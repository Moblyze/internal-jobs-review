"""Oracle Taleo (TBE) career portal scraper implementation.

This scraper extracts jobs from Oracle Taleo Business Edition (TBE) career
portals using the built-in RSS feed endpoint.

Used by: Helix Energy Solutions, potentially other companies using Taleo TBE.

Strategy:
1. Use the RSS feed endpoint to get all jobs in a single request (fastest)
2. Parse XML response with structured job data including Taleo-specific namespaced fields
3. Extract descriptions from RSS (no per-job detail page fetches needed)
4. Fall back to HTML scraping via search results page if RSS is unavailable

Taleo TBE RSS feeds provide these fields per item:
- title: Job title
- link: Job detail URL
- guid: Same as link (unique identifier)
- description: Plain text job description
- pubDate: Posted date (RFC 2822 format)
- taleo:reqId: Requisition ID (numeric)
- taleo:location: Full location string (e.g., "US - Texas, Houston, Helix Corporate")
- taleo:locationCountry: Country code (e.g., "US")
- taleo:locationState: State code (e.g., "US-TX")
- taleo:locationCity: City name (e.g., "Houston")
- taleo:department: Department name (optional, not always present)
- taleo:html-description: Full HTML job description
"""

import re
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime
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

# Taleo RSS namespace
TALEO_NS = 'urn:TBERss'


