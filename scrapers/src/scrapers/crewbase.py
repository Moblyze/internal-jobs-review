"""CrewBase.pro maritime/offshore crew job board scraper.

CrewBase (crewbase.pro) is a full-site job board for maritime/offshore crewing
(ROV pilots, ships' officers, engineers, ratings, etc.) posted by manning and
crewing agencies. Unlike our other sources, it is a clean full-site crawl
(sitemap -> every job page) rather than a keyword search against a job board
API, so it belongs alongside the direct employer scrapers with its own tab
("CrewBase") rather than in aggregator_cli.py.

No browser automation is needed. The site sits behind a CDN (cache-control:
public, s-maxage=86400; Fastly-style cache headers) with no anti-bot
protection, and every job page is fully server-rendered HTML -- a plain HTTP
GET returns everything we need in one request. This mirrors the
OracleHCMScraper / ADPScraper pattern: extends BaseScraper for the shared
certification/employment-type helpers, but does all fetching with `requests`.

Site structure (verified 2026-07-17):
- Sitemap index: https://crewbase.pro/sitemap.xml lists sitemap-static.xml
  plus per-shard job sitemaps named "sitemap-jobs-{n}.xml" (3 of them as of
  writing -- 0/1/2 -- totalling ~10,955 job URLs). We discover the job
  sitemaps dynamically rather than hardcoding a count, in case CrewBase adds
  a 4th shard later.
- Job URLs: https://crewbase.pro/jobs/{20-char id}
- Each job page embeds one schema.org JobPosting JSON-LD block with: title,
  description, datePosted, validThrough, employmentType (TEMPORARY /
  CONTRACTOR / FULL_TIME), jobLocation.address (addressCountry /
  addressRegion), and -- only when a rate has actually been set -- a
  baseSalary object: {"currency": "EUR", "value": {"value": 180, "unitText":
  "DAY"}}. In a 1,576-page sample only ~9% of postings had a baseSalary; the
  rest render "TBC" in the UI (confirmed by grepping the page's own render
  logic: `let salary = 'TBC'; if (job.salary) { ... }`).
- IMPORTANT (per BD/product spec): the JSON-LD `hiringOrganization.name` is
  meant to be treated as an agency label, not necessarily the real employer.
  The real employer name is rendered in the visible HTML in a
  `<p class="... text-brand-300 font-medium">` element directly under the
  job title, so that's what we extract for `company`. Note for the record:
  in a 1,576-page verification sample (2026-07-17), hiringOrganization.name
  matched the visible brand-300 text in every single case -- no discrepancy
  was observed. We still prefer the visible HTML per spec (it's the field
  the site itself renders as the canonical display name, and parsing it costs
  nothing extra since we already fetch the full page), but flagging this so
  a future maintainer isn't surprised if the two never seem to diverge.
- A small fraction of sitemap URLs (~1.5% in the same sample) return HTTP 410
  Gone -- expired postings the sitemap hasn't dropped yet. These are skipped
  outright. Jobs whose `validThrough` has already passed are also skipped
  (JobLifecycleManager will mark previously-exported postings as "removed"
  automatically once they stop appearing in a scrape).
- No separate listing + detail hop is required: one GET per job URL returns
  every field we need, so the "listing" phase is just the sitemap crawl.
"""

import html
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Optional
from xml.etree import ElementTree as ET

import requests
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()

SITEMAP_NS = {'sm': 'http://www.sitemaps.org/schemas/sitemap/0.9'}

DEFAULT_SITEMAP_INDEX_URL = "https://crewbase.pro/sitemap.xml"
DEFAULT_MAX_WORKERS = 8
DEFAULT_REQUEST_DELAY = 0.15  # small per-request stagger; the CDN is heavily cached

_EMPLOYMENT_TYPE_RE = re.compile(r'_')

_COMPANY_RE = re.compile(r'text-brand-300 font-medium">([^<]*)</p>')
_SALARY_CHIP_RE = re.compile(
    r'<div class="text-xl sm:text-2xl font-bold text-cta-400">([^<]*)</div>'
)
_JSONLD_RE = re.compile(
    r'<script type="application/ld\+json">(.*?)</script>', re.S
)
_ABOUT_PARAGRAPH_RE = re.compile(
    r'About This Opportunity.*?<p class="[^"]*">(.*?)</p>', re.S
)


