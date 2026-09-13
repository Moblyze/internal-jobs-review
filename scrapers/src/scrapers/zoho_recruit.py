"""Zoho Recruit hosted career-site scraper.

Zoho Recruit career pages (either on a *.zohorecruit.com subdomain or a
custom domain CNAME'd to one, e.g. jobs.black-grey.com) render server-side:
the full list of postings is embedded directly in the initial HTML response
as a JSON blob inside a `<input type="hidden" id="jobs" value="...">` tag
(HTML-entity-escaped). No JS execution and no separate API call is needed to
get the listing; the "Job_Description" field is inlined too, so no per-job
detail fetch is required either.

Verified against two tenants:
    https://madre-me.zohorecruit.com/jobs/Careers   (Madre Integrated Engineering)
    https://jobs.black-grey.com/jobs/Careers          (Black & Grey HR, custom domain)

Job detail URLs follow {origin}/jobs/Careers/{id} (confirmed live, returns a
per-job page titled "{Company} - {Posting_Title} in {City}").

Used by: Madre Integrated Engineering, Black & Grey HR.
"""

import html as htmllib
import json
import re
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

import requests
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()

# The jobs blob sits in `<input type="hidden" value="[...]" id="jobs">`.
# Locate the trailing `id="jobs"` anchor first and walk back to the opening
# `value="` -- the JSON payload itself can contain literal `" id="`-looking
# substrings (job descriptions, addresses), so a single non-greedy regex
# across the whole value is not reliable.
JOBS_INPUT_END = '" id="jobs"'
VALUE_ATTR = 'value="'


class ZohoRecruitScraper(BaseScraper):
    """
    Scraper for Zoho Recruit hosted career sites.

    Strategy: one HTTP GET of the careers list page; parse the embedded
    `#jobs` hidden-input JSON blob for the full posting list (title,
    location, description, job type, experience, and id already present).
    No browser and no per-job request needed.

    Config expects:
        base_url: The careers list page, e.g.
            "https://madre-me.zohorecruit.com/jobs/Careers" or a custom
            domain equivalent (e.g. "https://jobs.black-grey.com/jobs/Careers").
    """

    def __init__(self, config: dict):
        super().__init__(config)
        base_url = config.get('base_url', '')
        if not base_url:
            raise ValueError("ZohoRecruitScraper requires 'base_url'")
        self.list_url = base_url
        parsed = urlparse(base_url)
        self.origin = f"{parsed.scheme}://{parsed.netloc}"

        self._session = requests.Session()
        self._session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        })

    def _extract_jobs_blob(self, html_text: str) -> list[dict]:
        """Pull the embedded jobs JSON array out of the rendered career page."""
        end_idx = html_text.find(JOBS_INPUT_END)
        if end_idx == -1:
            raise RuntimeError("No #jobs hidden input found on career page")
        start_idx = html_text.rfind(VALUE_ATTR, 0, end_idx)
        if start_idx == -1:
            raise RuntimeError("Malformed #jobs hidden input (no value attr)")
        start_idx += len(VALUE_ATTR)
        raw = html_text[start_idx:end_idx]
        return json.loads(htmllib.unescape(raw))

    def _clean_html(self, text: Optional[str]) -> str:
        if not text:
            return ""
        try:
            soup = BeautifulSoup(text, 'html.parser')
            plain = soup.get_text(separator='\n', strip=True)
            lines = [line.strip() for line in plain.split('\n') if line.strip()]
            return '\n'.join(lines)
        except Exception:
            return text

    def _location_string(self, job: dict) -> str:
        parts = []
        for key in ('City', 'State', 'Country'):
            val = (job.get(key) or '').strip()
            if val and val not in parts:
                parts.append(val)
        return ', '.join(parts) if parts else "Location Not Specified"

    def _normalize_employment_type_zoho(self, raw: Optional[str]) -> Optional[str]:
        if not raw:
            return None
        return self._normalize_employment_type(raw)

    def _parse_posted_date(self, date_str: Optional[str]) -> Optional[datetime]:
        if not date_str:
            return None
        try:
            return datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            return None

    def _build_description(self, job: dict) -> str:
        sections = []
        header_lines = []
        for label, key in (
            ('Industry', 'Industry'),
            ('Experience', 'Work_Experience'),
        ):
            val = job.get(key)
            if val:
                header_lines.append(f"**{label}:** {val}")
        if header_lines:
            sections.append('\n'.join(header_lines))

        desc = self._clean_html(job.get('Job_Description'))
        if desc:
            sections.append(desc)

        description = '\n\n'.join(sections)
        if len(description) < 10:
            title = job.get('Posting_Title', 'this role')
            description = f"Position: {title}."
        return description

    def _build_job_data(self, job: dict) -> dict:
        job_id = job.get('id')
        return {
            'title': job.get('Posting_Title') or job.get('Job_Opening_Name') or 'Untitled Position',
            'company': self.company_name,
            'location': self._location_string(job),
            'description': self._build_description(job),
            'url': f"{self.origin}/jobs/Careers/{job_id}" if job_id else self.list_url,
            'requisition_id': str(job_id) if job_id else None,
            'posted_date': self._parse_posted_date(job.get('Date_Opened')),
            'employment_type': self._normalize_employment_type_zoho(job.get('Job_Type')),
        }

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all published postings from the configured Zoho Recruit
        career site. One request gets the full listing with descriptions
        already inlined.
        """
        jobs: list[JobPosting] = []
        self.logger.info("extraction_start", company=self.company_name, url=self.list_url)

        try:
            response = self._session.get(self.list_url, timeout=30)
            response.raise_for_status()
            raw_jobs = self._extract_jobs_blob(response.text)

            self.logger.info("postings_fetched", total=len(raw_jobs))

            for job in raw_jobs:
                # Only externally-published, unlocked postings are real live jobs.
                if job.get('Publish') is False or job.get('Is_Locked') is True:
                    continue
                if max_jobs and len(jobs) >= max_jobs:
                    self.logger.info("max_jobs_reached", limit=max_jobs)
                    break
                try:
                    job_data = self._build_job_data(job)
                    job_data = self._enrich_with_certifications(job_data)
                    jobs.append(JobPosting(**job_data))
                except ValidationError as e:
                    self.logger.error(
                        "validation_failed",
                        job_id=job.get('id'),
                        title=job.get('Posting_Title'),
                        errors=str(e),
                    )
                    continue

            self.logger.info("extraction_complete", total_jobs=len(jobs))
            return jobs

        except Exception as e:
            self.logger.error("extraction_failed", error=str(e), exc_info=True)
            return jobs

    # BaseScraper abstract methods (unused -- we skip Playwright)
    async def extract_job_listings(self, page: Page) -> list[dict]:
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        return {}
