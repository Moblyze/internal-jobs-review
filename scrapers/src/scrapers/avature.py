"""Avature career portal scraper (Subsea7)."""

import asyncio
import re
from typing import Optional
from urllib.parse import urljoin

from playwright.async_api import Page
import structlog

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()


def extract_avature_requisition_id(url: str) -> Optional[str]:
    """
    Extract requisition ID from Avature job URL.

    Avature URLs end with format: /numeric-id/
    Example: /job/Houston-Senior-Project-Engineer-TX-77001/1149548955/

    Args:
        url: Avature job URL

    Returns:
        Requisition ID (e.g., '1149548955') or None if not found
    """
    match = re.search(r'/(\d+)/?$', url)
    return match.group(1) if match else None


class AvatureScraper(BaseScraper):
    """
    Scraper for Avature career portals (Subsea7).

    Avature sites use JavaScript rendering and return 403 to non-browser requests,
    so Playwright with full browser emulation is required.

    PAGINATION: Avature uses AJAX pagination via /tile-search-results endpoint.
    The API requires a "startRow" parameter (0-indexed) to fetch additional pages.
    Example: /tile-search-results/category/9310955?startRow=25 (page 2)
    DO NOT use ?p= or ?page= parameters - they are ignored by the API.

    Based on patterns from existing moblyze-api Go code that scrapes
    careers.subsea7.com using Cloudflare Browser Rendering.
    """

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs from Avature career portal with pagination.

        Args:
            max_jobs: Optional limit for testing (extract only first N jobs)

        Returns:
            List of validated JobPosting objects
        """
        jobs = []
        context = None

        try:
            context = await self._get_browser_context()
            page = await context.new_page()

            # Navigate to search page
            base_url = self.config['base_url']
            await self._fetch_page(page, base_url)

            # Wait for job list to load
            await page.wait_for_selector('li.job-tile', timeout=15000)

            # Avature uses AJAX pagination via /tile-search-results endpoint
            # The site shows "Showing 1 to 25 of X Jobs" but doesn't auto-load more
            # We must manually fetch and inject additional pages via JavaScript

            # Extract total job count and API endpoint from page
            total_expected_jobs = None
            api_endpoint = None

            try:
                results_text = await page.locator('#tile-search-results-label').first.inner_text()
                self.logger.info("results_status", text=results_text)

                # Parse "Showing 1 to 25 of 62 Jobs"
                match = re.search(r'Showing \d+ to \d+ of (\d+)', results_text)
                if match:
                    total_expected_jobs = int(match.group(1))
                    self.logger.info("total_jobs_detected", total=total_expected_jobs)
            except Exception as e:
                self.logger.warning("failed_to_parse_total", error=str(e))

            # Extract API endpoint from page JavaScript config
            try:
                api_endpoint = await page.evaluate('''() => {
                    const scriptText = document.documentElement.innerHTML;
                    const match = scriptText.match(/apiEndpoint:\\s*"([^"]+)"/);
                    return match ? match[1] : null;
                }''')

                if api_endpoint:
                    self.logger.info("api_endpoint_detected", endpoint=api_endpoint)
            except Exception as e:
                self.logger.warning("failed_to_extract_api_endpoint", error=str(e))

            # If we have total jobs and API endpoint, fetch additional pages via AJAX
            if total_expected_jobs and api_endpoint and total_expected_jobs > 25:
                jobs_per_page = 25
                total_pages = (total_expected_jobs + jobs_per_page - 1) // jobs_per_page

                self.logger.info("ajax_pagination_start",
                               total_jobs=total_expected_jobs,
                               total_pages=total_pages)

                # Fetch and inject pages using startRow parameter
                # Avature uses startRow (0-indexed) not page numbers
                for page_num in range(2, total_pages + 1):
                    start_row = (page_num - 1) * jobs_per_page

                    try:
                        self.logger.info("fetching_ajax_page",
                                       page=page_num,
                                       start_row=start_row)

                        # Fetch page via AJAX and inject tiles into DOM
                        result = await page.evaluate('''async (args) => {
                            try {
                                // Avature uses startRow parameter for pagination
                                const url = `/${args.apiEndpoint}?startRow=${args.startRow}`;
                                const response = await fetch(url);
                                if (!response.ok) {
                                    return {error: `HTTP ${response.status}`};
                                }

                                const html = await response.text();

                                // Parse response (returns raw <li> elements)
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(html, 'text/html');
                                const newTiles = doc.querySelectorAll('li.job-tile');

                                if (newTiles.length === 0) {
                                    return {error: 'No tiles found in response'};
                                }

                                // Append to existing job list
                                const existingList = document.querySelector('#job-tile-list');
                                if (!existingList) {
                                    return {error: 'Existing job list not found'};
                                }

                                newTiles.forEach(tile => {
                                    existingList.appendChild(tile.cloneNode(true));
                                });

                                return {success: true, tilesAppended: newTiles.length};
                            } catch (err) {
                                return {error: err.toString()};
                            }
                        }''', {'apiEndpoint': api_endpoint, 'startRow': start_row})

                        if result.get('error'):
                            self.logger.warning("ajax_page_failed",
                                              page=page_num,
                                              start_row=start_row,
                                              error=result['error'])
                            # Continue to next page even if one fails
                            continue

                        self.logger.info("ajax_page_loaded",
                                       page=page_num,
                                       start_row=start_row,
                                       tiles_added=result.get('tilesAppended', 0))

                        # Rate limit between AJAX requests
                        await asyncio.sleep(1)

                    except Exception as e:
                        self.logger.error("ajax_pagination_error",
                                        page=page_num,
                                        start_row=start_row,
                                        error=str(e))
                        # Continue to next page
                        continue

                # Verify final count
                final_count = await page.locator('li.job-tile').count()
                self.logger.info("ajax_pagination_complete",
                               expected=total_expected_jobs,
                               loaded=final_count)
            else:
                self.logger.info("ajax_pagination_skipped",
                               reason="No API endpoint or <=25 jobs")

            # Extract all visible job listings
            all_listings = await self.extract_job_listings(page)

            self.logger.info("listings_extraction_complete", total_listings=len(all_listings))

            # Limit to max_jobs if specified
            listings_to_process = all_listings[:max_jobs] if max_jobs else all_listings
            self.logger.info("processing_listings", total_listings=len(all_listings), processing=len(listings_to_process))

            # Extract details for each job
            for idx, listing in enumerate(listings_to_process):
                if idx > 0:
                    await self._rate_limit()

                try:
                    self.logger.debug("extracting_detail", job_num=idx + 1, url=listing['url'])

                    # Navigate to job detail page (URL is already absolute from extract_job_listings)
                    detail = await self.extract_job_detail(page, listing['url'])

                    # Merge listing data with detail data
                    job_data = {**listing, **detail}

                    # Enrich with certifications (EXTRACT-14)
                    job_data = self._enrich_with_certifications(job_data)
                    if self.config.get('extract_contacts', False):
                        job_data = self._enrich_with_contacts(job_data)

                    # Validate through Pydantic model
                    job = JobPosting(**job_data)
                    jobs.append(job)

                    self.logger.debug("job_extracted", job_num=idx + 1, title=job.title)

                except Exception as e:
                    self.logger.error(
                        "job_extraction_failed",
                        job_num=idx + 1,
                        url=listing.get('url'),
                        error=str(e),
                        exc_info=True
                    )
                    # Continue to next job (per-job error handling)
                    continue

            self.logger.info("extraction_complete", total_jobs=len(jobs))
            return jobs

        finally:
            if context:
                await self._close_browser()

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job listing data from search results page.

        Avature uses <li class="job-tile"> elements with data-url attributes
        and <a class="jobTitle-link"> for job links.

        Args:
            page: Playwright page showing job listings

        Returns:
            List of dicts with: title, url, company
        """
        listings = []

        # Get base URL for converting relative URLs to absolute
        base_url = self.config['base_url']

        # Find all job tiles
        job_tiles = await page.locator('li.job-tile').all()

        for tile in job_tiles:
            try:
                # Extract job URL from data-url attribute
                job_url = await tile.get_attribute('data-url')
                if not job_url:
                    continue

                # Convert relative URL to absolute
                full_url = urljoin(base_url, job_url)

                # Extract requisition ID from URL
                requisition_id = extract_avature_requisition_id(job_url)

                # Extract job title from jobTitle-link
                title_elem = tile.locator('a.jobTitle-link').first
                title = await title_elem.inner_text()

                if title and full_url:
                    listings.append({
                        'title': title.strip(),
                        'url': full_url,
                        'company': self.company_name,
                        'requisition_id': requisition_id,
                    })

            except Exception as e:
                self.logger.debug("tile_extraction_failed", error=str(e))
                continue

        # Remove duplicates (same URL can appear multiple times in responsive layout)
        seen_urls = set()
        unique_listings = []
        for listing in listings:
            if listing['url'] not in seen_urls:
                seen_urls.add(listing['url'])
                unique_listings.append(listing)

        return unique_listings

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from job detail page.

        Args:
            page: Playwright page instance
            job_url: Full URL of job detail page

        Returns:
            Dict with: description, location, posted_date (if available), skills, salary
        """
        # Navigate to detail page
        await self._fetch_page(page, job_url)

        # Wait for job description to load
        await page.wait_for_selector('[itemprop="description"]', timeout=10000)

        detail = {
            'description': '',
            'location': '',
            'posted_date': None,
            'skills': [],
            'salary': None,
            'employment_type': None
        }

        # Extract description
        try:
            desc_elem = page.locator('[itemprop="description"]').first
            description = await desc_elem.inner_text()
            detail['description'] = description.strip()
        except Exception as e:
            self.logger.warning("description_extraction_failed", url=job_url, error=str(e))

        # Extract location from #job-location or .jobGeoLocation
        # Avature multi-location jobs list several locations in child elements.
        # inner_text() on the container concatenates them into one string
        # (e.g. "Aberdeen (Westhill), GB Leer, DE Dubai, AE"), which Mapbox
        # cannot geocode.  We grab only the FIRST child location instead.
        try:
            location_elem = page.locator('#job-location, .jobGeoLocation').first
            # Try to get individual location entries from child elements first
            children = location_elem.locator('span, li, div, p, a')
            child_count = await children.count()

            if child_count > 1:
                # Multiple child elements = multi-location job; take the first
                first_location = await children.nth(0).inner_text()
                first_location = first_location.strip().rstrip(',')
                if first_location:
                    detail['location'] = first_location
                    self.logger.info(
                        "multi_location_job_using_first",
                        url=job_url,
                        selected=first_location,
                        total_locations=child_count,
                    )
                else:
                    # Fallback: use full text
                    location = await location_elem.inner_text()
                    detail['location'] = location.strip()
            else:
                # Single location or no child structure - use full text
                location = await location_elem.inner_text()
                detail['location'] = location.strip()
        except Exception as e:
            self.logger.warning("location_extraction_failed", url=job_url, error=str(e))

        # Extract posted date if available (Avature doesn't always show this)
        # Skip for now - Avature doesn't consistently show posted dates

        # Extract skills from description text (look for common patterns)
        # This is basic extraction - can be enhanced later
        if detail['description']:
            desc_lower = detail['description'].lower()
            common_skills = [
                'pipeline', 'subsea', 'engineering', 'offshore', 'commissioning',
                'project management', 'analysis', 'installation', 'reel-lay',
                's-lay', 'j-lay', 'ROV', 'welding', 'inspection', 'QHSE'
            ]

            found_skills = []
            for skill in common_skills:
                if skill.lower() in desc_lower:
                    found_skills.append(skill)

            detail['skills'] = found_skills

        # Extract employment type from page
        # Try common Avature selectors for job type / contract type
        try:
            for selector in [
                '.job-type', '.contract-type', '.employment-type',
                '[itemprop="employmentType"]', '.jobType', '.job-category'
            ]:
                type_elem = page.locator(selector).first
                if await type_elem.count() > 0:
                    raw_type = await type_elem.inner_text(timeout=3000)
                    if raw_type and raw_type.strip():
                        detail['employment_type'] = self._normalize_employment_type(raw_type.strip())
                        break
        except Exception:
            pass

        # Infer from title or description if not found
        if not detail['employment_type'] and detail.get('description'):
            title_desc = (detail.get('title', '') + ' ' + detail['description']).lower()
            if 'contractor' in title_desc or 'contract position' in title_desc:
                detail['employment_type'] = 'Contractor'
            elif 'internship' in title_desc or 'intern ' in title_desc:
                detail['employment_type'] = 'Internship'

        return detail

    async def _navigate_next_page(self, page: Page, current_page: int) -> bool:
        """
        Navigate to next page of results if available.

        Avature uses numbered pagination with page links. The page count is shown
        in the pagination area at the bottom of the job list.

        Args:
            page: Playwright page instance
            current_page: Current page number (1-indexed)

        Returns:
            True if navigation to next page succeeded, False if no more pages
        """
        try:
            # Check if there's a "next page" or page number link
            # Avature uses data-per-page attribute, so pagination is client-side
            # The page shows "Showing 1 to 25 of 62 Jobs" - need to scroll/click to load more

            # Look for numbered pagination or next button
            next_page_num = current_page + 1

            # Try different pagination patterns
            next_selectors = [
                f'a:has-text("{next_page_num}")',  # Numbered page link
                'a[rel="next"]',                    # Standard next rel
                'a:has-text("Next")',               # Next button
                '.pagination .next:not(.disabled)', # Pagination next (not disabled)
            ]

            for selector in next_selectors:
                try:
                    next_btn = page.locator(selector).first
                    if await next_btn.count() > 0:
                        is_visible = await next_btn.is_visible(timeout=2000)
                        if is_visible:
                            self.logger.debug("clicking_next_page", selector=selector, page=next_page_num)
                            await next_btn.click()
                            await page.wait_for_load_state('networkidle', timeout=15000)
                            await asyncio.sleep(1)  # Extra wait for content to render
                            return True
                except Exception:
                    continue

            # If no pagination found, check if the current page shows all results
            # by looking at the "Showing X to Y of Z" text
            try:
                results_text = await page.locator('#tile-search-results-label').first.inner_text()
                self.logger.debug("results_text", text=results_text)

                # Parse "Showing 1 to 25 of 62 Jobs"
                import re
                match = re.search(r'Showing \d+ to (\d+) of (\d+)', results_text)
                if match:
                    shown = int(match.group(1))
                    total = int(match.group(2))
                    if shown >= total:
                        self.logger.info("all_results_shown", shown=shown, total=total)
                        return False
            except Exception:
                pass

            self.logger.info("no_next_page_found", current_page=current_page)
            return False

        except Exception as e:
            self.logger.warning("pagination_navigation_failed", current_page=current_page, error=str(e))
            return False