class CrewBaseScraper(BaseScraper):
    """
    Full-site scraper for CrewBase.pro (maritime/offshore crew job board).

    Uses `requests` for plain HTTP fetching (no Playwright/browser needed).
    Crawls the sitemap index to discover every job URL, then fetches each
    job page directly with a small thread pool + polite per-request delay.
    """

    def __init__(self, config: dict):
        super().__init__(config)
        cb_config = config.get('crewbase_config', {})
        self.sitemap_index_url = cb_config.get('sitemap_index_url', DEFAULT_SITEMAP_INDEX_URL)
        self.max_workers = cb_config.get('max_workers', DEFAULT_MAX_WORKERS)
        self.request_delay = config.get('rate_limit_delay', DEFAULT_REQUEST_DELAY)

        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': (
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/120.0.0.0 Safari/537.36'
            ),
        })

    # -- Sitemap discovery --------------------------------------------------

    def _fetch_xml(self, url: str) -> Optional[ET.Element]:
        try:
            resp = self.session.get(url, timeout=30)
            resp.raise_for_status()
            return ET.fromstring(resp.content)
        except Exception as e:
            self.logger.error("sitemap_fetch_failed", url=url, error=str(e))
            return None

    def _discover_job_urls(self) -> list[str]:
        """
        Parse the sitemap index, then every job sitemap it references, and
        return the full deduplicated list of job detail URLs.
        """
        root = self._fetch_xml(self.sitemap_index_url)
        if root is None:
            return []

        job_sitemaps = []
        for sitemap_elem in root.findall('sm:sitemap', SITEMAP_NS):
            loc = sitemap_elem.find('sm:loc', SITEMAP_NS)
            if loc is None or not loc.text:
                continue
            url = loc.text.strip()
            # Skip the static/marketing-page sitemap; only crawl job shards.
            if '/sitemap-jobs-' in url:
                job_sitemaps.append(url)

        self.logger.info("job_sitemaps_discovered", count=len(job_sitemaps), sitemaps=job_sitemaps)

        job_urls: list[str] = []
        seen = set()
        for sitemap_url in job_sitemaps:
            shard_root = self._fetch_xml(sitemap_url)
            if shard_root is None:
                continue
            for url_elem in shard_root.findall('sm:url', SITEMAP_NS):
                loc = url_elem.find('sm:loc', SITEMAP_NS)
                if loc is None or not loc.text:
                    continue
                url = loc.text.strip()
                if url not in seen:
                    seen.add(url)
                    job_urls.append(url)

        self.logger.info("job_urls_discovered", count=len(job_urls))
        return job_urls

    # -- Per-job parsing ------------------------------------------------------

    @staticmethod
    def _extract_job_id(url: str) -> str:
        return url.rstrip('/').split('/')[-1]

    def _parse_salary(self, jsonld: dict, salary_chip: Optional[str]) -> Optional[str]:
        """
        Prefer the structured schema.org baseSalary block (present for ~9%
        of postings): {"currency": "EUR", "value": {"value": 180,
        "unitText": "DAY"}}. Fall back to the visible chip text for the rare
        case where a free-text value like "Negotiable" is shown but no
        structured baseSalary was emitted. Return None (not "TBC") when
        there's genuinely no pay signal, per the pipeline's schema
        convention of leaving unknown optional fields empty.
        """
        base_salary = jsonld.get('baseSalary')
        if isinstance(base_salary, dict):
            currency = base_salary.get('currency', '')
            value_obj = base_salary.get('value') or {}
            value = value_obj.get('value')
            unit = (value_obj.get('unitText') or '').lower()
            if value is not None:
                if unit:
                    return f"{value} {currency}/{unit}".strip()
                return f"{value} {currency}".strip()

        if salary_chip and salary_chip.strip() and salary_chip.strip().upper() != 'TBC':
            return salary_chip.strip()

        return None

    def _parse_location(self, jsonld: dict) -> str:
        address = ((jsonld.get('jobLocation') or {}).get('address')) or {}
        country = (address.get('addressCountry') or '').strip()
        region = (address.get('addressRegion') or '').strip()

        parts = []
        if country and country != 'Not Specified':
            parts.append(country)
        if region and region not in ('Not Specified', country):
            parts.append(region)

        if parts:
            return ', '.join(parts)
        if region:  # e.g. bare "Worldwide" with no specific country
            return region
        return "Location Not Specified"

    def _parse_description(self, jsonld: dict, page_html: str) -> str:
        description = html.unescape((jsonld.get('description') or '').strip())

        # Short descriptions are common (many postings are terse). Enrich with
        # the page's own "About This Opportunity" SEO paragraph, which spells
        # out vessel type / location / employment type / boarding date in
        # prose, so downstream review has more to go on.
        if len(description) < 40:
            m = _ABOUT_PARAGRAPH_RE.search(page_html)
            if m:
                about_text = BeautifulSoup(m.group(1), 'html.parser').get_text(' ', strip=True)
                about_text = html.unescape(about_text)
                if about_text:
                    description = f"{description}\n\n{about_text}".strip() if description else about_text

        return description or "No description provided."

    def _parse_job_page(self, url: str, page_html: str) -> Optional[dict]:
        jsonld_match = _JSONLD_RE.search(page_html)
        if not jsonld_match:
            self.logger.warning("no_jsonld_found", url=url)
            return None

        try:
            jsonld = json.loads(jsonld_match.group(1))
        except json.JSONDecodeError as e:
            self.logger.warning("jsonld_parse_failed", url=url, error=str(e))
            return None

        title = html.unescape((jsonld.get('title') or '').strip())
        if not title:
            return None

        company_match = _COMPANY_RE.search(page_html)
        company = company_match.group(1).strip() if company_match else (
            (jsonld.get('hiringOrganization') or {}).get('name', '').strip()
        )
        company = html.unescape(company)
        if not company:
            return None

        # Skip postings whose validThrough has already passed -- the sitemap
        # lags behind actual expiry by a bit.
        valid_through_raw = jsonld.get('validThrough')
        if valid_through_raw:
            try:
                valid_through = datetime.fromisoformat(valid_through_raw.replace('Z', '+00:00'))
                if valid_through < datetime.now(timezone.utc):
                    return None
            except ValueError:
                pass

        posted_date = None
        date_posted_raw = jsonld.get('datePosted')
        if date_posted_raw:
            try:
                posted_date = datetime.fromisoformat(date_posted_raw.replace('Z', '+00:00'))
            except ValueError:
                pass

        salary_chip_match = _SALARY_CHIP_RE.search(page_html)
        salary_chip = salary_chip_match.group(1) if salary_chip_match else None

        raw_employment_type = (jsonld.get('employmentType') or '').strip()
        employment_type = self._normalize_employment_type(
            _EMPLOYMENT_TYPE_RE.sub(' ', raw_employment_type).lower()
        ) if raw_employment_type else None

        return {
            'title': title,
            'company': company,
            'location': self._parse_location(jsonld),
            'description': self._parse_description(jsonld, page_html),
            'url': url,
            'requisition_id': self._extract_job_id(url),
            'posted_date': posted_date,
            'salary': self._parse_salary(jsonld, salary_chip),
            'employment_type': employment_type,
            'skills': [],
        }

    def _fetch_and_parse_job(self, url: str) -> Optional[dict]:
        try:
            resp = self.session.get(url, timeout=20)
        except requests.RequestException as e:
            self.logger.warning("job_fetch_failed", url=url, error=str(e))
            return None

        if resp.status_code == 410:
            # Expired posting still listed in the sitemap -- skip quietly.
            return None
        if resp.status_code != 200:
            self.logger.warning("job_fetch_bad_status", url=url, status=resp.status_code)
            return None

        try:
            return self._parse_job_page(url, resp.text)
        except Exception as e:
            self.logger.error("job_parse_failed", url=url, error=str(e), exc_info=True)
            return None

    def _fetch_all_job_data(self, job_urls: list[str]) -> list[dict]:
        """Fetch + parse every job URL with a small polite thread pool."""
        results: list[dict] = []
        total = len(job_urls)
        completed = 0

        def worker(u: str) -> Optional[dict]:
            time.sleep(self.request_delay)
            return self._fetch_and_parse_job(u)

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {executor.submit(worker, u): u for u in job_urls}
            for future in as_completed(futures):
                completed += 1
                job_data = future.result()
                if job_data:
                    results.append(job_data)
                if completed % 500 == 0:
                    self.logger.info(
                        "crewbase_crawl_progress",
                        completed=completed,
                        total=total,
                        parsed_ok=len(results),
                    )

        return results

    # -- BaseScraper abstract method implementations -------------------------

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """Not used -- listing discovery is via the XML sitemap, not the browser."""
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """Not used -- all data comes from a plain HTTP GET of the job page."""
        return {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Main entry point: crawl the sitemap, fetch every job page over plain
        HTTP, and return validated JobPosting objects.

        Args:
            max_jobs: Optional cap on job URLs to fetch (for testing).

        Returns:
            List of validated JobPosting objects.
        """
        self.logger.info("extraction_start", company=self.company_name, max_jobs=max_jobs)

        job_urls = self._discover_job_urls()
        if not job_urls:
            self.logger.warning("no_job_urls_found", sitemap=self.sitemap_index_url)
            return []

        if max_jobs:
            job_urls = job_urls[:max_jobs]

        raw_jobs = self._fetch_all_job_data(job_urls)
        self.logger.info("raw_jobs_fetched", count=len(raw_jobs), attempted=len(job_urls))

        jobs: list[JobPosting] = []
        for job_data in raw_jobs:
            try:
                job_data = self._enrich_with_certifications(job_data)
                posting = JobPosting(**job_data)
                jobs.append(posting)
            except ValidationError as e:
                self.logger.debug(
                    "validation_failed", url=job_data.get('url'), error=str(e)
                )
                continue
            except Exception as e:
                self.logger.error(
                    "job_build_failed", url=job_data.get('url'), error=str(e), exc_info=True
                )
                continue

        self.logger.info("extraction_complete", total_jobs=len(jobs))
        return jobs
