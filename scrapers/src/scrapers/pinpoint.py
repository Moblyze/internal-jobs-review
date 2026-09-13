"""Pinpoint ATS career portal scraper.

Pinpoint hosts employer career pages at https://{tenant}.pinpointhq.com/.
The public `/postings.json` endpoint returns every live posting for the
tenant in a single unpaginated JSON response (no auth, no pagination params
needed -- verified against the V.Group tenant, which returns all ~400
postings in one call).

Response shape: {"data": [{...posting...}, ...]}. Each posting carries the
description/benefits/responsibilities as HTML fragments, a structured
location object, and a nested `job` object with department/division/client
group names (useful for multi-brand tenants like V.Group, which publishes
V.Ships Leisure and other divisions through the same board).

Used by: V.Group (and Vships, same tenant/board).
"""

import re
from datetime import datetime
from typing import Optional

import requests
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()


class PinpointScraper(BaseScraper):
    """
    Scraper for Pinpoint-hosted ATS career portals.

    Strategy: one HTTP GET to the tenant's public postings.json endpoint
    returns the full, current set of live postings with descriptions already
    inlined. No browser and no per-job detail fetch needed.

    Config expects either:
        pinpoint_tenant: Subdomain slug (e.g., "vgroup")
    or a base_url of the form https://{tenant}.pinpointhq.com/...
    """

    TENANT_RE = re.compile(r'https?://([^./]+)\.pinpointhq\.com')

    def __init__(self, config: dict):
        super().__init__(config)
        self.tenant = config.get('pinpoint_tenant')
        if not self.tenant:
            m = self.TENANT_RE.match(config.get('base_url', ''))
            self.tenant = m.group(1) if m else None
        if not self.tenant:
            raise ValueError(
                f"PinpointScraper requires 'pinpoint_tenant' or a "
                f"*.pinpointhq.com base_url (got {config.get('base_url')})"
            )

        self.postings_url = f"https://{self.tenant}.pinpointhq.com/postings.json"
        self._session = requests.Session()
        self._session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
        })

    def _clean_html(self, html_text: Optional[str]) -> str:
        """Strip Pinpoint's rich-text HTML fragments down to plain text."""
        if not html_text:
            return ""
        try:
            soup = BeautifulSoup(html_text, 'html.parser')
            text = soup.get_text(separator='\n', strip=True)
            lines = [line.strip() for line in text.split('\n') if line.strip()]
            return '\n'.join(lines)
        except Exception as e:
            self.logger.error("html_cleaning_failed", error=str(e))
            return html_text

    def _location_string(self, location: Optional[dict]) -> str:
        """Format Pinpoint's location object into a display string."""
        if not location:
            return "Location Not Specified"
        parts = []
        for key in ('name', 'city', 'province'):
            val = (location.get(key) or '').strip()
            if val and val not in parts:
                parts.append(val)
        return ', '.join(parts) if parts else "Location Not Specified"

    def _normalize_employment_type_pinpoint(self, raw: Optional[str]) -> Optional[str]:
        if not raw:
            return None
        mapping = {
            'full_time': 'Full-Time',
            'part_time': 'Part-Time',
            'contract': 'Contractor',
            'temporary': 'Temporary',
            'internship': 'Internship',
        }
        return mapping.get(raw.lower(), self._normalize_employment_type(raw))

    def _parse_posted_date(self, posting: dict) -> Optional[datetime]:
        for key in ('published_at', 'created_at', 'live_at'):
            val = posting.get(key)
            if val:
                try:
                    return datetime.fromisoformat(str(val).replace('Z', '+00:00'))
                except (ValueError, TypeError):
                    continue
        return None

    def _build_description(self, posting: dict) -> str:
        sections = []
        job_meta = posting.get('job') or {}
        header_lines = []
        dept = (job_meta.get('department') or {}).get('name')
        division = (job_meta.get('division') or {}).get('name')
        client_group = job_meta.get('structure_custom_group_one') or {}
        client_name = client_group.get('name')
        if client_name:
            header_lines.append(f"**Client:** {client_name}")
        if division:
            header_lines.append(f"**Division:** {division}")
        if dept:
            header_lines.append(f"**Department:** {dept}")
        if header_lines:
            sections.append('\n'.join(header_lines))

        desc = self._clean_html(posting.get('description'))
        if desc:
            sections.append(desc)

        responsibilities = self._clean_html(posting.get('key_responsibilities'))
        if responsibilities:
            header = posting.get('key_responsibilities_header') or 'Key Responsibilities'
            sections.append(f"{header}:\n{responsibilities}")

        skills = self._clean_html(posting.get('skills_knowledge_expertise'))
        if skills:
            header = posting.get('skills_knowledge_expertise_header') or 'Skills & Expertise'
            sections.append(f"{header}:\n{skills}")

        benefits = self._clean_html(posting.get('benefits'))
        if benefits:
            header = posting.get('benefits_header') or 'Benefits'
            sections.append(f"{header}:\n{benefits}")

        description = '\n\n'.join(sections)
        if len(description) < 10:
            title = posting.get('title', 'this role')
            description = f"Position: {title}."
        return description

    def _build_job_data(self, posting: dict) -> dict:
        return {
            'title': posting.get('title') or 'Untitled Position',
            'company': self.company_name,
            'location': self._location_string(posting.get('location')),
            'description': self._build_description(posting),
            'url': posting.get('url') or posting.get('path'),
            'requisition_id': str(posting.get('id')) if posting.get('id') else None,
            'posted_date': self._parse_posted_date(posting),
            'employment_type': self._normalize_employment_type_pinpoint(posting.get('employment_type')),
        }

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs for the configured Pinpoint tenant.

        A single request to postings.json returns every live posting with
        descriptions already inlined -- no pagination and no per-job detail
        fetch required.
        """
        jobs: list[JobPosting] = []
        self.logger.info("extraction_start", company=self.company_name, tenant=self.tenant)

        try:
            response = self._session.get(self.postings_url, timeout=30)
            response.raise_for_status()
            payload = response.json()
            postings = payload.get('data') or []

            self.logger.info("postings_fetched", total=len(postings))

            for posting in postings:
                if max_jobs and len(jobs) >= max_jobs:
                    self.logger.info("max_jobs_reached", limit=max_jobs)
                    break
                try:
                    job_data = self._build_job_data(posting)
                    job_data = self._enrich_with_certifications(job_data)
                    jobs.append(JobPosting(**job_data))
                except ValidationError as e:
                    self.logger.error(
                        "validation_failed",
                        posting_id=posting.get('id'),
                        title=posting.get('title'),
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
