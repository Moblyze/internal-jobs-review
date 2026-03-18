"""Generic HTML career page scraper using Playwright.

This scraper handles custom career pages that render job listings as standard HTML
(not via a known ATS platform API). It uses Playwright for browser automation to
handle JavaScript-rendered content, and is configurable via CSS selectors in
companies.yaml.

Supports:
- Static HTML pages (WordPress, custom sites)
- JavaScript-rendered SPAs (Vue, React, Squarespace)
- Pages behind CloudFront or other CDNs that block simple HTTP requests
- Single-page listings and paginated results

Used by: OSM Thome, Wellsafe Solutions, Allrig Group, Coast Renewable Services,
         Taurus Industrial Group, PBS by Ponticelli, and other custom career pages.

Configuration in companies.yaml:
    platform: html_generic
    base_url: "https://example.com/careers"
    selectors:
      job_card: "div.job-item"          # Container for each job listing
      job_title: "h3"                    # Title element within card (or listing page)
      job_link: "a"                      # Link to detail page within card
      job_location: ".location"          # Location element within card (optional)
      description: ".job-description"    # Description on detail page
      location: ".location"              # Location on detail page
      employment_type: ".job-type"       # Employment type on detail page (optional)
      pagination_next: "a.next"          # Next page link (optional)
    html_config:
      wait_for: "div.job-item"           # Selector to wait for before extraction
      detail_wait_for: ".job-description" # Selector to wait for on detail pages
      click_load_more: false              # Whether to click "load more" buttons
      jobs_are_links: true                # If true, job_card elements are themselves links
      title_from_link: false              # If true, get title from link text instead of job_title
"""

import html
import json
import re
import xml.etree.ElementTree as ET
from typing import Optional
from urllib.parse import urljoin
from urllib.request import Request, urlopen

import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()


