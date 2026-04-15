"""Phenom TXM career portal scraper implementation.

This scraper extracts jobs from Phenom-powered career portals
by parsing embedded DDO (Data-Driven Object) JSON from server-rendered pages.

Used by: Oceaneering, and potentially other companies using Phenom TXM.

Strategy:
1. GET the search-results page with ?from=N for pagination (10 jobs per page)
2. Parse the embedded phApp.ddo JSON from the HTML response
3. Extract job listings from ddo.eagerLoadRefineSearch.data.jobs
4. For each job, GET the detail page to retrieve full description from JSON-LD
5. Phenom embeds all data server-side — no XHR/API auth required

Key Phenom concepts:
- refNum: Tenant identifier (e.g., "OCINGLOBAL" for Oceaneering)
- jobSeqNo: Unique job identifier used in URLs (e.g., "OCINGLOBAL29160")
- DDO: Data-Driven Object — JSON config embedded in page via phApp.ddo
- eagerLoadRefineSearch: DDO key containing search results and facets
"""

import json
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


class PhenomScraper(BaseScraper):
    """
    Scraper for Phenom TXM career portals.

    Phenom career sites embed job data as server-rendered JSON in the page HTML
    via the phApp.ddo (Data-Driven Object) pattern. This means we can extract
    structured job data from simple HTTP GET requests without needing to
    authenticate or call separate API endpoints.

    Listing data: GET {base_url}/search-results?from={offset}
        -> phApp.ddo.eagerLoadRefineSearch.data.jobs (10 per page)
        -> phApp.ddo.eagerLoadRefineSearch.totalHits (total count)

    Detail data: GET {base_url}/job/{jobSeqNo}
        -> JSON-LD script tag with @type=JobPosting (full HTML description)
        -> phApp.ddo.jobDetail.data.job (skills, metadata)

    Page size: 10 jobs per request (fixed by Phenom platform)
    """

    PAGE_SIZE = 10  # Phenom returns 10 jobs per page (fixed)

    def __init__(self, config: dict):
        """
        Initialize Phenom scraper with company configuration.

        Args:
            config: Company config dict from companies.yaml. Must include:
                - name: Company display name
                - base_url: Career portal base URL (e.g., https://careers.oceaneering.com/global/en)
                - phenom_config.ref_num: Phenom tenant ID (e.g., "OCINGLOBAL")
        """
        super().__init__(config)
        self.phenom_config = config.get('phenom_config', {})
        self.ref_num = self.phenom_config.get('ref_num', '')
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        })

    def _extract_ddo(self, html: str) -> Optional[dict]:
        """
        Extract the phApp.ddo JSON object from page HTML.

        Phenom embeds a large JSON config object in a script tag as:
            var phApp = phApp || {...}; phApp.ddo = {...};

        This method extracts and parses the DDO portion.

        Args:
            html: Full HTML page content

        Returns:
            Parsed DDO dict, or None if extraction fails
        """
        # Match phApp.ddo = {...}; followed by either a comment, another
        # phApp assignment, or end of script
        match = re.search(
            r'phApp\.ddo\s*=\s*(\{.*?\});\s*(?:/\*|phApp\.|</script>|$)',
            html,
            re.DOTALL
        )
        if not match:
            self.logger.error("ddo_extraction_failed", note="Could not find phApp.ddo in page")
            return None

        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError as e:
            self.logger.error("ddo_parse_failed", error=str(e))
            return None

    def fetch_search_page(self, offset: int = 0) -> dict:
        """
        Fetch one page of search results and extract DDO data.

        Args:
            offset: Job offset for pagination (0, 10, 20, ...)

        Returns:
            Dict with keys:
                - total_hits: Total number of jobs matching search
                - jobs: List of raw job dicts from DDO
                - success: Whether extraction succeeded

        Raises:
            requests.RequestException: On network errors
        """
        base_url = self.config['base_url'].rstrip('/')
        url = f"{base_url}/search-results"
        params = {}
        if offset > 0:
            params['from'] = offset
            params['subCategory'] = ''

        self.logger.info("fetching_search_page", url=url, offset=offset)

        try:
            response = self.session.get(url, params=params, timeout=30)
            response.raise_for_status()
        except requests.RequestException as e:
            self.logger.error("search_page_fetch_failed", error=str(e), offset=offset)
            raise

        ddo = self._extract_ddo(response.text)
        if not ddo:
            return {'total_hits': 0, 'jobs': [], 'success': False}

        search_data = ddo.get('eagerLoadRefineSearch', {})
        total_hits = search_data.get('totalHits', 0)
        jobs = search_data.get('data', {}).get('jobs', [])

        self.logger.info(
            "search_page_parsed",
            offset=offset,
            total_hits=total_hits,
            jobs_on_page=len(jobs)
        )

        return {
            'total_hits': total_hits,
            'jobs': jobs,
            'success': True
        }

    def fetch_job_details(self, job_seq_no: str) -> dict:
        """
        Fetch full job details from the job detail page.

        Extracts data from two sources on the detail page:
        1. JSON-LD script tag (@type=JobPosting) — full HTML description
        2. phApp.ddo.jobDetail.data.job — skills, metadata, structured data

        Args:
            job_seq_no: Phenom job sequence number (e.g., "OCINGLOBAL29160")

        Returns:
            Dict with keys:
                - description: Clean plain text description
                - employment_type: Normalized employment type
                - skills: List of skill strings
                - salary: Salary info if available
        """
        result = {
            'description': None,
            'employment_type': None,
            'skills': [],
            'salary': None,
        }

        base_url = self.config['base_url'].rstrip('/')
        url = f"{base_url}/job/{job_seq_no}"

        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
        except requests.RequestException as e:
            self.logger.error(
                "detail_page_fetch_failed",
                error=str(e),
                job_seq_no=job_seq_no
            )
            return result

        html = response.text

        # Source 1: JSON-LD for full description
        jsonld_blocks = re.findall(
            r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
            html,
            re.DOTALL
        )
        for block in jsonld_blocks:
            try:
                ld = json.loads(block)
                if isinstance(ld, dict) and ld.get('@type') == 'JobPosting':
                    # Extract and clean HTML description
                    raw_desc = ld.get('description', '')
                    if raw_desc:
                        result['description'] = self.clean_html_description(raw_desc)

                    # Employment type from JSON-LD
                    emp_type = ld.get('employmentType')
                    if emp_type:
                        if isinstance(emp_type, list):
                            emp_type = emp_type[0] if emp_type else None
                        if emp_type:
                            result['employment_type'] = self._normalize_phenom_employment_type(emp_type)

                    # Salary from JSON-LD
                    salary_data = ld.get('baseSalary')
                    if salary_data and isinstance(salary_data, dict):
                        value = salary_data.get('value', {})
                        if isinstance(value, dict):
                            min_val = value.get('minValue')
                            max_val = value.get('maxValue')
                            currency = salary_data.get('currency', 'USD')
                            if min_val and max_val:
                                result['salary'] = f"{currency} {min_val}-{max_val}"
                            elif min_val:
                                result['salary'] = f"{currency} {min_val}+"

                    break
            except json.JSONDecodeError:
                continue

        # Source 2: DDO jobDetail for skills
        ddo = self._extract_ddo(html)
        if ddo:
            job_detail = ddo.get('jobDetail', {})
            job_data = job_detail.get('data', {}).get('job', {})
            if job_data:
                # Extract ML-parsed skills
                ml_skills = job_data.get('ml_skills', [])
                if ml_skills:
                    result['skills'] = ml_skills

                # Fallback employment type from DDO if not found in JSON-LD
                if not result['employment_type']:
                    emp_type = job_data.get('type')
                    if emp_type:
                        result['employment_type'] = self._normalize_employment_type(emp_type)

                # Fallback description from DDO structureData
                if not result['description']:
                    struct = job_data.get('structureData', {})
                    raw_desc = struct.get('description', '')
                    if raw_desc:
                        result['description'] = self.clean_html_description(raw_desc)

        return result

    def clean_html_description(self, html_text: Optional[str]) -> str:
        """
        Convert HTML description to clean plain text.

        Phenom job descriptions come as HTML-encoded strings from JSON-LD,
        sometimes double-encoded (HTML entities within JSON strings).

        Args:
            html_text: HTML description string (may contain encoded entities)

        Returns:
            Clean plain text description
        """
        if not html_text:
            return ""

        try:
            # Decode HTML entities that may be double-encoded
            import html
            decoded = html.unescape(html_text)

            soup = BeautifulSoup(decoded, 'html.parser')
            clean_text = soup.get_text(separator='\n', strip=True)

            # Remove excess whitespace and blank lines
            lines = [line.strip() for line in clean_text.split('\n') if line.strip()]
            clean_text = '\n'.join(lines)

            return clean_text

        except Exception as e:
            self.logger.error("html_cleaning_failed", error=str(e))
            return html_text

    @staticmethod
    def _normalize_phenom_employment_type(raw_type: str) -> Optional[str]:
        """
        Normalize Phenom/JSON-LD employment type to standard values.

        JSON-LD uses schema.org format: FULL_TIME, PART_TIME, CONTRACTOR, etc.
        Phenom DDO uses human-readable: Full-Time, Part-Time, Contract, etc.

        Args:
            raw_type: Raw employment type string

        Returns:
            Normalized employment type string
        """
        if not raw_type:
            return None

        phenom_type_map = {
            'full_time': 'Full-Time',
            'full-time': 'Full-Time',
            'part_time': 'Part-Time',
            'part-time': 'Part-Time',
            'contractor': 'Contractor',
            'contract': 'Contractor',
            'temporary': 'Temporary',
            'intern': 'Internship',
            'internship': 'Internship',
            'volunteer': 'Volunteer',
            'per_diem': 'Per Diem',
            'other': None,
        }

        return phenom_type_map.get(raw_type.strip().lower(), raw_type.strip())

    def parse_posted_date(self, date_string: Optional[str]) -> Optional[str]:
        """
        Parse ISO date string from Phenom to date-only string.

        Phenom provides posted dates as ISO 8601 strings with timezone:
        "2025-04-07T00:00:00.000+0000"

        Args:
            date_string: ISO 8601 date string from Phenom

        Returns:
            Date string (YYYY-MM-DD) or None
        """
        if not date_string:
            return None

        try:
            # Handle various ISO formats Phenom uses
            # Strip timezone offset for simple parsing
            clean = re.sub(r'[+-]\d{4}$', '', date_string)
            clean = clean.replace('Z', '')
            dt = datetime.fromisoformat(clean)
            return dt.strftime('%Y-%m-%d')
        except (ValueError, AttributeError):
            self.logger.warning("invalid_date_string", date_string=date_string)
            return None

    def construct_job_url(self, job_data: dict) -> str:
        """
        Construct the public job URL from listing data.

        Phenom job URLs follow the pattern:
        {base_url}/job/{jobSeqNo}

        Args:
            job_data: Raw job dict from DDO search results

        Returns:
            Full job detail URL
        """
        base_url = self.config['base_url'].rstrip('/')
        job_seq = job_data.get('jobSeqNo', '')
        if job_seq:
            return f"{base_url}/job/{job_seq}"

        # Fallback: use reqId
        req_id = job_data.get('reqId', '')
        if req_id:
            return f"{base_url}/job/{self.ref_num}{req_id}"

        return base_url

    def normalize_job_data(self, raw_job: dict, detail_data: Optional[dict] = None) -> dict:
        """
        Normalize Phenom DDO job data to JobPosting schema.

        Combines listing data (from search results DDO) with optional detail
        data (from job detail page) into a unified dict matching the
        JobPosting model fields.

        Args:
            raw_job: Raw job dict from eagerLoadRefineSearch.data.jobs
            detail_data: Optional detail data from fetch_job_details()

        Returns:
            Dict matching JobPosting model fields
        """
        # Build description
        description = ""
        if detail_data and detail_data.get('description'):
            description = detail_data['description']

        # Fallback to teaser from listing
        if not description or len(description) < 50:
            teaser = raw_job.get('descriptionTeaser', '')
            if not teaser:
                # Try ML parser teaser
                ml_parser = raw_job.get('ml_job_parser', {})
                teaser = (
                    ml_parser.get('descriptionTeaser', '')
                    or ml_parser.get('descriptionTeaser_first200', '')
                )
            if teaser:
                description = teaser

        # Fallback minimal description
        if not description or len(description) < 10:
            dept = raw_job.get('department', '')
            category = raw_job.get('category', '')
            description = f"Position in {dept or category} at {self.company_name}."

        # Employment type
        employment_type = None
        if detail_data and detail_data.get('employment_type'):
            employment_type = detail_data['employment_type']
        elif raw_job.get('type'):
            employment_type = self._normalize_employment_type(raw_job['type'])

        # Skills from detail page or listing
        skills = []
        if detail_data and detail_data.get('skills'):
            skills = detail_data['skills']
        elif raw_job.get('ml_skills'):
            skills = raw_job['ml_skills']

        # Location
        location = raw_job.get('location', '')
        if not location:
            location = raw_job.get('cityStateCountry', '')
        if not location:
            parts = []
            if raw_job.get('city'):
                parts.append(raw_job['city'])
            if raw_job.get('state'):
                parts.append(raw_job['state'])
            if raw_job.get('country'):
                parts.append(raw_job['country'])
            location = ', '.join(parts) if parts else 'Location Not Specified'

        # Salary
        salary = detail_data.get('salary') if detail_data else None

        return {
            'title': raw_job.get('title', 'Untitled Position'),
            'company': self.company_name,
            'location': location,
            'description': description,
            'url': self.construct_job_url(raw_job),
            'posted_date': self.parse_posted_date(raw_job.get('postedDate')),
            'skills': skills,
            'salary': salary,
            'requisition_id': raw_job.get('reqId') or raw_job.get('jobId'),
            'certifications': [],  # Will be enriched by base class
            'employment_type': employment_type,
        }

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job listing data from search results page.

        NOT USED for Phenom — we use direct HTTP requests instead.
        This method is required by BaseScraper abstract class.

        Returns:
            Empty list (not used)
        """
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from job detail page.

        NOT USED for Phenom — we use direct HTTP requests instead.
        This method is required by BaseScraper abstract class.

        Returns:
            Empty dict (not used)
        """
        return {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs from Phenom career portal using server-rendered DDO data.

        This is the main entry point for the scraper. Fetches search results
        pages sequentially, extracting job data from embedded DDO JSON, then
        fetches detail pages for full descriptions.

        Process:
        1. GET search-results page to get first 10 jobs + totalHits
        2. Paginate with ?from=N to get remaining jobs
        3. For each job, GET detail page for full description and skills
        4. Normalize and validate through JobPosting model
        5. Enrich with certifications

        Args:
            max_jobs: Optional limit for testing (extract only first N jobs)

        Returns:
            List of validated JobPosting objects
        """
        jobs = []
        offset = 0

        self.logger.info(
            "extraction_start",
            company=self.company_name,
            max_jobs=max_jobs
        )

        try:
            # Fetch first page to get total count
            first_page = self.fetch_search_page(offset=0)

            if not first_page['success']:
                self.logger.error("first_page_failed")
                return []

            total_hits = first_page['total_hits']
            self.logger.info("total_jobs_found", total=total_hits)

            # Process first page
            for raw_job in first_page['jobs']:
                try:
                    # Rate limit between detail requests
                    if jobs:
                        await self._rate_limit()

                    # Fetch full details
                    job_seq = raw_job.get('jobSeqNo', '')
                    detail_data = self.fetch_job_details(job_seq) if job_seq else None

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
                        job_seq=raw_job.get('jobSeqNo'),
                        title=raw_job.get('title')
                    )
                    continue

            # Fetch remaining pages
            offset = self.PAGE_SIZE
            while offset < total_hits:
                if max_jobs and len(jobs) >= max_jobs:
                    break

                # Rate limit between page requests
                await self._rate_limit()

                page_data = self.fetch_search_page(offset=offset)

                if not page_data['success'] or not page_data['jobs']:
                    self.logger.info("no_more_jobs", offset=offset)
                    break

                self.logger.info(
                    "fetched_page",
                    offset=offset,
                    jobs_on_page=len(page_data['jobs']),
                    total_so_far=len(jobs)
                )

                for raw_job in page_data['jobs']:
                    try:
                        # Rate limit between detail requests
                        await self._rate_limit()

                        job_seq = raw_job.get('jobSeqNo', '')
                        detail_data = self.fetch_job_details(job_seq) if job_seq else None

                        job_data = self.normalize_job_data(raw_job, detail_data=detail_data)
                        job_data = self._enrich_with_certifications(job_data)
                        if self.config.get('extract_contacts', False):
                            job_data = self._enrich_with_contacts(job_data)

                        posting = JobPosting(**job_data)
                        jobs.append(posting)

                        if max_jobs and len(jobs) >= max_jobs:
                            self.logger.info("max_jobs_reached", count=len(jobs))
                            return jobs

                    except ValidationError as e:
                        self.logger.error(
                            "validation_failed",
                            error=str(e),
                            job_seq=raw_job.get('jobSeqNo'),
                            title=raw_job.get('title')
                        )
                        continue

                offset += self.PAGE_SIZE

            self.logger.info("extraction_complete", total_jobs=len(jobs))
            return jobs

        except Exception as e:
            self.logger.error("extraction_failed", error=str(e), exc_info=True)
            return jobs  # Return partial results if available
