"""iCIMS career portal scraper, both portal flavors, over plain HTTP (no browser).

WHY THIS EXISTS (2026-09-12)
----------------------------
The Indeed-to-employer mapping (docs/plans/2026-09-12-indeed-employers-to-
direct-sources.md) put iCIMS first among the missing adapters: Acuren, EMCOR,
E2 Consulting on the legacy portal, Danos, Universal Engineering Sciences,
TRC and Diversified Energy on the newer "careers-home" portal. Both flavors
answer plain GETs.

Legacy portal (mode "legacy", host *.icims.com):

    GET https://{host}/jobs/search?ss=1&pr={page-1}&in_iframe=1
        -> server-rendered rows: div.row > a.iCIMS_Anchor[href=/jobs/{id}/{slug}/job]
           with "Job Locations" and Requisition ID / Position Type fields,
           and "Page 1 of N" for the page count.
    GET https://{host}/jobs/{id}/{slug}/job?in_iframe=1
        -> JSON-LD JobPosting (description HTML, datePosted, validThrough,
           employmentType, jobLocation address); .iCIMS_JobContent as fallback.

New portal (mode "portal", the employer's own careers host):

    GET https://{host}/api/jobs?page={N}&limit=100
        -> {"totalCount": 177, "jobs": [{"data": {"slug", "req_id", "title",
            "description" (HTML), "full_location", "city", "state", "country",
            "posted_date", "employment_type", "apply_url", ...}}]}
       Everything is in the listing; no detail request. Job page: /jobs/{slug}.

Closure signal for both: a job absent from the listing is retired by the
lifecycle diff. Legacy job pages also carry JSON-LD validThrough, logged in
the detail record for the lifecycle's benefit (not a sheet column yet).

Known URLs (already exported) skip the legacy detail request; new detail
fetches are budgeted with max_new_details_per_run as in workday_api.py.
Robots: iCIMS legacy hosts disallow only referral/login/candidate paths
(checked per tenant before configuring); tenants with "Disallow: /" (MasTec,
Kinder Morgan) are not configured.
"""

import asyncio
import json
import re
from datetime import datetime
from typing import Callable, Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

REQUEST_TIMEOUT = 30.0
MAX_ATTEMPTS = 4
MAX_PAGES = 300
PORTAL_PAGE_SIZE = 100

