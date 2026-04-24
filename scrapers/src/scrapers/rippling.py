"""Rippling ATS career portal scraper.

Rippling hosts employer career pages at https://ats.rippling.com/{slug}/jobs.
Pages are Next.js with a `__NEXT_DATA__` script tag that already contains the
hydrated data we need, so we skip Playwright and parse the embedded JSON.

Listing: `props.pageProps.dehydratedState.queries[0].state.data` →
    { items: [{id, name, url, department, locations, ...}], totalPages, totalItems }
    Pagination: add `?page=N` query param (0-indexed, 20 items/page).

Detail: `props.pageProps.apiData.jobPost` →
    { description: {company, role}, employmentType, createdOn, companyName, ... }

Used by: Kraken Robotics (and any future employer on Rippling ATS).
"""

import json
import re
from datetime import datetime
from typing import Optional

import dateparser
import requests
from bs4 import BeautifulSoup
from markdownify import markdownify
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__"[^>]*>(.+?)</script>', re.S
)


class RipplingScraper(BaseScraper):
    """
    Scraper for Rippling-hosted ATS career portals.

    Strategy: fetch each page's HTML and parse the Next.js `__NEXT_DATA__` blob
    to get structured job data. No browser needed.

    Config expects:
        rippling_slug: Employer slug (e.g., "kraken-robotics-inc")
    """

    PAGE_SIZE = 20  # Rippling default

    def __init__(self, config: dict):
        super().__init__(config)
        self.slug = config.get('rippling_slug')
        if not self.slug:
            # Best-effort: parse slug out of base_url like
            # https://ats.rippling.com/kraken-robotics-inc/jobs
            m = re.match(r'https?://ats\.rippling\.com/([^/]+)', config.get('base_url', ''))
            self.slug = m.group(1) if m else None
        if not self.slug:
            raise ValueError(f"RipplingScraper requires 'rippling_slug' or a rippling base_url (got {config.get('base_url')})")

        self.listing_url = f"https://ats.rippling.com/{self.slug}/jobs"
        self._session = requests.Session()
        self._session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        })

    def _fetch_next_data(self, url: str) -> dict:
        """Fetch a Rippling page and return its parsed __NEXT_DATA__ JSON."""
        resp = self._session.get(url, timeout=30)
        resp.raise_for_status()
        m = NEXT_DATA_RE.search(resp.text)
        if not m:
            raise RuntimeError(f"No __NEXT_DATA__ found at {url}")
        return json.loads(m.group(1))

    def _html_to_markdown(self, html: Optional[str]) -> str:
        """
        Convert Rippling's styled HTML into clean Markdown, preserving headings,
        lists, and bold/italic emphasis. Strips inline styles/font-family noise.
        """
        if not html:
            return ""
        # Drop <meta> wrapper tags Rippling inserts; flatten <b> so nested
        # <b><strong> doesn't yield '****foo****'.
        soup = BeautifulSoup(html, 'html.parser')
        for tag in soup.find_all('meta'):
            tag.decompose()
        for tag in soup.find_all('b'):
            tag.unwrap()
        md = markdownify(str(soup), heading_style='ATX', strip=['span'])
        # markdownify escapes hyphens/ampersands/dots; undo for readability.
        md = re.sub(r'\\([-&.])', r'\1', md)
        # Belt-and-braces: collapse any remaining ****...**** to **...**.
        md = re.sub(r'\*{4,}', '**', md)
        # Collapse runs of 3+ blank lines, trim
        lines = [line.rstrip() for line in md.splitlines()]
        cleaned = []
        blank = 0
        for line in lines:
            if not line.strip():
                blank += 1
                if blank <= 1:
                    cleaned.append('')
            else:
                blank = 0
                cleaned.append(line)
        return '\n'.join(cleaned).strip()

    def _location_string(self, locations: list[dict]) -> str:
        """Join Rippling location objects into a display string, de-duped, order preserved."""
        if not locations:
            return "Location not specified"
        seen = set()
        parts = []
        for loc in locations:
            name = (loc.get('name') or '').strip()
            if name and name not in seen:
                seen.add(name)
                parts.append(name)
        return '; '.join(parts) if parts else "Location not specified"

    def _fetch_listing_page(self, page: int) -> dict:
        """Return the `data` object from the job-posts query on a listing page."""
        url = self.listing_url if page == 0 else f"{self.listing_url}?page={page}"
        nd = self._fetch_next_data(url)
        queries = nd['props']['pageProps']['dehydratedState']['queries']
        for q in queries:
            key = q.get('queryKey') or []
            if len(key) >= 3 and key[2] == 'job-posts':
                return q['state']['data']
        raise RuntimeError("job-posts query not found in Rippling __NEXT_DATA__")

    def _fetch_job_detail(self, job_url: str) -> dict:
        """Fetch detail page and return apiData.jobPost dict."""
        nd = self._fetch_next_data(job_url)
        return nd['props']['pageProps']['apiData']['jobPost']

    def _normalize_employment_type_rippling(self, emp: Optional[dict]) -> Optional[str]:
        """
        Rippling's employmentType is e.g. {'label': 'SALARIED_FT', 'id': 'Salaried, full-time'}.
        """
        if not emp:
            return None
        label = (emp.get('label') or '').upper()
        # Map common Rippling labels
        mapping = {
            'SALARIED_FT': 'Full-Time',
            'SALARIED_PT': 'Part-Time',
            'HOURLY_FT': 'Full-Time',
            'HOURLY_PT': 'Part-Time',
            'CONTRACTOR': 'Contractor',
            'CONTRACT': 'Contractor',
            'TEMPORARY': 'Temporary',
            'TEMP': 'Temporary',
            'INTERN': 'Internship',
            'INTERNSHIP': 'Internship',
        }
        if label in mapping:
            return mapping[label]
        # Fall back to base normalizer on the human-readable id
        return self._normalize_employment_type(emp.get('id'))

    def _parse_posted_date(self, value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        dt = dateparser.parse(value)
        return dt

    def _extract_department(self, item: dict, detail: dict) -> Optional[str]:
        """
        Prefer the nested department tree (includes base dept) if available,
        else fall back to the listing-item department name.

        Example detail.department: {name: 'Marketing', base_department: 'Commercial'}
        → "Commercial / Marketing"
        """
        detail_dept = detail.get('department') or {}
        name = detail_dept.get('name')
        base = detail_dept.get('base_department')
        if name and base and name != base:
            return f"{base} / {name}"
        if name:
            return name
        item_dept = (item.get('department') or {}).get('name')
        return item_dept

    def _build_job_data(self, item: dict, detail: dict) -> dict:
        """Merge listing item + detail payload into the JobPosting-shaped dict."""
        desc_obj = detail.get('description') or {}
        company_md = self._html_to_markdown(desc_obj.get('company'))
        role_md = self._html_to_markdown(desc_obj.get('role'))

        department = self._extract_department(item, detail)

        # Assemble a structured description: a header block with metadata the
        # sheet columns don't already carry, followed by About/Role sections.
        sections = []
        header_lines = []
        if department:
            header_lines.append(f"**Department:** {department}")
        if header_lines:
            sections.append('\n'.join(header_lines))
        if company_md:
            sections.append(f"## About {self.company_name}\n\n{company_md}")
        if role_md:
            sections.append(f"## About the Role\n\n{role_md}")
        description = '\n\n'.join(sections)

        # Use config name (matches sheet_name + dedup history), not API companyName.
        company = self.company_name

        data = {
            'title': item.get('name') or detail.get('name') or '',
            'company': company,
            'location': self._location_string(item.get('locations') or detail.get('workLocations') or []),
            'description': description,
            'url': item.get('url'),
            'requisition_id': item.get('id') or detail.get('uuid'),
            'posted_date': self._parse_posted_date(detail.get('createdOn')),
            'employment_type': self._normalize_employment_type_rippling(detail.get('employmentType')),
        }
        return data

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs for the configured Rippling employer.

        Fetches the job-board listing page (and subsequent pages) via HTTP,
        then each job's detail page for the description + employment type.
        """
        jobs: list[JobPosting] = []
        self.logger.info("extraction_start", company=self.company_name, slug=self.slug)

        try:
            # Page 0: also tells us totalPages
            first = self._fetch_listing_page(0)
            total_pages = first.get('totalPages') or 1
            total_items = first.get('totalItems')
            items = list(first.get('items') or [])
            self.logger.info("listing_first_page", total_items=total_items, total_pages=total_pages, items_this_page=len(items))

            # Fetch remaining pages
            for page_idx in range(1, total_pages):
                await self._rate_limit()
                data = self._fetch_listing_page(page_idx)
                page_items = data.get('items') or []
                self.logger.info("listing_page_fetched", page=page_idx, items=len(page_items))
                if not page_items:
                    break
                items.extend(page_items)

            # Fetch detail for each job
            for idx, item in enumerate(items):
                if max_jobs and len(jobs) >= max_jobs:
                    self.logger.info("max_jobs_reached", limit=max_jobs)
                    break

                job_url = item.get('url')
                if not job_url:
                    continue

                try:
                    if idx > 0:
                        await self._rate_limit()
                    detail = self._fetch_job_detail(job_url)
                    job_data = self._build_job_data(item, detail)
                    job_data = self._enrich_with_certifications(job_data)
                    jobs.append(JobPosting(**job_data))
                    self.logger.debug("job_extracted", title=job_data['title'], url=job_url)
                except ValidationError as e:
                    self.logger.error("validation_failed", job_url=job_url, errors=str(e))
                    continue
                except Exception as e:
                    self.logger.error("detail_extraction_failed", job_url=job_url, error=str(e))
                    continue

            self.logger.info("extraction_complete", total_jobs=len(jobs))
            return jobs

        except Exception as e:
            self.logger.error("extraction_failed", error=str(e), exc_info=True)
            return jobs

    # BaseScraper abstract methods (unused — we skip Playwright)
    async def extract_job_listings(self, page: Page) -> list[dict]:
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        return {}