class TaleoScraper(BaseScraper):
    """
    Scraper for Oracle Taleo TBE career portals.

    Taleo TBE is used by Helix Energy Solutions and other companies.
    Uses the built-in RSS feed for fast, reliable extraction without
    browser automation. The RSS feed returns all jobs in a single
    request with structured metadata.

    RSS Endpoint pattern:
        https://{host}/{instance}/ats/servlet/Rss?org={ORG}&cws={CWS_ID}&WebPage=SRCHR_V2&WebVersion=0&_rss_version=2

    The scraper also supports fallback to HTML scraping via Playwright
    if the RSS feed is unavailable.
    """

    def _build_rss_url(self) -> str:
        """
        Construct the RSS feed URL from company config.

        Taleo RSS feeds follow a predictable URL pattern based on the
        host, instance path, org code, and CWS ID.

        Returns:
            Full RSS feed URL
        """
        taleo_config = self.config.get('taleo_config', {})
        host = taleo_config.get('host', 'phf.tbe.taleo.net')
        instance = taleo_config.get('instance', 'phf01')
        org = taleo_config['org']
        cws = taleo_config.get('cws', '45')

        return (
            f"https://{host}/{instance}/ats/servlet/Rss"
            f"?org={org}&cws={cws}"
            f"&WebPage=SRCHR_V2&WebVersion=0&_rss_version=2"
        )

    def _build_search_url(self) -> str:
        """
        Construct the search results URL for HTML fallback scraping.

        Returns:
            Search results POST URL
        """
        taleo_config = self.config.get('taleo_config', {})
        host = taleo_config.get('host', 'phf.tbe.taleo.net')
        instance = taleo_config.get('instance', 'phf01')
        org = taleo_config['org']
        cws = taleo_config.get('cws', '45')

        return (
            f"https://{host}/{instance}/ats/careers/v2/searchResults"
            f"?org={org}&cws={cws}"
        )

    def _build_job_url(self, rid: str) -> str:
        """
        Construct a v2 career portal URL for a specific requisition.

        The RSS feed returns links to the old requisition.jsp format.
        We convert to the v2 viewRequisition format for consistency.

        Args:
            rid: Requisition ID (e.g., "1006")

        Returns:
            Full job detail URL in v2 format
        """
        taleo_config = self.config.get('taleo_config', {})
        host = taleo_config.get('host', 'phf.tbe.taleo.net')
        instance = taleo_config.get('instance', 'phf01')
        org = taleo_config['org']
        cws = taleo_config.get('cws', '45')

        return (
            f"https://{host}/{instance}/ats/careers/v2/viewRequisition"
            f"?org={org}&cws={cws}&rid={rid}"
        )

    def _extract_rid_from_url(self, url: str) -> Optional[str]:
        """
        Extract requisition ID from a Taleo job URL.

        Taleo URLs contain the requisition ID as a query parameter:
        - .../requisition.jsp?org=HELIXESG&cws=45&rid=1006
        - .../viewRequisition?org=HELIXESG&cws=45&rid=1006

        Args:
            url: Taleo job URL

        Returns:
            Requisition ID string or None
        """
        match = re.search(r'[?&]rid=(\d+)', url)
        return match.group(1) if match else None

    def clean_html_description(self, html_text: Optional[str]) -> str:
        """
        Convert HTML description to clean plain text.

        Taleo job descriptions contain HTML markup with inline styles,
        Microsoft Office formatting artifacts, and entity references.

        Args:
            html_text: HTML description string (may contain escaped HTML entities)

        Returns:
            Clean plain text description
        """
        if not html_text:
            return ""

        try:
            # Unescape HTML entities (RSS may double-escape: &lt; -> < )
            unescaped = unescape(html_text)

            # Parse HTML
            soup = BeautifulSoup(unescaped, 'html.parser')

            # Get text content with newlines between block elements
            clean_text = soup.get_text(separator='\n', strip=True)

            # Remove excess whitespace and blank lines
            lines = [line.strip() for line in clean_text.split('\n') if line.strip()]
            clean_text = '\n'.join(lines)

            # Remove common Taleo artifacts
            clean_text = clean_text.replace('\xa0', ' ')  # Non-breaking spaces

            return clean_text

        except Exception as e:
            self.logger.error("html_cleaning_failed", error=str(e))
            return html_text

    def parse_rss_date(self, date_str: Optional[str]) -> Optional[datetime]:
        """
        Parse RFC 2822 date string from RSS pubDate field.

        Example: "Wed, 11 Mar 2026 13:17:13 GMT"

        Args:
            date_str: RFC 2822 formatted date string

        Returns:
            datetime object or None if parsing fails
        """
        if not date_str:
            return None

        try:
            return parsedate_to_datetime(date_str)
        except (ValueError, TypeError) as e:
            self.logger.warning("date_parse_failed", date_str=date_str, error=str(e))
            return None

    def fetch_rss_feed(self) -> Optional[str]:
        """
        Fetch the RSS feed XML content via HTTP GET.

        Returns:
            Raw XML string or None if request fails
        """
        rss_url = self._build_rss_url()

        headers = {
            'User-Agent': (
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/120.0.0.0 Safari/537.36'
            ),
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        }

        self.logger.info("fetching_rss_feed", url=rss_url)

        try:
            response = requests.get(rss_url, headers=headers, timeout=30)
            response.raise_for_status()
            return response.text

        except requests.RequestException as e:
            self.logger.error("rss_fetch_failed", error=str(e), url=rss_url)
            return None

    def parse_rss_items(self, xml_text: str) -> list[dict]:
        """
        Parse RSS XML into a list of job data dicts.

        Handles the Taleo-specific XML namespace (urn:TBERss) for
        custom fields like reqId, location, department, etc.

        Args:
            xml_text: Raw RSS XML string

        Returns:
            List of dicts with normalized job data
        """
        jobs = []

        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError as e:
            self.logger.error("rss_parse_failed", error=str(e))
            return []

        # Find all <item> elements in the RSS channel
        channel = root.find('channel')
        if channel is None:
            self.logger.error("rss_no_channel")
            return []

        items = channel.findall('item')
        self.logger.info("rss_items_found", count=len(items))

        for item in items:
            try:
                # Standard RSS fields
                title = item.findtext('title', '').strip()
                link = item.findtext('link', '').strip()
                description = item.findtext('description', '').strip()
                pub_date_str = item.findtext('pubDate', '').strip()

                # Taleo namespaced fields
                req_id = item.findtext(f'{{{TALEO_NS}}}reqId', '').strip()
                location = item.findtext(f'{{{TALEO_NS}}}location', '').strip()
                location_country = item.findtext(f'{{{TALEO_NS}}}locationCountry', '').strip()
                location_state = item.findtext(f'{{{TALEO_NS}}}locationState', '').strip()
                location_city = item.findtext(f'{{{TALEO_NS}}}locationCity', '').strip()
                department = item.findtext(f'{{{TALEO_NS}}}department', '').strip()
                html_description = item.findtext(f'{{{TALEO_NS}}}html-description', '').strip()

                # Skip items without title
                if not title:
                    self.logger.warning("rss_item_no_title", link=link)
                    continue

                # Extract req ID from URL if not in taleo:reqId field
                if not req_id and link:
                    req_id = self._extract_rid_from_url(link) or ''

                # Build clean v2 URL using the requisition ID
                if req_id:
                    job_url = self._build_job_url(req_id)
                else:
                    job_url = link

                # Clean the description - prefer HTML version for richer content
                if html_description:
                    clean_description = self.clean_html_description(html_description)
                elif description:
                    clean_description = description
                else:
                    clean_description = ""

                # Build normalized location string
                # Taleo provides structured location; use as-is if available
                job_location = location or 'Location Not Specified'

                # Parse posted date
                posted_date = self.parse_rss_date(pub_date_str)

                jobs.append({
                    'title': title,
                    'company': self.company_name,
                    'location': job_location,
                    'description': clean_description,
                    'url': job_url,
                    'posted_date': posted_date,
                    'requisition_id': req_id or None,
                    'skills': [],
                    'salary': None,
                    'certifications': [],
                    'employment_type': None,
                    # Extra metadata for logging
                    '_department': department,
                    '_location_country': location_country,
                    '_location_state': location_state,
                    '_location_city': location_city,
                })

            except Exception as e:
                self.logger.error("rss_item_parse_failed", error=str(e))
                continue

        return jobs

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job listing data from Taleo search results page (HTML fallback).

        This method is used when the RSS feed is unavailable. It scrapes the
        HTML search results page using Playwright.

        Taleo CWS v2 search results use an accordion layout where each job
        is in an .oracletaleocwsv2-accordion-block div with:
        - Title: h4.oracletaleocwsv2-head-title > a.viewJobLink
        - Location: div below the title (in .oracletaleocwsv2-accordion-head-info)
        - URL: href on the a.viewJobLink element (contains rid= parameter)

        Pagination uses jscroll (infinite scroll) with a.jscroll-next links
        that load the next 10 results.

        Args:
            page: Playwright page showing search results

        Returns:
            List of dicts with: title, url, location, company, requisition_id
        """
        jobs = []

        # Find all job title links
        job_links = page.locator('a.viewJobLink')
        count = await job_links.count()

        for i in range(count):
            try:
                link = job_links.nth(i)
                title = await link.inner_text()
                href = await link.get_attribute('href')

                # Extract requisition ID from URL
                req_id = self._extract_rid_from_url(href) if href else None

                # Get location from sibling div
                head_info = link.locator('xpath=ancestor::div[contains(@class, "oracletaleocwsv2-accordion-head-info")]')
                location_div = head_info.locator('div[tabindex="0"]')
                location = ''
                try:
                    location = await location_div.inner_text()
                except Exception:
                    location = 'Location Not Specified'

                jobs.append({
                    'title': title.strip(),
                    'url': href,
                    'company': self.company_name,
                    'location': location.strip() if location else 'Location Not Specified',
                    'requisition_id': req_id,
                })

            except Exception as e:
                self.logger.warning("card_extraction_failed", index=i, error=str(e))
                continue

        return jobs

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from Taleo requisition detail page (HTML fallback).

        Taleo detail pages have:
        - Description: div[name="cwsJobDescription"] contains the full HTML description
        - Location: shown in .oracletaleocwsv2-job-description section
        - No structured employment type or salary fields

        Args:
            page: Playwright page instance
            job_url: URL of job detail page

        Returns:
            Dict with: description, location, posted_date, skills, salary
        """
        await self._fetch_page(page, job_url)

        data = {}

        # Extract description from the named div
        try:
            desc_elem = page.locator('div[name="cwsJobDescription"]').first
            await desc_elem.wait_for(timeout=10000, state='visible')
            html_content = await desc_elem.inner_html()
            data['description'] = self.clean_html_description(html_content)
        except Exception as e:
            self.logger.error("description_extraction_failed", url=job_url, error=str(e))
            data['description'] = ''

        # Location is typically shown on the search results page, not detail
        data['skills'] = []
        data['salary'] = None
        data['employment_type'] = None
        data['posted_date'] = None

        return data

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs from Taleo career portal, preferring RSS feed.

        Strategy:
        1. Try RSS feed first (fast, single HTTP request, no browser needed)
        2. If RSS fails, fall back to HTML scraping with Playwright

        The RSS approach is strongly preferred because:
        - Single HTTP request gets ALL jobs (no pagination handling)
        - Structured data (no HTML parsing for metadata)
        - No browser automation overhead
        - No anti-bot detection concerns

        Args:
            max_jobs: Optional limit for testing (extract only first N jobs)

        Returns:
            List of validated JobPosting objects
        """
        self.logger.info("extraction_start", company=self.company_name, max_jobs=max_jobs)

        # Strategy 1: RSS feed (preferred)
        rss_xml = self.fetch_rss_feed()

        if rss_xml:
            return await self._extract_from_rss(rss_xml, max_jobs)

        # Strategy 2: HTML scraping fallback
        self.logger.warning("rss_unavailable_falling_back_to_html", company=self.company_name)
        return await self._extract_from_html(max_jobs)

    async def _extract_from_rss(
        self, rss_xml: str, max_jobs: Optional[int] = None
    ) -> list[JobPosting]:
        """
        Extract and validate jobs from RSS feed XML.

        Args:
            rss_xml: Raw RSS XML string
            max_jobs: Optional limit for testing

        Returns:
            List of validated JobPosting objects
        """
        jobs = []
        raw_jobs = self.parse_rss_items(rss_xml)

        self.logger.info("rss_jobs_parsed", count=len(raw_jobs))

        for raw_job in raw_jobs:
            if max_jobs and len(jobs) >= max_jobs:
                self.logger.info("max_jobs_reached", count=len(jobs))
                break

            try:
                # Remove internal metadata keys before validation
                job_data = {k: v for k, v in raw_job.items() if not k.startswith('_')}

                # Enrich with certifications
                job_data = self._enrich_with_certifications(job_data)
                if self.config.get('extract_contacts', False):
                    job_data = self._enrich_with_contacts(job_data)

                # Validate through Pydantic model
                posting = JobPosting(**job_data)
                jobs.append(posting)

                self.logger.debug(
                    "job_extracted",
                    title=posting.title,
                    requisition_id=posting.requisition_id
                )

            except ValidationError as e:
                self.logger.error(
                    "validation_failed",
                    error=str(e),
                    title=raw_job.get('title'),
                    requisition_id=raw_job.get('requisition_id')
                )
                continue

        self.logger.info("extraction_complete", total_jobs=len(jobs), method="rss")
        return jobs

    async def _extract_from_html(
        self, max_jobs: Optional[int] = None
    ) -> list[JobPosting]:
        """
        Extract jobs via HTML scraping as fallback when RSS is unavailable.

        Uses Playwright to:
        1. POST to search results page
        2. Handle jscroll pagination
        3. Extract job cards from accordion layout
        4. Visit each job detail page for full description

        Args:
            max_jobs: Optional limit for testing

        Returns:
            List of validated JobPosting objects
        """
        jobs = []
        context = None

        try:
            context = await self._get_browser_context()
            page = await context.new_page()

            # Navigate to search results
            search_url = self._build_search_url()
            taleo_config = self.config.get('taleo_config', {})
            org = taleo_config['org']
            cws = taleo_config.get('cws', '45')

            # POST the search form
            await page.goto(search_url, wait_until='networkidle', timeout=30000)

            # Wait for job listings to load
            try:
                await page.wait_for_selector(
                    '.oracletaleocwsv2-accordion-block',
                    timeout=10000,
                    state='visible'
                )
            except Exception:
                self.logger.error("job_list_not_found", url=search_url)
                return []

            # Handle jscroll pagination - scroll to load all results
            await self._handle_jscroll_pagination(page)

            # Extract all job cards
            job_cards = await self.extract_job_listings(page)
            self.logger.info("html_jobs_found", count=len(job_cards))

            # Visit each job detail page
            for idx, job_card in enumerate(job_cards):
                if max_jobs and len(jobs) >= max_jobs:
                    self.logger.info("max_jobs_reached", limit=max_jobs)
                    break

                try:
                    if idx > 0:
                        await self._rate_limit()

                    job_data = await self.extract_job_detail(page, job_card['url'])
                    full_job_data = {**job_card, **job_data}
                    full_job_data = self._enrich_with_certifications(full_job_data)
                    if self.config.get('extract_contacts', False):
                        full_job_data = self._enrich_with_contacts(full_job_data)

                    posting = JobPosting(**full_job_data)
                    jobs.append(posting)

                except ValidationError as e:
                    self.logger.error("validation_failed", job_url=job_card.get('url'), errors=str(e))
                    continue
                except Exception as e:
                    self.logger.error("extraction_failed", job_url=job_card.get('url'), error=str(e))
                    continue

            self.logger.info("extraction_complete", total_jobs=len(jobs), method="html")
            return jobs

        finally:
            if context:
                await self._close_browser()

    async def _handle_jscroll_pagination(self, page: Page) -> None:
        """
        Handle Taleo's jscroll infinite scroll pagination.

        Taleo CWS v2 uses jQuery jscroll plugin to load additional results
        when scrolling. Each page loads 10 jobs, with a hidden a.jscroll-next
        link that triggers the next page load.

        This method scrolls to the bottom repeatedly until no more
        jscroll-next links appear (all jobs loaded).

        Args:
            page: Playwright page with search results
        """
        max_scrolls = 20  # Safety limit (10 jobs per scroll * 20 = 200 jobs)

        for i in range(max_scrolls):
            # Check if there's a next page link
            next_link = page.locator('a.jscroll-next')
            count = await next_link.count()

            if count == 0:
                self.logger.info("jscroll_pagination_complete", scrolls=i)
                break

            # Scroll to trigger jscroll
            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            await page.wait_for_timeout(2000)

            self.logger.debug("jscroll_page_loaded", scroll=i + 1)
