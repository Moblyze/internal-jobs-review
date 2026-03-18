"""Occupop / Cezanne Recruitment career page scraper.

Scrapes job listings from Occupop-powered career pages (*.occupop-careers.com).
These are React SPAs that render job listings client-side, so Playwright is
required for JavaScript execution.

Used by: Sulmara (sulmara.occupop-careers.com).

The Occupop platform renders a React app with MUI components. Job listings
appear as cards or list items after the initial SPA hydration. The page context
includes a companyKey that identifies the tenant.

URL patterns:
- Listings: https://{company}.occupop-careers.com/
- Job detail: https://{company}.occupop-careers.com/jobs/{job-slug}
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


class OccupopScraper(BaseScraper):
    """
    Scraper for Occupop / Cezanne Recruitment career pages.

    Occupop career pages are React SPAs that require JavaScript rendering.
    The app loads job data via Apollo GraphQL and renders MUI (Material UI)
    components. The initial HTML only shows a loading spinner.
    """

    def __init__(self, config: dict):
        """
        Initialize Occupop scraper.

        Args:
            config: Company config dict with base_url pointing to
                    the *.occupop-careers.com domain.
        """
        super().__init__(config)
        self.base_url = config.get('base_url', '')
        self.selectors = config.get('selectors', {})

    async def _fetch_page(self, page, url: str) -> None:
        """
        Override base _fetch_page to use 'domcontentloaded' instead of 'networkidle'.

        Occupop/Cezanne Recruitment SPAs never reach network idle because they
        maintain active WebSocket/polling connections for real-time updates.
        Using 'domcontentloaded' allows us to proceed once the DOM is ready,
        then wait for React hydration separately.
        """
        self.logger.info("fetching_page", url=url)
        await page.goto(url, wait_until='domcontentloaded', timeout=30000)

    def _build_absolute_url(self, url: str) -> str:
        """Convert relative URL to absolute."""
        if not url:
            return self.base_url
        if url.startswith('http'):
            return url
        return urljoin(self.base_url, url)

    def _clean_html(self, html_text: Optional[str]) -> str:
        """Convert HTML to clean plain text."""
        if not html_text:
            return ""
        try:
            soup = BeautifulSoup(html_text, 'html.parser')
            for element in soup(['script', 'style', 'nav']):
                element.decompose()
            clean_text = soup.get_text(separator='\n', strip=True)
            lines = [line.strip() for line in clean_text.split('\n') if line.strip()]
            return '\n'.join(lines)
        except Exception as e:
            self.logger.error("html_cleaning_failed", error=str(e))
            return html_text

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job listings from the Occupop / Cezanne Recruitment React SPA.

        These portals render jobs as clickable cards/list items with links to
        detail pages. The SPA uses Apollo GraphQL to fetch job data after
        initial page load.

        Args:
            page: Playwright page after SPA has hydrated

        Returns:
            List of dicts with: title, url, company, location
        """
        listings = []

        # Strategy 1: Look for MUI job card containers with H3 title elements.
        # Cezanne Recruitment renders jobs as MuiBox-root divs containing:
        # H3 (title), P (type), DIV (details: company, location, date, category), HR
        h3_elements = page.locator('.job-listing__container h3, [class*="job-listing"] h3')
        h3_count = await h3_elements.count()

        if h3_count == 0:
            # Broader search: any H3 inside the main content area
            # that looks like a job title (not navigation/header)
            h3_elements = page.locator('#page-view h3')
            h3_count = await h3_elements.count()

        if h3_count > 0:
            self.logger.info("job_h3_elements_found", count=h3_count)
            for i in range(h3_count):
                try:
                    h3 = h3_elements.nth(i)
                    title = (await h3.inner_text(timeout=3000)).strip()

                    if not title or len(title) < 3:
                        continue

                    # Skip non-job headings
                    if any(skip in title.lower() for skip in [
                        'loading', 'are you ready', 'job listing',
                        'cookie', 'privacy', '404',
                    ]):
                        continue

                    # Get the parent container for location/type info
                    parent = h3.locator('..')
                    parent_text = ''
                    try:
                        parent_text = (await parent.inner_text(timeout=3000)).strip()
                    except Exception:
                        pass

                    lines = [l.strip() for l in parent_text.split('\n') if l.strip()]

                    # Parse card structure: title, type, company, location, date, category
                    employment_type = ''
                    location = ''
                    for line in lines[1:]:
                        line_lower = line.lower()
                        if line_lower in ('full-time', 'part-time', 'contract', 'temporary', 'permanent', 'internship'):
                            employment_type = line
                        elif line == self.company_name:
                            continue
                        elif len(line) < 80 and not any(kw in line_lower for kw in [
                            'apply', 'view', 'posted', 'ago', '202', 'commercial',
                            'energy', 'risk', 'quality', 'marketing'
                        ]):
                            if not location:
                                location = line

                    listing = {
                        'title': title,
                        'url': self.base_url,
                        'company': self.company_name,
                        'description': parent_text or f"{title} position at {self.company_name}.",
                    }
                    if location:
                        listing['location'] = location
                    if employment_type:
                        listing['employment_type'] = self._normalize_employment_type(employment_type)

                    listings.append(listing)

                except Exception as e:
                    self.logger.debug("h3_extraction_failed", index=i, error=str(e))
                    continue

            if listings:
                # Deduplicate and return
                seen = set()
                unique = []
                for listing in listings:
                    key = listing['title']
                    if key not in seen:
                        seen.add(key)
                        unique.append(listing)
                self.logger.info("unique_listings_extracted", count=len(unique))
                return unique

        # Strategy 2: Try anchor-based selectors (original approach)
        card_selector = self.selectors.get('job_card', '')
        selectors_to_try = [card_selector] if card_selector else []
        selectors_to_try.extend([
            'a[href*="/jobs/"]',
            'a[href*="/job/"]',
            '[class*="job-card"]',
            '[class*="JobCard"]',
            '[class*="jobCard"]',
            '[class*="vacancy"]',
            '[class*="position"]',
            '[class*="VacancyCard"]',
            '[class*="vacancyCard"]',
            '.MuiCard-root',
            '.MuiPaper-root a[href*="/jobs/"]',
            '.MuiPaper-root a[href*="/job/"]',
        ])

        for selector in selectors_to_try:
            if not selector:
                continue
            try:
                cards = page.locator(selector)
                count = await cards.count()
                if count == 0:
                    continue

                self.logger.info("job_elements_found", count=count, selector=selector)

                for i in range(count):
                    try:
                        card = cards.nth(i)
                        text = (await card.inner_text(timeout=5000)).strip()

                        if not text or len(text) < 3:
                            continue

                        # Get URL
                        url = ''
                        tag = await card.evaluate("el => el.tagName.toLowerCase()")
                        if tag == 'a':
                            url = await card.get_attribute('href') or ''
                        else:
                            try:
                                link = card.locator('a').first
                                if await link.count() > 0:
                                    url = await link.get_attribute('href') or ''
                            except Exception:
                                pass

                        # Title is typically the first line
                        lines = [l.strip() for l in text.split('\n') if l.strip()]
                        title = lines[0] if lines else text[:100]

                        # Location might be in the card text
                        location = ''
                        for line in lines[1:]:
                            # Occupop often shows location as a secondary line
                            if any(kw in line.lower() for kw in ['remote', 'hybrid', 'onsite', 'office']):
                                location = line
                                break
                            # Or it's just the second line (location is common pattern)
                            if len(line) < 80 and not any(kw in line.lower() for kw in ['apply', 'view', 'posted', 'ago']):
                                location = line
                                break

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

                if listings:
                    break  # Found listings

            except Exception:
                continue

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

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from an Occupop job detail page.

        Args:
            page: Playwright page instance
            job_url: URL of job detail page

        Returns:
            Dict with job detail fields
        """
        await self._fetch_page(page, job_url)

        # Wait for SPA to render the job detail content
        try:
            await page.wait_for_load_state('load', timeout=15000)
        except Exception:
            pass

        # Wait for job description content to appear
        try:
            await page.wait_for_selector(
                '[class*="description"], [class*="Description"], .MuiTypography-body1, article, main',
                timeout=10000
            )
        except Exception:
            await page.wait_for_timeout(3000)

        detail = {
            'description': '',
            'location': 'Location Not Specified',
            'posted_date': None,
            'skills': [],
            'salary': None,
            'employment_type': None,
        }

        # Description selectors
        desc_selectors = [
            self.selectors.get('description', ''),
            '.job-description',
            '[class*="description"]',
            '[class*="Description"]',
            '.MuiTypography-body1',
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

        # Location
        loc_selectors = [
            self.selectors.get('location', ''),
            '.job-location', '.location',
            '[class*="location"]',
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

        # Employment type
        type_selectors = [
            self.selectors.get('employment_type', ''),
            '.job-type', '[class*="type"]',
            '[class*="employment"]',
        ]
        for selector in [s for s in type_selectors if s]:
            try:
                elem = page.locator(selector).first
                if await elem.count() > 0:
                    text = (await elem.inner_text(timeout=3000)).strip()
                    if text and len(text) < 50:
                        detail['employment_type'] = self._normalize_employment_type(text)
                        break
            except Exception:
                continue

        return detail

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Main entry point: extract all jobs from Occupop career page.

        Args:
            max_jobs: Optional limit for testing

        Returns:
            List of validated JobPosting objects
        """
        jobs = []
        context = None

        self.logger.info("extraction_start", company=self.company_name, max_jobs=max_jobs)

        try:
            context = await self._get_browser_context()
            page = await context.new_page()

            # Navigate and wait for SPA to hydrate
            await self._fetch_page(page, self.base_url)

            # Wait for the page to finish loading scripts
            try:
                await page.wait_for_load_state('load', timeout=15000)
            except Exception:
                pass

            # Wait for the Apollo GraphQL data to load and React to render.
            # The initial HTML shows "Loading..." - we need to wait for actual
            # job content to appear after the SPA hydrates and fetches data.
            job_selectors_to_wait = [
                'a[href*="/jobs/"]',
                'a[href*="/job/"]',
                '[class*="job-card"]',
                '[class*="JobCard"]',
                '[class*="jobCard"]',
                '[class*="VacancyCard"]',
                '[class*="vacancyCard"]',
                '[class*="vacancy"]',
                '.MuiCard-root',
            ]

            job_content_found = False
            for selector in job_selectors_to_wait:
                try:
                    await page.wait_for_selector(selector, timeout=15000)
                    job_content_found = True
                    self.logger.debug("job_content_found", selector=selector)
                    break
                except Exception:
                    continue

            if not job_content_found:
                # Last resort: wait for the "Loading..." text to disappear
                self.logger.debug("no_job_selector_found", note="Waiting for loading to complete")
                try:
                    await page.wait_for_function(
                        "() => !document.body.innerText.includes('Loading...')",
                        timeout=15000
                    )
                except Exception:
                    pass

                # Extra wait for render
                try:
                    await page.wait_for_timeout(3000)
                except Exception:
                    pass

            # Extract listings
            all_listings = await self.extract_job_listings(page)

            if not all_listings:
                self.logger.warning("no_jobs_found", url=self.base_url)
                return []

            self.logger.info("total_listings_found", count=len(all_listings))

            listings_to_process = all_listings[:max_jobs] if max_jobs else all_listings

            for idx, listing in enumerate(listings_to_process):
                try:
                    job_data = {**listing}

                    detail_url = listing.get('url', '')
                    has_detail_page = detail_url and detail_url != self.base_url and (
                        '/jobs/' in detail_url or '/job/' in detail_url
                    )
                    if has_detail_page:
                        if idx > 0:
                            await self._rate_limit()

                        detail = await self.extract_job_detail(page, listing['url'])
                        job_data = {**listing, **detail}

                    if not job_data.get('description') or len(job_data.get('description', '')) < 10:
                        job_data['description'] = f"{job_data['title']} position at {self.company_name}."
                    if 'location' not in job_data:
                        job_data['location'] = 'Location Not Specified'

                    job_data = self._enrich_with_certifications(job_data)
                    posting = JobPosting(**job_data)
                    jobs.append(posting)

                    self.logger.debug("job_extracted", job_num=idx + 1, title=posting.title)

                except ValidationError as e:
                    self.logger.error("validation_failed", job_num=idx + 1, error=str(e))
                    continue
                except Exception as e:
                    self.logger.error("job_extraction_failed", job_num=idx + 1, error=str(e))
                    continue

            self.logger.info("extraction_complete", total_jobs=len(jobs))
            return jobs

        except Exception as e:
            self.logger.error("extraction_failed", error=str(e), exc_info=True)
            return jobs

        finally:
            if context:
                await self._close_browser()
