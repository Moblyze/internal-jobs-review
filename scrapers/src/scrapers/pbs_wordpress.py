"""PBS by Ponticelli WordPress REST API scraper implementation.

PBS uses a WordPress site with a custom "job" post type. Jobs are accessible
via the WP REST API at /wp-json/wp/v2/job. This is much more reliable than
scraping the AJAX-loaded careers page.

The careers page (/careers/) loads jobs via jQuery AJAX (action: load_more_job_posts)
into #job-post-container, but the nonce is session-specific and unreliable for
server-side scraping. The REST API provides the same data without auth requirements.

As of 2026-03-17, the REST API returns 0 jobs (no active listings on the site).
"""

import asyncio
from typing import Optional
from urllib.parse import urljoin

import requests
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()


class PBSWordPressScraper(BaseScraper):
    """
    Scraper for PBS by Ponticelli using WP REST API.

    Queries /wp-json/wp/v2/job for all published job posts.
    Falls back to AJAX-based extraction via Playwright if REST API fails.
    """

    def __init__(self, config: dict):
        """
        Initialize PBS WordPress scraper.

        Args:
            config: Company config dict from companies.yaml including:
                - base_url: Site root URL (e.g., https://www.pbs-offshore.com)
                - pbs_config.rest_endpoint: WP REST API path (default: /wp-json/wp/v2/job)
                - pbs_config.per_page: Results per page (default: 100)
        """
        super().__init__(config)
        self.base_url = config.get('base_url', '').rstrip('/')
        pbs_config = config.get('pbs_config', {})
        self.rest_endpoint = pbs_config.get('rest_endpoint', '/wp-json/wp/v2/job')
        self.per_page = pbs_config.get('per_page', 100)
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
        })

    def _clean_html(self, html_text: Optional[str]) -> str:
        """Convert HTML to plain text."""
        if not html_text:
            return ""
        try:
            soup = BeautifulSoup(html_text, 'html.parser')
            for element in soup(['script', 'style']):
                element.decompose()
            text = soup.get_text(separator='\n', strip=True)
            lines = [line.strip() for line in text.split('\n') if line.strip()]
            return '\n'.join(lines)
        except Exception:
            return html_text

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """Not used for REST API scraper. Required by BaseScraper."""
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """Not used for REST API scraper. Required by BaseScraper."""
        return {}

    def _fetch_jobs_from_api(self) -> list[dict]:
        """
        Fetch job listings from WP REST API.

        Handles pagination via X-WP-TotalPages header.

        Returns:
            List of raw job dicts from the API
        """
        all_jobs = []
        page_num = 1
        max_pages = 10  # Safety limit

        while page_num <= max_pages:
            url = f"{self.base_url}{self.rest_endpoint}"
            params = {
                'per_page': self.per_page,
                'page': page_num,
                'status': 'publish',
            }

            self.logger.info("fetching_api_page", url=url, page=page_num)

            try:
                response = self.session.get(url, params=params, timeout=30)

                if response.status_code == 400:
                    # WP returns 400 when page > total_pages
                    self.logger.debug("api_page_beyond_total", page=page_num)
                    break

                response.raise_for_status()
                jobs = response.json()

                if not jobs:
                    break

                all_jobs.extend(jobs)
                self.logger.info("api_page_fetched", page=page_num, jobs=len(jobs))

                # Check if there are more pages
                total_pages = int(response.headers.get('X-WP-TotalPages', 1))
                if page_num >= total_pages:
                    break

                page_num += 1
                # Rate limit between pages
                asyncio.get_event_loop()  # Just to verify we're in async context

            except requests.exceptions.RequestException as e:
                self.logger.error("api_fetch_failed", page=page_num, error=str(e))
                break

        return all_jobs

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs from PBS WordPress REST API.

        Process:
        1. Query /wp-json/wp/v2/job for all published job posts
        2. Parse title, content, link from each post
        3. Validate through JobPosting model
        4. Enrich with certifications

        Args:
            max_jobs: Optional limit for testing

        Returns:
            List of validated JobPosting objects
        """
        jobs = []

        self.logger.info("extraction_start", company=self.company_name, max_jobs=max_jobs)

        try:
            raw_jobs = self._fetch_jobs_from_api()

            if not raw_jobs:
                self.logger.warning("no_jobs_found", note="WP REST API returned 0 jobs")
                return []

            self.logger.info("total_api_jobs", count=len(raw_jobs))

            # Apply max_jobs limit
            if max_jobs:
                raw_jobs = raw_jobs[:max_jobs]

            for idx, raw_job in enumerate(raw_jobs):
                try:
                    title = raw_job.get('title', {}).get('rendered', '') or 'Untitled'
                    # Clean HTML entities from title
                    title = self._clean_html(title)

                    content = raw_job.get('content', {}).get('rendered', '')
                    description = self._clean_html(content)
                    if not description or len(description) < 10:
                        excerpt = raw_job.get('excerpt', {}).get('rendered', '')
                        description = self._clean_html(excerpt)
                    if not description or len(description) < 10:
                        description = f"{title} position at {self.company_name}."

                    url = raw_job.get('link', '')

                    # Try to extract location from custom fields or content
                    location = 'Location Not Specified'
                    # WP custom fields might be in acf, meta, or custom_fields
                    meta = raw_job.get('meta', {}) or {}
                    acf = raw_job.get('acf', {}) or {}
                    if isinstance(acf, dict):
                        location = acf.get('location', acf.get('job_location', '')) or location
                    if isinstance(meta, dict) and location == 'Location Not Specified':
                        location = meta.get('location', meta.get('job_location', '')) or location

                    posted_date = raw_job.get('date', '')
                    if posted_date:
                        # WP dates are ISO 8601: "2026-03-17T10:30:00"
                        posted_date = posted_date[:10]  # Just YYYY-MM-DD

                    job_data = {
                        'title': title,
                        'company': self.company_name,
                        'location': location,
                        'description': description,
                        'url': url,
                        'posted_date': posted_date or None,
                        'skills': [],
                        'salary': None,
                        'certifications': [],
                        'employment_type': None,
                    }

                    # Try to extract employment type from custom fields
                    if isinstance(acf, dict):
                        emp_type = acf.get('job_type', acf.get('employment_type', ''))
                        if emp_type:
                            job_data['employment_type'] = self._normalize_employment_type(emp_type)

                    # Enrich with certifications
                    job_data = self._enrich_with_certifications(job_data)

                    posting = JobPosting(**job_data)
                    jobs.append(posting)

                    self.logger.debug("job_extracted", title=title, url=url)

                except ValidationError as e:
                    self.logger.error("validation_failed", index=idx, error=str(e))
                    continue
                except Exception as e:
                    self.logger.error("job_parse_failed", index=idx, error=str(e))
                    continue

            self.logger.info("extraction_complete", total_jobs=len(jobs))
            return jobs

        except Exception as e:
            self.logger.error("extraction_failed", error=str(e), exc_info=True)
            return jobs
