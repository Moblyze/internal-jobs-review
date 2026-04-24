"""Oracle HCM Cloud Candidate Experience scraper implementation.

This scraper extracts jobs from Oracle HCM Cloud career portals using the
public REST API exposed by the Candidate Experience module.

Used by: Oceaneering (migrated from Phenom in April 2026).

Strategy:
1. Use the public REST API to fetch job requisitions in paginated batches of 25
2. Parse JSON response with structured job data (title, location, description, etc.)
3. Construct job detail URLs from requisition numbers
4. No authentication required for public career sites
5. No browser automation needed — pure HTTP/JSON approach

Oracle HCM REST API pattern:
    GET {api_base}/recruitingCEJobRequisitions?onlyData=true&expand=...&finder=findReqs;siteNumber={site},limit=25,offset=0,sortBy=POSTING_DATES_DESC

Each item in the response includes:
- Id: Internal requisition ID
- Title: Job title
- PrimaryLocation: Location string (e.g., "Houston, Texas, United States")
- ShortDescriptionStr: Plain text summary
- ExternalDescriptionStr: Full HTML job description
- PostedDate: ISO date string (e.g., "2026-04-10")
- WorkplaceTypeCode: Workplace type (e.g., "ONSITE", "HYBRID", "REMOTE")
- RequisitionNumber: Unique requisition number used in job URLs
- CategoryCode / CategoryName: Job category
"""

import time
from datetime import datetime
from html import unescape
from typing import Optional

import requests
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()

# Oracle HCM returns up to 25 items per page
PAGE_SIZE = 25


