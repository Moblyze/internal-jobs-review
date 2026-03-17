"""EasyApply (GetHired) career portal scraper implementation.

This scraper extracts jobs from EasyApply/GetHired-powered career portals
using the RSS feed endpoint for fast, reliable bulk extraction.

Used by: Altrad Sparrows US, potentially other companies using EasyApply/GetHired.

Strategy:
1. Fetch RSS feed from {base_url}/rss (all jobs in one request, no pagination needed)
2. Parse XML to extract title, description (HTML), pubDate, link, and location (category)
3. Optionally fetch JSON-LD from individual job pages for structured fields
   (employmentType, datePosted, jobLocation, industry)
4. Clean HTML descriptions to plain text
5. Enrich with certifications

EasyApply RSS structure:
- <item>
    <title>Job Title</title>
    <description><![CDATA[HTML description]]></description>
    <pubDate>Thu, 12 Feb 2026 18:49:27 +0000</pubDate>
    <link>https://easyapply.co/job/{slug}</link>
    <guid>https://easyapply.co/job/{slug}</guid>
    <category><![CDATA[City, ST]]></category>
  </item>

EasyApply JSON-LD structure (on detail pages):
- @type: JobPosting
- employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACTOR" etc.
- datePosted: "YYYY-MM-DD"
- validThrough: "YYYY-MM-DDT00:00"
- identifier.value: numeric job ID
- jobLocation.address: {streetAddress, addressLocality, addressRegion, postalCode}
- industry: "Manufacturing / Production / QA" etc.
"""

import json
import re
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Optional
from xml.etree import ElementTree

import requests
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()

# Namespace map for RSS XML parsing
RSS_NAMESPACES = {
    'dc': 'http://purl.org/dc/elements/1.1/',
    'atom': 'http://www.w3.org/2005/Atom',
}


