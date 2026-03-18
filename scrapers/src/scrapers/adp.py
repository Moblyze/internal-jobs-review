"""ADP Workforce Now career portal scraper implementation.

This scraper extracts jobs from ADP Workforce Now (WFN) recruitment portals
using the public REST API endpoint.

Used by: Taurus Industrial Group, and potentially other companies using ADP WFN.

Strategy:
1. Query the public job-requisitions API with company CID
2. Parse JSON response for job listings (title, location, date, employment type)
3. Fetch individual job details for full description (requisitionDescription)
4. Handle pagination via $top/$skip OData parameters

Key ADP WFN concepts:
- cid: Company identifier (UUID) -- uniquely identifies the employer
- ccId: Career Center ID -- always "19000101_000001" for external postings
- itemID: Internal job requisition ID (used for detail API and URL construction)
- clientRequisitionID: External/public requisition ID
- The API is publicly accessible without authentication
- Job descriptions are HTML-formatted (requisitionDescription field)

API endpoint:
    GET /mascsr/default/careercenter/public/events/staffing/v1/job-requisitions
    Query params: cid, ccId, lang, $top, $skip
"""

import asyncio
import re
from datetime import datetime
from typing import Optional
from urllib.parse import urlencode

import requests
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()


class ADPScraper(BaseScraper):
    """
    Scraper for ADP Workforce Now recruitment portals via public REST API.

    Uses the ADP career center API to fetch job listings and details directly,
    avoiding the complexity and fragility of scraping the React SPA.

    API URL pattern:
        https://workforcenow.adp.com/mascsr/default/careercenter/public/events/
        staffing/v1/job-requisitions?cid={company_id}&ccId={cc_id}&lang={locale}
    """

    API_BASE = "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions"
    PORTAL_BASE = "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html"

    def __init__(self, config: dict):
        """
        Initialize ADP scraper with company configuration.

        Args:
            config: Company config dict from companies.yaml. Must include:
                - name: Company display name
                - adp_config.cid: ADP company identifier (UUID)
                - adp_config.cc_id: Career center ID (default: "19000101_000001")
                - adp_config.lang: Locale (default: "en_US")
        """
        super().__init__(config)
        self.adp_config = config.get('adp_config', {})
        self.cid = self.adp_config.get('cid', '')
        self.cc_id = self.adp_config.get('cc_id', '19000101_000001')
        self.lang = self.adp_config.get('lang', 'en_US')

        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
        })

    def _build_api_url(self, top: int = 100, skip: int = 0) -> str:
        """
        Build the ADP job-requisitions API URL with OData pagination.

        Args:
            top: Number of results to return (max per page)
            skip: Number of results to skip (offset)

        Returns:
            Full API URL with query parameters
        """
        params = {
            'cid': self.cid,
            'ccId': self.cc_id,
            'lang': self.lang,
            '$top': str(top),
            '$skip': str(skip),
        }
        return f"{self.API_BASE}?{urlencode(params)}"

    def _build_portal_url(self, job_id: str = '') -> str:
        """
        Build a portal URL for a specific job posting.

        Args:
            job_id: Optional job requisition ID for deep linking

        Returns:
            URL string for the career portal (with optional job selected)
        """
        params = {
            'cid': self.cid,
            'ccId': self.cc_id,
            'lang': self.lang,
        }
        if job_id:
            params['selectedMenuKey'] = 'CurrentOpenings'
            params['jobId'] = job_id
        return f"{self.PORTAL_BASE}?{urlencode(params)}"

    def _clean_html(self, html_text: Optional[str]) -> str:
        """
        Convert HTML description to clean plain text.

        Args:
            html_text: Raw HTML description string

        Returns:
            Clean plain text description
        """
        if not html_text:
            return ""

        try:
            soup = BeautifulSoup(html_text, 'html.parser')
            for element in soup(['script', 'style', 'img']):
                element.decompose()
            text = soup.get_text(separator='\n', strip=True)
            lines = [line.strip() for line in text.split('\n') if line.strip()]
            return '\n'.join(lines)
        except Exception as e:
            self.logger.error("html_cleaning_failed", error=str(e))
            return html_text

    def _parse_post_date(self, date_str: str) -> Optional[str]:
        """
        Parse ADP ISO date string to YYYY-MM-DD format.

        Args:
            date_str: ISO 8601 date (e.g., "2026-03-17T16:42:00.000-04:00")

        Returns:
            Date string (YYYY-MM-DD) or None
        """
        if not date_str:
            return None
        try:
            # Just take the date portion
            return date_str[:10]
        except Exception:
            return None

    def _extract_location(self, job: dict) -> str:
        """
        Extract location string from job requisition data.

        Args:
            job: Raw job requisition dict from API

        Returns:
            Location string or 'Location Not Specified'
        """
        locations = job.get('requisitionLocations', [])
        if locations:
            loc = locations[0]
            name = loc.get('nameCode', {}).get('shortName', '')
            if name:
                return name.strip()
            # Fallback: build from address components
            addr = loc.get('address', {})
            city = addr.get('cityName', '')
            state = addr.get('countrySubdivisionLevel1', {}).get('codeValue', '')
            if city and state:
                return f"{city}, {state}"
            elif city:
                return city
        return 'Location Not Specified'

    def _extract_employment_type(self, job: dict) -> Optional[str]:
        """
        Extract employment type from workLevelCode.

        Args:
            job: Raw job requisition dict from API

        Returns:
            Normalized employment type or None
        """
        work_level = job.get('workLevelCode', {})
        short_name = work_level.get('shortName', '')
        if short_name:
            return self._normalize_employment_type(short_name)
        return None

    def _extract_external_job_id(self, job: dict) -> Optional[str]:
        """
        Extract the external job ID from custom fields.

        Args:
            job: Raw job requisition dict from API

        Returns:
            External job ID string or None
        """
        custom_fields = job.get('customFieldGroup', {})
        string_fields = custom_fields.get('stringFields', [])
        for field in string_fields:
            if field.get('nameCode', {}).get('codeValue') == 'ExternalJobID':
                return field.get('stringValue')
        return job.get('clientRequisitionID')

    def _fetch_job_listings(self) -> list[dict]:
        """
        Fetch all job listings from the ADP API with pagination.

        Returns:
            List of raw job requisition dicts
        """
        all_jobs = []
        page_size = 100
        skip = 0
        max_pages = 10  # Safety limit

        for page_num in range(max_pages):
            url = self._build_api_url(top=page_size, skip=skip)
            self.logger.info("fetching_api_page", url=url, skip=skip)

            try:
                response = self.session.get(url, timeout=30)
                response.raise_for_status()
                data = response.json()

                jobs = data.get('jobRequisitions', [])
                if not jobs:
                    break

                all_jobs.extend(jobs)
                self.logger.info("api_page_fetched", page=page_num + 1, jobs=len(jobs))

                # If we got fewer than page_size, we've reached the end
                if len(jobs) < page_size:
                    break

                skip += page_size

            except requests.exceptions.RequestException as e:
                self.logger.error("api_fetch_failed", skip=skip, error=str(e))
                break

        return all_jobs

    def _fetch_job_detail(self, item_id: str) -> Optional[dict]:
        """
        Fetch full job detail from the ADP API.

        Args:
            item_id: Job requisition itemID

        Returns:
            Full job requisition dict with description, or None on failure
        """
        params = {
            'cid': self.cid,
            'ccId': self.cc_id,
            'lang': self.lang,
        }
        url = f"{self.API_BASE}/{item_id}?{urlencode(params)}"

        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            self.logger.error("detail_fetch_failed", item_id=item_id, error=str(e))
            return None

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """Required by BaseScraper. Not used for API-based scraper."""
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """Required by BaseScraper. Not used for API-based scraper."""
        return {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs from ADP Workforce Now via public REST API.

        Process:
        1. Fetch all job listings from the API
        2. For each job, fetch full details (description)
        3. Parse and normalize job data
        4. Validate through JobPosting model
        5. Enrich with certifications

        Args:
            max_jobs: Optional limit for testing (extract only first N jobs)

        Returns:
            List of validated JobPosting objects
        """
        jobs = []

        self.logger.info(
            "extraction_start",
            company=self.company_name,
            cid=self.cid,
            max_jobs=max_jobs,
        )

        try:
            # Fetch all listings from the API
            raw_listings = self._fetch_job_listings()

            if not raw_listings:
                self.logger.warning("no_listings_found")
                return []

            self.logger.info("total_listings_found", count=len(raw_listings))

            # Apply max_jobs limit
            if max_jobs:
                raw_listings = raw_listings[:max_jobs]

            for i, listing in enumerate(raw_listings):
                try:
                    title = listing.get('requisitionTitle', 'Untitled Position')
                    item_id = listing.get('itemID', '')
                    location = self._extract_location(listing)
                    posted_date = self._parse_post_date(listing.get('postDate', ''))
                    employment_type = self._extract_employment_type(listing)
                    external_id = self._extract_external_job_id(listing)

                    self.logger.info(
                        "processing_job",
                        index=i + 1,
                        total=len(raw_listings),
                        title=title,
                    )

                    # Fetch full detail for description
                    description = ''
                    if item_id:
                        if i > 0:
                            await asyncio.sleep(self.rate_limit_delay * 0.5)

                        detail = self._fetch_job_detail(item_id)
                        if detail:
                            raw_desc = detail.get('requisitionDescription', '')
                            description = self._clean_html(raw_desc)

                    if not description or len(description) < 10:
                        description = f"Position: {title} at {self.company_name}."
                        if location and location != 'Location Not Specified':
                            description += f" Location: {location}."

                    # Build job URL
                    job_url = self._build_portal_url(external_id or item_id)

                    job_data = {
                        'title': title,
                        'company': self.company_name,
                        'location': location,
                        'description': description,
                        'url': job_url,
                        'posted_date': posted_date,
                        'skills': [],
                        'salary': None,
                        'requisition_id': external_id or None,
                        'certifications': [],
                        'employment_type': employment_type,
                    }

                    # Enrich with certifications
                    job_data = self._enrich_with_certifications(job_data)

                    # Validate through Pydantic model
                    posting = JobPosting(**job_data)
                    jobs.append(posting)

                    self.logger.info(
                        "job_extracted",
                        title=title,
                        location=location,
                    )

                except ValidationError as e:
                    self.logger.error(
                        "validation_failed",
                        error=str(e),
                        title=listing.get('requisitionTitle'),
                    )
                    continue
                except Exception as e:
                    self.logger.error(
                        "job_processing_failed",
                        error=str(e),
                        title=listing.get('requisitionTitle'),
                    )
                    continue

            self.logger.info("extraction_complete", total_jobs=len(jobs))
            return jobs

        except Exception as e:
            self.logger.error("extraction_failed", error=str(e), exc_info=True)
            return jobs
