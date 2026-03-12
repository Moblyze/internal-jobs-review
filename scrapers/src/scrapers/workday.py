"""Workday career portal scraper implementation."""

import asyncio
import random
import re
from typing import Optional

import dateparser
from playwright.async_api import Page, TimeoutError as PlaywrightTimeout
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper


def extract_workday_requisition_id(url: str) -> Optional[str]:
    """
    Extract requisition ID from Workday job URL.

    Workday URLs end with format: /Job-Title_REQID
    Example: /Supply-Chain-Localization-Leader_R156427

    Args:
        url: Workday job URL

    Returns:
        Requisition ID (e.g., 'R156427') or None if not found
    """
    match = re.search(r'_([A-Z0-9-]+)/?$', url)
    return match.group(1) if match else None


class WorkdayScraper(BaseScraper):
    """
    Scraper for Workday career portals.

    Workday is used by Baker Hughes, Noble Corporation, and KBR.
    Handles pagination via "Show More" button and extracts structured job data.
    """

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs from Workday portal with pagination.

        Args:
            max_jobs: Optional limit for testing (extract only first N jobs)

        Returns:
            List of validated JobPosting objects
        """
        jobs = []
        context = None

        try:
            # Launch browser
            context = await self._get_browser_context()
            page = await context.new_page()

            # Navigate to job listing page
            await self._fetch_page(page, self.config['base_url'])

            # Check for RSS feed first
            rss_url = await self._check_rss_feed(page)
            if rss_url:
                self.logger.info("rss_available", url=rss_url, note="Manual RSS parsing not implemented yet")

            # Wait for job listings to load
            try:
                await page.wait_for_selector(
                    self.config['selectors']['job_list'],
                    timeout=10000,
                    state='visible'
                )
            except PlaywrightTimeout:
                self.logger.error("job_list_not_found", selector=self.config['selectors']['job_list'])
                return []

            # Handle pagination and extract job cards from all pages
            job_cards = await self._extract_all_pages(page)
            self.logger.info("jobs_found_on_listing_page", count=len(job_cards))

            # Warn if job count is suspiciously LOW (under 50 may indicate pagination issues)
            # Note: Diagnostic (Plan 02-05) showed Baker Hughes has 770 jobs, so 20 is definitely wrong
            if len(job_cards) < 50:
                self.logger.warning("low_job_count", count=len(job_cards), note="Unexpectedly low job count - pagination may have failed")

            # Extract details for each job
            for idx, job_card in enumerate(job_cards):
                if max_jobs and len(jobs) >= max_jobs:
                    self.logger.info("max_jobs_reached", limit=max_jobs)
                    break

                try:
                    # Rate limit between detail page navigations
                    if idx > 0:
                        await self._rate_limit()

                    # Extract full details
                    job_data = await self.extract_job_detail(page, job_card['url'])

                    # Merge listing data with detail data
                    full_job_data = {**job_card, **job_data}

                    # Enrich with certifications (EXTRACT-14)
                    full_job_data = self._enrich_with_certifications(full_job_data)

                    # Validate through Pydantic model
                    job = JobPosting(**full_job_data)
                    jobs.append(job)

                    self.logger.debug("job_extracted", title=job.title, url=str(job.url))

                except ValidationError as e:
                    self.logger.error("validation_failed", job_url=job_card.get('url'), errors=str(e))
                    continue
                except Exception as e:
                    self.logger.error("extraction_failed", job_url=job_card.get('url'), error=str(e))
                    continue

            self.logger.info("extraction_complete", total_jobs=len(jobs))
            return jobs

        finally:
            # Always close browser
            if context:
                await self._close_browser()

    async def _extract_all_pages(self, page: Page) -> list[dict]:
        """
        Extract job listings from all pages by clicking through pagination.

        Args:
            page: Page showing job listings

        Returns:
            List of all job cards from all pages

        Workday displays 20 jobs per page with numbered pagination.
        This method extracts jobs from each page, then clicks next until no more pages.
        """
        all_jobs = []
        max_pages = 100  # Safety limit (20 jobs/page * 100 = 2000 jobs max)
        page_num = 1

        self.logger.info("extracting_paginated_results")

        while page_num <= max_pages:
            # Extract jobs from current page
            page_jobs = await self.extract_job_listings(page)
            all_jobs.extend(page_jobs)

            self.logger.info(
                "page_extracted",
                page_number=page_num,
                jobs_this_page=len(page_jobs),
                total_jobs=len(all_jobs)
            )

            # Look for next button
            try:
                next_button = page.locator('button[aria-label="next"]').first
                is_visible = await next_button.is_visible(timeout=2000)
                is_enabled = await next_button.is_enabled() if is_visible else False

                if not is_visible or not is_enabled:
                    self.logger.info(
                        "pagination_complete",
                        total_pages=page_num,
                        total_jobs=len(all_jobs),
                        reason="next_button_unavailable"
                    )
                    break

                # Click next and wait for new page
                await next_button.click()
                await page.wait_for_load_state('networkidle', timeout=10000)

                # Human-like delay
                await asyncio.sleep(random.uniform(2.0, 4.0))

                page_num += 1

            except Exception as e:
                self.logger.info(
                    "pagination_complete",
                    total_pages=page_num,
                    total_jobs=len(all_jobs),
                    reason="exception",
                    error=str(e)
                )
                break

        if page_num > max_pages:
            self.logger.warning("max_pages_reached", limit=max_pages, total_jobs=len(all_jobs))

        return all_jobs

    async def _paginate_all_results(self, page: Page) -> None:
        """
        Handle Workday pagination by clicking "next" page button repeatedly.

        Args:
            page: Page showing job listings

        Workday uses numbered page buttons (1, 2, 3, ...) with a "next" button to advance.
        Uses count-based completion detection: stops when no new jobs appear after click.

        Discovered via diagnostic (Plan 02-05): Workday does NOT use "Show More" button,
        instead uses pagination with aria-label="next" button.
        """
        max_iterations = 100
        iterations = 0
        selectors = self.config['selectors']

        self.logger.info("handling_pagination")

        # Count initial job cards
        job_cards = page.locator(selectors['job_card'])
        prev_count = await job_cards.count()
        self.logger.info("pagination_start", initial_jobs=prev_count)

        while iterations < max_iterations:
            try:
                # Look for "next" pagination button (Workday uses aria-label)
                next_button = page.locator('button[aria-label="next"]').first

                # Check if button exists and is enabled
                is_visible = await next_button.is_visible(timeout=2000)
                if not is_visible:
                    self.logger.info("pagination_complete", iterations=iterations, reason="next_button_not_visible", total_jobs=prev_count)
                    break

                is_enabled = await next_button.is_enabled()
                if not is_enabled:
                    self.logger.info("pagination_complete", iterations=iterations, reason="next_button_disabled", total_jobs=prev_count)
                    break

                # Click next and wait for network to settle
                await next_button.click()
                await page.wait_for_load_state('networkidle', timeout=10000)

                # Add human-like delay after network idle
                await asyncio.sleep(random.uniform(2.0, 4.0))

                # Re-count job cards to detect new content
                new_count = await job_cards.count()

                iterations += 1
                self.logger.info(
                    "pagination_progress",
                    iteration=iterations,
                    jobs_before=prev_count,
                    jobs_after=new_count
                )

                # If count didn't change, pagination is complete (no new jobs loaded)
                if new_count == prev_count:
                    self.logger.info("pagination_complete", iterations=iterations, reason="no_new_jobs", total_jobs=new_count)
                    break

                prev_count = new_count

            except PlaywrightTimeout:
                # Button not found or disappeared - pagination complete
                self.logger.info("pagination_complete", iterations=iterations, reason="timeout", total_jobs=prev_count)
                break
            except Exception as e:
                self.logger.warning("pagination_error", iteration=iterations, error=str(e))
                break

        if iterations >= max_iterations:
            self.logger.warning("pagination_limit_reached", max=max_iterations, total_jobs=prev_count)

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job cards from listing page.

        Args:
            page: Page showing job listings

        Returns:
            List of dicts with: title, url, location
        """
        jobs = []
        selectors = self.config['selectors']

        # Find all job card links
        job_links = page.locator(selectors['job_card'])
        count = await job_links.count()

        for i in range(count):
            link = job_links.nth(i)

            try:
                # Extract basic data from card
                title = await link.inner_text()
                href = await link.get_attribute('href')

                # Make URL absolute if needed
                if href and href.startswith('/'):
                    base = self.config['base_url'].rstrip('/')
                    # Remove path from base_url if present
                    if '//' in base:
                        protocol, rest = base.split('//', 1)
                        domain = rest.split('/')[0]
                        url = f"{protocol}//{domain}{href}"
                    else:
                        url = f"{base}{href}"
                elif href and not href.startswith('http'):
                    url = f"{self.config['base_url']}/{href}"
                else:
                    url = href

                # Extract requisition ID from URL
                requisition_id = extract_workday_requisition_id(url)

                jobs.append({
                    'title': title.strip(),
                    'url': url,
                    'company': self.company_name,
                    'requisition_id': requisition_id,
                })

            except Exception as e:
                self.logger.warning("card_extraction_failed", index=i, error=str(e))
                continue

        return jobs

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from detail page.

        Args:
            page: Playwright page instance
            job_url: URL of job detail page

        Returns:
            Dict with: description, location, posted_date, skills, salary
        """
        selectors = self.config['selectors']

        # Navigate to detail page
        await self._fetch_page(page, job_url)

        # Wait for description to load
        try:
            await page.wait_for_selector(
                selectors['description'],
                timeout=10000,
                state='visible'
            )
        except PlaywrightTimeout:
            self.logger.error("description_not_found", url=job_url)
            raise

        # Extract fields
        data = {}

        # Description (required)
        try:
            description_elem = page.locator(selectors['description']).first
            data['description'] = await description_elem.inner_text()
        except Exception as e:
            self.logger.error("description_extraction_failed", url=job_url, error=str(e))
            raise

        # Location (required)
        try:
            location_elem = page.locator(selectors['location']).first
            data['location'] = await location_elem.inner_text()
        except Exception:
            # Try to find location anywhere on the page as fallback
            data['location'] = 'Location not specified'

        # Posted date (optional)
        try:
            posted_elem = page.locator(selectors['posted_date']).first
            posted_text = await posted_elem.inner_text()
            # Clean text: remove "posted on", "posted", and extra whitespace
            posted_text = posted_text.lower().replace('posted on', '').replace('posted', '').strip()
            # Parse flexible date formats (handles "today", "2 days ago", "01/15/2024", etc.)
            parsed_date = dateparser.parse(posted_text, settings={'RELATIVE_BASE': __import__('datetime').datetime.now()})
            if parsed_date:
                data['posted_date'] = parsed_date
        except Exception:
            data['posted_date'] = None

        # Employment type / Time type (optional)
        # Workday wraps the time type in [data-automation-id="time"] div.
        # The div contains a label ("time type") and value ("Full time").
        # We extract just the value from the last child div.
        try:
            time_type_elem = page.locator('[data-automation-id="time"]').first
            is_visible = await time_type_elem.is_visible(timeout=2000)
            if is_visible:
                raw_text = await time_type_elem.inner_text()
                # Text format: "time type\nFull time" — take last line as the value
                lines = [line.strip() for line in raw_text.split('\n') if line.strip()]
                raw_type = lines[-1] if lines else raw_text
                data['employment_type'] = self._normalize_employment_type(raw_type)
        except Exception:
            data['employment_type'] = None

        # Skills (optional) - extract from description if no structured section
        data['skills'] = await self._extract_skills(page, data.get('description', ''))

        # Salary (optional) - many Workday postings don't show salary
        data['salary'] = await self._extract_salary(page, data.get('description', ''))

        return data

    async def _extract_skills(self, page: Page, description: str) -> list[str]:
        """
        Extract skills/qualifications from job posting.

        Args:
            page: Job detail page
            description: Job description text

        Returns:
            List of skill strings
        """
        skills = []

        # Try to find structured qualifications section
        qualifications_patterns = [
            'Qualifications',
            'Requirements',
            'Skills',
            'Required Skills',
            'Preferred Qualifications'
        ]

        for pattern in qualifications_patterns:
            try:
                section = page.locator(f'h2:has-text("{pattern}"), h3:has-text("{pattern}")').first
                is_visible = await section.is_visible(timeout=1000)

                if is_visible:
                    # Get following content until next heading
                    parent = section.locator('xpath=following-sibling::*[1]')
                    text = await parent.inner_text()

                    # Extract bullet points or lines
                    lines = [line.strip() for line in text.split('\n') if line.strip()]
                    skills.extend(lines[:10])  # Limit to 10 skills
                    break

            except Exception:
                continue

        # Fallback: extract from description using common patterns
        if not skills and description:
            # Look for bulleted requirements
            req_match = re.search(
                r'(?:Requirements?|Qualifications?|Skills?)[\s:]+(.+?)(?:Responsibilities|Duties|Benefits|Equal Opportunity|$)',
                description,
                re.DOTALL | re.IGNORECASE
            )

            if req_match:
                req_text = req_match.group(1)
                # Extract lines that look like requirements (start with bullet or are short)
                for line in req_text.split('\n'):
                    line = line.strip().lstrip('•-*·')
                    if line and len(line) < 200:
                        skills.append(line)
                        if len(skills) >= 10:
                            break

        return skills[:10]  # Max 10 skills

    async def _extract_salary(self, page: Page, description: str) -> Optional[str]:
        """
        Extract salary information if available.

        Args:
            page: Job detail page
            description: Job description text

        Returns:
            Salary string or None
        """
        # Try structured compensation section
        comp_patterns = ['Compensation', 'Salary', 'Pay Range']

        for pattern in comp_patterns:
            try:
                section = page.locator(f'h2:has-text("{pattern}"), h3:has-text("{pattern}")').first
                is_visible = await section.is_visible(timeout=1000)

                if is_visible:
                    parent = section.locator('xpath=following-sibling::*[1]')
                    return await parent.inner_text()

            except Exception:
                continue

        # Fallback: search description for salary patterns
        if description:
            salary_match = re.search(
                r'\$[\d,]+(?:\s*-\s*\$?[\d,]+)?(?:\s*(?:per|/)\s*(?:year|hour|yr|hr))?',
                description,
                re.IGNORECASE
            )
            if salary_match:
                return salary_match.group(0)

        return None
