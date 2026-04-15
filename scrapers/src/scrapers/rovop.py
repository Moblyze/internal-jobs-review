"""ROVOP custom ASP.NET career portal scraper implementation.

This scraper extracts jobs from ROVOP's custom career portal at jobs.rovop.com,
which runs on an ASP.NET-based system (not a known ATS platform like Workday,
Taleo, or SuccessFactors).

Used by: ROVOP (global ROV specialist, Edison Chouest subsidiary).

Strategy:
1. Navigate to jobs.rovop.com/jobs.aspx with Playwright (server-rendered HTML)
2. Extract job listing cards from the main listings page
3. Visit each job detail page at /job/{slug}-{id}.aspx for full descriptions
4. Parse HTML content for title, location, description, employment type
5. Handle pagination if present (load more / page links)

URL patterns:
- Listings: https://jobs.rovop.com/jobs.aspx
- Detail:   https://jobs.rovop.com/job/{title-slug}-{numeric-id}.aspx
- Login:    https://jobs.rovop.com/login.aspx
- Register: https://jobs.rovop.com/register.aspx
"""

import re
from typing import Optional
from urllib.parse import urljoin

import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()


class ROVOPScraper(BaseScraper):
    """
    Scraper for ROVOP's custom ASP.NET career portal.

    ROVOP (jobs.rovop.com) uses a custom-built ASP.NET recruitment site
    with server-rendered HTML pages. There is no known public API or RSS feed,
    so we use Playwright browser automation for extraction.

    The site structure:
    - Main listing page at /jobs.aspx shows all open positions
    - Each job links to /job/{slug}-{id}.aspx with full details
    - Jobs include ROV Pilot Technicians, Senior Pilot Technicians,
      Trainee Pilot Technicians, Tooling Technicians, etc.
    """

    # Base URL for the career site
    BASE_URL = "https://jobs.rovop.com"

    def __init__(self, config: dict):
        """
        Initialize ROVOP scraper with company configuration.

        Args:
            config: Company config dict from companies.yaml.
        """
        super().__init__(config)
        self.base_url = config.get('base_url', f"{self.BASE_URL}/jobs.aspx")

    def _build_absolute_url(self, relative_url: str) -> str:
        """
        Convert a relative URL to absolute using the ROVOP base URL.

        Args:
            relative_url: Relative URL path (e.g., "/job/rov-pilot-technician-36.aspx")

        Returns:
            Full absolute URL
        """
        if relative_url.startswith('http'):
            return relative_url
        return urljoin(self.BASE_URL, relative_url)

    def _extract_job_id_from_url(self, url: str) -> Optional[str]:
        """
        Extract numeric job ID from ROVOP job URL.

        ROVOP URLs follow the pattern: /job/{title-slug}-{id}.aspx
        Example: /job/rov-pilot-technician-36.aspx -> "36"

        Args:
            url: Job URL (relative or absolute)

        Returns:
            Numeric job ID string or None
        """
        match = re.search(r'-(\d+)\.aspx', url)
        return match.group(1) if match else None

    def clean_html_description(self, html_text: Optional[str]) -> str:
        """
        Convert HTML description to clean plain text.

        Args:
            html_text: HTML description string

        Returns:
            Clean plain text description
        """
        if not html_text:
            return ""

        try:
            soup = BeautifulSoup(html_text, 'html.parser')

            # Get text with newlines between block elements
            clean_text = soup.get_text(separator='\n', strip=True)

            # Remove excess blank lines
            lines = [line.strip() for line in clean_text.split('\n') if line.strip()]
            clean_text = '\n'.join(lines)

            return clean_text

        except Exception as e:
            self.logger.error("html_cleaning_failed", error=str(e))
            return html_text

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job listing data from the main jobs.aspx page.

        The ROVOP jobs page renders job cards as HTML elements. This method
        attempts multiple selector strategies to find job links, since the
        exact HTML structure isn't known without direct page access.

        Selector strategies (tried in order):
        1. Links within common job list containers (table rows, list items, divs)
        2. Links containing "/job/" in their href attribute
        3. Any anchor tags with href matching the /job/*.aspx pattern

        Args:
            page: Playwright page showing job listings

        Returns:
            List of dicts with: title, url, company, requisition_id
        """
        listings = []

        # Strategy: Find all links that point to job detail pages
        # ROVOP job URLs follow: /job/{slug}-{id}.aspx
        job_links = page.locator('a[href*="/job/"]')
        count = await job_links.count()

        self.logger.info("job_links_found", count=count, strategy="href_contains_job")

        # First, try Firefish card-based extraction (ROVOP's actual platform)
        # Each job is a div.card--job with title in .card__title and location
        # in li[id*="liLocation"]
        cards = page.locator('div.card.card--job')
        card_count = await cards.count()

        if card_count > 0:
            self.logger.info("firefish_cards_found", count=card_count)
            for i in range(card_count):
                try:
                    card = cards.nth(i)

                    # Extract title from .card__title
                    title_elem = card.locator('.card__title').first
                    title = ''
                    if await title_elem.count() > 0:
                        title = (await title_elem.inner_text(timeout=3000)).strip()

                    # Extract URL from the card link
                    link_elem = card.locator('a.card__full-card-link').first
                    href = ''
                    link_title = ''
                    if await link_elem.count() > 0:
                        href = await link_elem.get_attribute('href') or ''
                        link_title = await link_elem.get_attribute('title') or ''
                        if not title:
                            title = (await link_elem.inner_text(timeout=3000)).strip()

                    if not title or len(title) < 3:
                        continue

                    # Extract location from li[id*="liLocation"] within card
                    location = ''
                    loc_elem = card.locator('li[id*="liLocation"]').first
                    if await loc_elem.count() > 0:
                        location = (await loc_elem.inner_text(timeout=3000)).strip()

                    # Fallback: extract location from link title attribute
                    # Format: "Job Title in Location"
                    if not location and link_title and ' in ' in link_title:
                        location = link_title.split(' in ')[-1].strip()

                    job_id = self._extract_job_id_from_url(href)

                    listing = {
                        'title': title,
                        'url': self._build_absolute_url(href),
                        'company': self.company_name,
                        'requisition_id': job_id,
                    }
                    if location:
                        listing['location'] = location

                    listings.append(listing)

                except Exception as e:
                    self.logger.debug("card_extraction_failed", index=i, error=str(e))
                    continue

        elif count == 0:
            # Fallback: Try broader selectors
            # Look for any link with .aspx in href that's not a system page
            all_links = page.locator('a[href$=".aspx"]')
            all_count = await all_links.count()
            self.logger.info("all_aspx_links_found", count=all_count)

            for i in range(all_count):
                try:
                    link = all_links.nth(i)
                    href = await link.get_attribute('href') or ''
                    # Filter to job detail pages only
                    if '/job/' in href and href not in ('/jobs.aspx', '/login.aspx', '/register.aspx'):
                        title = (await link.inner_text()).strip()
                        if title and len(title) > 2:
                            job_id = self._extract_job_id_from_url(href)
                            listings.append({
                                'title': title,
                                'url': self._build_absolute_url(href),
                                'company': self.company_name,
                                'requisition_id': job_id,
                            })
                except Exception as e:
                    self.logger.debug("link_extraction_failed", index=i, error=str(e))
                    continue
        else:
            for i in range(count):
                try:
                    link = job_links.nth(i)
                    href = await link.get_attribute('href') or ''
                    title = (await link.inner_text()).strip()

                    # Skip empty titles or navigation links
                    if not title or len(title) < 3:
                        continue

                    # Skip duplicate/navigation links (like "Apply" buttons pointing to same job)
                    if any(skip in title.lower() for skip in ['apply', 'login', 'register', 'back']):
                        continue

                    job_id = self._extract_job_id_from_url(href)

                    # Try to get location from link title attribute
                    link_title = await link.get_attribute('title') or ''
                    location = ''
                    if link_title and ' in ' in link_title:
                        location = link_title.split(' in ')[-1].strip()

                    listing = {
                        'title': title,
                        'url': self._build_absolute_url(href),
                        'company': self.company_name,
                        'requisition_id': job_id,
                    }
                    if location:
                        listing['location'] = location

                    listings.append(listing)

                except Exception as e:
                    self.logger.debug("link_extraction_failed", index=i, error=str(e))
                    continue

        # Deduplicate by URL (same job may appear in multiple link elements)
        seen_urls = set()
        unique_listings = []
        for listing in listings:
            if listing['url'] not in seen_urls:
                seen_urls.add(listing['url'])
                unique_listings.append(listing)

        self.logger.info("unique_listings_extracted", count=len(unique_listings))
        return unique_listings

    async def _try_extract_location(self, page: Page) -> str:
        """
        Try multiple selectors to extract job location from a detail page.

        ROVOP uses a Firefish-powered career site with specific CSS classes:
        - li.job-details__location on detail pages
        - li[id*="liLocation"] (ASP.NET generated IDs)
        - JSON-LD structured data with jobLocation

        Args:
            page: Playwright page showing job detail

        Returns:
            Location string or "Location Not Specified"
        """
        location_selectors = [
            # Firefish-specific selectors (ROVOP's actual platform)
            'li.job-details__location',
            'li[id*="liLocation"]',
            # Card listing selectors (also used on detail pages)
            'li.card-color--text:has(i[title="Location"])',
            # Common ASP.NET/custom ATS patterns
            '.job-location',
            '.location',
            '[class*="location"]',
            '[class*="Location"]',
            '[id*="location"]',
            '[id*="Location"]',
            # Data attribute patterns
            '[data-field="location"]',
            # Schema.org
            '[itemprop="jobLocation"]',
            '[itemprop="addressLocality"]',
            # Table-based layouts (common in ASP.NET)
            'td:has-text("Location") + td',
            'th:has-text("Location") + td',
            'dt:has-text("Location") + dd',
            # Label patterns
            'span:has-text("Location") + span',
            'label:has-text("Location") + span',
        ]

        for selector in location_selectors:
            try:
                elem = page.locator(selector).first
                if await elem.count() > 0:
                    text = await elem.inner_text(timeout=3000)
                    text = text.strip()
                    # Filter out the label itself if captured
                    if text and text.lower() not in ('location', 'location:'):
                        # Remove "Location:" prefix if present
                        text = re.sub(r'^location\s*:\s*', '', text, flags=re.IGNORECASE).strip()
                        if text:
                            self.logger.debug("location_found", selector=selector, location=text)
                            return text
            except Exception:
                continue

        # Fallback: try extracting from JSON-LD structured data
        try:
            json_ld_scripts = page.locator('script[type="application/ld+json"]')
            count = await json_ld_scripts.count()
            for i in range(count):
                try:
                    import json
                    content = await json_ld_scripts.nth(i).inner_text(timeout=3000)
                    data = json.loads(content)
                    if isinstance(data, dict):
                        job_location = data.get('jobLocation', {})
                        if isinstance(job_location, dict):
                            address = job_location.get('address', {})
                            if isinstance(address, dict):
                                parts = []
                                locality = address.get('addressLocality', '')
                                region = address.get('addressRegion', '')
                                country = address.get('addressCountry', '')
                                if locality:
                                    parts.append(locality)
                                if region:
                                    parts.append(region)
                                if country:
                                    parts.append(country)
                                if parts:
                                    location = ', '.join(parts)
                                    self.logger.debug("location_from_jsonld", location=location)
                                    return location
                except Exception:
                    continue
        except Exception:
            pass

        # Fallback: try extracting from link title attribute
        # ROVOP listing links have title="Job Title in Location"
        try:
            page_title = await page.title()
            if page_title and ' in ' in page_title:
                # Pattern: "Job Title in Location"
                location = page_title.split(' in ')[-1].strip()
                if location and len(location) < 50:
                    self.logger.debug("location_from_title", location=location)
                    return location
        except Exception:
            pass

        return "Location Not Specified"

    async def _try_extract_employment_type(self, page: Page) -> Optional[str]:
        """
        Try to extract employment type from job detail page.

        Args:
            page: Playwright page showing job detail

        Returns:
            Normalized employment type or None
        """
        type_selectors = [
            '.job-type',
            '.employment-type',
            '[class*="type"]',
            '[class*="contract"]',
            '[itemprop="employmentType"]',
            'td:has-text("Type") + td',
            'dt:has-text("Type") + dd',
            'td:has-text("Contract") + td',
            'dt:has-text("Contract") + dd',
        ]

        for selector in type_selectors:
            try:
                elem = page.locator(selector).first
                if await elem.count() > 0:
                    text = await elem.inner_text(timeout=3000)
                    text = text.strip()
                    if text and len(text) < 50:  # Reasonable length for an employment type
                        normalized = self._normalize_employment_type(text)
                        if normalized:
                            return normalized
            except Exception:
                continue

        return None

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from a ROVOP job detail page.

        Navigates to the job URL and extracts description, location,
        and employment type using multiple selector strategies.

        Args:
            page: Playwright page instance
            job_url: URL of job detail page

        Returns:
            Dict with: description, location, posted_date, skills, salary,
                       employment_type
        """
        await self._fetch_page(page, job_url)

        detail = {
            'description': '',
            'location': 'Location Not Specified',
            'posted_date': None,
            'skills': [],
            'salary': None,
            'employment_type': None,
        }

        # Extract description - try multiple selectors
        description_selectors = [
            '.job-description',
            '.description',
            '[class*="description"]',
            '[class*="Description"]',
            '[id*="description"]',
            '[id*="Description"]',
            '[itemprop="description"]',
            'div[name="description"]',
            # ASP.NET content areas
            '.content-area',
            '.job-content',
            '.job-detail',
            '[class*="detail"]',
            '[class*="content"]',
            # Generic main content
            'main',
            '#content',
            '.main-content',
        ]

        for selector in description_selectors:
            try:
                elem = page.locator(selector).first
                if await elem.count() > 0:
                    html_content = await elem.inner_html(timeout=10000)
                    text = self.clean_html_description(html_content)
                    # Minimum viable description
                    if text and len(text) > 50:
                        detail['description'] = text
                        self.logger.debug("description_found", selector=selector, length=len(text))
                        break
            except Exception:
                continue

        # If no description found via selectors, try getting the full page body
        if not detail['description'] or len(detail['description']) < 50:
            try:
                body_html = await page.locator('body').inner_html()
                body_text = self.clean_html_description(body_html)
                if body_text and len(body_text) > 100:
                    detail['description'] = body_text
                    self.logger.info("description_from_body", length=len(body_text))
            except Exception as e:
                self.logger.warning("body_extraction_failed", url=job_url, error=str(e))

        # Extract location
        detail['location'] = await self._try_extract_location(page)

        # Extract employment type
        detail['employment_type'] = await self._try_extract_employment_type(page)

        # Infer employment type from title/description if not found
        if not detail['employment_type'] and detail.get('description'):
            desc_lower = detail['description'].lower()
            if 'permanent' in desc_lower:
                detail['employment_type'] = 'Full-Time'
            elif 'contract' in desc_lower and 'contractor' not in desc_lower:
                detail['employment_type'] = 'Contractor'
            elif 'ad-hoc' in desc_lower or 'ad hoc' in desc_lower:
                detail['employment_type'] = 'Contractor'

        return detail

    async def _handle_pagination(self, page: Page) -> None:
        """
        Handle pagination on the jobs listing page.

        The ROVOP site may use pagination links, a "load more" button,
        or show all jobs on a single page. This method tries common patterns.

        Args:
            page: Playwright page showing job listings
        """
        max_pages = 10  # Safety limit

        for page_num in range(max_pages):
            # Check for "load more" button
            load_more_selectors = [
                'button:has-text("Load More")',
                'a:has-text("Load More")',
                'button:has-text("Show More")',
                'a:has-text("Show More")',
                '.load-more',
                '.show-more',
                '[class*="load-more"]',
                '[class*="show-more"]',
            ]

            clicked = False
            for selector in load_more_selectors:
                try:
                    btn = page.locator(selector).first
                    if await btn.count() > 0 and await btn.is_visible(timeout=2000):
                        await btn.click()
                        await page.wait_for_load_state('networkidle', timeout=10000)
                        await self._rate_limit()
                        clicked = True
                        self.logger.info("load_more_clicked", page=page_num + 2)
                        break
                except Exception:
                    continue

            if not clicked:
                # Check for page number links
                next_selectors = [
                    'a:has-text("Next")',
                    'a:has-text(">")',
                    '.pagination a:last-child',
                    'a[rel="next"]',
                    '.pager .next a',
                ]

                for selector in next_selectors:
                    try:
                        next_btn = page.locator(selector).first
                        if await next_btn.count() > 0 and await next_btn.is_visible(timeout=2000):
                            await next_btn.click()
                            await page.wait_for_load_state('networkidle', timeout=10000)
                            await self._rate_limit()
                            clicked = True
                            self.logger.info("next_page_clicked", page=page_num + 2)
                            break
                    except Exception:
                        continue

            if not clicked:
                self.logger.info("pagination_complete", pages_loaded=page_num + 1)
                break

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs from ROVOP career portal using Playwright.

        This is the main entry point. Uses browser automation since
        ROVOP's custom ASP.NET site has no public API or RSS feed.

        Process:
        1. Navigate to jobs.aspx listing page
        2. Handle pagination to load all jobs
        3. Extract job card data (title, URL, ID)
        4. Visit each job detail page for full description
        5. Validate through JobPosting model
        6. Enrich with certifications

        Args:
            max_jobs: Optional limit for testing (extract only first N jobs)

        Returns:
            List of validated JobPosting objects
        """
        jobs = []
        context = None

        self.logger.info("extraction_start", company=self.company_name, max_jobs=max_jobs)

        try:
            context = await self._get_browser_context()
            page = await context.new_page()

            # Navigate to main listings page
            await self._fetch_page(page, self.base_url)

            # Wait for page content to load
            try:
                await page.wait_for_load_state('networkidle', timeout=15000)
            except Exception:
                self.logger.warning("networkidle_timeout", note="Continuing with current page state")

            # Handle pagination to load all available jobs
            await self._handle_pagination(page)

            # Extract all job listings from the page
            all_listings = await self.extract_job_listings(page)

            if not all_listings:
                self.logger.warning("no_jobs_found", url=self.base_url)
                return []

            self.logger.info("total_listings_found", count=len(all_listings))

            # Limit to max_jobs if specified
            listings_to_process = all_listings[:max_jobs] if max_jobs else all_listings

            # Visit each job detail page
            for idx, listing in enumerate(listings_to_process):
                try:
                    if idx > 0:
                        await self._rate_limit()

                    self.logger.debug("extracting_detail", job_num=idx + 1, url=listing['url'])

                    # Get full details from the job page
                    detail = await self.extract_job_detail(page, listing['url'])

                    # Merge listing data with detail data, preserving listing-level
                    # location if detail page returned "Location Not Specified"
                    listing_location = listing.get('location', '')
                    job_data = {**listing, **detail}
                    if (
                        job_data.get('location') == 'Location Not Specified'
                        and listing_location
                        and listing_location != 'Location Not Specified'
                    ):
                        job_data['location'] = listing_location

                    # Ensure minimum description
                    if not job_data.get('description') or len(job_data['description']) < 10:
                        job_data['description'] = f"{job_data['title']} position at ROVOP."

                    # Enrich with certifications
                    job_data = self._enrich_with_certifications(job_data)
                    if self.config.get('extract_contacts', False):
                        job_data = self._enrich_with_contacts(job_data)

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
            return jobs  # Return partial results if available

        finally:
            if context:
                await self._close_browser()
