"""HiBob career page scraper implementation.

Scrapes job listings from HiBob-powered career pages ({company}.careers.hibob.com).
These are Angular SPAs that render job listings client-side after fetching data
from authenticated internal APIs.

Used by: Dron & Dickson (drondickson.careers.hibob.com).

HiBob career pages are Angular SPAs served from front.hibob.com. The internal
API endpoints (/api/*) require authentication, so we use Playwright to render
the SPA and extract job data from the DOM.

URL patterns:
- Listings: https://{company}.careers.hibob.com/
- Job detail: https://{company}.careers.hibob.com/jobs/{uuid}
"""

import re
from datetime import datetime
from typing import Optional
from urllib.parse import urljoin

import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()


class HiBobScraper(BaseScraper):
    """
    Scraper for HiBob career pages.

    HiBob career pages are Angular SPAs that load job data via internal APIs
    after the page renders. Since the APIs require authentication, we use
    Playwright to render the SPA and extract job data from the DOM.

    The career page displays job cards with title, location, department,
    and employment type. Each card links to a detail page at /jobs/{uuid}.
    """

    def __init__(self, config: dict):
        """
        Initialize HiBob scraper.

        Args:
            config: Company config dict from companies.yaml with keys:
                - name: Company display name
                - base_url: Career portal URL (e.g., https://drondickson.careers.hibob.com)
                - hibob_config: Optional dict with careers_page, job_url_template
        """
        super().__init__(config)
        self.base_url = config.get('base_url', '').rstrip('/')
        self.selectors = config.get('selectors', {})
        self.hibob_config = config.get('hibob_config', {})
        self.job_url_template = self.hibob_config.get(
            'job_url_template',
            f"{self.base_url}/jobs/{{uuid}}"
        )

    def _build_absolute_url(self, url: str) -> str:
        """Convert relative URL to absolute using base_url."""
        if not url:
            return self.base_url
        if url.startswith('http'):
            return url
        return urljoin(self.base_url + '/', url)

    def _clean_html(self, html_text: Optional[str]) -> str:
        """Convert HTML to clean plain text."""
        if not html_text:
            return ""
        try:
            soup = BeautifulSoup(html_text, 'html.parser')
            for element in soup(['script', 'style', 'nav', 'header', 'footer']):
                element.decompose()
            clean_text = soup.get_text(separator='\n', strip=True)
            lines = [line.strip() for line in clean_text.split('\n') if line.strip()]
            return '\n'.join(lines)
        except Exception as e:
            self.logger.error("html_cleaning_failed", error=str(e))
            return html_text

    async def _wait_for_spa_render(self, page: Page, timeout: int = 20000) -> bool:
        """
        Wait for the HiBob Angular SPA to render job content.

        HiBob SPAs show a loading state initially, then render job cards
        after the Angular app hydrates and fetches data from APIs.

        Args:
            page: Playwright page instance
            timeout: Maximum wait time in milliseconds

        Returns:
            True if job content was detected, False otherwise
        """
        # Wait for Angular app to bootstrap
        try:
            await page.wait_for_load_state('load', timeout=15000)
        except Exception:
            pass

        # Try multiple selectors that HiBob career pages use for job cards
        job_selectors = [
            'a[href*="/jobs/"]',
            '[class*="position"]',
            '[class*="job-card"]',
            '[class*="job-list"]',
            '[class*="opening"]',
            '[class*="vacancy"]',
            '[data-testid*="position"]',
            '[data-testid*="job"]',
        ]

        for selector in job_selectors:
            try:
                await page.wait_for_selector(selector, timeout=timeout // len(job_selectors))
                self.logger.debug("job_content_found", selector=selector)
                return True
            except Exception:
                continue

        # Fallback: wait for loading indicators to disappear
        self.logger.debug("no_job_selector_found", note="Waiting for loading to complete")
        try:
            await page.wait_for_function(
                """() => {
                    const body = document.body.innerText;
                    return !body.includes('Loading') &&
                           body.length > 100 &&
                           document.querySelectorAll('a[href*="/jobs/"]').length > 0;
                }""",
                timeout=timeout
            )
            return True
        except Exception:
            pass

        # Last resort: give the SPA extra time to render
        await page.wait_for_timeout(5000)
        return False

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job listings from the HiBob career page DOM.

        HiBob career pages render job cards as clickable elements linking to
        /jobs/{uuid} detail pages. Each card typically shows title, location,
        department, and employment type.

        Args:
            page: Playwright page after SPA has rendered

        Returns:
            List of dicts with: title, url, company, location, employment_type
        """
        listings = []

        # Strategy 1: Find all links to /jobs/{uuid} pages
        job_links = page.locator('a[href*="/jobs/"]')
        link_count = await job_links.count()

        if link_count > 0:
            self.logger.info("job_links_found", count=link_count)

            for i in range(link_count):
                try:
                    link = job_links.nth(i)
                    href = await link.get_attribute('href') or ''

                    # Filter out non-job links (e.g., /jobs/ without UUID)
                    if not href or not re.search(r'/jobs/[a-f0-9-]{8,}', href):
                        continue

                    url = self._build_absolute_url(href)

                    # Get the card text content
                    card_text = (await link.inner_text(timeout=5000)).strip()
                    if not card_text or len(card_text) < 3:
                        continue

                    # Parse card content: typically title is first line,
                    # followed by metadata (location, department, type)
                    lines = [l.strip() for l in card_text.split('\n') if l.strip()]
                    if not lines:
                        continue

                    title = lines[0]

                    # Skip navigation/utility links
                    if any(skip in title.lower() for skip in [
                        'apply', 'back', 'home', 'login', 'sign',
                        'cookie', 'privacy', 'terms',
                    ]):
                        continue

                    # Extract metadata from remaining lines
                    location = ''
                    employment_type = ''
                    department = ''

                    for line in lines[1:]:
                        line_lower = line.lower().strip()

                        # Employment type detection
                        if line_lower in (
                            'full-time', 'full time', 'part-time', 'part time',
                            'contract', 'contractor', 'temporary', 'permanent',
                            'internship', 'freelance',
                        ):
                            employment_type = line.strip()
                            continue

                        # Skip company name
                        if line.strip() == self.company_name:
                            continue

                        # Location heuristic: contains geographic indicators
                        if not location and len(line) < 100:
                            # Check for common location patterns
                            if any(kw in line_lower for kw in [
                                'remote', 'hybrid', 'onsite', 'office',
                                'uk', 'us', 'aberdeen', 'london', 'houston',
                                ',',  # "City, Country" pattern
                            ]):
                                location = line.strip()
                                continue

                        # If no location yet and line looks geographic (short, no action words)
                        if not location and len(line) < 80 and not any(
                            kw in line_lower for kw in [
                                'apply', 'view', 'posted', 'ago', 'department',
                                'description', 'requirements',
                            ]
                        ):
                            location = line.strip()

                    listing = {
                        'title': title,
                        'url': url,
                        'company': self.company_name,
                        'location': location or 'Location Not Specified',
                    }
                    if employment_type:
                        listing['employment_type'] = self._normalize_employment_type(employment_type)

                    listings.append(listing)

                except Exception as e:
                    self.logger.debug("link_extraction_failed", index=i, error=str(e))
                    continue

        # Strategy 2: If no job links found, try broader card-based extraction
        if not listings:
            self.logger.debug("no_job_links", note="Trying card-based extraction")
            listings = await self._extract_from_cards(page)

        # Deduplicate by URL
        seen = set()
        unique = []
        for listing in listings:
            key = listing.get('url', listing['title'])
            if key not in seen:
                seen.add(key)
                unique.append(listing)

        self.logger.info("unique_listings_extracted", count=len(unique))
        return unique

    async def _extract_from_cards(self, page: Page) -> list[dict]:
        """
        Fallback extraction using generic card/container selectors.

        Used when no /jobs/{uuid} links are found directly.

        Args:
            page: Playwright page instance

        Returns:
            List of job listing dicts
        """
        listings = []

        card_selectors = [
            self.selectors.get('job_card', ''),
            '[class*="position-card"]',
            '[class*="job-card"]',
            '[class*="opening-card"]',
            '[class*="vacancy"]',
        ]

        for selector in [s for s in card_selectors if s]:
            try:
                cards = page.locator(selector)
                count = await cards.count()
                if count == 0:
                    continue

                self.logger.info("card_elements_found", count=count, selector=selector)

                for i in range(count):
                    try:
                        card = cards.nth(i)
                        text = (await card.inner_text(timeout=5000)).strip()
                        if not text or len(text) < 3:
                            continue

                        # Try to find a link within the card
                        url = ''
                        try:
                            link = card.locator('a').first
                            if await link.count() > 0:
                                url = await link.get_attribute('href') or ''
                                url = self._build_absolute_url(url) if url else ''
                        except Exception:
                            pass

                        lines = [l.strip() for l in text.split('\n') if l.strip()]
                        title = lines[0] if lines else text[:100]

                        listing = {
                            'title': title,
                            'url': url or self.base_url,
                            'company': self.company_name,
                            'location': 'Location Not Specified',
                        }
                        listings.append(listing)

                    except Exception as e:
                        self.logger.debug("card_extraction_failed", index=i, error=str(e))
                        continue

                if listings:
                    break

            except Exception:
                continue

        return listings

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from a HiBob job detail page.

        HiBob job detail pages (/jobs/{uuid}) show the full job description,
        requirements, location, employment type, and department.

        Args:
            page: Playwright page instance
            job_url: URL of job detail page

        Returns:
            Dict with job detail fields (description, location, employment_type, etc.)
        """
        self.logger.info("fetching_job_detail", url=job_url)

        try:
            await page.goto(job_url, wait_until='domcontentloaded', timeout=30000)
        except Exception as e:
            self.logger.error("detail_page_load_failed", url=job_url, error=str(e))
            return {}

        # Wait for the detail content to render
        try:
            await page.wait_for_load_state('load', timeout=15000)
        except Exception:
            pass

        # Wait for description content to appear
        detail_selectors = [
            '[class*="description"]',
            '[class*="Description"]',
            '[class*="job-content"]',
            '[class*="position-detail"]',
            'article',
            'main',
        ]

        for selector in detail_selectors:
            try:
                await page.wait_for_selector(selector, timeout=8000)
                break
            except Exception:
                continue
        else:
            # No selector matched; give the SPA extra render time
            await page.wait_for_timeout(3000)

        detail = {
            'description': '',
            'location': '',
            'employment_type': None,
            'posted_date': None,
            'department': '',
        }

        # Extract description
        desc_selectors = [
            self.selectors.get('description', ''),
            '[class*="description"]',
            '[class*="Description"]',
            '[class*="job-content"]',
            '[class*="position-content"]',
            'article',
            'main',
        ]

        for selector in [s for s in desc_selectors if s]:
            try:
                elem = page.locator(selector).first
                if await elem.count() > 0:
                    html_content = await elem.inner_html(timeout=10000)
                    text = self._clean_html(html_content)
                    if text and len(text) > 50:
                        detail['description'] = text
                        break
            except Exception:
                continue

        # If no description from specific selectors, get full page text
        if not detail['description']:
            try:
                body_html = await page.inner_html('body', timeout=10000)
                text = self._clean_html(body_html)
                if text and len(text) > 50:
                    detail['description'] = text
            except Exception:
                pass

        # Extract location from detail page
        loc_selectors = [
            self.selectors.get('location', ''),
            '[class*="location"]',
            '[class*="Location"]',
            '[data-testid*="location"]',
        ]
        for selector in [s for s in loc_selectors if s]:
            try:
                elem = page.locator(selector).first
                if await elem.count() > 0:
                    text = (await elem.inner_text(timeout=3000)).strip()
                    if text and len(text) < 100:
                        detail['location'] = text
                        break
            except Exception:
                continue

        # Extract employment type from detail page
        type_selectors = [
            self.selectors.get('employment_type', ''),
            '[class*="employment"]',
            '[class*="job-type"]',
            '[class*="type"]',
        ]
        for selector in [s for s in type_selectors if s]:
            try:
                elem = page.locator(selector).first
                if await elem.count() > 0:
                    text = (await elem.inner_text(timeout=3000)).strip()
                    if text and len(text) < 50:
                        normalized = self._normalize_employment_type(text)
                        if normalized:
                            detail['employment_type'] = normalized
                            break
            except Exception:
                continue

        return detail

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Main entry point: extract all jobs from a HiBob career page.

        Process:
        1. Launch Playwright and navigate to the career page
        2. Wait for Angular SPA to render job listings
        3. Extract job listing metadata from the DOM
        4. Visit each job detail page for full descriptions
        5. Validate through JobPosting model and enrich with certifications

        Args:
            max_jobs: Optional limit for testing (extract only first N jobs)

        Returns:
            List of validated JobPosting objects
        """
        jobs = []
        context = None

        self.logger.info(
            "extraction_start",
            company=self.company_name,
            base_url=self.base_url,
            max_jobs=max_jobs,
        )

        try:
            context = await self._get_browser_context()
            page = await context.new_page()

            # Navigate to career page
            self.logger.info("navigating_to_careers", url=self.base_url)
            try:
                await page.goto(self.base_url, wait_until='domcontentloaded', timeout=30000)
            except Exception as e:
                self.logger.error("page_load_failed", url=self.base_url, error=str(e))
                return []

            # Wait for the Angular SPA to render
            content_found = await self._wait_for_spa_render(page)
            if not content_found:
                self.logger.warning("spa_render_timeout", url=self.base_url)
                # Continue anyway - content may have partially loaded

            # Extract job listings from the DOM
            all_listings = await self.extract_job_listings(page)

            if not all_listings:
                self.logger.warning("no_jobs_found", url=self.base_url)
                return []

            self.logger.info("total_listings_found", count=len(all_listings))

            listings_to_process = all_listings[:max_jobs] if max_jobs else all_listings

            for idx, listing in enumerate(listings_to_process):
                try:
                    job_data = {**listing}

                    # Fetch detail page if we have a job-specific URL
                    detail_url = listing.get('url', '')
                    has_detail_page = (
                        detail_url
                        and detail_url != self.base_url
                        and '/jobs/' in detail_url
                    )

                    if has_detail_page:
                        if idx > 0:
                            await self._rate_limit()

                        detail = await self.extract_job_detail(page, detail_url)

                        # Merge detail data (don't overwrite listing data with empty values)
                        if detail.get('description'):
                            job_data['description'] = detail['description']
                        if detail.get('location'):
                            job_data['location'] = detail['location']
                        if detail.get('employment_type'):
                            job_data['employment_type'] = detail['employment_type']
                        if detail.get('posted_date'):
                            job_data['posted_date'] = detail['posted_date']

                    # Ensure minimum required fields
                    if not job_data.get('description') or len(job_data.get('description', '')) < 10:
                        job_data['description'] = (
                            f"{job_data['title']} position at {self.company_name}."
                        )
                    if not job_data.get('location'):
                        job_data['location'] = 'Location Not Specified'

                    # Enrich with certifications
                    job_data = self._enrich_with_certifications(job_data)

                    # Enrich with contacts if configured
                    if self.config.get('extract_contacts', False):
                        job_data = self._enrich_with_contacts(job_data)

                    # Validate through Pydantic model
                    posting = JobPosting(**job_data)
                    jobs.append(posting)

                    self.logger.debug(
                        "job_extracted",
                        job_num=idx + 1,
                        title=posting.title,
                        location=posting.location,
                    )

                except ValidationError as e:
                    self.logger.error(
                        "validation_failed",
                        job_num=idx + 1,
                        error=str(e),
                        title=listing.get('title'),
                    )
                    continue
                except Exception as e:
                    self.logger.error(
                        "job_extraction_failed",
                        job_num=idx + 1,
                        error=str(e),
                        title=listing.get('title'),
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
