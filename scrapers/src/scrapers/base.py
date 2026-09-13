"""Abstract base scraper providing shared infrastructure for all platform scrapers."""

import asyncio
import logging
import os
import random
import sys
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

import structlog
from playwright.async_api import async_playwright, Browser, BrowserContext, Page
from tenacity import retry, stop_after_attempt, wait_exponential, before_sleep_log

from src.models.job import JobPosting

# Import certification extractor
scrapers_path = Path(__file__).parent.parent.parent / 'scrapers'
sys.path.insert(0, str(scrapers_path))
from certification_extractor import extract_job_certifications

logger = structlog.get_logger()

# Process-wide cap on concurrent Playwright browser instances.
#
# main.py launches every company's scrape as a concurrent asyncio task with
# no limit on how many run at once (2026-09-13 incident: ~28 of ~71
# companies use a Playwright-based scraper, each launching its own headless
# Chromium). On the single ubuntu-latest GH Actions runner, 20+ simultaneous
# Chromium processes exhaust CPU/memory, which starves the *other*,
# httpx-only scrapers (workday_api, icims, successfactors_csb,
# smartrecruiters) of the CPU time and socket availability their listing
# requests need — those failed with "listing_page_failed" at offset 0 within
# milliseconds of each other, and Playwright-heavy companies (Chevron,
# Marathon Petroleum, SGS) blew through the 45-minute per-company timeout.
# This semaphore is a module-level global (shared by every BaseScraper
# subclass instance in the process), so it caps the true bottleneck resource
# regardless of how many scrape tasks main.py fires off.
#
# See docs/2026-09-13-runner-contention-scheduling-fix-proposal.md — this
# commit is deliberately reverted immediately afterward; it exists in git
# history as a ready-to-apply fix, not as active behavior on this branch.
MAX_CONCURRENT_BROWSERS = int(os.environ.get('MAX_CONCURRENT_BROWSERS', '6'))
_BROWSER_LAUNCH_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_BROWSERS)


