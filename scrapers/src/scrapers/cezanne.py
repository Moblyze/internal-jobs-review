"""Cezanne OnDemand (Intervieweb) career portal scraper.

Scrapes job listings from Cezanne OnDemand / InRecruiting career pages hosted at
cezanneondemand.intervieweb.it. These portals require Playwright because:
1. The career page is behind a guest module that may need JavaScript rendering
2. Job listings are loaded dynamically via AJAX

Used by: Dron & Dickson (and potentially other Cezanne OnDemand clients).

URL patterns:
- Career page: https://cezanneondemand.intervieweb.it/{company}/en/career#702
- Job detail:  https://cezanneondemand.intervieweb.it/{company}/en/career#/vacancy/{id}

Note: The career page uses fragment-based routing (#702 for listings, #/vacancy/ID
for details). The base URL must include the correct fragment for the listing view.
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


class CezanneScraper(BaseScraper):
    """
    Scraper for Cezanne OnDemand / InRecruiting career portals.

    These portals use a jQuery-based SPA with fragment routing. The career
    page loads job listings via AJAX into a dynamic table/list. Playwright
    is required to render the JavaScript content.
    """

    def __init__(self, config: dict):
        """
        Initialize Cezanne scraper.

        Args:
            config: Company config dict including cezanne_config with:
                - company_slug: URL slug (e.g., 'dronanddickson')
                - host: Base host URL
        """
        super().__init__(config)
        self.base_url = config.get('base_url', '')
        self.selectors = config.get('selectors', {})
        cezanne_config = config.get('cezanne_config', {})
        self.company_slug = cezanne_config.get('company_slug', '')
        self.host = cezanne_config.get('host', 'cezanneondemand.intervieweb.it')

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
        Extract job listings from the Cezanne career page.

        Cezanne portals typically display jobs in a table or card layout.
        Common selectors include .annuncioRow, .job-row, table rows with
        job data, or Bootstrap card layouts.

        Args:
            page: Playwright page showing career listings

        Returns:
            List of dicts with: title, url, company, location
        """
        listings = []

        # Try configured selectors first, then common Cezanne patterns
        card_selector = self.selectors.get('job_card', '')
        card_selectors = [card_selector] if card_selector else []
        card_selectors.extend([
            '.annuncioRow',
            '.job-row',
            'tr.annuncio',
            '.career-item',
            '.vacancy-item',
            'a[href*="vacancy"]',
            'a[href*="annuncio"]',
            '.list-group-item',
            'table tbody tr',
        ])

        for selector in card_selectors:
            if not selector:
                continue
            try:
                cards = page.locator(selector)
                count = await cards.count()
                if count > 0:
                    self.logger.info("job_cards_found", count=count, selector=selector)

                    for i in range(count):
                        try:
                            card = cards.nth(i)
                            text = (await card.inner_text(timeout=5000)).strip()

                            if not text or len(text) < 3:
                                continue

                            # Try to get link
                            url = ''
                            try:
                                # Card itself might be a link
                                url = await card.get_attribute('href') or ''
                            except Exception:
                                pass

                            if not url:
                                try:
                                    link = card.locator('a').first
                                    if await link.count() > 0:
                                        url = await link.get_attribute('href') or ''
                                except Exception:
                                    pass

                            # Extract title (first meaningful text)
                            title = text.split('\n')[0].strip()
                            if len(title) > 200:
                                title = title[:200]

                            # Build absolute URL
                            if url and not url.startswith('http'):
                                url = f"https://{self.host}/{url.lstrip('/')}"

                            # Try to find location in card text
                            location = ''
                            lines = text.split('\n')
                            for line in lines[1:]:
                                line = line.strip()
                                if any(kw in line.lower() for kw in ['location', 'city', 'office', 'site']):
                                    location = re.sub(r'^(location|city|office|site)\s*:\s*', '', line, flags=re.IGNORECASE).strip()
                                    break

                            listing = {
                                'title': title,
                                'url': url or self.base_url,
                                'company': self.company_name,
                            }
                            if location:
                                listing['location'] = location

                            listings.append(listing)

                        except Exception as e:
                            self.logger.debug("card_extraction_failed", index=i, error=str(e))
                            continue

                    if listings:
                        break  # Found listings with this selector

            except Exception:
                continue

        # Deduplicate
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
        Extract full job details from a Cezanne job detail page.

        Args:
            page: Playwright page instance
            job_url: URL of job detail page

        Returns:
            Dict with job detail fields
        """
        await self._fetch_page(page, job_url)

        try:
            await page.wait_for_load_state('networkidle', timeout=15000)
        except Exception:
            pass

        detail = {
            'description': '',
            'location': 'Location Not Specified',
            'posted_date': None,
            'skills': [],
            'salary': None,
            'employment_type': None,
        }

        # Extract description
        desc_selectors = [
            self.selectors.get('description', ''),
            '.annuncioDetail',
            '.vacancy-detail',
            '.job-description',
            '.description',
            '[class*="description"]',
            '.entry-content',
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

        # Extract location
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

        return detail

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Main entry point: extract all jobs from Cezanne career portal.

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

            # Navigate to career page
            await self._fetch_page(page, self.base_url)

            # Wait for dynamic content
            try:
                await page.wait_for_load_state('networkidle', timeout=20000)
            except Exception:
                self.logger.debug("networkidle_timeout", note="Continuing with current state")

            # Additional wait for AJAX content
            try:
                await page.wait_for_timeout(3000)  # Give AJAX calls time to complete
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

                    # Visit detail page if URL is available and different from base
                    if listing.get('url') and listing['url'] != self.base_url:
                        if idx > 0:
                            await self._rate_limit()

                        detail = await self.extract_job_detail(page, listing['url'])
                        job_data = {**listing, **detail}

                    # Ensure minimum fields
                    if not job_data.get('description') or len(job_data.get('description', '')) < 10:
                        job_data['description'] = f"{job_data['title']} position at {self.company_name}."
                    if 'location' not in job_data:
                        job_data['location'] = 'Location Not Specified'

                    job_data = self._enrich_with_certifications(job_data)
                    if self.config.get('extract_contacts', False):
                        job_data = self._enrich_with_contacts(job_data)
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
