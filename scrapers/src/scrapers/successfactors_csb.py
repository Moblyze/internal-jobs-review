"""SuccessFactors Career Site Builder scraper over plain HTTP (no browser).

WHY THIS EXISTS (2026-09-12)
----------------------------
The existing successfactors.py targets the TalentBrew front end (Halliburton,
TechnipFMC, PG&E), renders every page in Chromium and re-fetches every detail
page on every run. Vestas, RWE and NextEra run SAP's native Career Site
Builder instead: the search results and the job pages are server-rendered
HTML that a plain GET returns in full, and the site publishes a sitemap.xml
listing every live job URL. Rendering ~640 Vestas detail pages in a browser
would blow the 45 minute company timeout; one small GET per new job does not.

    GET {origin}{search_path}?q=&startrow=N
        -> <tr class="data-row"><td class="colTitle"><a class="jobTitle-link"
           href="/job/<slug>/<id>/">Title</a></td><td class="colLocation">
           <span class="jobLocation">City, Region, CC, Zip</span></td>
           <td class="colDate">12 Sept 2026</td>...</tr>
           <span class="paginationLabel">Results 1 – 10 of 638</span>

    GET {origin}/job/<slug>/<id>/
        -> <span itemprop="description">...full posting...</span>
           <span class="jobGeoLocation">City, Region, CC, Zip</span>

    GET {origin}/sitemap.xml
        -> <loc>https://.../job/<slug>/<id>/</loc> for every live job

Closure signal: a job is returned as present when it is on the search listing,
or when its URL is already on file AND still in sitemap.xml (guards against a
truncated listing page retiring live jobs). A job absent from both is retired
by the lifecycle diff on the next run.

Known URLs (already exported) skip the detail request; new detail fetches are
budgeted per run with max_new_details_per_run, as in workday_api.py.

Used by: Vestas, RWE, NextEra Energy (platform: successfactors_csb).
"""

import asyncio
import html as htmlmod
import re
from datetime import datetime
from typing import Callable, Optional
from urllib.parse import urljoin, urlparse

import dateparser
import httpx
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

REQUEST_TIMEOUT = 60.0  # was 30.0; raised 2026-09-14 -- see main.py's STARTUP_STAGGER_SECONDS comment for the measured ~2x timeout inflation this compensates for
MAX_ATTEMPTS = 4
MAX_LISTING_PAGES = 400

