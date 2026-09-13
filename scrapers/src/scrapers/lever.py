"""Lever ATS career portal scraper.

Lever hosts employer career pages at https://jobs.lever.co/{slug} (US region)
or https://jobs.{region}.lever.co/{slug} (regional data residency, e.g. "eu").
Both regions expose the same public JSON API, just on a region-prefixed API
host:

    https://api.lever.co/v0/postings/{slug}?mode=json          (default region)
    https://api.eu.lever.co/v0/postings/{slug}?mode=json        (EU region)

Verified against Columbia Shipmanagement's EU-hosted board
(jobs.eu.lever.co/csmcy -> api.eu.lever.co/v0/postings/csmcy?mode=json),
which 404s against the default api.lever.co host -- the region prefix is
required, not optional, for EU tenants.

No auth, no pagination (the endpoint returns every live posting in one
response), descriptions inlined. No browser needed.

Used by: Columbia Shipmanagement (and its Romania entity, same board).
"""

import re
from datetime import datetime
from typing import Optional

import requests
import structlog
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()

HOSTED_RE = re.compile(r'https?://jobs\.(?:([a-z]+)\.)?lever\.co/([^/?#]+)')


class LeverScraper(BaseScraper):
    """
    Scraper for Lever-hosted ATS career portals.

    Strategy: one HTTP GET to the region-appropriate public postings API
    returns every live posting with full descriptions inlined.

    Config expects either:
        lever_slug: Account slug (e.g., "csmcy")
        lever_region: Optional data-residency region prefix (e.g., "eu");
            omit for the default api.lever.co host.
    or a base_url of the form https://jobs.lever.co/{slug} or
    https://jobs.{region}.lever.co/{slug}, from which both are derived.
    """

    def __init__(self, config: dict):
        super().__init__(config)
        self.slug = config.get('lever_slug')
        self.region = config.get('lever_region')

        if not self.slug:
            m = HOSTED_RE.match(config.get('base_url', ''))
            if m:
                self.region = self.region or m.group(1)
                self.slug = m.group(2)

        if not self.slug:
            raise ValueError(
                f"LeverScraper requires 'lever_slug' or a jobs.lever.co / "
                f"jobs.{{region}}.lever.co base_url (got {config.get('base_url')})"
            )

        api_host = f"api.{self.region}.lever.co" if self.region else "api.lever.co"
        self.postings_url = f"https://{api_host}/v0/postings/{self.slug}?mode=json"

        self._session = requests.Session()
        self._session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
        })

    def _location_string(self, categories: dict) -> str:
        parts = []
        location = (categories.get('location') or '').strip()
        all_locations = categories.get('allLocations') or []
        if all_locations:
            for loc in all_locations:
                loc = (loc or '').strip()
                if loc and loc not in parts:
                    parts.append(loc)
        elif location:
            parts.append(location)
        return '; '.join(parts) if parts else "Location Not Specified"

    def _normalize_employment_type_lever(self, commitment: Optional[str]) -> Optional[str]:
        if not commitment:
            return None
        mapping = {
            'full-time': 'Full-Time',
            'part-time': 'Part-Time',
            'contract': 'Contractor',
            'contractual': 'Contractor',
            'temporary': 'Temporary',
            'internship': 'Internship',
        }
        return mapping.get(commitment.strip().lower(), self._normalize_employment_type(commitment))

    def _parse_posted_date(self, epoch_millis: Optional[int]) -> Optional[datetime]:
        if not epoch_millis:
            return None
        try:
            return datetime.utcfromtimestamp(epoch_millis / 1000)
        except (ValueError, TypeError, OSError):
            return None

    def _build_description(self, posting: dict) -> str:
        sections = []
        categories = posting.get('categories') or {}
        header_lines = []
        for label, key in (('Department', 'department'), ('Team', 'team')):
            val = categories.get(key)
            if val:
                header_lines.append(f"**{label}:** {val}")
        if header_lines:
            sections.append('\n'.join(header_lines))

        opening = (posting.get('openingPlain') or '').strip()
        if opening:
            sections.append(opening)

        description = (posting.get('descriptionPlain') or '').strip()
        if description:
            sections.append(description)

        additional = (posting.get('additionalPlain') or '').strip()
        if additional:
            sections.append(additional)

        # Lever sometimes carries structured extra sections under "lists"
        # (e.g. "Requirements", "Benefits") beyond the main description.
        for section in posting.get('lists') or []:
            text = (section.get('content') or '').strip()
            if not text:
                continue
            # content is HTML for `lists`; descriptionPlain-style fields are
            # already plain, so only strip tags here.
            from bs4 import BeautifulSoup
            plain = BeautifulSoup(text, 'html.parser').get_text(separator='\n', strip=True)
            if plain:
                title = section.get('text') or 'Additional Information'
                sections.append(f"{title}:\n{plain}")

        result = '\n\n'.join(s for s in sections if s)
        if len(result) < 10:
            title = posting.get('text', 'this role')
            result = f"Position: {title}."
        return result

    def _build_job_data(self, posting: dict) -> dict:
        categories = posting.get('categories') or {}
        return {
            'title': posting.get('text') or 'Untitled Position',
            'company': self.company_name,
            'location': self._location_string(categories),
            'description': self._build_description(posting),
            'url': posting.get('hostedUrl'),
            'requisition_id': posting.get('id'),
            'posted_date': self._parse_posted_date(posting.get('createdAt')),
            'employment_type': self._normalize_employment_type_lever(categories.get('commitment')),
        }

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all live postings for the configured Lever account.

        A single request to the postings API returns every live posting with
        descriptions already inlined -- no pagination and no per-job detail
        fetch required.
        """
        jobs: list[JobPosting] = []
        self.logger.info("extraction_start", company=self.company_name, slug=self.slug, region=self.region)

        try:
            response = self._session.get(self.postings_url, timeout=30)
            response.raise_for_status()
            postings = response.json()
            if not isinstance(postings, list):
                self.logger.error("unexpected_response_shape", body=str(postings)[:300])
                return jobs

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
                        title=posting.get('text'),
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
