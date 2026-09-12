"""SmartRecruiters career site scraper using the public Posting API (no browser).

WHY THIS EXISTS (2026-09-12)
----------------------------
SGS, Boskalis (incl. Gardline survey roles) and Vattenfall publish their
boards through SmartRecruiters. The vendor exposes a documented, unauthenticated
Posting API that is meant for exactly this kind of consumption (embedding a
company's live postings elsewhere):

    GET https://api.smartrecruiters.com/v1/companies/{company}/postings
        ?limit=100&offset=N[&q=term]
        -> {"totalFound": 106, "content": [{"id", "name", "releasedDate",
            "location": {"city", "region", "country", "fullLocation"},
            "typeOfEmployment": {"label"}, "refNumber", "company": {"identifier"}}]}

    GET https://api.smartrecruiters.com/v1/companies/{company}/postings/{id}
        -> {..., "jobAd": {"sections": {"companyDescription", "jobDescription",
            "qualifications", "additionalInformation": {"title", "text" (HTML)}}},
            "postingUrl", "active"}

One listing page per 100 postings, one detail request per posting the tracker
has not exported yet. A posting drops out of the listing when it is closed,
which is the lifecycle removal signal.

Optional `sr_config.queries` runs the listing once per full-text term and takes
the union (deduped by posting id). SGS lists ~4,500 postings worldwide, most of
them outside our sectors, so its config pulls the inspection / NDT / technician
slices instead of the whole board.

Job URLs are the public posting page without the slug,
https://jobs.smartrecruiters.com/{CompanyIdentifier}/{id}, which resolves and
is stable, so listing-only and detail paths agree on identity.
"""

import asyncio
from datetime import datetime
from typing import Callable, Optional

import httpx
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

API_BASE = "https://api.smartrecruiters.com/v1/companies"
PUBLIC_BASE = "https://jobs.smartrecruiters.com"
PAGE_SIZE = 100
MAX_LISTING_PAGES = 100
REQUEST_TIMEOUT = 30.0
MAX_ATTEMPTS = 4

