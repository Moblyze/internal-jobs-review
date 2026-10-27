"""Kuiper Group (jobs.kuiper-group.com/online) careers portal scraper.

Kuiper Group is an offshore/energy manpower agency. Its website's "Job Search"
link (kuiper-group.com/jobs/) points at this portal, a jQuery app that loads the
list from its own JSON endpoint:

    POST /online/jobs/getJobListing
         sort_by=DESC&per_page=10&page=N   (sort_by is required; empty -> PHP fatal)
    -> {"success": true, "data": {"job_list": {"count": 3, "data": [
          {"id": 70, "position": "Floorman", "work_site": "",
           "country": {"name": "SAUDI ARABIA"}, "sector": "Oil & Gas",
           "job_type": "Full Time", "no_of_req": 100,
           "show_salary_on_website": 0, "currency": "SAR", "salary_format": "",
           "date_open": "04/16/2025", "date_close": "2035-07-15",
           "created_at": "2025-04-16T08:26:31.000000Z",
           "manpowerrequestwebsite": {"principalwebsite": {"name": "H&P Drilling"}}}]}}}

The description is only on the detail page, `/online/jobs/view_job_details?id=<id>`,
in `div#job_description`.

⚠️ CrewBase lists 227 active "Kuiper" rows (Oct 27, 2026) but this portal listed
only 3 the same day, all H&P Drilling roles in Saudi Arabia. Most CrewBase Kuiper
rows read like email-application adverts ("send your CV with '4TH ENGINEER' in the
subject line"), which have no page to collect. So this replaces very little.

robots.txt: none (404), so nothing is disallowed.

Config:
    platform: kuiper
    base_url: "https://jobs.kuiper-group.com/online"
"""

import asyncio
from datetime import datetime
from typing import Optional

import httpx
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper
from src.utils.salary import extract_salary

logger = structlog.get_logger()

REQUEST_TIMEOUT = 30.0
USER_AGENT = 'Mozilla/5.0 (compatible; MoblyzeJobScraper/1.0; +https://moblyze.me)'
PER_PAGE = 10
MAX_PAGES = 50


def build_location(job: dict) -> str:
    site = str(job.get('work_site') or '').strip()
    country = str((job.get('country') or {}).get('name') or '').strip().title()
    parts = [p for p in (site, country) if p]
    return ', '.join(parts) if parts else 'Location Not Specified'


def build_salary(job: dict) -> Optional[str]:
    """Pay only when the employer chose to show it on the website."""
    if not job.get('show_salary_on_website'):
        return None
    amount = str(job.get('salary_format') or '').strip()
    if not amount:
        return None
    currency = str(job.get('currency') or '').strip()
    return f'{currency} {amount}'.strip()


def client_name(job: dict) -> str:
    return str(((job.get('manpowerrequestwebsite') or {}).get('principalwebsite') or {}).get('name') or '').strip()


def parse_detail_description(html: str) -> str:
    soup = BeautifulSoup(html, 'html.parser')
    node = soup.select_one('#job_description')
    return node.get_text('\n', strip=True) if node else ''


def build_description(job: dict, body: str) -> str:
    header = []
    if client_name(job):
        header.append(f"Client: {client_name(job)}")
    for label, key in (('Sector', 'sector'), ('Job type', 'job_type'), ('Experience', 'yrs_exp')):
        if job.get(key):
            header.append(f'{label}: {job[key]}')
    return '\n'.join(header + ([body] if body else [])).strip()


def _posted(job: dict) -> Optional[datetime]:
    raw = job.get('created_at')
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
    except ValueError:
        return None


class KuiperScraper(BaseScraper):
    """JSON listing + detail page scraper for the Kuiper Group careers portal."""

    def __init__(self, config: dict):
        super().__init__(config)
        self.base_url = config.get('base_url', 'https://jobs.kuiper-group.com/online').rstrip('/')

    async def extract_job_listings(self, page: Page) -> list[dict]:
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        return {}

    async def fetch_listing(self, client: httpx.AsyncClient) -> list[dict]:
        jobs: dict[int, dict] = {}
        total = None
        for page in range(1, MAX_PAGES + 1):
            if page > 1:
                await asyncio.sleep(self.rate_limit_delay)
            try:
                resp = await client.post(
                    f'{self.base_url}/jobs/getJobListing',
                    data={'hashid': '', 'position': '', 'currency': '', 'salary_min': '',
                          'salary_max': '', 'country': '', 'sort_by': 'DESC',
                          'per_page': PER_PAGE, 'page': page},
                )
                resp.raise_for_status()
                payload = resp.json()
            except (httpx.HTTPError, ValueError) as exc:
                self.logger.error('kuiper_listing_failed', page=page, error=str(exc))
                break
            job_list = (payload.get('data') or {}).get('job_list') or {}
            total = job_list.get('count', total)
            batch = job_list.get('data') or []
            new = 0
            for job in batch:
                if job.get('id') is not None and job['id'] not in jobs:
                    jobs[job['id']] = job
                    new += 1
            if not new or (total is not None and len(jobs) >= int(total)):
                break
        self.logger.info('kuiper_listing', listed_total=total, found=len(jobs))
        return list(jobs.values())

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        out: list[JobPosting] = []
        async with httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT, headers={'User-Agent': USER_AGENT}, follow_redirects=True
        ) as client:
            listing = await self.fetch_listing(client)
            if max_jobs:
                listing = listing[:max_jobs]
            for job in listing:
                url = f"{self.base_url}/jobs/view_job_details?id={job['id']}"
                body = ''
                await asyncio.sleep(self.rate_limit_delay)
                try:
                    resp = await client.get(url)
                    if resp.status_code == 200:
                        body = parse_detail_description(resp.text)
                except httpx.HTTPError as exc:
                    self.logger.warning('kuiper_detail_failed', url=url, error=str(exc))
                title = str(job.get('position') or '').strip()
                description = build_description(job, body)
                job_data = {
                    'title': title,
                    'company': self.company_name,
                    'location': build_location(job),
                    'description': description,
                    'url': url,
                    'posted_date': _posted(job),
                    'requisition_id': str(job['id']),
                    'employment_type': self._normalize_employment_type(job.get('job_type')),
                    'salary': build_salary(job) or extract_salary(description),
                }
                try:
                    out.append(JobPosting(**self._enrich_with_certifications(job_data)))
                except ValidationError as exc:
                    self.logger.warning('kuiper_job_invalid', title=title[:60], error=str(exc))
        self.logger.info('extraction_complete', company=self.company_name, total_jobs=len(out))
        return out
