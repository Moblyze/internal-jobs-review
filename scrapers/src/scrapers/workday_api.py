"""Workday career portal scraper using the public CXS JSON API (no browser).

WHY THIS EXISTS (2026-09-12)
----------------------------
The Playwright-based WorkdayScraper renders every listing page and every job
detail page in headless Chromium. All employer scrapers run concurrently on one
GitHub Actions runner, so under that load a single Workday detail page takes
10-17 seconds. Baker Hughes (~570 jobs) and BP (~365) blew through the 45 minute
per-company timeout every day, and KBR (~1,700 jobs) timed out before it even
finished paginating the listing. None of the three had a successful scrape for
months (KBR since 2026-03-12).

Every Workday tenant exposes the same JSON API its own single-page app uses:

    POST https://{host}/wday/cxs/{tenant}/{site}/jobs
         {"appliedFacets": {}, "limit": 20, "offset": N, "searchText": ""}
         -> {"total": 573, "jobPostings": [{"title", "externalPath",
             "locationsText", "postedOn", "bulletFields": ["R164317"]}, ...]}

    GET  https://{host}/wday/cxs/{tenant}/{site}{externalPath}
         -> {"jobPostingInfo": {"title", "jobDescription" (HTML), "location",
             "postedOn", "startDate", "timeType", "jobReqId", ...}}

One small JSON request per job instead of a full page render. Job URLs are
built as https://{host}/{locale}/{site}{externalPath}, which is byte-for-byte
the URL the browser scraper recorded, so the dedup tracker and the lifecycle
manager see the same identities and no history is lost.

Used by: Baker Hughes, KBR (platform: workday_api in companies.yaml).
The browser-based WorkdayScraper (platform: workday) is unchanged for the
tenants where it still works.
"""

import asyncio
import re
from datetime import datetime
from typing import Callable, Optional
from urllib.parse import urlparse

import dateparser
import httpx
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper
from src.scrapers.workday import extract_workday_requisition_id, parse_workday_location

# Workday's CXS endpoint rejects limit > 20 with HTTP 400.
PAGE_SIZE = 20
# Safety cap on listing pages (20 x 400 = 8,000 postings).
MAX_LISTING_PAGES = 400
REQUEST_TIMEOUT = 30.0
MAX_ATTEMPTS = 4

