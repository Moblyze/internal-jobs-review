"""Workable ATS career portal scraper implementation.

This scraper extracts jobs from Workable-powered career portals
using the public v3 API endpoints.

Used by: Interocean Marine Services, and potentially other companies using Workable.

Strategy:
1. Use direct POST to /api/v3/accounts/{slug}/jobs for job listings
2. Use GET /api/v1/accounts/{slug}/jobs/{shortcode} for full job details
3. Parse JSON responses with structured job data
4. Paginate using token-based pagination
5. Extract job details (description, requirements) from individual job endpoints
"""

import re
from datetime import datetime
from typing import Optional

import requests
import structlog
from bs4 import BeautifulSoup
from pydantic import ValidationError
from playwright.async_api import Page

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()


class WorkableScraper(BaseScraper):
    """
    Scraper for Workable ATS career portals.

    Workable provides a public v3 API that returns JSON data without
    requiring authentication. This makes scraping much faster and more reliable
    than browser-based scraping.

    Listing endpoint: POST https://apply.workable.com/api/v3/accounts/{slug}/jobs
    Detail endpoint:  GET  https://apply.workable.com/api/v1/accounts/{slug}/jobs/{shortcode}

    The listing endpoint returns basic job metadata (title, location, code, dates).
    The detail endpoint returns full description, requirements, benefits, and employment type.
    """

    BASE_API_URL = "https://apply.workable.com/api/v3/accounts"
    # Job detail endpoint uses v1, not v3
    DETAIL_API_URL = "https://apply.workable.com/api/v1/accounts"

    def __init__(self, config: dict):
        """
        Initialize Workable scraper with company configuration.

        Args:
            config: Company config dict from companies.yaml. Must include:
                - name: Company display name
                - base_url: Career portal URL (e.g., https://apply.workable.com/interocean/)
                - workable_slug: Account slug for API calls (e.g., "interocean")
        """
        super().__init__(config)
        self.slug = config.get('workable_slug', self._extract_slug_from_url(config['base_url']))
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Referer': config['base_url'],
        })

    @staticmethod
    def _extract_slug_from_url(url: str) -> str:
        """
        Extract the Workable account slug from a career page URL.

        Example: https://apply.workable.com/interocean/ -> "interocean"

        Args:
            url: Career portal URL

        Returns:
            Account slug string
        """
        # Remove trailing slash and extract last path segment
        path = url.rstrip('/').split('/')
        # URL format: https://apply.workable.com/{slug}/
        for i, segment in enumerate(path):
            if segment == 'apply.workable.com' and i + 1 < len(path):
                return path[i + 1]
        # Fallback: return last non-empty path segment
        return [p for p in path if p][-1]

    def clean_html_description(self, html_text: Optional[str]) -> str:
        """
        Convert HTML description to clean plain text.

        Workable job descriptions contain full HTML markup. This method strips
        all HTML and converts to readable plain text.

        Args:
            html_text: HTML description string

        Returns:
            Clean plain text description
        """
        if not html_text:
            return ""

        try:
            soup = BeautifulSoup(html_text, 'html.parser')
            clean_text = soup.get_text(separator='\n', strip=True)

            # Remove excess whitespace and blank lines
            lines = [line.strip() for line in clean_text.split('\n') if line.strip()]
            clean_text = '\n'.join(lines)

            return clean_text

        except Exception as e:
            self.logger.error("html_cleaning_failed", error=str(e))
            return html_text

    def format_location(self, job_data: dict) -> str:
        """
        Format location string from Workable job data.

        Workable provides location as a structured object with city, region,
        country, and countryCode fields. Also supports multiple locations
        and remote/hybrid workplace types.

        Args:
            job_data: Raw job dict from Workable API

        Returns:
            Formatted location string (e.g., "Aberdeen, Scotland, United Kingdom (Remote)")
        """
        location_obj = job_data.get('location', {})
        if not location_obj:
            return "Location Not Specified"

        parts = []
        city = location_obj.get('city')
        region = location_obj.get('region')
        country = location_obj.get('country')

        if city:
            parts.append(city)
        if region and region != city:
            parts.append(region)
        if country:
            parts.append(country)

        location_str = ', '.join(parts) if parts else "Location Not Specified"

        # Append workplace type if remote or hybrid
        workplace = job_data.get('workplace', '')
        if workplace == 'remote':
            location_str += ' (Remote)'
        elif workplace == 'hybrid':
            location_str += ' (Hybrid)'

        return location_str

    def normalize_employment_type(self, raw_type: Optional[str]) -> Optional[str]:
        """
        Normalize Workable employment type to standard values.

        Workable uses short type codes: "full", "part", "contract", "temporary".

        Args:
            raw_type: Raw type string from Workable API

        Returns:
            Normalized employment type string
        """
        if not raw_type:
            return None

        workable_type_map = {
            'full': 'Full-Time',
            'part': 'Part-Time',
            'contract': 'Contractor',
            'temporary': 'Temporary',
            'internship': 'Internship',
            'volunteer': 'Volunteer',
        }

        return workable_type_map.get(raw_type.lower(), self._normalize_employment_type(raw_type))

    def construct_job_url(self, job_data: dict) -> str:
        """
        Construct the public job URL from job data.

        Workable job URLs follow the pattern:
        https://apply.workable.com/{slug}/j/{shortcode}/

        Args:
            job_data: Raw job dict from Workable API

        Returns:
            Full job URL
        """
        shortcode = job_data.get('shortcode', '')
        return f"https://apply.workable.com/{self.slug}/j/{shortcode}/"

    def parse_posted_date(self, date_string: Optional[str]) -> Optional[str]:
        """
        Parse ISO date string from Workable API to date-only string.

        Workable provides published dates as ISO 8601 strings
        (e.g., "2025-12-05T00:00:00.000Z").

        Args:
            date_string: ISO 8601 date string

        Returns:
            Date string (YYYY-MM-DD) or None
        """
        if not date_string:
            return None

        try:
            dt = datetime.fromisoformat(date_string.replace('Z', '+00:00'))
            return dt.strftime('%Y-%m-%d')
        except (ValueError, AttributeError):
            self.logger.warning("invalid_date_string", date_string=date_string)
            return None

    def fetch_jobs_page(self, token: Optional[str] = None) -> dict:
        """
        Fetch one page of jobs from Workable v3 API.

        Args:
            token: Pagination token from previous response (None for first page)

        Returns:
            API response dict with keys:
                - total: Total number of jobs
                - results: List of job dicts
                - nextPage: Pagination token for next page (if more results)

        Raises:
            requests.RequestException: On network errors
        """
        url = f"{self.BASE_API_URL}/{self.slug}/jobs"

        payload = {}
        if token:
            payload['token'] = token

        self.logger.info("fetching_jobs_page", url=url, has_token=bool(token))

        try:
            response = self.session.post(url, json=payload, timeout=30)
            response.raise_for_status()
            return response.json()

        except requests.RequestException as e:
            self.logger.error("api_request_failed", error=str(e), url=url)
            raise

    def fetch_job_details(self, shortcode: str) -> dict:
        """
        Fetch full job details for a specific position.

        The listing API only returns basic fields. The detail endpoint provides
        the full description, requirements, benefits, and employment type.

        Args:
            shortcode: Workable job shortcode (e.g., "55F1A1F6C5")

        Returns:
            Dict with full job detail fields including:
                - description: HTML job description
                - requirements: HTML requirements section
                - benefits: HTML benefits section
                - employment_type: Job type string
        """
        url = f"{self.DETAIL_API_URL}/{self.slug}/jobs/{shortcode}"

        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            return response.json()

        except requests.RequestException as e:
            self.logger.error("detail_fetch_failed", error=str(e), shortcode=shortcode)
            return {}

    def normalize_job_data(self, raw_job: dict, detail_data: Optional[dict] = None) -> dict:
        """
        Normalize Workable API response to JobPosting schema.

        Combines data from listing endpoint and detail endpoint into
        a unified dict matching the JobPosting model fields.

        Args:
            raw_job: Raw job dict from listing API results array
            detail_data: Optional full detail data from detail endpoint

        Returns:
            Dict matching JobPosting model fields
        """
        # Build description from detail data if available
        description = ""
        if detail_data:
            desc_parts = []

            # Main description
            desc_html = detail_data.get('description')
            if desc_html:
                desc_parts.append(self.clean_html_description(desc_html))

            # Requirements section
            req_html = detail_data.get('requirements')
            if req_html:
                desc_parts.append("Requirements:\n" + self.clean_html_description(req_html))

            # Benefits section
            benefits_html = detail_data.get('benefits')
            if benefits_html:
                desc_parts.append("Benefits:\n" + self.clean_html_description(benefits_html))

            description = '\n\n'.join(desc_parts)

        # Fallback: construct minimal description from listing data
        if not description or len(description) < 10:
            department = ', '.join(raw_job.get('department', []))
            workplace = raw_job.get('workplace', '')
            description = f"Position in {department}." if department else "Job posting."
            if workplace:
                description += f" Workplace: {workplace}."

        # Extract employment type from detail or listing data
        employment_type = None
        if detail_data and detail_data.get('employment_type'):
            employment_type = self.normalize_employment_type(detail_data['employment_type'])
        elif raw_job.get('type'):
            employment_type = self.normalize_employment_type(raw_job['type'])

        # Use 'code' field as requisition ID (e.g., "INT-042")
        requisition_id = raw_job.get('code') or raw_job.get('shortcode')

        return {
            'title': raw_job.get('title', 'Untitled Position'),
            'company': self.company_name,
            'location': self.format_location(raw_job),
            'description': description,
            'url': self.construct_job_url(raw_job),
            'posted_date': self.parse_posted_date(raw_job.get('published')),
            'skills': [],  # Workable doesn't provide structured skills in API
            'salary': None,  # Workable doesn't expose salary in public API
            'requisition_id': requisition_id,
            'certifications': [],  # Will be enriched by base class
            'employment_type': employment_type,
        }

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job listing data from search results page.

        NOT USED for Workable - we use direct API calls instead.
        This method is required by BaseScraper abstract class.

        Returns:
            Empty list (not used)
        """
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from job detail page.

        NOT USED for Workable - we use direct API calls instead.
        This method is required by BaseScraper abstract class.

        Returns:
            Empty dict (not used)
        """
        return {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs from Workable portal using direct API calls.

        This is the main entry point for the scraper. Uses direct HTTP requests
        to the Workable v3 API for fast, reliable extraction.

        Process:
        1. POST to listing endpoint to get job summaries with pagination
        2. For each job, GET the detail endpoint for full description
        3. Normalize and validate each job through JobPosting model
        4. Enrich with certifications

        Args:
            max_jobs: Optional limit for testing (extract only first N jobs)

        Returns:
            List of validated JobPosting objects
        """
        jobs = []
        token = None

        self.logger.info("extraction_start", company=self.company_name, slug=self.slug, max_jobs=max_jobs)

        try:
            while True:
                # Fetch page of job listings
                response = self.fetch_jobs_page(token=token)

                total = response.get('total', 0)
                results = response.get('results', [])
                next_token = response.get('nextPage')

                if not results:
                    if not jobs:
                        self.logger.warning("no_jobs_found", slug=self.slug)
                    break

                if token is None:
                    self.logger.info("total_jobs_found", total=total)

                self.logger.info("fetched_page", jobs_this_page=len(results), total_so_far=len(jobs))

                for raw_job in results:
                    try:
                        # Rate limit between detail requests
                        if jobs:
                            await self._rate_limit()

                        # Fetch full job details
                        shortcode = raw_job.get('shortcode', '')
                        detail_data = self.fetch_job_details(shortcode) if shortcode else None

                        # Normalize to JobPosting schema
                        job_data = self.normalize_job_data(raw_job, detail_data=detail_data)

                        # Enrich with certifications from description
                        job_data = self._enrich_with_certifications(job_data)
                        if self.config.get('extract_contacts', False):
                            job_data = self._enrich_with_contacts(job_data)

                        # Validate through Pydantic model
                        posting = JobPosting(**job_data)
                        jobs.append(posting)

                        if max_jobs and len(jobs) >= max_jobs:
                            self.logger.info("max_jobs_reached", count=len(jobs))
                            return jobs

                    except ValidationError as e:
                        self.logger.error(
                            "validation_failed",
                            error=str(e),
                            shortcode=raw_job.get('shortcode'),
                            title=raw_job.get('title')
                        )
                        continue

                # Check for next page
                if next_token:
                    token = next_token
                    await self._rate_limit()
                else:
                    break

            self.logger.info("extraction_complete", total_jobs=len(jobs))
            return jobs

        except Exception as e:
            self.logger.error("extraction_failed", error=str(e), exc_info=True)
            return jobs  # Return partial results if available
