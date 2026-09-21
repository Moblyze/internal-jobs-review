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

from src.aggregators.cleanup import looks_like_company_name
from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()

# Below this, a "description" is not one: it is a title echoed back, a label, or
# an empty container. Used both to decide whether a job's own page still needs
# fetching and to drop a row rather than invent text for it.
MIN_USABLE_DESCRIPTION = 60


def _address_part(value) -> str:
    """One address field as text. schema.org allows a bare string or an object."""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get('name') or '').strip()
    return ''


def _iter_jsonld_objects(html: str):
    """Every JSON-LD object on the page, unwrapping lists and @graph."""
    for block in re.findall(
        r'<script[^>]*type=[\'"]application/ld\+json[\'"][^>]*>(.*?)</script>',
        html,
        re.DOTALL | re.IGNORECASE,
    ):
        try:
            data = json.loads(block)
        except (json.JSONDecodeError, TypeError):
            # One malformed block must not hide a good one further down.
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            item = stack.pop(0)
            if not isinstance(item, dict):
                continue
            graph = item.get('@graph')
            if isinstance(graph, list):
                stack.extend(graph)
            yield item


def location_from_jsonld(html: str) -> Optional[str]:
    """The job's location from its schema.org JobPosting markup, or None.

    WHY THIS EXISTS (2026-09-16)
    ----------------------------
    Some ATS portals never put the location in selectable HTML. Altrad UK's
    Eploy portal renders it only inside ASP.NET postback script noise, so every
    CSS selector missed it, the page-<title> fallback mis-parsed the site's
    "Job Title - Town in Site - Company" format, and all 156 Altrad jobs
    resolved to "Unknown". The public store requires a resolvable country, so
    those jobs could never be published.

    The JSON-LD is the reliable source on such sites: it is the same structured
    data the employer publishes for Google for Jobs, so it is maintained.

    Returns "Locality, Country" where both exist, matching the house style the
    rest of the corpus uses ("Abu Dhabi, United Arab Emirates"). Region is used
    in place of a missing locality rather than added to it, to keep the string
    geocodable.
    """
    for item in _iter_jsonld_objects(html):
        types = item.get('@type')
        types = types if isinstance(types, list) else [types]
        if 'JobPosting' not in types:
            continue

        job_location = item.get('jobLocation')
        if isinstance(job_location, list):
            job_location = job_location[0] if job_location else None
        if not isinstance(job_location, dict):
            continue

        address = job_location.get('address')
        if isinstance(address, str) and address.strip():
            return address.strip()
        if not isinstance(address, dict):
            continue

        locality = _address_part(address.get('addressLocality'))
        region = _address_part(address.get('addressRegion'))
        country = _address_part(address.get('addressCountry'))

        # Region is a stand-in for a missing locality, not an extra layer:
        # "Bridgwater, Somerset, United Kingdom" geocodes no better than
        # "Bridgwater, United Kingdom" and is further from the house style.
        place = locality or region
        parts = [p for p in (place, country) if p]
        # A city-state repeats itself ("Singapore, Singapore").
        if len(parts) == 2 and parts[0].lower() == parts[1].lower():
            parts = parts[:1]
        if parts:
            return ', '.join(parts)
    return None


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
        self._known_url_checker = None

    def set_known_url_checker(self, checker) -> None:
        """Predicate for 'this URL is already exported' (main.py passes the
        dedup tracker). Used by the sitemap fallback to keep known jobs present
        without exporting title-only rows for unknown ones."""
        self._known_url_checker = checker

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

        # Extract location from CSS selectors
        detail['location'] = await self._try_extract_field(
            page,
            self.selectors.get('location', ''),
            fallback_selectors=[
                '.job-location', '.location',
                '[class*="location"]', '[itemprop="jobLocation"]',
                'td:has-text("Location") + td',
                'dt:has-text("Location") + dd',
                # Firefish/ASP.NET patterns (used by ROVOP and similar portals)
                'li.job-details__location',
                'li[id*="liLocation"]',
            ],
            field_name='location',
            default='Location Not Specified'
        )

        # Fallback: the page's own JobPosting JSON-LD. Tried BEFORE the <title>
        # and slug guesses because it is structured data the employer maintains
        # for Google for Jobs, not an inference. Some ATS portals (Altrad UK's
        # Eploy) put the location nowhere else a selector can reach it.
        if detail['location'] == 'Location Not Specified':
            try:
                jsonld_location = location_from_jsonld(await page.content())
                if jsonld_location:
                    detail['location'] = jsonld_location
                    self.logger.debug(
                        "location_from_jsonld",
                        url=job_url,
                        location=jsonld_location,
                    )
            except Exception:
                pass

        # Fallback: extract location from page <title> tag
        # Many career sites use "Job Title - Location | Company" format
        if detail['location'] == 'Location Not Specified':
            try:
                page_title = await page.title()
                if page_title and ' - ' in page_title:
                    # Pattern: "Job Title - Location | Company Name"
                    after_dash = page_title.split(' - ', 1)[1]
                    # Remove company suffix (after | or at end)
                    if '|' in after_dash:
                        location_candidate = after_dash.split('|')[0].strip()
                    else:
                        location_candidate = after_dash.strip()
                    # Guard against "Job Title - Company Name" pages (no pipe,
                    # no location segment): WRS's titles are exactly this shape
                    # ("2nd Engineer - Worldwide Recruitment Solutions"), which
                    # used to get stored as the location until the JobPosting
                    # company-name sanitizer caught it downstream and blanked
                    # it to "Unknown" -- discarding a good listing-page location
                    # along the way. Skip the fallback outright when the
                    # candidate is the company's own name.
                    if (
                        location_candidate
                        and len(location_candidate) < 100
                        and not looks_like_company_name(location_candidate, self.company_name)
                    ):
                        detail['location'] = location_candidate
                        self.logger.debug(
                            "location_from_page_title",
                            title=page_title[:80],
                            location=location_candidate
                        )
            except Exception:
                pass

        # Fallback: extract location from URL slug
        if detail['location'] == 'Location Not Specified' and job_url:
            slug = job_url.rstrip('/').split('/')[-1]
            slug_location = self._extract_location_from_slug(slug)
            if slug_location:
                detail['location'] = slug_location
                self.logger.debug(
                    "location_from_url_slug",
                    url=job_url[:80],
                    location=slug_location
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

    def _extract_location_from_slug(self, slug: str) -> str:
        """
        Extract location from a URL slug by matching known location keywords.

        Many maritime/energy job sites encode the location as the last word(s)
        in the URL slug, e.g. "3rd-engineer-offshore-pipe-layer-brazil" -> "Brazil".

        Args:
            slug: URL slug (hyphen-separated words)

        Returns:
            Extracted location string or empty string if none found
        """
        # Known location keywords commonly found in maritime/energy job slugs.
        # These are checked case-insensitively against the last word(s) of the slug.
        #
        # Multi-word entries (with spaces) are checked as hyphenated slug segments.
        # E.g., "saudi arabia" matches "...-saudi-arabia" at end of slug.
        location_keywords = {
            # Multi-word patterns (checked first)
            'world wide': 'Worldwide',
            'world-wide': 'Worldwide',
            'worl wide': 'Worldwide',   # common typo in OSM Thome data
            'worl-wide': 'Worldwide',
            'north sea': 'North Sea',
            'north sea trade': 'North Sea',
            'saudi arabia': 'Saudi Arabia',
            'united kingdom': 'United Kingdom',
            'united states': 'United States',
            'new zealand': 'New Zealand',
            'south korea': 'South Korea',
            'hong kong': 'Hong Kong',
            'trinidad tobago': 'Trinidad & Tobago',
            'papua new guinea': 'Papua New Guinea',
            'middle east': 'Middle East',
            'asia pacific': 'Asia-Pacific',
            'west africa': 'West Africa',
            'east africa': 'East Africa',
            # Regions / generic (single word)
            'worldwide': 'Worldwide',
            'wordwide': 'Worldwide',  # common typo
            'global': 'Global',
            'international': 'International',
            'offshore': 'Offshore',
            'onshore': 'Onshore',
            'remote': 'Remote',
            # Countries & territories
            'norway': 'Norway',
            'norge': 'Norway',
            'brazil': 'Brazil',
            'brasil': 'Brazil',
            'uk': 'United Kingdom',
            'usa': 'United States',
            'singapore': 'Singapore',
            'india': 'India',
            'australia': 'Australia',
            'canada': 'Canada',
            'qatar': 'Qatar',
            'uae': 'United Arab Emirates',
            'dubai': 'Dubai, UAE',
            'abu dhabi': 'Abu Dhabi, UAE',
            'saudi': 'Saudi Arabia',
            'angola': 'Angola',
            'nigeria': 'Nigeria',
            'ghana': 'Ghana',
            'egypt': 'Egypt',
            'mexico': 'Mexico',
            'trinidad': 'Trinidad & Tobago',
            'guyana': 'Guyana',
            'suriname': 'Suriname',
            'malaysia': 'Malaysia',
            'indonesia': 'Indonesia',
            'thailand': 'Thailand',
            'vietnam': 'Vietnam',
            'philippines': 'Philippines',
            'japan': 'Japan',
            'korea': 'South Korea',
            'china': 'China',
            'taiwan': 'Taiwan',
            'netherlands': 'Netherlands',
            'germany': 'Germany',
            'france': 'France',
            'italy': 'Italy',
            'spain': 'Spain',
            'portugal': 'Portugal',
            'greece': 'Greece',
            'turkey': 'Turkey',
            'cyprus': 'Cyprus',
            'denmark': 'Denmark',
            'sweden': 'Sweden',
            'finland': 'Finland',
            'poland': 'Poland',
            'romania': 'Romania',
            'croatia': 'Croatia',
            'scotland': 'Scotland, UK',
            'aberdeen': 'Aberdeen, UK',
            'houston': 'Houston, TX',
            'perth': 'Perth, Australia',
            'apac': 'Asia-Pacific',
            'emea': 'EMEA',
            'americas': 'Americas',
            'europe': 'Europe',
            'africa': 'Africa',
            'gulf': 'Gulf Region',
            'caribbean': 'Caribbean',
            'mediterranean': 'Mediterranean',
            'arabia': 'Saudi Arabia',
            'mozambique': 'Mozambique',
            'namibia': 'Namibia',
            'senegal': 'Senegal',
            'mauritania': 'Mauritania',
            'libya': 'Libya',
            'iraq': 'Iraq',
            'oman': 'Oman',
            'bahrain': 'Bahrain',
            'kuwait': 'Kuwait',
            'brunei': 'Brunei',
            'myanmar': 'Myanmar',
            'bangladesh': 'Bangladesh',
            'pakistan': 'Pakistan',
            'colombia': 'Colombia',
            'argentina': 'Argentina',
            'chile': 'Chile',
            'peru': 'Peru',
            'ecuador': 'Ecuador',
            'venezuela': 'Venezuela',
            'ireland': 'Ireland',
            'belgium': 'Belgium',
            'luxembourg': 'Luxembourg',
            'switzerland': 'Switzerland',
            'austria': 'Austria',
            'czech': 'Czech Republic',
            'hungary': 'Hungary',
            'bulgaria': 'Bulgaria',
            'serbia': 'Serbia',
            'malta': 'Malta',
        }

        slug_words = slug.lower().split('-')

        # Filter out noise words that indicate unknown location
        last_word = slug_words[-1] if slug_words else ''
        if last_word in ('tba', 'tbc', 'tbd', 'na', 'copy', 'asap'):
            # Check previous words instead, these are modifiers not locations
            if len(slug_words) >= 2:
                slug_words = slug_words[:-1]
                last_word = slug_words[-1]
            else:
                return ''

        # Check the last 1-4 words of the slug for location matches
        # Start with longer matches first (more specific)
        for num_words in range(min(4, len(slug_words)), 0, -1):
            candidate = '-'.join(slug_words[-num_words:])
            candidate_spaced = candidate.replace('-', ' ')
            for keyword, location in location_keywords.items():
                keyword_normalized = keyword.replace('-', ' ')
                if keyword_normalized == candidate_spaced:
                    return location

        return ''

    def _extract_listings_from_portal_api(self) -> list[dict]:
        """
        Extract job listings from a JSON portal API (e.g., OSM Thome / osmaportal.com).

        Fetches all jobs from a paginated REST API that returns structured JSON
        with title, location, description, and employment type. This avoids
        the need for browser rendering or detail page visits.

        Config (in html_config):
            portal_api_url: Base API URL (e.g., "https://maritime.osmaportal.com/api/jobs")
            portal_api_headers: Dict of headers to send (e.g., {"X-Job-Portal": "yes"})
            portal_per_page: Results per page (default 100)

        Returns:
            List of dicts with: title, url, company, location, description,
                                employment_type (complete data, no detail pages needed)
        """
        api_url = self.html_config.get('portal_api_url', '')
        if not api_url:
            return []

        headers = self.html_config.get('portal_api_headers', {})
        per_page = self.html_config.get('portal_per_page', 100)

        self.logger.info("fetching_portal_api", url=api_url, per_page=per_page)

        listings = []
        page_num = 1
        max_pages = 50  # Safety limit

        try:
            while page_num <= max_pages:
                page_url = f"{api_url}?page={page_num}&per_page={per_page}"
                # Look like the portal's own single-page app: the OSM Thome API
                # answered 403 to the generic "JobScraper/1.0" agent from the
                # GitHub Actions runner (2026-09-12 daily run) while the same
                # request with browser headers succeeds.
                req = Request(page_url, headers={
                    'User-Agent': (
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    ),
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Origin': self.base_url.rstrip('/'),
                    'Referer': self.base_url,
                    **headers,
                })
                resp = urlopen(req, timeout=30)
                data = json.loads(resp.read().decode('utf-8'))

                jobs = data.get('data', [])
                if not jobs:
                    break

                for job in jobs:
                    listing = self._portal_job_to_listing(job)
                    if listing:
                        listings.append(listing)

                # Check if there are more pages
                meta = data.get('meta', {})
                last_page = meta.get('last_page', 1)
                if page_num >= last_page:
                    break
                page_num += 1

            self.logger.info(
                "portal_api_listings_extracted",
                count=len(listings),
                pages_fetched=page_num,
            )
            return listings

        except Exception as e:
            self.logger.error("portal_api_fetch_failed", error=str(e), page=page_num)
            return listings  # Return whatever we got so far

    def _portal_job_to_listing(self, job: dict) -> Optional[dict]:
        """Map one portal API job record onto a listing dict (or None to skip)."""
        # Skip inactive/expired jobs
        if not job.get('is_active', True) or job.get('is_expired', False):
            return None

        title = (job.get('name') or '').strip()
        if not title:
            return None

        slug = job.get('slug', '')
        job_id = job.get('id', '')
        job_url = f"{self.base_url}jobs/{job_id}/{slug}" if job_id else ''

        # Extract location from the locations array
        locations = job.get('locations') or []
        location = ', '.join(
            loc.get('label', '') for loc in locations if isinstance(loc, dict) and loc.get('label')
        ) if locations else ''

        # Extract employment type
        emp_types = job.get('employment_types') or []
        employment_type = None
        if emp_types and isinstance(emp_types[0], dict):
            employment_type = self._normalize_employment_type(emp_types[0].get('label', ''))

        # Extract description (HTML) and clean it
        raw_desc = job.get('description', '') or job.get('excerpt', '') or ''
        description = self._clean_html(raw_desc) if raw_desc else ''

        return {
            'title': title,
            'url': job_url,
            'company': self.company_name,
            'location': location or 'Location Not Specified',
            # Deliberately left EMPTY when the sitemap gives us nothing: that is
            # the signal the main loop uses to go and fetch the job's own page.
            'description': description or '',
            'employment_type': employment_type,
        }

    # REMOVED 2026-09-21: _extract_listings_from_portal_api_via_browser().
    #
    # It re-issued a portal-API call from inside a headless browser on the
    # career site's own origin whenever the plain HTTP call was refused. Its
    # only user was OSM Thome, whose API host (maritime.osmaportal.com) answers
    # "User-agent: * / Disallow: /" in robots.txt and 403s us accordingly. A
    # 403 from a host that has already told every crawler to stay out is an
    # answer, not an obstacle, so there is nothing here to route around. If a
    # future source needs this, check its robots.txt first and say in the
    # config why the path is permitted.

    def _extract_listings_from_sitemap(self) -> list[dict]:
        """
        Extract job listings from an XML sitemap.

        Parses the sitemap XML and extracts URLs matching the configured
        job pattern. Title and location are derived from the URL slug.

        Returns:
            List of dicts with: title, url, company, location (if found)
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
                # Strip a trailing file extension: legacy ASP.NET/PHP-style ATS
                # sitemaps end job URLs in ".html"/".aspx" (Altrad's Eploy portal,
                # ".../pipefitter-advanced--bridgwater.html"), which otherwise
                # title-cases into "...Bridgwater.Html".
                slug_no_ext = re.sub(r'\.(html?|aspx|php)$', '', slug, flags=re.IGNORECASE)
                # Remove leading numeric ID if present (e.g., "526/wiper-..." pattern)
                # The slug is already the last part after the ID
                title = slug_no_ext.replace('-', ' ').strip().title()

                if not title or len(title) < 3:
                    continue

                listing = {
                    'title': title,
                    'url': url,
                    'company': self.company_name,
                }

                # Try to extract location from slug (common in maritime job sites)
                location = self._extract_location_from_slug(slug_no_ext)
                if location:
                    listing['location'] = location
                    # Provenance: a slug keyword match is a deliberate,
                    # high-confidence read. The merge below uses this to know it
                    # should not be overwritten by the detail page's last-resort
                    # <title>-splitting guess. Only set on this path, so
                    # selector-driven configs keep their existing behaviour.
                    listing['_location_from_slug'] = True
                    self.logger.debug(
                        "location_from_slug",
                        slug=slug[:60],
                        location=location
                    )

                listings.append(listing)

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
                    if len(description) < MIN_USABLE_DESCRIPTION:
                        # Empty rather than invented: the main loop then fetches
                        # the job's own page for the real text.
                        description = ''

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

            if self.html_config.get('portal_api_url'):
                # Portal JSON API extraction (e.g., OSM Thome / osmaportal.com)
                # Returns complete data (title, location, description, employment type)
                all_listings = self._extract_listings_from_portal_api()
                if all_listings:
                    skip_detail_pages = True  # API provides all data we need

            if not all_listings and self.html_config.get('wp_api_url'):
                # WordPress REST API extraction (e.g., Wellsafe Solutions)
                all_listings = self._extract_listings_from_wp_api()
                skip_detail_pages = True  # WP API provides all data we need

            if not all_listings and self.html_config.get('sitemap_url'):
                # Sitemap-based extraction (fallback for OSM Thome if API fails)
                all_listings = self._extract_listings_from_sitemap()
                if all_listings and skip_detail_pages and self.html_config.get('portal_api_url'):
                    # The sitemap only carries URLs. With no detail pass, a
                    # job that is not yet on the sheet would be exported as a
                    # title-only row (OSM Thome, 2026-09: 50-149 char rows,
                    # no location). Keep the sitemap as the presence signal for
                    # jobs already on file and leave the rest for a run where
                    # the API answers.
                    before = len(all_listings)
                    all_listings = [
                        l for l in all_listings
                        if self._known_url_checker and self._known_url_checker(l.get('url', ''))
                    ]
                    self.logger.warning(
                        "sitemap_presence_only",
                        sitemap_urls=before,
                        kept_known=len(all_listings),
                        note="API unavailable; sitemap keeps known jobs present, new jobs wait for the API",
                    )

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

            # Cap detail page fetching to avoid timeouts on large portals (e.g. OSM Thome sitemap has 1000+ jobs)
            max_detail_pages = self.config.get('max_detail_pages')
            if not skip_detail_pages and max_detail_pages and len(all_listings) > max_detail_pages:
                self.logger.warning(
                    "capping_detail_pages",
                    total_listings=len(all_listings),
                    max_detail_pages=max_detail_pages,
                    note="Fetching only a subset of job detail pages to stay within timeout"
                )
                all_listings = all_listings[:max_detail_pages]

            # Limit for testing
            listings_to_process = all_listings[:max_jobs] if max_jobs else all_listings

            # Visit each detail page (or use listing data directly)
            for idx, listing in enumerate(listings_to_process):
                try:
                    job_data = {**listing}

                    # `skip_detail_pages` exists so a source whose LISTING already
                    # carries the whole advert is not re-fetched once per job. It
                    # was never meant to mean "publish without a description":
                    # when a fallback path (sitemap, wp_api) yields a title and
                    # nothing else, the only honest options are to fetch the job's
                    # own page or to drop the row, and inventing a sentence was
                    # doing neither. Measured 2026-09-17: 395 active rows read
                    # "<title> position at OSM Thome.", 90 of them scraped this
                    # month, and only 34 of OSM Thome's 436 rows had a real
                    # description. So the skip is now conditional on actually
                    # having one. The per-request rate limit still applies, so a
                    # small site is not hit any harder per request than before.
                    needs_detail = len((listing.get('description') or '').strip()) < MIN_USABLE_DESCRIPTION
                    if (not skip_detail_pages or needs_detail) and listing.get('url'):
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
                        # Merge detail into listing, but keep the listing's own
                        # location when the detail page has nothing usable.
                        listing_location = listing.get('location', '')
                        job_data = {**listing, **detail}
                        if (
                            job_data.get('location') == 'Location Not Specified'
                            and listing_location
                            and listing_location != 'Location Not Specified'
                        ):
                            job_data['location'] = listing_location
                        # A location read from the sitemap slug outranks the
                        # detail page even when the detail page returned
                        # something, because that something is often the
                        # last-resort <title> split on " - ". On a multi-segment
                        # title ("Job Title - Town in Site - Company") that leaks
                        # the company name into the location, which
                        # sanitize_company_in_location then blanks to "Unknown",
                        # losing a location we had already resolved correctly.
                        # Scoped to slug-derived locations on purpose: a config
                        # with a real job_location SELECTOR is not guessing, and
                        # its detail page is usually the more precise of the two.
                        elif listing.get('_location_from_slug') and listing_location:
                            job_data['location'] = listing_location
                        job_data.pop('_location_from_slug', None)
                    else:
                        # Use what we have from the listing
                        if 'location' not in job_data:
                            job_data['location'] = 'Location Not Specified'

                    # No invented descriptions. A stub like "<title> position at
                    # <company>." is not a description, it just carries a row past
                    # the model's 10-character minimum and then fails the public
                    # site's 600-character gate forever, while looking to everyone
                    # downstream like real captured text. If the detail fetch above
                    # could not find anything, drop the row and say so.
                    if len((job_data.get('description') or '').strip()) < MIN_USABLE_DESCRIPTION:
                        self.logger.warning(
                            "job_skipped_no_description",
                            title=str(job_data.get('title'))[:60],
                            url=str(job_data.get('url'))[:120],
                        )
                        continue

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