class EasyApplyScraper(BaseScraper):
    """
    Scraper for EasyApply/GetHired career portals.

    EasyApply (by GetHired) provides:
    - An RSS feed at /rss with all jobs (no pagination needed)
    - JSON-LD structured data on individual job pages
    - Server-rendered HTML listings (fallback)

    We use the RSS feed as the primary extraction method because it returns
    all jobs in a single request with full HTML descriptions, pub dates,
    and locations. JSON-LD from detail pages supplements with employment type
    and structured location data.
    """

    def __init__(self, config: dict):
        """Initialize EasyApply scraper with company configuration."""
        super().__init__(config)
        self.base_url = config['base_url'].rstrip('/')
        # Whether to fetch JSON-LD from detail pages (slower but gets employment type)
        self.fetch_detail_pages = config.get('fetch_detail_pages', True)

    def _get_rss_url(self) -> str:
        """
        Construct RSS feed URL from base URL.

        EasyApply RSS feeds are at {base_url}/rss.

        Returns:
            RSS feed URL string
        """
        return f"{self.base_url}/rss"

    def _fetch_rss_feed(self) -> str:
        """
        Fetch raw RSS XML from the EasyApply feed endpoint.

        Returns:
            Raw XML string

        Raises:
            requests.RequestException: On network errors
        """
        url = self._get_rss_url()

        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        }

        self.logger.info("fetching_rss_feed", url=url)

        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()

        self.logger.info("rss_feed_fetched", status=response.status_code,
                         content_length=len(response.text))

        return response.text

    def _parse_rss_items(self, xml_text: str) -> list[dict]:
        """
        Parse RSS XML into list of job dicts.

        Extracts from each <item>:
        - title: Job title
        - url: Job detail page URL (from <link>)
        - description_html: Raw HTML description
        - posted_date: Parsed datetime from <pubDate>
        - location: City, ST from <category>

        Args:
            xml_text: Raw RSS XML string

        Returns:
            List of parsed job dicts
        """
        jobs = []

        try:
            root = ElementTree.fromstring(xml_text)
        except ElementTree.ParseError as e:
            self.logger.error("rss_parse_failed", error=str(e))
            return []

        channel = root.find('channel')
        if channel is None:
            self.logger.error("rss_no_channel")
            return []

        items = channel.findall('item')
        self.logger.info("rss_items_found", count=len(items))

        for item in items:
            try:
                # Title (required)
                title_elem = item.find('title')
                title = title_elem.text.strip() if title_elem is not None and title_elem.text else None
                if not title:
                    self.logger.warning("rss_item_no_title")
                    continue

                # URL from <link> element
                link_elem = item.find('link')
                url = link_elem.text.strip() if link_elem is not None and link_elem.text else None

                # Sometimes <link> has no text but tail text (XML quirk)
                if not url and link_elem is not None and link_elem.tail:
                    url = link_elem.tail.strip()

                # Fallback to <guid>
                if not url:
                    guid_elem = item.find('guid')
                    url = guid_elem.text.strip() if guid_elem is not None and guid_elem.text else None

                if not url:
                    self.logger.warning("rss_item_no_url", title=title)
                    continue

                # Description (HTML)
                desc_elem = item.find('description')
                description_html = desc_elem.text if desc_elem is not None and desc_elem.text else ""

                # Posted date from <pubDate>
                posted_date = None
                pub_date_elem = item.find('pubDate')
                if pub_date_elem is not None and pub_date_elem.text:
                    try:
                        posted_date = parsedate_to_datetime(pub_date_elem.text.strip())
                    except (ValueError, TypeError) as e:
                        self.logger.debug("date_parse_failed", date_text=pub_date_elem.text, error=str(e))

                # Location from <category>
                category_elem = item.find('category')
                location = category_elem.text.strip() if category_elem is not None and category_elem.text else "Location Not Specified"

                jobs.append({
                    'title': title,
                    'url': url,
                    'description_html': description_html,
                    'posted_date': posted_date,
                    'location': location,
                    'company': self.company_name,
                })

            except Exception as e:
                self.logger.warning("rss_item_parse_failed", error=str(e))
                continue

        return jobs

    def _clean_html_description(self, html_text: str) -> str:
        """
        Convert HTML description to clean plain text.

        EasyApply job descriptions contain full HTML markup. This method
        strips all HTML tags and converts to readable plain text.

        Args:
            html_text: HTML description string

        Returns:
            Clean plain text description
        """
        if not html_text:
            return ""

        try:
            soup = BeautifulSoup(html_text, 'html.parser')

            # Remove hidden hashtag/SEO text (white text on white background)
            for font_tag in soup.find_all('font', color='#ffffff'):
                font_tag.decompose()

            # Get text with newlines between block elements
            clean_text = soup.get_text(separator='\n', strip=True)

            # Remove excess blank lines
            lines = [line.strip() for line in clean_text.split('\n') if line.strip()]
            clean_text = '\n'.join(lines)

            return clean_text

        except Exception as e:
            self.logger.error("html_cleaning_failed", error=str(e))
            return html_text

    def _extract_slug_from_url(self, url: str) -> Optional[str]:
        """
        Extract job slug from EasyApply URL.

        URL pattern: https://easyapply.co/job/{slug}

        Args:
            url: EasyApply job URL

        Returns:
            Job slug string or None
        """
        match = re.search(r'/job/([^/?#]+)', url)
        return match.group(1) if match else None

    def _fetch_job_json_ld(self, job_url: str) -> dict:
        """
        Fetch JSON-LD structured data from a job detail page.

        EasyApply job pages embed a JSON-LD script tag with schema.org
        JobPosting data including employmentType, datePosted, jobLocation,
        and a numeric identifier.

        Args:
            job_url: URL of the job detail page

        Returns:
            Dict with extracted structured fields:
            - employment_type: Normalized employment type string
            - identifier: Numeric job ID from EasyApply
            - industry: Industry string
            - address: Full address dict (if available)
        """
        result = {}

        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,*/*',
        }

        try:
            response = requests.get(job_url, headers=headers, timeout=30)
            response.raise_for_status()

            # Parse JSON-LD from script tag
            soup = BeautifulSoup(response.text, 'html.parser')
            ld_script = soup.find('script', type='application/ld+json')

            if not ld_script or not ld_script.string:
                self.logger.debug("no_json_ld", url=job_url)
                return result

            ld_data = json.loads(ld_script.string)

            # Employment type (JSON-LD uses schema.org format: "FULL_TIME", "PART_TIME", etc.)
            emp_type = ld_data.get('employmentType')
            if emp_type:
                # Convert schema.org format to our normalized format
                schema_type_map = {
                    'FULL_TIME': 'Full-Time',
                    'PART_TIME': 'Part-Time',
                    'CONTRACTOR': 'Contractor',
                    'TEMPORARY': 'Temporary',
                    'INTERN': 'Internship',
                    'VOLUNTEER': 'Volunteer',
                    'PER_DIEM': 'Per Diem',
                    'OTHER': None,
                }
                result['employment_type'] = schema_type_map.get(emp_type, self._normalize_employment_type(emp_type))

            # Numeric identifier (EasyApply internal job ID)
            identifier = ld_data.get('identifier', {})
            if isinstance(identifier, dict) and identifier.get('value'):
                result['identifier'] = str(identifier['value'])

            # Industry
            if ld_data.get('industry'):
                result['industry'] = ld_data['industry']

            # Structured location from JSON-LD (more precise than RSS category)
            job_location = ld_data.get('jobLocation', {})
            if isinstance(job_location, dict):
                address = job_location.get('address', {})
                if isinstance(address, dict):
                    parts = []
                    if address.get('addressLocality'):
                        parts.append(address['addressLocality'])
                    if address.get('addressRegion'):
                        parts.append(address['addressRegion'])
                    if parts:
                        result['location'] = ', '.join(parts)

        except requests.RequestException as e:
            self.logger.debug("json_ld_fetch_failed", url=job_url, error=str(e))
        except (json.JSONDecodeError, KeyError) as e:
            self.logger.debug("json_ld_parse_failed", url=job_url, error=str(e))

        return result

    def _normalize_job_data(self, rss_job: dict, json_ld: Optional[dict] = None) -> dict:
        """
        Normalize RSS + JSON-LD data into JobPosting schema.

        Args:
            rss_job: Job dict parsed from RSS feed
            json_ld: Optional dict with JSON-LD structured data from detail page

        Returns:
            Dict matching JobPosting model fields
        """
        json_ld = json_ld or {}

        # Clean HTML description to plain text
        description = self._clean_html_description(rss_job.get('description_html', ''))

        # Use JSON-LD location if available (more precise), fall back to RSS category
        location = json_ld.get('location') or rss_job.get('location', 'Location Not Specified')

        # Extract slug as requisition ID (EasyApply doesn't have traditional req IDs)
        slug = self._extract_slug_from_url(rss_job.get('url', ''))
        # Prefer numeric identifier from JSON-LD if available
        requisition_id = json_ld.get('identifier') or slug

        return {
            'title': rss_job.get('title', 'Untitled Position'),
            'company': rss_job.get('company', self.company_name),
            'location': location,
            'description': description if description and len(description) >= 10 else rss_job.get('description_html', ''),
            'url': rss_job.get('url'),
            'posted_date': rss_job.get('posted_date'),
            'skills': [],  # Extracted via certification enrichment from description
            'salary': None,  # EasyApply rarely includes salary in structured form
            'requisition_id': requisition_id,
            'certifications': [],  # Will be enriched by base class
            'employment_type': json_ld.get('employment_type'),
        }

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job listing data from search results page.

        NOT USED for EasyApply - we use RSS feed instead.
        Required by BaseScraper abstract class.

        Returns:
            Empty list (not used)
        """
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from job detail page.

        NOT USED for EasyApply - we use RSS feed + JSON-LD instead.
        Required by BaseScraper abstract class.

        Returns:
            Empty dict (not used)
        """
        return {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs from EasyApply portal using RSS feed.

        This is the main entry point. Unlike browser-based scrapers,
        EasyApply scraper uses direct HTTP requests to the RSS feed
        for fast, reliable extraction.

        Process:
        1. Fetch RSS feed (single request, all jobs)
        2. Parse XML items into job dicts
        3. Optionally fetch JSON-LD from detail pages for employment type
        4. Clean HTML descriptions to plain text
        5. Validate through JobPosting model
        6. Enrich with certifications

        Args:
            max_jobs: Optional limit for testing (extract only first N jobs)

        Returns:
            List of validated JobPosting objects
        """
        jobs = []

        self.logger.info("extraction_start", company=self.company_name,
                         max_jobs=max_jobs, method="rss")

        try:
            # Step 1: Fetch RSS feed
            rss_xml = self._fetch_rss_feed()

            # Step 2: Parse RSS items
            rss_jobs = self._parse_rss_items(rss_xml)

            if not rss_jobs:
                self.logger.warning("no_jobs_in_rss", url=self._get_rss_url())
                return []

            self.logger.info("total_jobs_found", total=len(rss_jobs))

            # Step 3: Process each job
            for idx, rss_job in enumerate(rss_jobs):
                if max_jobs and len(jobs) >= max_jobs:
                    self.logger.info("max_jobs_reached", count=len(jobs))
                    break

                try:
                    # Optionally fetch JSON-LD for employment type and structured data
                    json_ld = {}
                    if self.fetch_detail_pages and rss_job.get('url'):
                        # Rate limit between detail page fetches
                        if idx > 0:
                            await self._rate_limit()

                        json_ld = self._fetch_job_json_ld(rss_job['url'])

                    # Normalize to JobPosting schema
                    job_data = self._normalize_job_data(rss_job, json_ld)

                    # Enrich with certifications from description
                    job_data = self._enrich_with_certifications(job_data)

                    # Validate through Pydantic model
                    posting = JobPosting(**job_data)
                    jobs.append(posting)

                    self.logger.debug("job_extracted", title=posting.title,
                                      url=str(posting.url))

                except ValidationError as e:
                    self.logger.error("validation_failed", error=str(e),
                                      title=rss_job.get('title'))
                    continue
                except Exception as e:
                    self.logger.error("job_processing_failed", error=str(e),
                                      title=rss_job.get('title'))
                    continue

            self.logger.info("extraction_complete", total_jobs=len(jobs))
            return jobs

        except requests.RequestException as e:
            self.logger.error("rss_fetch_failed", error=str(e),
                              url=self._get_rss_url())
            return jobs  # Return partial results if any

        except Exception as e:
            self.logger.error("extraction_failed", error=str(e), exc_info=True)
            return jobs