class BaseScraper(ABC):
    """
    Abstract base class for all job board scrapers.

    Provides:
    - Browser lifecycle management with Playwright
    - Rate limiting to avoid anti-bot detection
    - Retry logic with exponential backoff
    - RSS feed detection
    - Structured logging

    Platform-specific scrapers (Workday, Avature, etc.) inherit from this class
    and implement the abstract methods.
    """

    def __init__(self, config: dict):
        """
        Initialize scraper with company configuration.

        Args:
            config: Company config dict from companies.yaml with keys:
                - name: Company name
                - base_url: Career portal URL
                - rate_limit_delay: Seconds between requests (default 2.0)
                - selectors: Platform-specific CSS selectors
        """
        self.config = config
        self.company_name = config['name']
        self.rate_limit_delay = config.get('rate_limit_delay', 2.0)
        self.logger = logger.bind(company=self.company_name)
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._holds_browser_slot = False

    async def _get_browser_context(self) -> BrowserContext:
        """
        Launch Playwright browser and create context with anti-detection settings.

        Blocks on MAX_CONCURRENT_BROWSERS (module-level semaphore, shared
        across every scraper instance in the process) so at most that many
        Chromium processes run at once, regardless of how many companies
        main.py has launched concurrently. The slot is held for the life of
        this browser instance and released in _close_browser.

        Returns:
            BrowserContext configured for web scraping
        """
        if self._context:
            return self._context

        self.logger.debug("waiting_for_browser_slot", max_concurrent=MAX_CONCURRENT_BROWSERS)
        await _BROWSER_LAUNCH_SEMAPHORE.acquire()
        self._holds_browser_slot = True

        try:
            self.logger.info("launching_browser")
            playwright = await async_playwright().start()

            # Launch headless Chromium with realistic settings
            self._browser = await playwright.chromium.launch(
                headless=True,
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage',
                    '--no-sandbox'
                ]
            )

            # Create context with desktop Chrome user agent and viewport
            self._context = await self._browser.new_context(
                user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport={'width': 1920, 'height': 1080},
                locale='en-US'
            )
        except Exception:
            # Launch failed after we took a slot; release it so we don't
            # permanently shrink the pool for the rest of the process.
            self._holds_browser_slot = False
            _BROWSER_LAUNCH_SEMAPHORE.release()
            raise

        return self._context

    async def _close_browser(self):
        """Close browser context and browser instance."""
        if self._context:
            await self._context.close()
            self._context = None
        if self._browser:
            await self._browser.close()
            self._browser = None
        if self._holds_browser_slot:
            self._holds_browser_slot = False
            _BROWSER_LAUNCH_SEMAPHORE.release()

    async def _rate_limit(self):
        """
        Sleep for random duration to avoid anti-bot detection.

        Uses jittered delay: rate_limit_delay +/- 20%
        """
        delay = random.uniform(
            self.rate_limit_delay * 0.8,
            self.rate_limit_delay * 1.5
        )
        self.logger.debug("rate_limiting", delay_seconds=delay)
        await asyncio.sleep(delay)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=30),
        before_sleep=before_sleep_log(logger, logging.INFO),
        reraise=True
    )
    async def _fetch_page(self, page: Page, url: str) -> None:
        """
        Navigate to URL with retry logic.

        Args:
            page: Playwright page instance
            url: URL to navigate to

        Raises:
            Exception: After 3 failed attempts
        """
        self.logger.info("fetching_page", url=url)
        await page.goto(url, wait_until='networkidle', timeout=30000)

    async def _check_rss_feed(self, page: Page) -> Optional[str]:
        """
        Check if page has RSS feed link for alternate extraction method.

        Args:
            page: Playwright page to check

        Returns:
            RSS feed URL if found, None otherwise
        """
        try:
            rss_link = await page.locator(
                'link[rel="alternate"][type="application/rss+xml"]'
            ).get_attribute('href')

            if rss_link:
                self.logger.info("rss_feed_detected", url=rss_link)
                return rss_link
        except Exception as e:
            self.logger.debug("no_rss_feed", error=str(e))

        return None

    def _enrich_with_certifications(self, job_data: dict) -> dict:
        """
        Extract certifications from job description and skills, add to job data.

        Args:
            job_data: Job dict with 'description' and optional 'skills' keys

        Returns:
            Job dict with 'certifications' list added

        Example:
            >>> job = {'description': 'CDL required. OSHA 30 preferred.', 'skills': []}
            >>> enriched = scraper._enrich_with_certifications(job)
            >>> enriched['certifications']
            ['CDL', 'OSHA 30']
        """
        try:
            certifications = extract_job_certifications(job_data)
            job_data['certifications'] = certifications

            if certifications:
                self.logger.debug(
                    "certifications_extracted",
                    count=len(certifications),
                    certifications=certifications
                )
        except Exception as e:
            self.logger.error("certification_extraction_failed", error=str(e))
            job_data['certifications'] = []

        return job_data

    @staticmethod
    def _normalize_employment_type(raw_type: Optional[str]) -> Optional[str]:
        """
        Normalize employment type strings to standard values.

        Maps various ATS-specific labels to a consistent set:
        - Full-Time
        - Part-Time
        - Contractor
        - Temporary
        - Internship

        Args:
            raw_type: Raw employment type string from ATS (e.g., "Full time", "Regular")

        Returns:
            Normalized string or original value if no mapping found
        """
        if not raw_type:
            return None

        raw_lower = raw_type.strip().lower()

        # Mapping of common ATS variations to standard values
        type_map = {
            'full time': 'Full-Time',
            'full-time': 'Full-Time',
            'fulltime': 'Full-Time',
            'regular': 'Full-Time',
            'regular full-time': 'Full-Time',
            'permanent': 'Full-Time',
            'part time': 'Part-Time',
            'part-time': 'Part-Time',
            'parttime': 'Part-Time',
            'contract': 'Contractor',
            'contractor': 'Contractor',
            'contingent': 'Contractor',
            'contingent worker': 'Contractor',
            'temporary': 'Temporary',
            'temp': 'Temporary',
            'seasonal': 'Temporary',
            'intern': 'Internship',
            'internship': 'Internship',
            'student': 'Internship',
            'co-op': 'Internship',
            'coop': 'Internship',
            'graduate': 'Internship',
        }

        return type_map.get(raw_lower, raw_type.strip())

    @abstractmethod
    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job listing data from search results page.

        Args:
            page: Playwright page showing job listings

        Returns:
            List of dicts with at least: title, url, location
        """
        pass

    @abstractmethod
    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from job detail page.

        Args:
            page: Playwright page instance
            job_url: URL of job detail page

        Returns:
            Dict with all job fields (description, skills, salary, posted_date)
        """
        pass

    @abstractmethod
    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Main entry point: extract all jobs from career portal.

        Should handle:
        - Browser lifecycle
        - Pagination
        - RSS feed detection
        - Per-job validation through JobPosting model
        - Error handling for individual jobs

        Args:
            max_jobs: Optional limit for testing (extract only first N jobs)

        Returns:
            List of validated JobPosting objects
        """
        pass