_SECTION_ORDER = ('jobDescription', 'qualifications', 'additionalInformation', 'companyDescription')
_BLOCK_TAGS = ['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'section']


class SmartRecruitersScraper(BaseScraper):
    """Scrape a SmartRecruiters company board through the public Posting API."""

    def __init__(self, config: dict):
        super().__init__(config)
        sr = config.get('sr_config', {}) or {}
        self.company_id = sr.get('company') or self._company_from_url(config.get('base_url', ''))
        if not self.company_id:
            raise ValueError("sr_config.company (or a jobs.smartrecruiters.com base_url) is required")
        self.queries: list[str] = [q for q in (sr.get('queries') or []) if q]
        self.max_new_details = config.get('max_new_details_per_run')
        self._known_url_checker: Optional[Callable[[str], bool]] = None

    @staticmethod
    def _company_from_url(base_url: str) -> str:
        parts = [p for p in base_url.split('/') if p]
        # https://jobs.smartrecruiters.com/Boskalis -> Boskalis
        return parts[-1] if 'smartrecruiters.com' in base_url and len(parts) >= 3 else ''

    # ------------------------------------------------------------------ hooks

    def set_known_url_checker(self, checker: Callable[[str], bool]) -> None:
        """Known (already exported) postings skip the detail request; their
        URL alone is what the lifecycle diff needs."""
        self._known_url_checker = checker

    # ------------------------------------------------------------------ http

    def _headers(self) -> dict:
        return {
            'User-Agent': 'Mozilla/5.0 (compatible; MoblyzeJobScraper/1.0; +https://moblyze.me)',
            'Accept': 'application/json',
        }

    async def _request(self, client: httpx.AsyncClient, url: str, params: Optional[dict] = None) -> Optional[dict]:
        """GET with retry on 429/5xx/network errors; None on 404 or exhaustion."""
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                resp = await client.get(url, params=params, timeout=REQUEST_TIMEOUT)
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
                self.logger.warning("request_throttled_or_failed", url=url, status=resp.status_code,
                                    attempt=attempt, retry_in=delay)
                await asyncio.sleep(delay)
                continue
            self.logger.error("request_failed", url=url, status=resp.status_code, body=resp.text[:200])
            return None
        self.logger.error("request_exhausted", url=url, attempts=MAX_ATTEMPTS)
        return None

    # --------------------------------------------------------------- listing

    def _job_url(self, posting: dict) -> str:
        identifier = ((posting.get('company') or {}).get('identifier')) or self.company_id
        return f"{PUBLIC_BASE}/{identifier}/{posting['id']}"

    @staticmethod
    def _location(loc: Optional[dict]) -> str:
        loc = loc or {}
        full = (loc.get('fullLocation') or '').strip()
        if full:
            return full
        parts = [loc.get('city'), loc.get('region'), (loc.get('country') or '').upper()]
        joined = ', '.join(p for p in parts if p)
        if loc.get('remote') and not joined:
            return 'Remote'
        return joined or 'Location Not Specified'

    @staticmethod
    def _parse_date(value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            return datetime.strptime(value[:10], '%Y-%m-%d')
        except ValueError:
            return None

    def _card(self, posting: dict) -> Optional[dict]:
        pid = posting.get('id')
        title = (posting.get('name') or '').strip()
        if not pid or not title:
            return None
        return {
            'id': str(pid),
            'title': title,
            'url': self._job_url(posting),
            'company': self.company_name,
            'location': self._location(posting.get('location')),
            'posted_date': self._parse_date(posting.get('releasedDate')),
            'requisition_id': posting.get('refNumber') or str(pid),
            'employment_type': self._normalize_employment_type(
                (posting.get('typeOfEmployment') or {}).get('label')),
        }

    async def fetch_listing(self, client: httpx.AsyncClient, max_jobs: Optional[int] = None) -> list[dict]:
        """Page the listing once per query term (or once with no term) and
        return deduplicated cards."""
        cards: list[dict] = []
        seen: set[str] = set()
        terms: list[Optional[str]] = list(self.queries) or [None]

        for term in terms:
            offset = 0
            total: Optional[int] = None
            for page_num in range(MAX_LISTING_PAGES):
                if page_num > 0 or term is not terms[0]:
                    await self._rate_limit()
                params = {'limit': PAGE_SIZE, 'offset': offset}
                if term:
                    params['q'] = term
                data = await self._request(client, f"{API_BASE}/{self.company_id}/postings", params)
                if not data:
                    self.logger.error("listing_page_failed", offset=offset, query=term)
                    break
                if total is None:
                    total = int(data.get('totalFound') or 0)
                    self.logger.info("listing_total", total=total, query=term)
                content = data.get('content') or []
                new_this_page = 0
                for posting in content:
                    card = self._card(posting)
                    if not card or card['id'] in seen:
                        continue
                    seen.add(card['id'])
                    cards.append(card)
                    new_this_page += 1
                self.logger.info("page_extracted", query=term, page_number=page_num + 1,
                                 jobs_this_page=len(content), total_jobs=len(cards))
                offset += PAGE_SIZE
                if not content or offset >= total:
                    break
                if max_jobs and len(cards) >= max_jobs:
                    return cards
            if max_jobs and len(cards) >= max_jobs:
                break
        return cards

    # ---------------------------------------------------------------- detail

    @staticmethod
    def _html_to_text(html: Optional[str]) -> str:
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

    @classmethod
    def _description_from_ad(cls, job_ad: Optional[dict]) -> str:
        sections = (job_ad or {}).get('sections') or {}
        parts = []
        for key in _SECTION_ORDER:
            sec = sections.get(key) or {}
            text = cls._html_to_text(sec.get('text'))
            if text:
                title = (sec.get('title') or '').strip()
                parts.append(f"{title}\n{text}" if title and key != 'jobDescription' else text)
        return '\n\n'.join(parts)

    async def fetch_detail(self, client: httpx.AsyncClient, posting_id: str) -> Optional[dict]:
        data = await self._request(client, f"{API_BASE}/{self.company_id}/postings/{posting_id}")
        if not data:
            return None
        description = self._description_from_ad(data.get('jobAd'))
        if not description:
            return None
        return {
            'description': description,
            'location': self._location(data.get('location')),
            'posted_date': self._parse_date(data.get('releasedDate')),
            'employment_type': self._normalize_employment_type(
                (data.get('typeOfEmployment') or {}).get('label')),
            'requisition_id': data.get('refNumber') or None,
        }

    # ------------------------------------------------------------ interface

    async def extract_job_listings(self, page: Page) -> list[dict]:
        async with httpx.AsyncClient(headers=self._headers()) as client:
            return await self.fetch_listing(client)

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        posting_id = job_url.rstrip('/').rsplit('/', 1)[-1].split('-', 1)[0]
        async with httpx.AsyncClient(headers=self._headers()) as client:
            return await self.fetch_detail(client, posting_id) or {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        jobs: list[JobPosting] = []
        skipped_known = new_details = deferred = detail_failures = 0

        async with httpx.AsyncClient(headers=self._headers(), follow_redirects=True) as client:
            cards = await self.fetch_listing(client, max_jobs=max_jobs)
            self.logger.info("jobs_found_on_listing_page", count=len(cards))

            for card in cards:
                if max_jobs and len(jobs) >= max_jobs:
                    break
                try:
                    known = bool(self._known_url_checker and self._known_url_checker(card['url']))
                    if known:
                        skipped_known += 1
                        job_data = {k: v for k, v in card.items() if k != 'id'}
                        job_data['description'] = (
                            f"{card['title']} at {self.company_name} (listing only; detail already on file)"
                        )
                    else:
                        if self.max_new_details and new_details >= self.max_new_details:
                            deferred += 1
                            continue
                        new_details += 1
                        await self._rate_limit()
                        detail = await self.fetch_detail(client, card['id'])
                        if not detail:
                            detail_failures += 1
                            self.logger.warning("detail_unavailable", url=card['url'])
                            continue
                        job_data = {k: v for k, v in card.items() if k != 'id'}
                        for k, v in detail.items():
                            if v:
                                job_data[k] = v
                        job_data = self._enrich_with_certifications(job_data)
                    jobs.append(JobPosting(**job_data))
                except ValidationError as e:
                    self.logger.error("validation_failed", job_url=card.get('url'), errors=str(e))
                except Exception as e:  # noqa: BLE001 - one bad posting must not sink the run
                    self.logger.error("extraction_failed", job_url=card.get('url'), error=str(e))

        if deferred:
            self.logger.warning("new_details_deferred", deferred=deferred,
                                max_new_details_per_run=self.max_new_details,
                                note="Unseen postings left for a later run; lifecycle is unaffected")
        self.logger.info("extraction_complete", total_jobs=len(jobs), listing_only=skipped_known,
                         new_details=new_details, deferred=deferred, detail_failures=detail_failures)
        return jobs