_JOB_ID_RE = re.compile(r'/job/[^/]+/(\d+)/?(?:[?#].*)?$')
_REQ_ID_RE = re.compile(r'Requisition\s*ID:?\s*([A-Za-z0-9-]+)', re.IGNORECASE)
_BLOCK_TAGS = ['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'section']


class SuccessFactorsCsbScraper(BaseScraper):
    """Scrape a SuccessFactors Career Site Builder site through its HTML pages."""

    def __init__(self, config: dict):
        super().__init__(config)
        parsed = urlparse(config['base_url'])
        self.origin = f"{parsed.scheme}://{parsed.netloc}"
        csb = config.get('sf_csb_config', {}) or {}
        self.search_path = csb.get('search_path', '/search/')
        self.search_query = csb.get('search_query', 'q=')
        self.sitemap_url = csb.get('sitemap_url') or f"{self.origin}/sitemap.xml"
        self.max_new_details = config.get('max_new_details_per_run')
        self._known_url_checker: Optional[Callable[[str], bool]] = None
        # Reason the most recent _get() call returned None, so callers
        # (e.g. listing_page_failed) can log *why*, not just *that* it failed.
        self._last_request_error: Optional[str] = None

    # ------------------------------------------------------------------ hooks

    def set_known_url_checker(self, checker: Callable[[str], bool]) -> None:
        """Known (already exported) jobs skip the detail request and are also
        looked up in sitemap.xml when they drop off the search listing."""
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
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        }

    async def _get(self, client: httpx.AsyncClient, url: str) -> Optional[str]:
        """GET with retry on 429/5xx/network errors; None on 404 or exhaustion."""
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
                return resp.text
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
    def job_id_from_url(url: str) -> Optional[str]:
        m = _JOB_ID_RE.search(url or '')
        return m.group(1) if m else None

    @staticmethod
    def parse_total(html: str) -> Optional[int]:
        """'Results 1 – 10 of 638' / 'Ergebnisse 1 – 25 von 226' -> 638 / 226."""
        soup = BeautifulSoup(html, 'html.parser')
        label = soup.select_one('.paginationLabel')
        if not label:
            return None
        nums = re.findall(r'\d[\d.,]*', label.get_text(' ', strip=True))
        if not nums:
            return None
        return int(re.sub(r'[.,]', '', nums[-1]))

    def parse_listing(self, html: str) -> list[dict]:
        """Listing rows -> cards: title, url, company, location, posted_date, requisition_id."""
        soup = BeautifulSoup(html, 'html.parser')
        cards = []
        for row in soup.select('tr.data-row'):
            link = row.select_one('a.jobTitle-link')
            if not link or not link.get('href'):
                continue
            title = link.get_text(' ', strip=True)
            if not title:
                continue
            url = urljoin(self.origin, link['href'])
            loc_el = row.select_one('span.jobLocation, td.colLocation')
            location = ' '.join(loc_el.get_text(' ', strip=True).split()) if loc_el else ''
            location = re.sub(r'\s*\+\d+\s+(more|weitere|autres)\s*\S*$', '', location).strip()
            date_el = row.select_one('td.colDate, span.jobDate')
            posted = None
            if date_el:
                posted = dateparser.parse(date_el.get_text(' ', strip=True), languages=['en', 'de'])
            fac_el = row.select_one('td.colFacility span.jobFacility, span.jobFacility')
            req_id = fac_el.get_text(' ', strip=True) if fac_el else None
            cards.append({
                'title': title,
                'url': url,
                'company': self.company_name,
                'location': location or 'Location Not Specified',
                'posted_date': posted,
                'requisition_id': req_id or self.job_id_from_url(url),
            })
        return cards

    @staticmethod
    def parse_sitemap(xml: str) -> dict[str, str]:
        """sitemap.xml -> {job id: absolute job URL} for every /job/ entry."""
        out: dict[str, str] = {}
        for loc in re.findall(r'<loc>\s*([^<]+?)\s*</loc>', xml):
            url = htmlmod.unescape(loc)
            jid = SuccessFactorsCsbScraper.job_id_from_url(url)
            if jid:
                out[jid] = url
        return out

    @staticmethod
    def _html_to_text(node) -> str:
        if node is None:
            return ''
        for br in node.find_all('br'):
            br.replace_with('\n')
        for tag in node.find_all(_BLOCK_TAGS):
            tag.insert_before('\n')
            tag.insert_after('\n')
        lines = [' '.join(ln.split()) for ln in node.get_text().split('\n')]
        return '\n'.join(ln for ln in lines if ln)

    def parse_detail(self, html: str) -> Optional[dict]:
        soup = BeautifulSoup(html, 'html.parser')
        node = (soup.select_one('span[itemprop="description"]')
                or soup.select_one('.jobdescription')
                or soup.select_one('.job'))
        description = self._html_to_text(node)
        if not description:
            return None
        loc_el = soup.select_one('.jobGeoLocation')
        location = ' '.join(loc_el.get_text(' ', strip=True).split()) if loc_el else ''
        req = _REQ_ID_RE.search(description)
        return {
            'description': description,
            'location': location,
            'requisition_id': req.group(1) if req else None,
        }

    @staticmethod
    def title_from_url(url: str) -> str:
        path = urlparse(url).path.rstrip('/')
        parts = [p for p in path.split('/') if p]
        slug = parts[-2] if len(parts) >= 2 else (parts[-1] if parts else 'Job')
        return ' '.join(htmlmod.unescape(slug).replace('%2C', ',').split('-')).strip() or 'Job'

    # --------------------------------------------------------------- listing

    def _search_url(self, startrow: int) -> str:
        sep = '&' if '?' in self.search_path else '?'
        return f"{self.origin}{self.search_path}{sep}{self.search_query}&startrow={startrow}"

    async def fetch_listing(self, client: httpx.AsyncClient, max_jobs: Optional[int] = None) -> list[dict]:
        cards: list[dict] = []
        seen: set[str] = set()
        startrow = 0
        total: Optional[int] = None
        per_page: Optional[int] = None

        for page_num in range(MAX_LISTING_PAGES):
            if page_num > 0:
                await self._rate_limit()
            html = await self._get(client, self._search_url(startrow))
            if not html:
                self.logger.error(
                    "listing_page_failed", startrow=startrow,
                    reason=self._last_request_error or "unknown (no response captured)",
                )
                break
            if total is None:
                total = self.parse_total(html)
                self.logger.info("listing_total", total=total)
            rows = self.parse_listing(html)
            if per_page is None:
                per_page = len(rows)
            new_this_page = 0
            for card in rows:
                if card['url'] in seen:
                    continue
                seen.add(card['url'])
                cards.append(card)
                new_this_page += 1
            self.logger.info("page_extracted", page_number=page_num + 1, jobs_this_page=len(rows),
                             total_jobs=len(cards))
            if not rows or new_this_page == 0 or not per_page:
                break
            startrow += per_page
            if total is not None and startrow >= total:
                break
            if max_jobs and len(cards) >= max_jobs:
                break

        if total is not None and len(cards) < total and not max_jobs:
            self.logger.warning("listing_incomplete", collected=len(cards), total=total)
        return cards

    async def fetch_sitemap_ids(self, client: httpx.AsyncClient) -> dict[str, str]:
        xml = await self._get(client, self.sitemap_url)
        if not xml:
            self.logger.warning("sitemap_unavailable", url=self.sitemap_url)
            return {}
        ids = self.parse_sitemap(xml)
        self.logger.info("sitemap_job_urls", count=len(ids), url=self.sitemap_url)
        return ids

    async def fetch_detail(self, client: httpx.AsyncClient, url: str) -> Optional[dict]:
        html = await self._get(client, url)
        if not html:
            return None
        return self.parse_detail(html)

    # ------------------------------------------------------------ interface

    async def extract_job_listings(self, page: Page) -> list[dict]:
        async with httpx.AsyncClient(headers=self._headers(), follow_redirects=True) as client:
            return await self.fetch_listing(client)

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        async with httpx.AsyncClient(headers=self._headers(), follow_redirects=True) as client:
            return await self.fetch_detail(client, job_url) or {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        jobs: list[JobPosting] = []
        skipped_known = new_details = deferred = detail_failures = sitemap_only = 0

        async with httpx.AsyncClient(headers=self._headers(), follow_redirects=True) as client:
            cards = await self.fetch_listing(client, max_jobs=max_jobs)
            self.logger.info("jobs_found_on_listing_page", count=len(cards))

            # Sitemap: the site's own list of live job URLs. Known jobs that the
            # search listing did not return but the sitemap still lists stay
            # present (listing-only card), so a short listing cannot retire them.
            if not max_jobs and self._known_url_checker:
                listed_ids = {self.job_id_from_url(c['url']) for c in cards}
                for jid, url in (await self.fetch_sitemap_ids(client)).items():
                    if jid in listed_ids or not self._is_known(url):
                        continue
                    sitemap_only += 1
                    cards.append({
                        'title': self.title_from_url(url), 'url': url, 'company': self.company_name,
                        'location': 'Location Not Specified', 'posted_date': None,
                        'requisition_id': jid, '_sitemap_only': True,
                    })
                if sitemap_only:
                    self.logger.info("sitemap_kept_known_jobs", count=sitemap_only,
                                     note="Known jobs missing from the listing but still in sitemap.xml")

            for card in cards:
                if max_jobs and len(jobs) >= max_jobs:
                    break
                try:
                    if card.pop('_sitemap_only', False) or self._is_known(card['url']):
                        skipped_known += 1
                        job_data = dict(card)
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
                        job_data = dict(card)
                        job_data['description'] = detail['description']
                        if detail.get('location'):
                            job_data['location'] = detail['location']
                        if detail.get('requisition_id'):
                            job_data['requisition_id'] = detail['requisition_id']
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
        self.logger.info("extraction_complete", total_jobs=len(jobs), listing_only=skipped_known,
                         sitemap_only=sitemap_only, new_details=new_details, deferred=deferred,
                         detail_failures=detail_failures)
        return jobs