_PAGE_OF_RE = re.compile(r'Page\s+\d+\s+of\s+(\d+)', re.IGNORECASE)
_BLOCK_TAGS = ['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'section']


class ICIMSScraper(BaseScraper):
    """Scrape an iCIMS legacy portal (HTML) or new portal (JSON API)."""

    def __init__(self, config: dict):
        super().__init__(config)
        parsed = urlparse(config['base_url'])
        self.origin = f"{parsed.scheme}://{parsed.netloc}"
        icfg = config.get('icims_config', {}) or {}
        self.mode = icfg.get('mode') or ('legacy' if parsed.netloc.endswith('.icims.com') else 'portal')
        if self.mode not in ('legacy', 'portal'):
            raise ValueError(f"icims_config.mode must be 'legacy' or 'portal', got {self.mode!r}")
        self.max_new_details = config.get('max_new_details_per_run')
        self._known_url_checker: Optional[Callable[[str], bool]] = None
        # Reason the most recent _get() call returned None, so callers
        # (e.g. listing_page_failed) can log *why*, not just *that* it failed.
        self._last_request_error: Optional[str] = None

    # ------------------------------------------------------------------ hooks

    def set_known_url_checker(self, checker: Callable[[str], bool]) -> None:
        self._known_url_checker = checker

    def _is_known(self, url: str) -> bool:
        return bool(self._known_url_checker and self._known_url_checker(url))

    # ------------------------------------------------------------------ http

    def _headers(self) -> dict:
        return {
            'User-Agent': (
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ),
            'Accept': ('application/json, text/plain, */*' if self.mode == 'portal'
                       else 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
            'Accept-Language': 'en-US,en;q=0.9',
        }

    async def _get(self, client: httpx.AsyncClient, url: str) -> Optional[httpx.Response]:
        self._last_request_error = None
        last_exc_message: Optional[str] = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                resp = await client.get(url, timeout=REQUEST_TIMEOUT)
            except httpx.HTTPError as e:
                last_exc_message = f"{type(e).__name__}: {e}"
                self.logger.warning("request_exception", url=url, attempt=attempt, error=str(e))
                await asyncio.sleep(min(30, 2 ** attempt))
                continue
            if resp.status_code == 200:
                return resp
            if resp.status_code == 404:
                self._last_request_error = "404 resource_gone"
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
            self._last_request_error = f"HTTP {resp.status_code}"
            self.logger.error("request_failed", url=url, status=resp.status_code)
            return None
        self._last_request_error = last_exc_message or f"exhausted {MAX_ATTEMPTS} attempts (429/5xx)"
        self.logger.error("request_exhausted", url=url, attempts=MAX_ATTEMPTS, last_error=self._last_request_error)
        return None

    # --------------------------------------------------------------- parsing

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

    @staticmethod
    def _parse_date(value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            return datetime.strptime(str(value)[:10], '%Y-%m-%d')
        except ValueError:
            return None

    @staticmethod
    def canonical_legacy_url(href: str) -> str:
        """Strip the iframe flag and anything after /job."""
        base = href.split('?', 1)[0]
        m = re.match(r'(https?://[^/]+/jobs/\d+/[^/]+/job)', base)
        return m.group(1) if m else base

    @staticmethod
    def parse_legacy_page_count(html: str) -> Optional[int]:
        m = _PAGE_OF_RE.search(html)
        return int(m.group(1)) if m else None

    def parse_legacy_listing(self, html: str) -> list[dict]:
        soup = BeautifulSoup(html, 'html.parser')
        cards = []
        for row in soup.select('div.row'):
            link = row.select_one('a.iCIMS_Anchor[href*="/jobs/"], a[href*="/jobs/"][href*="/job"]')
            if not link or not link.get('href'):
                continue
            for hidden in link.select('.sr-only'):
                hidden.decompose()
            title = link.get_text(' ', strip=True)
            if not title:
                continue
            url = self.canonical_legacy_url(link['href'])
            if not url.startswith('http'):
                url = self.origin + url
            location = ''
            loc_label = row.find('span', class_='field-label', string=re.compile(r'Job Locations', re.I))
            if loc_label:
                sib = loc_label.find_next_sibling('span')
                if sib:
                    location = ' '.join(sib.get_text(' ', strip=True).split())
            fields = {}
            for tag in row.select('.iCIMS_JobHeaderTag'):
                dt = tag.select_one('dt')
                dd = tag.select_one('dd')
                if dt and dd:
                    fields[dt.get_text(' ', strip=True).lower()] = ' '.join(dd.get_text(' ', strip=True).split())
            req_id = fields.get('requisition id') or (re.search(r'/jobs/(\d+)/', url) or [None, None])[1]
            cards.append({
                'title': title,
                'url': url,
                'company': self.company_name,
                'location': location or 'Location Not Specified',
                'requisition_id': req_id,
                'employment_type': self._normalize_employment_type(fields.get('position type')),
                'posted_date': None,
            })
        return cards

    def parse_legacy_detail(self, html: str) -> Optional[dict]:
        soup = BeautifulSoup(html, 'html.parser')
        out: dict = {}
        for script in soup.select('script[type="application/ld+json"]'):
            try:
                data = json.loads(script.string or '')
            except (ValueError, TypeError):
                continue
            items = data if isinstance(data, list) else [data]
            for item in items:
                if not isinstance(item, dict) or item.get('@type') != 'JobPosting':
                    continue
                description = self._html_to_text(item.get('description'))
                if description:
                    out['description'] = description
                out['posted_date'] = self._parse_date(item.get('datePosted'))
                out['valid_through'] = self._parse_date(item.get('validThrough'))
                out['employment_type'] = self._normalize_employment_type(
                    item.get('employmentType') if isinstance(item.get('employmentType'), str) else None)
                locs = item.get('jobLocation') or []
                if isinstance(locs, dict):
                    locs = [locs]
                parts = []
                for loc in locs:
                    addr = (loc or {}).get('address') or {}
                    piece = ', '.join(p for p in (addr.get('addressLocality'), addr.get('addressRegion'),
                                                  addr.get('addressCountry')) if p)
                    if piece:
                        parts.append(piece)
                if parts:
                    out['location'] = '; '.join(dict.fromkeys(parts))
                break
        if not out.get('description'):
            node = soup.select_one('.iCIMS_JobContent') or soup.select_one('.iCIMS_JobPage')
            text = self._html_to_text(str(node)) if node else ''
            if text:
                out['description'] = text
        return out if out.get('description') else None

    def portal_job_url(self, data: dict) -> str:
        return f"{self.origin}/jobs/{data.get('slug') or data.get('req_id')}"

    def parse_portal_job(self, job: dict) -> Optional[dict]:
        data = job.get('data') or job
        title = (data.get('title') or '').strip()
        if not title or not (data.get('slug') or data.get('req_id')):
            return None
        description = self._html_to_text(data.get('description'))
        for extra_key in ('responsibilities', 'qualifications'):
            extra = self._html_to_text(data.get(extra_key))
            if extra and extra not in description:
                description = f"{description}\n\n{extra}" if description else extra
        location = (data.get('full_location') or data.get('location_name') or ', '.join(
            p for p in (data.get('city'), data.get('state'), data.get('country')) if p)).strip()
        salary = None
        try:
            if float(data.get('salary_value') or 0) > 0:
                salary = str(data.get('salary_value'))
        except (TypeError, ValueError):
            pass
        return {
            'title': title,
            'url': self.portal_job_url(data),
            'company': self.company_name,
            'location': location or 'Location Not Specified',
            'description': description,
            'posted_date': self._parse_date(data.get('posted_date')),
            'requisition_id': str(data.get('req_id') or data.get('slug')),
            'employment_type': self._normalize_employment_type(
                (data.get('employment_type') or '').replace('_', ' ') or None),
            'salary': salary,
        }

    # --------------------------------------------------------------- listing

    async def fetch_legacy_listing(self, client: httpx.AsyncClient, max_jobs: Optional[int] = None) -> list[dict]:
        cards: list[dict] = []
        seen: set[str] = set()
        pages: Optional[int] = None
        for page_num in range(MAX_PAGES):
            if page_num > 0:
                await self._rate_limit()
            resp = await self._get(client, f"{self.origin}/jobs/search?ss=1&pr={page_num}&in_iframe=1")
            if resp is None:
                self.logger.error(
                    "listing_page_failed", page=page_num + 1,
                    reason=self._last_request_error or "unknown (no response captured)",
                )
                break
            if pages is None:
                pages = self.parse_legacy_page_count(resp.text) or 1
                self.logger.info("listing_pages", pages=pages)
            rows = self.parse_legacy_listing(resp.text)
            new = 0
            for card in rows:
                if card['url'] in seen:
                    continue
                seen.add(card['url'])
                cards.append(card)
                new += 1
            self.logger.info("page_extracted", page_number=page_num + 1, jobs_this_page=len(rows), total_jobs=len(cards))
            if not rows or new == 0 or page_num + 1 >= pages:
                break
            if max_jobs and len(cards) >= max_jobs:
                break
        return cards

    async def fetch_portal_listing(self, client: httpx.AsyncClient, max_jobs: Optional[int] = None) -> list[dict]:
        cards: list[dict] = []
        seen: set[str] = set()
        total: Optional[int] = None
        for page_num in range(1, MAX_PAGES + 1):
            if page_num > 1:
                await self._rate_limit()
            resp = await self._get(client, f"{self.origin}/api/jobs?page={page_num}&limit={PORTAL_PAGE_SIZE}")
            if resp is None:
                self.logger.error(
                    "listing_page_failed", page=page_num,
                    reason=self._last_request_error or "unknown (no response captured)",
                )
                break
            try:
                data = resp.json()
            except ValueError as e:
                self.logger.error("json_parse_failed", page=page_num, error=str(e))
                break
            if total is None:
                total = int(data.get('totalCount') or 0)
                self.logger.info("listing_total", total=total)
            jobs = data.get('jobs') or []
            new = 0
            for job in jobs:
                card = self.parse_portal_job(job)
                if not card or card['url'] in seen:
                    continue
                seen.add(card['url'])
                cards.append(card)
                new += 1
            self.logger.info("page_extracted", page_number=page_num, jobs_this_page=len(jobs), total_jobs=len(cards))
            if not jobs or new == 0 or len(cards) >= total:
                break
            if max_jobs and len(cards) >= max_jobs:
                break
        if total is not None and len(cards) < total and not max_jobs:
            self.logger.warning("listing_incomplete", collected=len(cards), total=total)
        return cards

    async def fetch_detail(self, client: httpx.AsyncClient, url: str) -> Optional[dict]:
        resp = await self._get(client, f"{url}?in_iframe=1")
        if resp is None:
            return None
        return self.parse_legacy_detail(resp.text)

    # ------------------------------------------------------------ interface

    async def extract_job_listings(self, page: Page) -> list[dict]:
        async with httpx.AsyncClient(headers=self._headers(), follow_redirects=True) as client:
            if self.mode == 'portal':
                return await self.fetch_portal_listing(client)
            return await self.fetch_legacy_listing(client)

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        async with httpx.AsyncClient(headers=self._headers(), follow_redirects=True) as client:
            return await self.fetch_detail(client, job_url) or {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        jobs: list[JobPosting] = []
        skipped_known = new_details = deferred = detail_failures = 0

        async with httpx.AsyncClient(headers=self._headers(), follow_redirects=True) as client:
            if self.mode == 'portal':
                cards = await self.fetch_portal_listing(client, max_jobs=max_jobs)
            else:
                cards = await self.fetch_legacy_listing(client, max_jobs=max_jobs)
            self.logger.info("jobs_found_on_listing_page", count=len(cards), mode=self.mode)

            for card in cards:
                if max_jobs and len(jobs) >= max_jobs:
                    break
                try:
                    job_data = dict(card)
                    if self.mode == 'portal':
                        if not job_data.get('description'):
                            job_data['description'] = f"{card['title']} at {self.company_name}"
                        job_data = self._enrich_with_certifications(job_data)
                    elif self._is_known(card['url']):
                        skipped_known += 1
                        job_data['description'] = (
                            f"{card['title']} at {self.company_name} (listing only; detail already on file)"
                        )
                    else:
                        if self.max_new_details and new_details >= self.max_new_details:
                            deferred += 1
                            continue
                        new_details += 1
                        await self._rate_limit()
                        detail = await self.fetch_detail(client, card['url'])
                        if not detail:
                            detail_failures += 1
                            self.logger.warning("detail_unavailable", url=card['url'])
                            continue
                        for key in ('description', 'posted_date', 'location', 'employment_type'):
                            if detail.get(key):
                                job_data[key] = detail[key]
                        if detail.get('valid_through'):
                            self.logger.debug("valid_through", url=card['url'], valid_through=detail['valid_through'].date())
                        job_data = self._enrich_with_certifications(job_data)
                    jobs.append(JobPosting(**job_data))
                except ValidationError as e:
                    self.logger.error("validation_failed", job_url=card.get('url'), errors=str(e))
                except Exception as e:  # noqa: BLE001 - one bad job must not sink the run
                    self.logger.error("extraction_failed", job_url=card.get('url'), error=str(e))

        if deferred:
            self.logger.warning("new_details_deferred", deferred=deferred,
                                max_new_details_per_run=self.max_new_details,
                                note="Unseen jobs left for a later run; lifecycle is unaffected")
        self.logger.info("extraction_complete", total_jobs=len(jobs), mode=self.mode, listing_only=skipped_known,
                         new_details=new_details, deferred=deferred, detail_failures=detail_failures)
        return jobs
