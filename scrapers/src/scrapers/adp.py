"""ADP Workforce Now career portal scraper implementation.

This scraper extracts jobs from ADP Workforce Now (WFN) recruitment portals
using Playwright browser automation.

Used by: Taurus Industrial Group, and potentially other companies using ADP WFN.

Strategy:
1. Load the ADP WFN recruitment SPA in Playwright
2. Wait for React app to render job listings
3. Extract job cards from the "Current Openings" view
4. Click into each job to get full description from the detail view
5. Handle infinite scroll pagination for companies with many openings

Key ADP WFN concepts:
- cid: Company identifier (UUID) — uniquely identifies the employer
- ccId: Career Center ID — always "19000101_000001" for external postings
- The app is a React SPA that loads job data via internal API calls
- Job listings appear in a scrollable list with title, location, and post date
- Job details include full HTML description (requisitionDescription)
- The SPA uses sessionStorage and internal routing, not URL-based navigation
"""

import asyncio
import re
from datetime import datetime
from typing import Optional
from urllib.parse import urlencode

import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()


class ADPScraper(BaseScraper):
    """
    Scraper for ADP Workforce Now recruitment portals.

    ADP WFN career portals are React SPAs that load job data through internal
    API services. Direct API access is not available without session auth, so
    this scraper uses Playwright to render the SPA and extract data from the DOM.

    URL pattern:
        https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html
            ?cid={company_id}&ccId={career_center_id}&lang={locale}

    The scraper:
    1. Navigates to the recruitment URL
    2. Waits for job listings to render
    3. Extracts listing data (title, location, date) from each job card
    4. Clicks into each job to extract the full description
    5. Navigates back and processes the next job
    """

    ADP_BASE_URL = "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html"

    def __init__(self, config: dict):
        """
        Initialize ADP scraper with company configuration.

        Args:
            config: Company config dict from companies.yaml. Must include:
                - name: Company display name
                - adp_config.cid: ADP company identifier (UUID)
                - adp_config.cc_id: Career center ID (default: "19000101_000001")
                - adp_config.lang: Locale (default: "en_US")
        """
        super().__init__(config)
        self.adp_config = config.get('adp_config', {})
        self.cid = self.adp_config.get('cid', '')
        self.cc_id = self.adp_config.get('cc_id', '19000101_000001')
        self.lang = self.adp_config.get('lang', 'en_US')

    def _build_recruitment_url(self) -> str:
        """
        Build the full ADP WFN recruitment URL with query parameters.

        Returns:
            Complete URL string for the career portal
        """
        params = {
            'cid': self.cid,
            'ccId': self.cc_id,
            'lang': self.lang,
        }
        return f"{self.ADP_BASE_URL}?{urlencode(params)}"

    def _build_job_url(self, job_id: str) -> str:
        """
        Build a direct link to a specific job posting.

        ADP WFN uses query parameters to deep-link to specific jobs.

        Args:
            job_id: The external job ID (requisition ID)

        Returns:
            URL string that opens the portal with the job selected
        """
        params = {
            'cid': self.cid,
            'ccId': self.cc_id,
            'lang': self.lang,
            'selectedMenuKey': 'CurrentOpenings',
        }
        if job_id:
            params['jobId'] = job_id
        return f"{self.ADP_BASE_URL}?{urlencode(params)}"

    def clean_html_description(self, html_text: Optional[str]) -> str:
        """
        Convert HTML description to clean plain text.

        ADP WFN job descriptions are HTML-formatted with various inline styles
        and formatting tags.

        Args:
            html_text: Raw HTML description string

        Returns:
            Clean plain text description
        """
        if not html_text:
            return ""

        try:
            soup = BeautifulSoup(html_text, 'html.parser')
            clean_text = soup.get_text(separator='\n', strip=True)

            # Remove excess whitespace and blank lines
            lines = [line.strip() for line in clean_text.split('\n') if line.strip()]
            clean_text = '\n'.join(lines)

            return clean_text

        except Exception as e:
            self.logger.error("html_cleaning_failed", error=str(e))
            return html_text

    def _parse_relative_date(self, date_text: str) -> Optional[str]:
        """
        Parse ADP's relative date strings to ISO date format.

        ADP WFN displays post dates as relative strings like:
        - "Posted 3 days ago"
        - "Posted 1 month ago"
        - "Posted today"

        Args:
            date_text: Relative date string from the job listing

        Returns:
            Date string (YYYY-MM-DD) or None
        """
        if not date_text:
            return None

        text = date_text.lower().strip()

        try:
            now = datetime.utcnow()

            if 'today' in text or 'just posted' in text:
                return now.strftime('%Y-%m-%d')

            if 'yesterday' in text:
                from datetime import timedelta
                return (now - timedelta(days=1)).strftime('%Y-%m-%d')

            # Match "X days ago"
            days_match = re.search(r'(\d+)\s*days?\s*ago', text)
            if days_match:
                from datetime import timedelta
                days = int(days_match.group(1))
                return (now - timedelta(days=days)).strftime('%Y-%m-%d')

            # Match "X weeks ago"
            weeks_match = re.search(r'(\d+)\s*weeks?\s*ago', text)
            if weeks_match:
                from datetime import timedelta
                weeks = int(weeks_match.group(1))
                return (now - timedelta(weeks=weeks)).strftime('%Y-%m-%d')

            # Match "X months ago"
            months_match = re.search(r'(\d+)\s*months?\s*ago', text)
            if months_match:
                from datetime import timedelta
                months = int(months_match.group(1))
                return (now - timedelta(days=months * 30)).strftime('%Y-%m-%d')

            # Try parsing as a direct date (some ADP portals show actual dates)
            for fmt in ['%m/%d/%Y', '%Y-%m-%d', '%b %d, %Y']:
                try:
                    dt = datetime.strptime(text, fmt)
                    return dt.strftime('%Y-%m-%d')
                except ValueError:
                    continue

        except Exception as e:
            self.logger.warning("date_parse_failed", date_text=date_text, error=str(e))

        return None

    async def _wait_for_app_load(self, page: Page) -> bool:
        """
        Wait for the ADP WFN React app to fully load and render content.

        The app shows a loading spinner (#recPageLoadWaitingIndicator) while
        initializing, then renders job listings or career center content.

        Args:
            page: Playwright page instance

        Returns:
            True if app loaded successfully, False if timeout
        """
        try:
            # Wait for the loading spinner to disappear
            await page.wait_for_selector(
                '#recPageLoadWaitingIndicator',
                state='hidden',
                timeout=30000
            )

            # Wait for job content to appear — try multiple possible selectors
            # ADP renders jobs in various container patterns
            job_selectors = [
                '[class*="current-openings"]',
                '[class*="currentOpenings"]',
                '[class*="job-requisition"]',
                '[class*="jobRequisition"]',
                '[class*="career-center"]',
                '[class*="careerCenter"]',
                '.recruitment',
            ]

            for selector in job_selectors:
                try:
                    await page.wait_for_selector(selector, timeout=5000)
                    self.logger.debug("app_content_found", selector=selector)
                    return True
                except Exception:
                    continue

            # Fallback: wait for any meaningful content in recruitment_root
            await page.wait_for_function(
                """() => {
                    const root = document.getElementById('recruitment_root');
                    return root && root.children.length > 0 && root.innerHTML.length > 500;
                }""",
                timeout=30000
            )
            return True

        except Exception as e:
            self.logger.error("app_load_timeout", error=str(e))
            return False

    async def _navigate_to_current_openings(self, page: Page) -> bool:
        """
        Navigate to the Current Openings view if not already there.

        ADP WFN may land on a Career Center overview page first.
        This method clicks through to the job listings view.

        Args:
            page: Playwright page instance

        Returns:
            True if successfully on current openings, False otherwise
        """
        try:
            # Check if we're already seeing job listings
            job_items = await page.query_selector_all('[class*="job-item"], [class*="requisition-item"], [class*="jobItem"]')
            if job_items:
                return True

            # Look for "Current Openings" or "View All Jobs" link/button
            openings_selectors = [
                'text="Current Openings"',
                'text="View All Jobs"',
                'text="View All"',
                'text="See All Jobs"',
                '[class*="view-all"]',
                '[class*="viewAll"]',
                'a:has-text("openings")',
                'button:has-text("openings")',
            ]

            for selector in openings_selectors:
                try:
                    element = await page.query_selector(selector)
                    if element:
                        await element.click()
                        self.logger.info("clicked_current_openings", selector=selector)
                        await page.wait_for_timeout(3000)
                        return True
                except Exception:
                    continue

            # If no link found, try the URL with selectedMenuKey
            url_with_menu = self._build_recruitment_url() + '&selectedMenuKey=CurrentOpenings'
            await page.goto(url_with_menu, wait_until='networkidle', timeout=30000)
            await self._wait_for_app_load(page)
            return True

        except Exception as e:
            self.logger.error("navigate_current_openings_failed", error=str(e))
            return False

    async def _scroll_to_load_all_jobs(self, page: Page) -> None:
        """
        Scroll down to trigger infinite scroll and load all job listings.

        ADP WFN loads additional jobs when the user scrolls near the bottom
        of the current openings list.

        Args:
            page: Playwright page instance
        """
        previous_count = 0
        scroll_attempts = 0
        max_scroll_attempts = 20  # Safety limit

        while scroll_attempts < max_scroll_attempts:
            # Count current job items
            current_count = await page.evaluate("""() => {
                const items = document.querySelectorAll(
                    '[class*="requisition"], [class*="job-item"], [class*="jobItem"], ' +
                    '[class*="current-opening-item"], [class*="currentOpening"]'
                );
                return items.length;
            }""")

            if current_count == previous_count and scroll_attempts > 0:
                # No new items loaded, we've reached the end
                self.logger.info("scroll_complete", total_items=current_count)
                break

            previous_count = current_count
            scroll_attempts += 1

            # Scroll to bottom
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(2000)

            self.logger.debug(
                "scroll_progress",
                attempt=scroll_attempts,
                items_loaded=current_count
            )

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job listing data from the current openings page.

        Parses the rendered DOM to extract job cards with title, location,
        post date, and any available metadata.

        Args:
            page: Playwright page showing job listings

        Returns:
            List of dicts with keys: title, location, posted_date, index
        """
        jobs = await page.evaluate("""() => {
            const results = [];

            // ADP WFN renders job listings in various ways. Try multiple patterns.
            // Pattern 1: Table rows (common for Current Openings view)
            const tableRows = document.querySelectorAll('table tbody tr, [role="row"]');
            if (tableRows.length > 0) {
                tableRows.forEach((row, index) => {
                    const cells = row.querySelectorAll('td, [role="cell"], [role="gridcell"]');
                    if (cells.length >= 2) {
                        const titleEl = cells[0].querySelector('a, button, [role="link"]') || cells[0];
                        const title = titleEl?.textContent?.trim();
                        if (title && title.length > 2 && !title.match(/^(Title|Job Title|Position)$/i)) {
                            results.push({
                                title: title,
                                location: cells.length > 1 ? cells[1]?.textContent?.trim() : '',
                                posted_date: cells.length > 2 ? cells[2]?.textContent?.trim() : '',
                                worker_category: cells.length > 3 ? cells[3]?.textContent?.trim() : '',
                                index: index,
                            });
                        }
                    }
                });
            }

            // Pattern 2: Card/list items (alternative layout)
            if (results.length === 0) {
                const cards = document.querySelectorAll(
                    '[class*="requisition"], [class*="job-item"], [class*="jobItem"], ' +
                    '[class*="current-opening-item"], [class*="opening-card"]'
                );
                cards.forEach((card, index) => {
                    const titleEl = card.querySelector(
                        '[class*="title"], [class*="Title"], h2, h3, h4, a, [role="link"]'
                    );
                    const locationEl = card.querySelector(
                        '[class*="location"], [class*="Location"]'
                    );
                    const dateEl = card.querySelector(
                        '[class*="date"], [class*="Date"], [class*="posted"]'
                    );
                    const title = titleEl?.textContent?.trim();
                    if (title && title.length > 2) {
                        results.push({
                            title: title,
                            location: locationEl?.textContent?.trim() || '',
                            posted_date: dateEl?.textContent?.trim() || '',
                            index: index,
                        });
                    }
                });
            }

            // Pattern 3: Link-based listings (simple list of job links)
            if (results.length === 0) {
                const links = document.querySelectorAll(
                    '#recruitment_root a[href*="jobId"], ' +
                    '#recruitment_root [role="link"], ' +
                    '#recruitment_root a[class*="job"]'
                );
                links.forEach((link, index) => {
                    const title = link.textContent?.trim();
                    if (title && title.length > 5 && !title.match(/^(Apply|Sign|Log|View|Back|Home)/i)) {
                        results.push({
                            title: title,
                            location: '',
                            posted_date: '',
                            index: index,
                        });
                    }
                });
            }

            // Pattern 4: Generic fallback - look for anything that looks like job listings
            if (results.length === 0) {
                const root = document.getElementById('recruitment_root');
                if (root) {
                    // Look for repeated structures with clickable titles
                    const allLinks = root.querySelectorAll('a, [role="link"], button[class*="title"]');
                    const seen = new Set();
                    allLinks.forEach((el, index) => {
                        const text = el.textContent?.trim();
                        if (text && text.length > 5 && text.length < 200 &&
                            !seen.has(text) &&
                            !text.match(/^(Apply|Sign In|Log In|Create|Back|Home|Privacy|Terms|Copyright|Language|Current Openings|Career Center|Menu)/i)) {
                            seen.add(text);
                            // Check if parent/sibling has location info
                            const parent = el.closest('[class*="row"], [class*="item"], [class*="card"], tr, li');
                            let location = '';
                            if (parent) {
                                const locEl = parent.querySelector('[class*="location"], [class*="Location"]');
                                location = locEl?.textContent?.trim() || '';
                            }
                            results.push({
                                title: text,
                                location: location,
                                posted_date: '',
                                index: index,
                            });
                        }
                    });
                }
            }

            return results;
        }""")

        self.logger.info("listings_extracted", count=len(jobs))
        return jobs

    async def _click_job_and_extract_detail(self, page: Page, job_listing: dict) -> dict:
        """
        Click on a job listing and extract full details from the detail view.

        Args:
            page: Playwright page instance
            job_listing: Dict with job listing data including title for matching

        Returns:
            Dict with description, employment_type, and any additional detail data
        """
        result = {
            'description': None,
            'employment_type': None,
            'requisition_id': None,
        }

        title = job_listing.get('title', '')

        try:
            # Find and click the job title link
            # Try exact text match first, then partial
            clicked = False
            click_selectors = [
                f'text="{title}"',
                f'a:has-text("{title}")',
                f'button:has-text("{title}")',
                f'[role="link"]:has-text("{title}")',
            ]

            for selector in click_selectors:
                try:
                    element = await page.query_selector(selector)
                    if element:
                        await element.click()
                        clicked = True
                        break
                except Exception:
                    continue

            if not clicked:
                self.logger.warning("could_not_click_job", title=title)
                return result

            # Wait for detail view to load
            await page.wait_for_timeout(2000)

            # Wait for description content to appear
            try:
                await page.wait_for_function(
                    """() => {
                        const root = document.getElementById('recruitment_root');
                        if (!root) return false;
                        const html = root.innerHTML;
                        // Look for description-like content (long text blocks)
                        return html.length > 2000;
                    }""",
                    timeout=10000
                )
            except Exception:
                self.logger.debug("detail_content_wait_timeout", title=title)

            # Extract detail data from the rendered page
            detail = await page.evaluate("""() => {
                const root = document.getElementById('recruitment_root');
                if (!root) return {};

                // Look for the job description container
                const descSelectors = [
                    '[class*="description"]',
                    '[class*="Description"]',
                    '[class*="requisition-description"]',
                    '[class*="job-detail"]',
                    '[class*="jobDetail"]',
                    '[class*="job-description"]',
                ];

                let description = '';
                for (const sel of descSelectors) {
                    const el = root.querySelector(sel);
                    if (el && el.innerHTML.length > 50) {
                        description = el.innerHTML;
                        break;
                    }
                }

                // Fallback: get the largest text block in the detail view
                if (!description) {
                    const allDivs = root.querySelectorAll('div, section, article');
                    let maxLen = 0;
                    allDivs.forEach(div => {
                        const text = div.textContent?.trim() || '';
                        if (text.length > maxLen && text.length > 100 &&
                            !text.includes('Current Openings') &&
                            div.querySelectorAll('a, button').length < 5) {
                            maxLen = text.length;
                            description = div.innerHTML;
                        }
                    });
                }

                // Look for requisition ID
                let requisitionId = '';
                const reqIdPatterns = [
                    /Req(?:uisition)?\s*(?:ID|#|Number)?[:\s]*([A-Z0-9-]+)/i,
                    /Job\s*(?:ID|#|Number)?[:\s]*([A-Z0-9-]+)/i,
                ];

                const fullText = root.textContent || '';
                for (const pattern of reqIdPatterns) {
                    const match = fullText.match(pattern);
                    if (match) {
                        requisitionId = match[1];
                        break;
                    }
                }

                // Look for employment type
                let employmentType = '';
                const typePatterns = [
                    /(?:Job\s*Type|Employment\s*Type|Position\s*Type)[:\s]*(Full[- ]?Time|Part[- ]?Time|Contract|Temporary|Contractor)/i,
                    /(?:Type)[:\s]*(Full[- ]?Time|Part[- ]?Time|Contract|Temporary|Contractor)/i,
                ];
                for (const pattern of typePatterns) {
                    const match = fullText.match(pattern);
                    if (match) {
                        employmentType = match[1];
                        break;
                    }
                }

                // Look for location (may be more detailed on detail page)
                let detailLocation = '';
                const locSelectors = [
                    '[class*="location"], [class*="Location"]',
                ];
                for (const sel of locSelectors) {
                    const el = root.querySelector(sel);
                    if (el) {
                        detailLocation = el.textContent?.trim() || '';
                        break;
                    }
                }

                return {
                    description: description,
                    requisition_id: requisitionId,
                    employment_type: employmentType,
                    detail_location: detailLocation,
                };
            }""")

            if detail.get('description'):
                result['description'] = self.clean_html_description(detail['description'])
            if detail.get('requisition_id'):
                result['requisition_id'] = detail['requisition_id']
            if detail.get('employment_type'):
                result['employment_type'] = self._normalize_employment_type(detail['employment_type'])
            if detail.get('detail_location'):
                result['detail_location'] = detail['detail_location']

        except Exception as e:
            self.logger.error("detail_extraction_failed", title=title, error=str(e))

        return result

    async def _navigate_back_to_listings(self, page: Page) -> bool:
        """
        Navigate back from job detail view to the listings view.

        Args:
            page: Playwright page instance

        Returns:
            True if successfully returned to listings, False otherwise
        """
        try:
            # Try clicking a Back button first (ADP usually has one)
            back_selectors = [
                'text="Back"',
                'text="Back to Current Openings"',
                'text="Back to Search Results"',
                '[class*="back"]',
                '[class*="Back"]',
                'button:has-text("Back")',
                'a:has-text("Back")',
            ]

            for selector in back_selectors:
                try:
                    element = await page.query_selector(selector)
                    if element and await element.is_visible():
                        await element.click()
                        await page.wait_for_timeout(2000)
                        return True
                except Exception:
                    continue

            # Fallback: use browser back
            await page.go_back()
            await page.wait_for_timeout(2000)

            # If that doesn't work, reload the page
            listings = await self.extract_job_listings(page)
            if not listings:
                url = self._build_recruitment_url() + '&selectedMenuKey=CurrentOpenings'
                await page.goto(url, wait_until='networkidle', timeout=30000)
                await self._wait_for_app_load(page)
                await self._navigate_to_current_openings(page)

            return True

        except Exception as e:
            self.logger.error("navigate_back_failed", error=str(e))
            return False

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from job detail page.

        Required by BaseScraper abstract class. For ADP, we use
        _click_job_and_extract_detail instead since navigation is SPA-based.

        Returns:
            Empty dict (not used directly)
        """
        return {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs from ADP Workforce Now career portal.

        This is the main entry point for the scraper. Uses Playwright to render
        the ADP WFN React SPA and extract job data from the DOM.

        Process:
        1. Launch browser and navigate to recruitment URL
        2. Wait for React app to load
        3. Navigate to Current Openings view
        4. Scroll to load all jobs (infinite scroll)
        5. Extract listing data from all visible job cards
        6. For each job, click into detail view for full description
        7. Navigate back and process next job
        8. Normalize and validate through JobPosting model
        9. Enrich with certifications

        Args:
            max_jobs: Optional limit for testing (extract only first N jobs)

        Returns:
            List of validated JobPosting objects
        """
        jobs = []

        self.logger.info(
            "extraction_start",
            company=self.company_name,
            cid=self.cid,
            max_jobs=max_jobs,
        )

        context = None
        try:
            context = await self._get_browser_context()
            page = await context.new_page()

            # Navigate to ADP recruitment page
            url = self._build_recruitment_url()
            self.logger.info("navigating_to_portal", url=url)

            await page.goto(url, wait_until='networkidle', timeout=60000)

            # Wait for the React app to load
            app_loaded = await self._wait_for_app_load(page)
            if not app_loaded:
                self.logger.error("app_failed_to_load")
                return []

            # Navigate to Current Openings view
            await self._navigate_to_current_openings(page)
            await page.wait_for_timeout(3000)

            # Scroll to load all jobs
            await self._scroll_to_load_all_jobs(page)

            # Extract all job listings
            listings = await self.extract_job_listings(page)

            if not listings:
                self.logger.warning("no_listings_found")
                return []

            self.logger.info("total_listings_found", count=len(listings))

            # Apply max_jobs limit to listings
            if max_jobs:
                listings = listings[:max_jobs]

            # Process each job listing
            for i, listing in enumerate(listings):
                try:
                    self.logger.info(
                        "processing_job",
                        index=i + 1,
                        total=len(listings),
                        title=listing.get('title', 'Unknown'),
                    )

                    # Rate limit between jobs
                    if i > 0:
                        await self._rate_limit()

                    # Click into the job and extract details
                    detail = await self._click_job_and_extract_detail(page, listing)

                    # Build description
                    description = detail.get('description', '')
                    if not description or len(description) < 10:
                        description = f"Position: {listing.get('title', '')} at {self.company_name}."
                        location = listing.get('location', '')
                        if location:
                            description += f" Location: {location}."

                    # Determine location
                    location = (
                        detail.get('detail_location')
                        or listing.get('location')
                        or 'Location Not Specified'
                    )

                    # Build job URL
                    req_id = detail.get('requisition_id', '')
                    job_url = self._build_job_url(req_id) if req_id else self._build_recruitment_url()

                    # Normalize job data
                    job_data = {
                        'title': listing.get('title', 'Untitled Position'),
                        'company': self.company_name,
                        'location': location,
                        'description': description,
                        'url': job_url,
                        'posted_date': self._parse_relative_date(listing.get('posted_date', '')),
                        'skills': [],
                        'salary': None,
                        'requisition_id': req_id or None,
                        'certifications': [],
                        'employment_type': detail.get('employment_type'),
                    }

                    # Enrich with certifications
                    job_data = self._enrich_with_certifications(job_data)

                    # Validate through Pydantic model
                    posting = JobPosting(**job_data)
                    jobs.append(posting)

                    self.logger.info(
                        "job_extracted",
                        title=listing.get('title'),
                        location=location,
                    )

                    # Navigate back to listings
                    await self._navigate_back_to_listings(page)

                except ValidationError as e:
                    self.logger.error(
                        "validation_failed",
                        error=str(e),
                        title=listing.get('title'),
                    )
                    # Try to get back to listings even on error
                    await self._navigate_back_to_listings(page)
                    continue
                except Exception as e:
                    self.logger.error(
                        "job_processing_failed",
                        error=str(e),
                        title=listing.get('title'),
                    )
                    # Try to get back to listings even on error
                    try:
                        await self._navigate_back_to_listings(page)
                    except Exception:
                        pass
                    continue

            self.logger.info("extraction_complete", total_jobs=len(jobs))
            return jobs

        except Exception as e:
            self.logger.error("extraction_failed", error=str(e), exc_info=True)
            return jobs

        finally:
            await self._close_browser()