class OracleHCMScraper(BaseScraper):
    """
    Scraper for Oracle HCM Cloud Candidate Experience career portals.

    Oracle HCM exposes a public REST API for job search at the
    recruitingCEJobRequisitions endpoint. This scraper paginates through
    all results using offset-based pagination and maps each requisition
    to the JobPosting model.

    No browser automation is required — all data comes from JSON responses.
    """

    def __init__(self, config: dict):
        """
        Initialize Oracle HCM scraper with company configuration.

        Args:
            config: Company config dict from companies.yaml. Must include:
                - name: Company display name
                - base_url: Career portal base URL
                - oracle_hcm_config.api_base: REST API base URL
                - oracle_hcm_config.site_number: Career site identifier
                - oracle_hcm_config.job_url_template: URL template for job detail pages
        """
        super().__init__(config)
        self.hcm_config = config.get('oracle_hcm_config', {})
        self.api_base = self.hcm_config.get('api_base', '')
        self.site_number = self.hcm_config.get('site_number', 'jobs')
        self.job_url_template = self.hcm_config.get('job_url_template', '')

        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': (
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/120.0.0.0 Safari/537.36'
            ),
            'Accept': 'application/json',
        })

    def _build_search_url(self, offset: int = 0, limit: int = PAGE_SIZE) -> str:
        """
        Construct the REST API search URL with pagination parameters.

        Args:
            offset: Number of results to skip (0-based)
            limit: Number of results per page (max 25)

        Returns:
            Full API URL for job search
        """
        finder = (
            f"findReqs;siteNumber={self.site_number},"
            f"facetsList=LOCATIONS;WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;"
            f"CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS,"
            f"limit={limit},offset={offset},sortBy=POSTING_DATES_DESC"
        )
        return (
            f"{self.api_base}/recruitingCEJobRequisitions"
            f"?onlyData=true"
            f"&expand=requisitionList.secondaryLocations,flexFieldsFacet.values"
            f"&finder={finder}"
        )

    def _build_job_url(self, req_number: str) -> str:
        """
        Construct the job detail URL from a requisition number.

        Args:
            req_number: Oracle requisition number (e.g., "IRC123456")

        Returns:
            Full job detail URL
        """
        if self.job_url_template:
            return self.job_url_template.replace('{req_id}', req_number)
        # Fallback: construct from base_url
        return f"{self.config.get('base_url', '')}/job/{req_number}"

    def _fetch_page(self, offset: int = 0) -> Optional[dict]:
        """
        Fetch a single page of job requisitions from the API.

        Args:
            offset: Number of results to skip

        Returns:
            Parsed JSON response dict, or None on failure
        """
        url = self._build_search_url(offset=offset)
        self.logger.info("fetching_api_page", offset=offset, url=url)

        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            self.logger.error("api_fetch_failed", offset=offset, error=str(e))
            return None
        except ValueError as e:
            self.logger.error("json_parse_failed", offset=offset, error=str(e))
            return None

    def _fetch_requisition_detail(self, req_id: str) -> dict:
        """
        Fetch the full detail record for a single requisition.

        The listing endpoint (recruitingCEJobRequisitions) only returns a
        short summary. Full description + qualifications + responsibilities
        live on recruitingCEJobRequisitionDetails, queried by primary key via
        the `q=Id=...` query parameter.

        Returns:
            The single detail dict, or {} on failure.
        """
        if not req_id:
            return {}
        url = (
            f"{self.api_base}/recruitingCEJobRequisitionDetails"
            f"?onlyData=true&q=Id={req_id}&limit=1"
        )
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            items = (response.json() or {}).get('items') or []
            return items[0] if items else {}
        except (requests.RequestException, ValueError) as e:
            self.logger.warning("detail_fetch_failed", req_id=req_id, error=str(e))
            return {}

    def _extract_total_count(self, response_data: dict) -> int:
        """
        Extract total job count from the API response.

        Oracle HCM returns total count in different possible locations.
        Check items[0].TotalJobsCount first, then fall back to counting items.

        Args:
            response_data: Parsed JSON response

        Returns:
            Total number of jobs available
        """
        items = response_data.get('items', [])
        if not items:
            return 0

        # Oracle HCM nests requisitions under items[0].requisitionList
        first_item = items[0] if items else {}

        # Try to get total from the response metadata
        total = first_item.get('TotalJobsCount', 0)
        if total:
            return int(total)

        # Fall back to count field or items length
        count = response_data.get('count', 0)
        if count:
            return int(count)

        # Last resort: count requisition list items
        req_list = first_item.get('requisitionList', [])
        return len(req_list)

    def _extract_requisitions(self, response_data: dict) -> list[dict]:
        """
        Extract the list of job requisitions from the API response.

        Oracle HCM nests requisitions under items[0].requisitionList.

        Args:
            response_data: Parsed JSON response

        Returns:
            List of requisition dicts
        """
        items = response_data.get('items', [])
        if not items:
            return []

        # Requisitions are nested under items[0].requisitionList
        first_item = items[0]
        req_list = first_item.get('requisitionList', [])
        return req_list

    def _clean_html_description(self, html_text: Optional[str]) -> str:
        """
        Convert HTML description to clean plain text.

        Oracle HCM job descriptions contain HTML markup. This method
        strips tags and normalizes whitespace.

        Args:
            html_text: Raw HTML description string

        Returns:
            Clean plain text description
        """
        if not html_text:
            return ""

        try:
            # Unescape HTML entities
            unescaped = unescape(html_text)

            # Parse HTML and extract text
            soup = BeautifulSoup(unescaped, 'html.parser')
            clean_text = soup.get_text(separator='\n', strip=True)

            # Remove excess blank lines
            lines = [line.strip() for line in clean_text.split('\n') if line.strip()]
            clean_text = '\n'.join(lines)

            # Clean up non-breaking spaces
            clean_text = clean_text.replace('\xa0', ' ')

            return clean_text

        except Exception as e:
            self.logger.error("html_cleaning_failed", error=str(e))
            return html_text or ""

    def _parse_posted_date(self, date_str: Optional[str]) -> Optional[datetime]:
        """
        Parse Oracle HCM date string to datetime.

        Oracle HCM uses ISO date format: "2026-04-10" or full ISO datetime.

        Args:
            date_str: Date string from API response

        Returns:
            datetime object or None if parsing fails
        """
        if not date_str:
            return None

        try:
            # Try ISO datetime first (e.g., "2026-04-10T14:30:00+00:00")
            return datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            pass

        try:
            # Try date-only format (e.g., "2026-04-10")
            return datetime.strptime(date_str, '%Y-%m-%d')
        except (ValueError, AttributeError) as e:
            self.logger.warning("date_parse_failed", date_str=date_str, error=str(e))
            return None

    def _map_workplace_type(self, workplace_code: Optional[str]) -> Optional[str]:
        """
        Map Oracle HCM WorkplaceTypeCode to a human-readable string.

        Args:
            workplace_code: Oracle workplace type code

        Returns:
            Human-readable workplace type or None
        """
        if not workplace_code:
            return None

        mapping = {
            'ONSITE': 'On-site',
            'HYBRID': 'Hybrid',
            'REMOTE': 'Remote',
        }
        return mapping.get(workplace_code.upper(), workplace_code)

    def _parse_requisition(self, req: dict) -> Optional[dict]:
        """
        Parse a single requisition dict into normalized job data.

        Args:
            req: Raw requisition dict from Oracle HCM API

        Returns:
            Normalized job data dict, or None if requisition is invalid
        """
        try:
            title = (req.get('Title') or '').strip()
            if not title:
                self.logger.warning("requisition_no_title", req_id=req.get('Id'))
                return None

            # Oracle HCM's CE listing response does not include a separate
            # RequisitionNumber field — the `Id` IS the stable requisition id
            # used in detail URLs. Fall back to Id if RequisitionNumber is
            # missing so URL and requisition_id are always populated.
            req_number = (
                req.get('RequisitionNumber')
                or str(req.get('Id') or '')
            )
            job_url = self._build_job_url(req_number) if req_number else ''

            # Location: use PrimaryLocation, append secondary locations if present
            primary_location = (req.get('PrimaryLocation') or 'Location Not Specified').strip()
            secondary_locations = req.get('secondaryLocations', [])
            if secondary_locations:
                secondary_names = [
                    loc.get('Name', '').strip()
                    for loc in secondary_locations
                    if loc.get('Name', '').strip()
                ]
                if secondary_names:
                    location = f"{primary_location}; {'; '.join(secondary_names)}"
                else:
                    location = primary_location
            else:
                location = primary_location

            # Description: the listing endpoint only returns a short summary
            # (often whitespace). Fetch the detail record for the full HTML
            # description when needed.
            external_desc = req.get('ExternalDescriptionStr') or ''
            short_desc = req.get('ShortDescriptionStr') or ''
            if len(external_desc.strip()) < 50:
                detail = self._fetch_requisition_detail(str(req.get('Id') or ''))
                if detail:
                    external_desc = detail.get('ExternalDescriptionStr') or external_desc
                    resp = detail.get('ExternalResponsibilitiesStr') or ''
                    qual = detail.get('ExternalQualificationsStr') or ''
                    # Combine description + responsibilities + qualifications
                    parts = [p for p in (external_desc, resp, qual) if p and p.strip()]
                    external_desc = '\n\n'.join(parts)
            description = (
                self._clean_html_description(external_desc)
                if external_desc.strip()
                else short_desc.strip()
            )

            # Posted date
            posted_date = self._parse_posted_date(req.get('PostedDate'))

            # Workplace type as metadata in location
            workplace_type = self._map_workplace_type(req.get('WorkplaceTypeCode'))

            # Employment type from WorkActionCode or similar fields
            employment_type = self._normalize_employment_type(
                req.get('WorkActionCode') or req.get('RegularTemporary')
            )

            # Category
            category = req.get('CategoryName', '')

            return {
                'title': title,
                'company': self.company_name,
                'location': location,
                'description': description,
                'url': job_url,
                'posted_date': posted_date,
                'requisition_id': req_number or str(req.get('Id', '')),
                'skills': [],
                'salary': None,
                'certifications': [],
                'employment_type': employment_type,
                # Internal metadata for logging
                '_workplace_type': workplace_type,
                '_category': category,
                '_oracle_id': req.get('Id'),
            }

        except Exception as e:
            self.logger.error(
                "requisition_parse_failed",
                error=str(e),
                req_id=req.get('Id'),
                title=req.get('Title'),
            )
            return None

    def _fetch_all_requisitions(self, max_jobs: Optional[int] = None) -> list[dict]:
        """
        Fetch all job requisitions from the API, handling pagination.

        Args:
            max_jobs: Optional limit on total jobs to fetch

        Returns:
            List of parsed job data dicts
        """
        all_jobs = []
        offset = 0
        total_count = None

        while True:
            # Respect max_jobs limit
            if max_jobs and len(all_jobs) >= max_jobs:
                self.logger.info("max_jobs_reached", count=len(all_jobs))
                break

            # Rate limit between API requests (skip first request)
            if offset > 0:
                delay = self.rate_limit_delay
                self.logger.debug("rate_limiting", delay_seconds=delay)
                time.sleep(delay)

            # Fetch page
            response_data = self._fetch_page(offset=offset)
            if response_data is None:
                self.logger.error("page_fetch_failed_stopping", offset=offset)
                break

            # Get total count on first request
            if total_count is None:
                total_count = self._extract_total_count(response_data)
                self.logger.info("total_jobs_available", total=total_count)

            # Extract requisitions from this page
            requisitions = self._extract_requisitions(response_data)
            if not requisitions:
                self.logger.info("no_more_requisitions", offset=offset)
                break

            self.logger.info(
                "page_fetched",
                offset=offset,
                count=len(requisitions),
                total_so_far=len(all_jobs) + len(requisitions),
            )

            # Parse each requisition
            for req in requisitions:
                if max_jobs and len(all_jobs) >= max_jobs:
                    break

                job_data = self._parse_requisition(req)
                if job_data:
                    all_jobs.append(job_data)

            # Move to next page
            offset += PAGE_SIZE

            # Stop if we've fetched all available jobs
            if total_count and offset >= total_count:
                self.logger.info("all_pages_fetched", total_fetched=len(all_jobs))
                break

            # Safety limit: stop after 100 pages (2500 jobs)
            if offset >= PAGE_SIZE * 100:
                self.logger.warning("pagination_safety_limit", offset=offset)
                break

        return all_jobs

    # -- BaseScraper abstract method implementations --

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Not used for Oracle HCM — extraction is API-based.

        This method exists to satisfy the BaseScraper interface.
        Oracle HCM scraping uses the REST API, not browser automation.
        """
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Not used for Oracle HCM — all data comes from the API response.

        This method exists to satisfy the BaseScraper interface.
        """
        return {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Main entry point: extract all jobs from Oracle HCM career portal.

        Uses the public REST API to fetch all requisitions with offset-based
        pagination. No browser automation is needed.

        Args:
            max_jobs: Optional limit for testing (extract only first N jobs)

        Returns:
            List of validated JobPosting objects
        """
        self.logger.info(
            "extraction_start",
            company=self.company_name,
            max_jobs=max_jobs,
            api_base=self.api_base,
            site_number=self.site_number,
        )

        # Fetch all requisitions via API
        raw_jobs = self._fetch_all_requisitions(max_jobs=max_jobs)
        self.logger.info("raw_jobs_fetched", count=len(raw_jobs))

        # Validate and enrich each job
        jobs = []
        for raw_job in raw_jobs:
            try:
                # Remove internal metadata keys before validation
                job_data = {k: v for k, v in raw_job.items() if not k.startswith('_')}

                # Enrich with certifications extracted from description
                job_data = self._enrich_with_certifications(job_data)

                # Enrich with contacts if enabled
                if self.config.get('extract_contacts', False):
                    job_data = self._enrich_with_contacts(job_data)

                # Validate through Pydantic model
                posting = JobPosting(**job_data)
                jobs.append(posting)

                self.logger.debug(
                    "job_extracted",
                    title=posting.title,
                    requisition_id=posting.requisition_id,
                )

            except ValidationError as e:
                self.logger.error(
                    "validation_failed",
                    error=str(e),
                    title=raw_job.get('title'),
                    requisition_id=raw_job.get('requisition_id'),
                )
                continue

        self.logger.info(
            "extraction_complete",
            total_jobs=len(jobs),
            method="oracle_hcm_api",
        )
        return jobs
