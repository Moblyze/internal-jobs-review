"""Bullhorn OSCP (Open Source Career Portal) scraper.

Employers running Bullhorn's career-portal widget embed it as a client-rendered
Angular SPA inside a same-origin iframe, so there is nothing in the outer DOM to
select against and html_generic cannot see the jobs. The widget itself reads a
public, unauthenticated REST endpoint, which is what this adapter calls.

Used by: Peak Ocean Group (126 jobs), TEXO Recruitment (36 jobs).

Config:
    platform: bullhorn
    bullhorn_corp_token: "C5RJPS"
    bullhorn_swimlane: "rest61"     # the public-restNN host the portal uses

Both values come from the portal's own network calls; they differ per employer
and there is no way to derive one from the other. Verified live 2026-09-17,
Peak Ocean and TEXO return an IDENTICAL field shape and differ only in these
two values, which is what made one adapter worth writing for both.

    https://public-rest61.bullhornstaffing.com/rest-services/C5RJPS/search/JobOrder
        ?query=(isOpen:1) AND (isDeleted:0)
        &fields=...&start=0&count=30&sort=-dateLastPublished&showTotalMatched=true

    {"total": 126, "data": [{
        "id": 12345,
        "title": "Supply Chain Supervisor",
        "publicDescription": "<p>...</p>",          # HTML, ~8,700 chars
        "address": {"city": "District 9", "state": null, "countryName": "..."},
        "employmentType": "Permanent",
        "dateLastPublished": 1789444749853,          # epoch MILLISECONDS
        "salary": 8000.0, "salaryUnit": "Monthly"
    }, ...]}
"""

from datetime import datetime, timezone
from typing import Optional

import httpx
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()

REQUEST_TIMEOUT = 30.0
PAGE_SIZE = 30            # what the portal itself requests
MAX_PAGES = 40            # runaway guard: 1,200 jobs is far beyond any of these boards
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)

FIELDS = (
    'id,title,address(city,state,countryName),employmentType,'
    'dateLastPublished,publicDescription,isOpen,isPublic,isDeleted'
)
# The portal's own filter. Without it the endpoint happily returns closed and
# deleted requisitions, which would put filled jobs on the public site.
QUERY = '(isOpen:1) AND (isDeleted:0)'


def search_url(swimlane: str, corp_token: str) -> str:
    return f"https://public-{swimlane}.bullhornstaffing.com/rest-services/{corp_token}/search/JobOrder"


def build_location(job: dict) -> str:
    """"City, State, Country" from the address block, skipping empty parts."""
    address = job.get('address') or {}
    parts = [
        str(address.get(key) or '').strip()
        for key in ('city', 'state', 'countryName')
    ]
    seen: list[str] = []
    for part in parts:
        if part and part.lower() not in {s.lower() for s in seen}:
            seen.append(part)
    return ', '.join(seen) if seen else 'Location Not Specified'


def build_description(job: dict) -> str:
    """`publicDescription` as text. It is HTML and it is the whole advert."""
    html = (job.get('publicDescription') or '').strip()
    if not html:
        return ''
    return BeautifulSoup(html, 'html.parser').get_text(separator='\n', strip=True)


def build_posted_date(job: dict) -> Optional[datetime]:
    """`dateLastPublished` is epoch MILLISECONDS, like Lever's createdAt."""
    value = job.get('dateLastPublished')
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    try:
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


class BullhornScraper(BaseScraper):
    """Scraper for Bullhorn OSCP career portals."""

    def __init__(self, config: dict):
        super().__init__(config)
        self.corp_token = config.get('bullhorn_corp_token', '')
        self.swimlane = config.get('bullhorn_swimlane', '')
        self.base_url = config.get('base_url', '')

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """Not used: the REST endpoint returns whole jobs, not stubs."""
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """Not used: `publicDescription` is already the full advert."""
        return {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        if not self.corp_token or not self.swimlane:
            self.logger.error(
                'bullhorn_config_incomplete',
                note='bullhorn_corp_token and bullhorn_swimlane are both required',
            )
            return []

        url = search_url(self.swimlane, self.corp_token)
        raw: list[dict] = []
        total: Optional[int] = None

        try:
            async with httpx.AsyncClient(
                timeout=REQUEST_TIMEOUT, headers={'User-Agent': USER_AGENT}
            ) as client:
                for page_num in range(MAX_PAGES):
                    if page_num > 0:
                        await self._rate_limit()
                    params = {
                        'query': QUERY,
                        'fields': FIELDS,
                        'start': page_num * PAGE_SIZE,
                        'count': PAGE_SIZE,
                        'sort': '-dateLastPublished',
                        'showTotalMatched': 'true',
                    }
                    response = await client.get(url, params=params)
                    response.raise_for_status()
                    payload = response.json()
                    batch = payload.get('data') or []
                    if total is None:
                        total = payload.get('total')
                    raw.extend(batch)
                    if len(batch) < PAGE_SIZE or (max_jobs and len(raw) >= max_jobs):
                        break
        except (httpx.HTTPError, ValueError) as exc:
            self.logger.error('bullhorn_fetch_failed', url=url, error=str(exc))
            return []

        self.logger.info('bullhorn_jobs_fetched', url=url, fetched=len(raw), total=total)
        if max_jobs:
            raw = raw[:max_jobs]

        jobs: list[JobPosting] = []
        for job in raw:
            title = str(job.get('title') or '').strip()
            description = build_description(job)
            job_id = job.get('id')
            if not title or not job_id or len(description) < 10:
                continue

            job_data = {
                'title': title,
                'company': self.company_name,
                'location': build_location(job),
                'description': description,
                # The portal has no per-job permalink of its own; the widget is
                # a hash-routed SPA, so this is the honest public address.
                'url': f"{self.base_url.rstrip('/')}/#/job/{job_id}",
                'posted_date': build_posted_date(job),
                'employment_type': self._normalize_employment_type(job.get('employmentType')),
                'requisition_id': str(job_id),
                # Salary is deliberately NOT taken. The feed carries an amount
                # and a period ("8000.0", "Monthly") but NO CURRENCY, and these
                # are international crewing boards where the difference between
                # USD and PHP is the whole meaning. An amount we cannot label is
                # worse on a page than no amount at all.
            }

            try:
                jobs.append(JobPosting(**self._enrich_with_certifications(job_data)))
            except ValidationError as exc:
                self.logger.warning('bullhorn_job_invalid', title=title[:60], error=str(exc))

        self.logger.info('extraction_complete', company=self.company_name, total_jobs=len(jobs))
        return jobs