class HtmlGenericScraper(BaseScraper):
    """
    Generic scraper for custom HTML career pages.

    Configurable via CSS selectors defined in companies.yaml. Uses Playwright
    to handle JavaScript-rendered content and anti-bot protections (CloudFront, etc.).

    The scraper follows a two-phase approach:
    1. Extract job listing cards from the main careers page (title, URL)
    2. Visit each job detail page to get full description, location, etc.
    """

    def __init__(self, config: dict):
        """
        Initialize generic HTML scraper with company configuration.

        Args:
            config: Company config dict from companies.yaml including:
                - base_url: Career page URL
                - selectors: CSS selectors for job extraction
                - html_config: Optional behavioral configuration
        """
        super().__init__(config)
        self.base_url = config.get('base_url', '')
        self.selectors = config.get('selectors', {})
        self.html_config = config.get('html_config', {})

    def _build_absolute_url(self, url: str) -> str:
        """
        Convert a relative URL to absolute using the base URL.

        Args:
            url: Relative or absolute URL

        Returns:
            Full absolute URL
        """
        if not url:
            return self.base_url
        if url.startswith('http'):
            return url
        return urljoin(self.base_url, url)

    def _clean_html(self, html_text: Optional[str]) -> str:
        """
        Convert HTML to clean plain text.

        Args:
            html_text: Raw HTML string

        Returns:
            Clean plain text with reasonable line breaks
        """
        if not html_text:
            return ""

        try:
            soup = BeautifulSoup(html_text, 'html.parser')
            # Remove script and style elements
            for element in soup(['script', 'style', 'nav', 'header', 'footer']):
                element.decompose()

            clean_text = soup.get_text(separator='\n', strip=True)
            # Remove excess blank lines
            lines = [line.strip() for line in clean_text.split('\n') if line.strip()]
            return '\n'.join(lines)
        except Exception as e:
            self.logger.error("html_cleaning_failed", error=str(e))
            return html_text

    async def _wait_for_content(self, page: Page, wait_selector: Optional[str] = None):
        """
        Wait for page content to be ready for extraction.

        Tries the configured wait_for selector first, then falls back to
        networkidle state.

        Args:
            page: Playwright page instance
            wait_selector: CSS selector to wait for (overrides config)
        """
        selector = wait_selector or self.html_config.get('wait_for')

        if selector:
            try:
                await page.wait_for_selector(selector, timeout=15000)
                self.logger.debug("wait_for_selector_found", selector=selector)
                return
            except Exception:
                self.logger.debug("wait_for_selector_timeout", selector=selector)

        # Fallback: wait for network to settle
        try:
            await page.wait_for_load_state('networkidle', timeout=15000)
        except Exception:
            self.logger.debug("networkidle_timeout", note="Continuing with current state")

    async def _handle_load_more(self, page: Page) -> int:
        """
        Click "Load More" or "Show More" buttons to reveal all jobs.

        Args:
            page: Playwright page instance

        Returns:
            Number of times load more was clicked
        """
        if not self.html_config.get('click_load_more', False):
            return 0

        clicks = 0
        max_clicks = 20  # Safety limit

        load_more_selectors = [
            self.selectors.get('load_more', ''),
            'button:has-text("Load More")',
            'button:has-text("Show More")',
            'a:has-text("Load More")',
            'a:has-text("Show More")',
            '.load-more',
            '.show-more',
            '[class*="load-more"]',
        ]

        # Filter out empty selectors
        load_more_selectors = [s for s in load_more_selectors if s]

        for _ in range(max_clicks):
            clicked = False
            for selector in load_more_selectors:
                try:
                    btn = page.locator(selector).first
                    if await btn.count() > 0 and await btn.is_visible(timeout=2000):
                        await btn.click()
                        await page.wait_for_load_state('networkidle', timeout=10000)
                        await self._rate_limit()
                        clicks += 1
                        clicked = True
                        self.logger.debug("load_more_clicked", clicks=clicks)
                        break
                except Exception:
                    continue

            if not clicked:
                break

        return clicks

    async def _handle_pagination(self, page: Page) -> list[str]:
        """
        Collect URLs from pagination links for multi-page listings.

        Args:
            page: Playwright page instance

        Returns:
            List of additional page URLs to scrape
        """
        next_selector = self.selectors.get('pagination_next', '')
        if not next_selector:
            return []

        additional_pages = []
        max_pages = 10  # Safety limit

        for _ in range(max_pages):
            try:
                next_link = page.locator(next_selector).first
                if await next_link.count() > 0 and await next_link.is_visible(timeout=3000):
                    href = await next_link.get_attribute('href')
                    if href:
                        next_url = self._build_absolute_url(href)
                        if next_url not in additional_pages:
                            additional_pages.append(next_url)
                            await next_link.click()
                            await self._wait_for_content(page)
                            await self._rate_limit()
                        else:
                            break
                    else:
                        break
                else:
                    break
            except Exception:
                break

        return additional_pages

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job listing data from the careers page.

        Uses configured CSS selectors to find job cards/links and extract
        title, URL, and optionally location from each listing.

        Selector strategy:
        1. Use job_card selector to find listing containers
        2. Within each card, find title (job_title) and link (job_link)
        3. If jobs_are_links is true, treat job_card as both container and link
        4. Fallback: find all links on page matching common job URL patterns

        Args:
            page: Playwright page showing job listings

        Returns:
            List of dicts with: title, url, company, location (if available)
        """
        listings = []

        card_selector = self.selectors.get('job_card', '')
        title_selector = self.selectors.get('job_title', '')
        link_selector = self.selectors.get('job_link', '')
        location_selector = self.selectors.get('job_location', '')
        jobs_are_links = self.html_config.get('jobs_are_links', False)
        title_from_link = self.html_config.get('title_from_link', False)

        if card_selector:
            cards = page.locator(card_selector)
            count = await cards.count()
            self.logger.info("job_cards_found", count=count, selector=card_selector)

            for i in range(count):
                try:
                    card = cards.nth(i)

                    # Extract title
                    title = ''
                    if title_from_link and link_selector:
                        try:
                            link_elem = card.locator(link_selector).first
                            title = (await link_elem.inner_text(timeout=3000)).strip()
                        except Exception:
                            pass

                    if not title and title_selector:
                        try:
                            title_elem = card.locator(title_selector).first
                            if await title_elem.count() > 0:
                                title = (await title_elem.inner_text(timeout=3000)).strip()
                        except Exception:
                            pass

                    if not title:
                        # Try getting text from the card itself
                        try:
                            title = (await card.inner_text(timeout=3000)).strip()
                            # Truncate if it's too long (got entire card text)
                            if len(title) > 200:
                                title = title.split('\n')[0].strip()
                        except Exception:
                            continue

                    # Extract URL
                    url = ''
                    if jobs_are_links:
                        try:
                            url = await card.get_attribute('href') or ''
                        except Exception:
                            pass
                    elif link_selector:
                        try:
                            link_elem = card.locator(link_selector).first
                            if await link_elem.count() > 0:
                                url = await link_elem.get_attribute('href') or ''
                        except Exception:
                            pass

                    if not url:
                        # Fallback: try any <a> within the card
                        try:
                            any_link = card.locator('a').first
                            if await any_link.count() > 0:
                                url = await any_link.get_attribute('href') or ''
                        except Exception:
                            pass

                    # Extract location from listing (optional)
                    location = ''
                    if location_selector:
                        try:
                            loc_elem = card.locator(location_selector).first
                            if await loc_elem.count() > 0:
                                location = (await loc_elem.inner_text(timeout=3000)).strip()
                        except Exception:
                            pass

                    if title and len(title) >= 3:
                        listing = {
                            'title': title,
                            'url': self._build_absolute_url(url) if url else '',
                            'company': self.company_name,
                        }
                        if location:
                            listing['location'] = location
                        listings.append(listing)

                except Exception as e:
                    self.logger.debug("card_extraction_failed", index=i, error=str(e))
                    continue
        else:
            # No card selector: try to find job links by common patterns
            self.logger.info("no_card_selector", note="Using fallback link detection")
            listings = await self._fallback_extract_links(page)

        # Deduplicate by URL
        seen_urls = set()
        unique_listings = []
        for listing in listings:
            url_key = listing.get('url', listing['title'])
            if url_key not in seen_urls:
                seen_urls.add(url_key)
                unique_listings.append(listing)

        self.logger.info("unique_listings_extracted", count=len(unique_listings))
        return unique_listings

    async def _fallback_extract_links(self, page: Page) -> list[dict]:
        """
        Fallback extraction: find links that look like job postings.

        Scans all links on the page for patterns indicating job detail pages
        (e.g., /job/, /vacancy/, /position/, /career/).

        Also supports html_config.exclude_url_patterns — a list of regex patterns
        to exclude specific URLs (e.g., the main careers page, open-application links).

        Args:
            page: Playwright page to scan

        Returns:
            List of job listing dicts
        """
        listings = []
        job_url_patterns = [
            '/job/', '/jobs/', '/vacancy/', '/vacancies/',
            '/position/', '/positions/', '/career/', '/careers/',
            '/opening/', '/role/',
        ]

        # Load exclude patterns from config (regex patterns applied to href)
        exclude_url_patterns = self.html_config.get('exclude_url_patterns', [])

        all_links = page.locator('a[href]')
        count = await all_links.count()

        for i in range(count):
            try:
                link = all_links.nth(i)
                href = await link.get_attribute('href') or ''
                href_lower = href.lower()

                # Check if link matches job URL patterns
                if any(pattern in href_lower for pattern in job_url_patterns):
                    # Check if URL matches any exclude pattern
                    if exclude_url_patterns and any(
                        re.search(pattern, href) for pattern in exclude_url_patterns
                    ):
                        continue

                    title = (await link.inner_text(timeout=3000)).strip()

                    # Skip nav/utility links
                    if not title or len(title) < 3:
                        continue
                    if any(skip in title.lower() for skip in [
                        'apply', 'login', 'register', 'back', 'home',
                        'search', 'filter', 'sort', 'all jobs', 'view all',
                        'careers', 'open application',
                    ]):
                        continue

                    listings.append({
                        'title': title,
                        'url': self._build_absolute_url(href),
                        'company': self.company_name,
                    })
            except Exception:
                continue

        return listings

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from a job detail page.

        Navigates to the job URL and extracts description, location,
        and employment type using configured selectors with fallbacks.

        Args:
            page: Playwright page instance
            job_url: URL of job detail page

        Returns:
            Dict with: description, location, posted_date, skills, salary,
                       employment_type
        """
        await self._fetch_page(page, job_url)

        # Wait for detail content
        detail_wait = self.html_config.get('detail_wait_for')
        await self._wait_for_content(page, detail_wait)

        detail = {
            'description': '',
            'location': 'Location Not Specified',
            'posted_date': None,
            'skills': [],
            'salary': None,
            'employment_type': None,
        }

        # Extract description
        desc_selector = self.selectors.get('description', '')
        description_selectors = [s.strip() for s in desc_selector.split(',') if s.strip()] if desc_selector else []

        # Add generic fallbacks
        description_selectors.extend([
            '.job-description',
            '.description',
            '[class*="description"]',
            '[itemprop="description"]',
            '.job-content',
            '.job-detail',
            '.entry-content',
            '.post-content',
            'article',
            'main',
        ])

        for selector in description_selectors:
            try:
                elem = page.locator(selector).first
                if await elem.count() > 0:
                    html_content = await elem.inner_html(timeout=10000)
                    text = self._clean_html(html_content)
                    if text and len(text) > 50:
                        detail['description'] = text
                        self.logger.debug("description_found", selector=selector, length=len(text))
                        break
            except Exception:
                continue

        # Fallback: use page body if no description found
        if not detail['description'] or len(detail['description']) < 50:
            try:
                body_html = await page.locator('body').inner_html()
                body_text = self._clean_html(body_html)
                if body_text and len(body_text) > 100:
                    detail['description'] = body_text
                    self.logger.debug("description_from_body", length=len(body_text))
            except Exception:
                pass

        # Extract location
        detail['location'] = await self._try_extract_field(
            page,
            self.selectors.get('location', ''),
            fallback_selectors=[
                '.job-location', '.location',
                '[class*="location"]', '[itemprop="jobLocation"]',
                'td:has-text("Location") + td',
                'dt:has-text("Location") + dd',
            ],
            field_name='location',
            default='Location Not Specified'
        )

        # Extract employment type
        emp_type = await self._try_extract_field(
            page,
            self.selectors.get('employment_type', ''),
            fallback_selectors=[
                '.job-type', '.employment-type',
                '[class*="type"]', '[itemprop="employmentType"]',
                'td:has-text("Type") + td',
                'dt:has-text("Type") + dd',
                'td:has-text("Contract") + td',
            ],
            field_name='employment_type',
            default=None
        )
        if emp_type:
            detail['employment_type'] = self._normalize_employment_type(emp_type)

        # Infer employment type from description
        if not detail['employment_type'] and detail.get('description'):
            desc_lower = detail['description'].lower()
            if 'permanent' in desc_lower:
                detail['employment_type'] = 'Full-Time'
            elif 'contract' in desc_lower and 'contractor' not in desc_lower:
                detail['employment_type'] = 'Contractor'
            elif 'part-time' in desc_lower or 'part time' in desc_lower:
                detail['employment_type'] = 'Part-Time'

        return detail

    async def _try_extract_field(
        self,
        page: Page,
        primary_selector: str,
        fallback_selectors: list[str],
        field_name: str,
        default: Optional[str] = None
    ) -> Optional[str]:
        """
        Try to extract a text field using primary selector then fallbacks.

        Args:
            page: Playwright page
            primary_selector: Configured selector (may be comma-separated)
            fallback_selectors: Generic selectors to try if primary fails
            field_name: Name of field (for logging)
            default: Default value if nothing found

        Returns:
            Extracted text or default value
        """
        all_selectors = []
        if primary_selector:
            all_selectors.extend([s.strip() for s in primary_selector.split(',') if s.strip()])
        all_selectors.extend(fallback_selectors)

        for selector in all_selectors:
            try:
                elem = page.locator(selector).first
                if await elem.count() > 0:
                    text = (await elem.inner_text(timeout=3000)).strip()
                    if text and len(text) < 200:
                        # Clean label prefixes
                        text = re.sub(
                            rf'^{field_name}\s*:\s*',
                            '', text, flags=re.IGNORECASE
                        ).strip()
                        if text:
                            self.logger.debug(
                                f"{field_name}_found",
                                selector=selector,
                                value=text[:80]
                            )
                            return text
            except Exception:
                continue

        return default

    def _extract_listings_from_sitemap(self) -> list[dict]:
        """
        Extract job listings from an XML sitemap.

        Parses the sitemap XML and extracts URLs matching the configured
        job pattern. Title is derived from the URL slug.

        Returns:
            List of dicts with: title, url, company
        """
        sitemap_url = self.html_config.get('sitemap_url', '')
        job_pattern = self.html_config.get('sitemap_job_pattern', '/jobs/')

        if not sitemap_url:
            return []

        self.logger.info("fetching_sitemap", url=sitemap_url)

        try:
            req = Request(sitemap_url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; JobScraper/1.0)'
            })
            resp = urlopen(req, timeout=30)
            xml_content = resp.read().decode('utf-8')

            # Parse XML
            root = ET.fromstring(xml_content)
            # Handle namespace
            ns = {'sm': 'http://www.sitemaps.org/schemas/sitemap/0.9'}

            listings = []
            for url_elem in root.findall('sm:url', ns):
                loc = url_elem.find('sm:loc', ns)
                if loc is None or loc.text is None:
                    continue

                url = loc.text.strip()
                if job_pattern not in url:
                    continue

                # Extract title from URL slug
                parts = url.rstrip('/').split('/')
                slug = parts[-1] if parts[-1] else parts[-2]
                # Remove leading numeric ID if present (e.g., "526/wiper-..." pattern)
                # The slug is already the last part after the ID
                title = slug.replace('-', ' ').strip().title()

                if not title or len(title) < 3:
                    continue

                listings.append({
                    'title': title,
                    'url': url,
                    'company': self.company_name,
                })

            self.logger.info("sitemap_listings_extracted", count=len(listings))
            return listings

        except Exception as e:
            self.logger.error("sitemap_fetch_failed", error=str(e))
            return []

    def _extract_listings_from_wp_api(self) -> list[dict]:
        """
        Extract job listings from a WordPress REST API page.

        Parses the page content returned by WP REST API, extracting
        job titles and locations from Visual Composer sections (h3 headings
        followed by location text).

        Returns:
            List of dicts with: title, url, company, location, description
        """
        wp_api_url = self.html_config.get('wp_api_url', '')
        if not wp_api_url:
            return []

        self.logger.info("fetching_wp_api", url=wp_api_url)

        try:
            req = Request(wp_api_url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; JobScraper/1.0)'
            })
            resp = urlopen(req, timeout=30)
            data = json.loads(resp.read())
            content = html.unescape(data['content']['rendered'])

            # Split content by VC column sections
            sections = content.split('[/vc_column]')

            listings = []
            # Skip intro sections (header image, description, FAQ)
            # Job sections have h3 with job title and text with "Location: ..."
            skip_titles = {
                'home', 'play your part', 'how do i submit', 'faq',
                'join our team', 'widget area',
            }

            for section in sections:
                # Extract h3 headings
                h3_matches = re.findall(r'<h3[^>]*>(.*?)</h3>', section, re.DOTALL)
                for h3_html in h3_matches:
                    title = re.sub(r'<[^>]+>', '', h3_html).strip()
                    if not title or len(title) < 3:
                        continue
                    if any(skip in title.lower() for skip in skip_titles):
                        continue

                    # Extract text content (strip HTML and VC shortcodes)
                    text = re.sub(r'<[^>]+>', ' ', section)
                    text = re.sub(r'\[.*?\]', '', text)
                    text = ' '.join(text.split())

                    # Look for location
                    location = 'Location Not Specified'
                    loc_match = re.search(
                        r'Location\s*:\s*([A-Za-z][A-Za-z\s,/]+)',
                        text, re.IGNORECASE
                    )
                    if loc_match:
                        location = loc_match.group(1).strip()

                    # Build a description from the section text
                    description = text.strip()
                    if len(description) < 20:
                        description = f"{title} position at {self.company_name}. Location: {location}."

                    listings.append({
                        'title': title,
                        'url': self.base_url,
                        'company': self.company_name,
                        'location': location,
                        'description': description,
                    })

            self.logger.info("wp_api_listings_extracted", count=len(listings))
            return listings

        except Exception as e:
            self.logger.error("wp_api_fetch_failed", error=str(e))
            return []

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Main entry point: extract all jobs from career portal using Playwright.

        Process:
        1. Check for sitemap or WP API extraction (no browser needed for listings)
        2. Otherwise navigate to career page and wait for content
        3. Handle load more buttons / pagination
        4. Extract job listing cards (title, URL)
        5. Visit each job detail page for full descriptions
        6. Validate through JobPosting model
        7. Enrich with certifications

        Args:
            max_jobs: Optional limit for testing

        Returns:
            List of validated JobPosting objects
        """
        jobs = []
        context = None
        skip_detail_pages = self.html_config.get('skip_detail_pages', False)

        self.logger.info("extraction_start", company=self.company_name, max_jobs=max_jobs)

        try:
            # Check for alternative extraction methods first (no browser needed)
            all_listings = []

            if self.html_config.get('wp_api_url'):
                # WordPress REST API extraction (e.g., Wellsafe Solutions)
                all_listings = self._extract_listings_from_wp_api()
                skip_detail_pages = True  # WP API provides all data we need

            elif self.html_config.get('sitemap_url'):
                # Sitemap-based extraction (e.g., OSM Thome)
                all_listings = self._extract_listings_from_sitemap()

            page = None

            if not all_listings:
                # Fall back to browser-based extraction
                context = await self._get_browser_context()
                page = await context.new_page()

                # Navigate to main listings page
                await self._fetch_page(page, self.base_url)
                await self._wait_for_content(page)

                # Handle load more buttons
                await self._handle_load_more(page)

                # Extract listings from first page
                all_listings = await self.extract_job_listings(page)

                # Handle pagination if configured (only when using browser)
                if self.selectors.get('pagination_next'):
                    pages_visited = 1
                    max_pages = 10

                    while pages_visited < max_pages:
                        try:
                            next_selector = self.selectors['pagination_next']
                            next_link = page.locator(next_selector).first
                            if await next_link.count() > 0 and await next_link.is_visible(timeout=3000):
                                await next_link.click()
                                await self._wait_for_content(page)
                                await self._rate_limit()

                                page_listings = await self.extract_job_listings(page)
                                if not page_listings:
                                    break
                                all_listings.extend(page_listings)
                                pages_visited += 1
                                self.logger.info("pagination_page", page=pages_visited, new_listings=len(page_listings))
                            else:
                                break
                        except Exception:
                            break

            if not all_listings:
                self.logger.warning("no_jobs_found", url=self.base_url)
                return []

            self.logger.info("total_listings_found", count=len(all_listings))

            # Limit for testing
            listings_to_process = all_listings[:max_jobs] if max_jobs else all_listings

            # Visit each detail page (or use listing data directly)
            for idx, listing in enumerate(listings_to_process):
                try:
                    job_data = {**listing}

                    if not skip_detail_pages and listing.get('url'):
                        # Ensure browser is available for detail page extraction
                        if page is None:
                            context = await self._get_browser_context()
                            page = await context.new_page()

                        if idx > 0:
                            await self._rate_limit()

                        self.logger.debug(
                            "extracting_detail",
                            job_num=idx + 1,
                            title=listing['title'][:50],
                            url=listing['url']
                        )

                        detail = await self.extract_job_detail(page, listing['url'])
                        job_data = {**listing, **detail}
                    else:
                        # Use what we have from the listing
                        if 'description' not in job_data or not job_data.get('description'):
                            job_data['description'] = f"{job_data['title']} position at {self.company_name}."
                        if 'location' not in job_data:
                            job_data['location'] = 'Location Not Specified'

                    # Ensure minimum description
                    if not job_data.get('description') or len(job_data['description']) < 10:
                        job_data['description'] = f"{job_data['title']} position at {self.company_name}."

                    # Enrich with certifications
                    job_data = self._enrich_with_certifications(job_data)

                    # Validate through Pydantic model
                    posting = JobPosting(**job_data)
                    jobs.append(posting)

                    self.logger.debug("job_extracted", job_num=idx + 1, title=posting.title)

                except ValidationError as e:
                    self.logger.error(
                        "validation_failed",
                        job_num=idx + 1,
                        url=listing.get('url'),
                        error=str(e)
                    )
                    continue
                except Exception as e:
                    self.logger.error(
                        "job_extraction_failed",
                        job_num=idx + 1,
                        url=listing.get('url'),
                        error=str(e),
                        exc_info=True
                    )
                    continue

            self.logger.info("extraction_complete", total_jobs=len(jobs))
            return jobs

        except Exception as e:
            self.logger.error("extraction_failed", error=str(e), exc_info=True)
            return jobs

        finally:
            if context:
                await self._close_browser()
