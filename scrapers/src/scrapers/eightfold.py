"""Eightfold AI career portal scraper implementation.

This scraper extracts jobs from Eightfold AI-powered career portals
using the unauthenticated public API endpoints.

Used by: Schlumberger (SLB), potentially other companies using Eightfold AI.

Strategy:
1. Use direct API calls to /api/pcsx/search endpoint (fastest)
2. Parse JSON response with structured job data
3. Paginate using start parameter (10 jobs per page)
4. Extract job details from individual position endpoints if needed
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


class EightfoldScraper(BaseScraper):
    """
    Scraper for Eightfold AI career portals.

    Eightfold provides a public API endpoint that returns JSON data without
    requiring authentication. This makes scraping much faster and more reliable
    than browser-based scraping.

    API Endpoint: https://{company}.eightfold.ai/api/pcsx/search
    Response: JSON with positions array, count, and metadata
    Pagination: start parameter (0, 10, 20, 30, ...)
    Page size: 10 jobs per request
    """

    def extract_requisition_id(self, job_data: dict) -> Optional[str]:
        """
        Extract requisition ID from Eightfold job data.

        Eightfold provides multiple ID fields:
        - displayJobId: Human-readable ID (e.g., "13536")
        - id: Internal position ID (e.g., 563499731394011)
        - atsJobId: ATS system job ID (usually same as displayJobId)

        We use displayJobId as the requisition ID since it's what users
        will see on the job posting.

        Args:
            job_data: Raw job dict from Eightfold API

        Returns:
            Requisition ID string or None
        """
        # Prefer displayJobId (human-readable)
        req_id = job_data.get('displayJobId')
        if req_id:
            return str(req_id)

        # Fallback to atsJobId
        req_id = job_data.get('atsJobId')
        if req_id:
            return str(req_id)

        # Last resort: internal ID
        req_id = job_data.get('id')
        if req_id:
            return str(req_id)

        return None

    def parse_posted_date(self, timestamp: Optional[int]) -> Optional[str]:
        """
        Convert Unix timestamp (seconds) to ISO date string.

        Eightfold provides postedTs as Unix timestamp in seconds.

        Args:
            timestamp: Unix timestamp in seconds (e.g., 1770184713)

        Returns:
            ISO date string (YYYY-MM-DD) or None
        """
        if not timestamp:
            return None

        try:
            dt = datetime.fromtimestamp(timestamp)
            return dt.strftime('%Y-%m-%d')
        except (ValueError, OSError):
            self.logger.warning("invalid_timestamp", timestamp=timestamp)
            return None

    def clean_html_description(self, html_text: Optional[str]) -> str:
        """
        Convert HTML description to clean plain text.

        Eightfold job descriptions contain full HTML markup with tags,
        attributes, and formatting. This method strips all HTML and
        converts to readable plain text.

        Args:
            html_text: HTML description string

        Returns:
            Clean plain text description
        """
        if not html_text:
            return ""

        try:
            # Parse HTML
            soup = BeautifulSoup(html_text, 'html.parser')

            # Get text content with newlines between elements
            clean_text = soup.get_text(separator='\n', strip=True)

            # Remove excess whitespace and blank lines
            lines = [line.strip() for line in clean_text.split('\n') if line.strip()]
            clean_text = '\n'.join(lines)

            return clean_text

        except Exception as e:
            self.logger.error("html_cleaning_failed", error=str(e))
            return html_text  # Return original if cleaning fails

    def normalize_location(self, locations: list[str], standardized_locations: list[str]) -> str:
        """
        Format location from Eightfold location arrays.

        Eightfold provides two location fields:
        - locations: Human-readable locations (e.g., ["Pune, India"])
        - standardizedLocations: Standardized format (e.g., ["Pune, MH, IN"])

        We prefer the human-readable format.

        Args:
            locations: List of location strings
            standardized_locations: List of standardized location strings

        Returns:
            Primary location string
        """
        if locations and locations[0]:
            return locations[0]

        if standardized_locations and standardized_locations[0]:
            return standardized_locations[0]

        return "Location Not Specified"

    def construct_job_url(self, job_data: dict) -> str:
        """
        Construct full job URL from position data.

        Eightfold provides positionUrl as relative path (e.g., "/careers/job/563499731394011").
        We need to prepend the base domain.

        Args:
            job_data: Raw job dict from Eightfold API

        Returns:
            Full job URL
        """
        position_url = job_data.get('positionUrl', '')
        if position_url:
            # Extract base domain from config
            base_domain = self.config['base_url'].rstrip('/careers').rstrip('/')
            return f"{base_domain}{position_url}"

        # Fallback: construct from job ID
        job_id = job_data.get('id')
        if job_id:
            base_domain = self.config['base_url'].rstrip('/careers').rstrip('/')
            return f"{base_domain}/careers/job/{job_id}"

        return self.config['base_url']

    def fetch_jobs_page(self, start: int = 0) -> dict:
        """
        Fetch one page of jobs from Eightfold API.

        Args:
            start: Pagination offset (0, 10, 20, ...)

        Returns:
            API response dict with keys:
                - status: HTTP status code
                - error: Error dict (empty if success)
                - data: Dict with 'positions', 'count', etc.
                - metadata: Usually null

        Raises:
            requests.RequestException: On network errors
        """
        # Extract domain from base URL
        # Example: https://slb.eightfold.ai/careers -> slb.com
        domain = self.config.get('eightfold_domain', 'slb.com')

        url = f"{self.config['base_url'].rstrip('/careers')}/api/pcsx/search"

        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': self.config['base_url']
        }

        params = {
            'domain': domain,
            'query': '',
            'location': '',
            'start': start
        }

        self.logger.info("fetching_jobs_page", url=url, start=start)

        try:
            response = requests.get(url, headers=headers, params=params, timeout=30)
            response.raise_for_status()
            return response.json()

        except requests.RequestException as e:
            self.logger.error("api_request_failed", error=str(e), url=url, start=start)
            raise

    def fetch_job_details(self, position_id: int) -> dict:
        """
        Fetch full job details for a specific position.

        The search API only returns basic fields. To get the full description
        and employment type, we need to call the position_details endpoint.

        Args:
            position_id: Eightfold position ID (e.g., 563499731394011)

        Returns:
            Dict with 'description' (clean text) and 'employment_type' keys
        """
        result = {'description': None, 'employment_type': None}

        domain = self.config.get('eightfold_domain', 'slb.com')
        url = f"{self.config['base_url'].rstrip('/careers')}/api/pcsx/position_details"

        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': self.config['base_url']
        }

        params = {
            'position_id': position_id,
            'domain': domain,
            'hl': 'en'
        }

        try:
            response = requests.get(url, headers=headers, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()

            if data.get('status') == 200 and data.get('data'):
                position_data = data['data']

                # Extract description (HTML → plain text)
                html_description = position_data.get('description') or position_data.get('jobDescription')
                if html_description:
                    result['description'] = self.clean_html_description(html_description)

                # Extract employment type from various possible fields
                emp_type = (
                    position_data.get('employmentType')
                    or position_data.get('jobType')
                    or position_data.get('positionType')
                    or position_data.get('type')
                )
                if emp_type:
                    result['employment_type'] = self._normalize_employment_type(emp_type)

                # Check positionExtraDetails for employment type
                if not result['employment_type']:
                    extra = position_data.get('positionExtraDetails', {})
                    if isinstance(extra, dict):
                        emp_type = (
                            extra.get('employmentType')
                            or extra.get('jobType')
                            or extra.get('type')
                        )
                        if emp_type:
                            result['employment_type'] = self._normalize_employment_type(emp_type)

        except requests.RequestException as e:
            self.logger.error("description_fetch_failed", error=str(e), position_id=position_id)

        return result

    def fetch_job_description(self, position_id: int) -> Optional[str]:
        """
        Backward-compatible wrapper around fetch_job_details().

        Args:
            position_id: Eightfold position ID

        Returns:
            Clean plain text job description or None
        """
        details = self.fetch_job_details(position_id)
        return details.get('description')

    def normalize_job_data(self, raw_job: dict, include_description: bool = False) -> dict:
        """
        Normalize Eightfold API response to JobPosting schema.

        Args:
            raw_job: Raw job dict from Eightfold API positions array
            include_description: If True, fetch full description (slower)

        Returns:
            Dict matching JobPosting model fields
        """
        # Extract description and employment type (requires additional API call)
        description = ""
        employment_type = None

        if include_description:
            details = self.fetch_job_details(raw_job.get('id'))
            description = details.get('description') or ""
            employment_type = details.get('employment_type')

        if not description:
            # Use placeholder from available search result fields
            department = raw_job.get('department', '')
            work_option = raw_job.get('workLocationOption', '')
            description = f"Position in {department}. Work location: {work_option}." if department else ""

        # Include department info in description if no full description available
        if not description or len(description) < 50:
            department = raw_job.get('department', '')
            work_option = raw_job.get('workLocationOption', '')
            if department:
                description = f"Position in {department}. Work location: {work_option}."

        # Try to infer employment type from job name if API didn't provide it
        if not employment_type:
            name_lower = raw_job.get('name', '').lower()
            if 'intern' in name_lower or 'student' in name_lower or 'co-op' in name_lower:
                employment_type = 'Internship'
            elif 'contract' in name_lower or 'contingent' in name_lower:
                employment_type = 'Contractor'
            elif 'temp' in name_lower and 'temperature' not in name_lower:
                employment_type = 'Temporary'

        return {
            'title': raw_job.get('name', 'Untitled Position'),
            'company': self.company_name,
            'location': self.normalize_location(
                raw_job.get('locations', []),
                raw_job.get('standardizedLocations', [])
            ),
            'description': description,
            'url': self.construct_job_url(raw_job),
            'posted_date': self.parse_posted_date(raw_job.get('postedTs')),
            'skills': [],  # Eightfold doesn't provide skills in search results
            'salary': None,  # Eightfold doesn't provide salary in public API
            'requisition_id': self.extract_requisition_id(raw_job),
            'certifications': [],  # Will be enriched by base class
            'employment_type': employment_type
        }

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job listing data from search results page.

        NOT USED for Eightfold - we use direct API calls instead.
        This method is required by BaseScraper abstract class.

        Returns:
            Empty list (not used)
        """
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from job detail page.

        NOT USED for Eightfold - we use direct API calls instead.
        This method is required by BaseScraper abstract class.

        Returns:
            Empty dict (not used)
        """
        return {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs from Eightfold portal using direct API calls.

        This is the main entry point for the scraper. Unlike other scrapers
        that use Playwright, Eightfold scraper uses direct HTTP requests
        to the public API for much faster extraction.

        Process:
        1. Fetch first page to get total count
        2. Calculate number of pages needed
        3. Fetch all pages in sequence
        4. Normalize and validate each job
        5. Enrich with certifications

        Args:
            max_jobs: Optional limit for testing (extract only first N jobs)

        Returns:
            List of validated JobPosting objects
        """
        jobs = []
        start = 0
        page_size = 10  # Eightfold returns 10 jobs per page
        total_jobs = None

        self.logger.info("extraction_start", company=self.company_name, max_jobs=max_jobs)

        try:
            # Fetch first page to get total count
            response = self.fetch_jobs_page(start=0)

            if response.get('status') != 200:
                error_msg = response.get('error', {}).get('message', 'Unknown error')
                self.logger.error("api_error", error=error_msg)
                return []

            data = response.get('data', {})
            total_jobs = data.get('count', 0)
            positions = data.get('positions', [])

            self.logger.info("total_jobs_found", total=total_jobs)

            # Process first page
            for raw_job in positions:
                try:
                    job_data = self.normalize_job_data(raw_job, include_description=True)
                    job_data = self._enrich_with_certifications(job_data)
                    if self.config.get('extract_contacts', False):
                        job_data = self._enrich_with_contacts(job_data)

                    posting = JobPosting(**job_data)
                    jobs.append(posting)

                    if max_jobs and len(jobs) >= max_jobs:
                        self.logger.info("max_jobs_reached", count=len(jobs))
                        return jobs

                except ValidationError as e:
                    self.logger.error("validation_failed", error=str(e), job_data=raw_job)
                    continue

            # Fetch remaining pages
            start = page_size
            while start < total_jobs:
                if max_jobs and len(jobs) >= max_jobs:
                    break

                # Rate limit between requests
                await self._rate_limit()

                response = self.fetch_jobs_page(start=start)

                if response.get('status') != 200:
                    error_msg = response.get('error', {}).get('message', 'Unknown error')
                    self.logger.error("api_error", error=error_msg, start=start)
                    break

                positions = response.get('data', {}).get('positions', [])

                if not positions:
                    self.logger.info("no_more_positions", start=start)
                    break

                self.logger.info("fetched_page", start=start, count=len(positions))

                for raw_job in positions:
                    try:
                        job_data = self.normalize_job_data(raw_job, include_description=True)
                        job_data = self._enrich_with_certifications(job_data)
                        if self.config.get('extract_contacts', False):
                            job_data = self._enrich_with_contacts(job_data)

                        posting = JobPosting(**job_data)
                        jobs.append(posting)

                        if max_jobs and len(jobs) >= max_jobs:
                            self.logger.info("max_jobs_reached", count=len(jobs))
                            return jobs

                    except ValidationError as e:
                        self.logger.error("validation_failed", error=str(e), job_data=raw_job)
                        continue

                start += page_size

            self.logger.info("extraction_complete", total_jobs=len(jobs))
            return jobs

        except Exception as e:
            self.logger.error("extraction_failed", error=str(e), exc_info=True)
            return jobs  # Return partial results if available