_BLOCK_TAGS = ['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'section']
_SALARY_RE = re.compile(
    r'\$[\d,]+(?:\s*-\s*\$?[\d,]+)?(?:\s*(?:per|/)\s*(?:year|hour|yr|hr))?',
    re.IGNORECASE,
)
_REQUIREMENTS_RE = re.compile(
    r'(?:Requirements?|Qualifications?|Skills?)[\s:]+(.+?)'
    r'(?:Responsibilities|Duties|Benefits|Equal Opportunity|$)',
    re.DOTALL | re.IGNORECASE,
)


class WorkdayApiScraper(BaseScraper):
    """Scrape a Workday career site through its CXS JSON API."""

    def __init__(self, config: dict):
        super().__init__(config)
        parsed = urlparse(config['base_url'])
        self.host = parsed.netloc
        path_parts = [p for p in parsed.path.split('/') if p]
        if not path_parts and not config.get('wd_site'):
            raise ValueError(f"base_url must include the Workday site path: {config['base_url']}")
        self.site = config.get('wd_site') or path_parts[-1]
        # Tenant is the first DNS label: bakerhughes.wd5.myworkdayjobs.com -> bakerhughes
        self.tenant = config.get('wd_tenant') or self.host.split('.')[0]
        # Locale segment used in the public job URLs (matches historical rows).
        self.locale = config.get('url_locale', 'en-US')
        self.api_base = f"https://{self.host}/wday/cxs/{self.tenant}/{self.site}"
        self._known_url_checker: Optional[Callable[[str], bool]] = None

    # ------------------------------------------------------------------ hooks

    def set_known_url_checker(self, checker: Callable[[str], bool]) -> None:
        """Install a predicate that says whether a job URL is already on file.

        main.py passes DeduplicationTracker.is_duplicate here. For URLs that are
        already exported we skip the detail request: the job still counts as
        present for the lifecycle diff (URL only), but it is a duplicate for the
        exporter, so its placeholder description never reaches the sheet. This
        turns a 1,700-request daily run (KBR) into ~90 requests.
        """
        self._known_url_checker = checker

    # ------------------------------------------------------------------ http

    def _headers(self) -> dict:
        return {
            'User-Agent': (
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ),
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': self.config['base_url'],
        }

    async def _request(
        self,
        client: httpx.AsyncClient,
        method: str,
        url: str,
        json_body: Optional[dict] = None,
    ) -> Optional[dict]:
        """Issue one API request with retry on 429/5xx/network errors.

        Returns the parsed JSON, or None if the resource is definitively gone
        (404) or all attempts failed.
        """
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                resp = await client.request(method, url, json=json_body, timeout=REQUEST_TIMEOUT)
            except httpx.HTTPError as e:
                self.logger.warning("request_exception", url=url, attempt=attempt, error=str(e))
                await asyncio.sleep(min(30, 2 ** attempt))
                continue

            if resp.status_code == 200:
                try:
                    return resp.json()
                except ValueError as e:
                    self.logger.warning("json_parse_failed", url=url, error=str(e))
                    return None

            if resp.status_code == 404:
                self.logger.info("resource_gone", url=url)
                return None

            if resp.status_code == 429 or resp.status_code >= 500:
                retry_after = resp.headers.get('Retry-After')
                try:
                    delay = float(retry_after) if retry_after else min(60, 3 * 2 ** attempt)
                except ValueError:
                    delay = min(60, 3 * 2 ** attempt)
                self.logger.warning(
                    "request_throttled_or_failed",
                    url=url, status=resp.status_code, attempt=attempt, retry_in=delay,
                )
                await asyncio.sleep(delay)
                continue

            self.logger.error("request_failed", url=url, status=resp.status_code, body=resp.text[:200])
            return None

        self.logger.error("request_exhausted", url=url, attempts=MAX_ATTEMPTS)
        return None

    # --------------------------------------------------------------- listing

    def _job_url(self, external_path: str) -> str:
        return f"https://{self.host}/{self.locale}/{self.site}{external_path}"

    async def fetch_listing(
        self,
        client: httpx.AsyncClient,
        max_jobs: Optional[int] = None,
    ) -> list[dict]:
        """Page through the CXS jobs endpoint and return listing cards.

        Each card: title, url, external_path, company, requisition_id,
        location_raw, posted_on.
        """
        cards: list[dict] = []
        seen_paths: set[str] = set()
        total: Optional[int] = None
        offset = 0
        page_num = 0

        while page_num < MAX_LISTING_PAGES:
            if page_num > 0:
                await self._rate_limit()
            page_num += 1

            data = await self._request(
                client, 'POST', f"{self.api_base}/jobs",
                json_body={'appliedFacets': {}, 'limit': PAGE_SIZE, 'offset': offset, 'searchText': ''},
            )
            if not data:
                self.logger.error("listing_page_failed", offset=offset)
                break

            if total is None:
                total = int(data.get('total') or 0)
                self.logger.info("listing_total", total=total)

            postings = data.get('jobPostings') or []
            new_this_page = 0
            for p in postings:
                path = p.get('externalPath')
                title = (p.get('title') or '').strip()
                if not path or not title or path in seen_paths:
                    continue
                seen_paths.add(path)
                new_this_page += 1
                bullets = p.get('bulletFields') or []
                cards.append({
                    'title': title,
                    'url': self._job_url(path),
                    'external_path': path,
                    'company': self.company_name,
                    'requisition_id': (bullets[0] if bullets else None)
                                      or extract_workday_requisition_id(path),
                    'location_raw': p.get('locationsText') or '',
                    'posted_on': p.get('postedOn') or '',
                })

            self.logger.info(
                "page_extracted", page_number=page_num, jobs_this_page=len(postings),
                total_jobs=len(cards),
            )

            offset += PAGE_SIZE
            if not postings or new_this_page == 0 or offset >= total:
                break
            if max_jobs and len(cards) >= max_jobs:
                break

        if total is not None and len(cards) < total and not max_jobs:
            self.logger.warning("listing_incomplete", collected=len(cards), total=total)
        return cards

    # ---------------------------------------------------------------- detail

    @staticmethod
    def _html_to_text(html: Optional[str]) -> str:
        """Flatten Workday's description HTML: block elements become lines,
        inline markup (bold, links) stays on its line."""
        if not html:
            return ''
        soup = BeautifulSoup(html, 'html.parser')
        for br in soup.find_all('br'):
            br.replace_with('\n')
        for tag in soup.find_all(_BLOCK_TAGS):
            tag.insert_before('\n')
            tag.insert_after('\n')
        lines = [' '.join(ln.split()) for ln in soup.get_text().split('\n')]
        return '\n'.join(ln for ln in lines if ln)

    @staticmethod
    def _parse_posted(posted_on: str, start_date: Optional[str]) -> Optional[datetime]:
        """Prefer Workday's ISO startDate; fall back to the relative 'Posted ...' text."""
        if start_date:
            try:
                return datetime.strptime(start_date[:10], '%Y-%m-%d')
            except ValueError:
                pass
        text = (posted_on or '').lower().replace('posted on', '').replace('posted', '').strip()
        if not text or '+' in text:  # "30+ days ago" is not a date
            return None
        return dateparser.parse(text, settings={'RELATIVE_BASE': datetime.now()})

    @staticmethod
    def _skills_from_description(description: str) -> list[str]:
        skills: list[str] = []
        match = _REQUIREMENTS_RE.search(description or '')
        if match:
            for line in match.group(1).split('\n'):
                line = line.strip().lstrip('•-*·').strip()
                if line and len(line) < 200:
                    skills.append(line)
                    if len(skills) >= 10:
                        break
        return skills

    async def fetch_detail(self, client: httpx.AsyncClient, external_path: str) -> Optional[dict]:
        """Fetch one job's detail JSON and map it onto JobPosting fields."""
        data = await self._request(client, 'GET', f"{self.api_base}{external_path}")
        if not data:
            return None
        info = data.get('jobPostingInfo') or {}
        description = self._html_to_text(info.get('jobDescription'))
        if not description:
            return None

        salary_match = _SALARY_RE.search(description)
        return {
            'description': description,
            'location': parse_workday_location(info.get('location') or ''),
            'posted_date': self._parse_posted(info.get('postedOn') or '', info.get('startDate')),
            'employment_type': self._normalize_employment_type(info.get('timeType')),
            'requisition_id': info.get('jobReqId') or None,
            'skills': self._skills_from_description(description),
            'salary': salary_match.group(0) if salary_match else None,
        }

    # ------------------------------------------------------------ interface

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """Required by BaseScraper; the API path does not use a Playwright page."""
        async with httpx.AsyncClient(headers=self._headers()) as client:
            return await self.fetch_listing(client)

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """Required by BaseScraper; the API path does not use a Playwright page."""
        external_path = job_url.split(f"/{self.site}", 1)[-1]
        async with httpx.AsyncClient(headers=self._headers()) as client:
            return await self.fetch_detail(client, external_path) or {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        jobs: list[JobPosting] = []
        skipped_known = 0
        detail_failures = 0

        async with httpx.AsyncClient(headers=self._headers(), follow_redirects=True) as client:
            cards = await self.fetch_listing(client, max_jobs=max_jobs)
            self.logger.info("jobs_found_on_listing_page", count=len(cards))
            if len(cards) < 50:
                self.logger.warning("low_job_count", count=len(cards), note="Unexpectedly low job count")

            max_detail_pages = self.config.get('max_detail_pages')
            if max_detail_pages and len(cards) > max_detail_pages:
                self.logger.warning(
                    "capping_detail_pages", total_listings=len(cards), max_detail_pages=max_detail_pages,
                )
                cards = cards[:max_detail_pages]

            # Per-run budget for NEW detail fetches. Jobs the tracker has never
            # seen can be left out of a run without side effects: the
            # lifecycle diff only retires jobs that are active in the DB, and
            # a job that is not returned is simply picked up on a later run.
            # This lets a large tenant (KBR: 1,700 postings) catch up over a
            # few days at ~1 request/s instead of one multi-hour run.
            max_new_details = self.config.get('max_new_details_per_run')
            new_details = 0
            deferred = 0

            for card in cards:
                if max_jobs and len(jobs) >= max_jobs:
                    self.logger.info("max_jobs_reached", limit=max_jobs)
                    break

                try:
                    if self._known_url_checker and self._known_url_checker(card['url']):
                        # Already exported: URL is all the lifecycle needs. The
                        # placeholder description never reaches the sheet because
                        # the tracker filters this job out before export.
                        skipped_known += 1
                        job_data = {
                            'title': card['title'],
                            'url': card['url'],
                            'company': card['company'],
                            'requisition_id': card['requisition_id'],
                            'location': parse_workday_location(card['location_raw']),
                            'description': f"{card['title']} at {self.company_name} (listing only; detail already on file)",
                            'posted_date': self._parse_posted(card['posted_on'], None),
                        }
                    else:
                        if max_new_details and new_details >= max_new_details:
                            deferred += 1
                            continue
                        new_details += 1
                        await self._rate_limit()
                        detail = await self.fetch_detail(client, card['external_path'])
                        if not detail:
                            detail_failures += 1
                            self.logger.warning("detail_unavailable", url=card['url'])
                            continue
                        job_data = {
                            'title': card['title'],
                            'url': card['url'],
                            'company': card['company'],
                            'requisition_id': detail.get('requisition_id') or card['requisition_id'],
                            **{k: v for k, v in detail.items() if k != 'requisition_id'},
                        }
                        job_data = self._enrich_with_certifications(job_data)

                    jobs.append(JobPosting(**job_data))
                except ValidationError as e:
                    self.logger.error("validation_failed", job_url=card.get('url'), errors=str(e))
                except Exception as e:  # noqa: BLE001 - one bad job must not sink the run
                    self.logger.error("extraction_failed", job_url=card.get('url'), error=str(e))

        if deferred:
            self.logger.warning(
                "new_details_deferred", deferred=deferred, max_new_details_per_run=max_new_details,
                note="Unseen jobs left for a later run; lifecycle is unaffected",
            )
        self.logger.info(
            "extraction_complete", total_jobs=len(jobs), listing_only=skipped_known,
            new_details=new_details, deferred=deferred, detail_failures=detail_failures,
        )
        return jobs
