"""SuccessFactors/TalentBrew scraper for Halliburton career portal."""

import asyncio
import json
import random
import re
from datetime import datetime
from typing import Optional

import dateparser
import structlog
from playwright.async_api import Page, TimeoutError as PlaywrightTimeout

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()


class SuccessFactorsScraper(BaseScraper):
    """
    Scraper for SuccessFactors career portals using TalentBrew frontend.

    Halliburton's careers.halliburton.com site embeds job data as JSON in the page HTML
    via console.log() statement. This scraper extracts that JSON for reliable pagination
    and job data retrieval.

    Pagination uses URL-based pattern: /search-jobs&p={page_number}
    """

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        """
        Extract all jobs from SuccessFactors TalentBrew portal with pagination.

        Args:
            max_jobs: Optional limit on total jobs to extract (for testing)

        Returns:
            List of validated JobPosting objects
        """
        jobs = []
        context = None

        try:
            context = await self._get_browser_context()
            page = await context.new_page()

            base_url = self.config['base_url']
            total_pages_estimate = self.config.get('total_pages_estimate', 30)

            self.logger.info("pagination_start", base_url=base_url, total_pages_estimate=total_pages_estimate)

            # Iterate through pages
            page_num = 1
            consecutive_empty_pages = 0
            max_consecutive_empty = 3  # Stop after 3 consecutive empty pages

            # Get pagination configuration
            sf_config = self.config.get('sf_config', {})
            pagination_type = sf_config.get('pagination_type', 'page')  # Default to 'page' for Halliburton
            records_per_page = self.config.get('records_per_page', 15)

            while page_num <= total_pages_estimate:
                # Construct page URL using configured pagination pattern
                if page_num == 1:
                    page_url = base_url
                else:
                    if pagination_type == 'startrow':
                        # TechnipFMC style: ?startrow=N (offset-based)
                        startrow = (page_num - 1) * records_per_page
                        page_url = f"{base_url}?startrow={startrow}"
                    else:
                        # Halliburton style: ?p=N (page-based)
                        page_url = f"{base_url}?p={page_num}"

                self.logger.info("fetching_page", page_num=page_num, url=page_url, pagination_type=pagination_type)

                try:
                    await self._fetch_page(page, page_url)
                except Exception as e:
                    self.logger.error("page_fetch_failed", page_num=page_num, error=str(e))
                    break

                # Extract jobs from current page
                page_jobs = await self._extract_page_jobs(page)

                if not page_jobs:
                    consecutive_empty_pages += 1
                    self.logger.info("empty_page_encountered",
                                   page_num=page_num,
                                   consecutive_empty=consecutive_empty_pages)

                    if consecutive_empty_pages >= max_consecutive_empty:
                        self.logger.info("pagination_complete",
                                       reason="max_consecutive_empty_pages",
                                       consecutive_count=consecutive_empty_pages,
                                       page_num=page_num)
                        break

                    # Continue to next page - single empty page is not enough to stop
                    page_num += 1
                    if page_num <= total_pages_estimate:
                        await self._rate_limit()
                    continue

                # Reset consecutive empty counter when we find jobs
                consecutive_empty_pages = 0

                self.logger.info("page_extracted", page_num=page_num, jobs_count=len(page_jobs))

                # Map and validate each job
                for raw_job in page_jobs:
                    try:
                        job_data = self._map_job_data(raw_job, page_url)

                        # Fetch full job details if URL is available (TechnipFMC needs this)
                        if job_data.get('url') and len(job_data.get('description', '')) < 100:
                            self.logger.debug("fetching_full_details", url=job_data['url'])
                            try:
                                detail_data = await self.extract_job_detail(page, job_data['url'])
                                # Update with full description if available
                                if detail_data.get('description') and len(detail_data['description']) > len(job_data.get('description', '')):
                                    job_data['description'] = detail_data['description']
                                # Add skills if found
                                if detail_data.get('skills'):
                                    job_data['skills'].extend(detail_data['skills'])
                                # NOTE: Don't update posted_date from detail pages - it's often inaccurate
                                # (shows last updated date instead of originally posted date)
                            except Exception as e:
                                self.logger.warning("detail_fetch_failed", url=job_data['url'], error=str(e))

                        # Enrich with certifications (EXTRACT-14)
                        job_data = self._enrich_with_certifications(job_data)

                        job = JobPosting(**job_data)
                        jobs.append(job)

                        # Check max_jobs limit
                        if max_jobs and len(jobs) >= max_jobs:
                            self.logger.info("max_jobs_reached", total_jobs=len(jobs))
                            return jobs

                    except Exception as e:
                        self.logger.warning(
                            "job_validation_failed",
                            job_id=raw_job.get('ID'),
                            title=raw_job.get('Title', 'Unknown')[:50],
                            error=str(e)
                        )
                        continue

                # Rate limit between pages
                if page_num < total_pages_estimate:
                    await self._rate_limit()

                page_num += 1

            self.logger.info("extraction_complete", total_jobs=len(jobs), pages_processed=page_num)
            return jobs

        finally:
            if context:
                await self._close_browser()

    async def _extract_page_jobs(self, page: Page) -> list[dict]:
        """
        Extract job data from TalentBrew page using embedded JSON.

        Strategy:
        1. Extract console.log JSON from page source (most reliable)
        2. Parse the Jobs array
        3. Fallback to CSS selectors if JSON extraction fails

        Args:
            page: Playwright page instance

        Returns:
            List of raw job dicts from JSON
        """
        # Strategy 1: Extract JSON from page source
        try:
            page_content = await page.content()

            # Find console.log statement with job data
            match = re.search(r"console\.log\('test',\s*({.*?})\);", page_content, re.DOTALL)

            if match:
                json_str = match.group(1)
                data = json.loads(json_str)

                if 'Jobs' in data and data['Jobs']:
                    self.logger.info("json_extraction_success", jobs_count=len(data['Jobs']))
                    return data['Jobs']
                else:
                    self.logger.warning("json_missing_jobs_array", keys=list(data.keys())[:10])

        except json.JSONDecodeError as e:
            self.logger.warning("json_parse_failed", error=str(e))
        except Exception as e:
            self.logger.warning("json_extraction_error", error=str(e))

        # Strategy 2: CSS fallback (if JSON extraction failed)
        self.logger.warning("json_extraction_failed_using_css_fallback")
        return await self._extract_jobs_via_css(page)

    async def _extract_jobs_via_css(self, page: Page) -> list[dict]:
        """
        Fallback: Extract jobs using CSS selectors when JSON extraction fails.

        Supports two layouts:
        1. List-based (Halliburton): <li> items with job cards
        2. Table-based (TechnipFMC): <tr> rows with job data in columns

        Args:
            page: Playwright page instance

        Returns:
            List of job dicts extracted from HTML
        """
        jobs = []
        selectors = self.config.get('selectors', {})

        try:
            # Try table-based layout first (TechnipFMC, Phillips 66)
            # Exclude header/filter rows by filtering out rows with <th> or filter inputs
            table_rows = await page.locator(
                'table tbody tr:not(#search-results-header):not(#search-results-filter), '
                '#search-results-table tbody tr:not(#search-results-header):not(#search-results-filter)'
            ).all()

            if table_rows and len(table_rows) > 0:
                self.logger.info("table_layout_detected", rows_count=len(table_rows))

                for row in table_rows:
                    try:
                        cells = await row.locator('td').all()

                        if len(cells) < 2:
                            continue

                        # Find the title link - search all cells for job link
                        # Phillips 66: [Req ID] [Title link] [Location] [Job Field]
                        # TechnipFMC:  [Title link] [Location] [Date]
                        title = None
                        url = None

                        # Strategy 1: Look for a.jobTitle-link (Phillips 66 / TalentBrew table)
                        try:
                            jt_link = row.locator('a.jobTitle-link').first
                            if await jt_link.count() > 0:
                                title = await jt_link.inner_text(timeout=5000)
                                url = await jt_link.get_attribute('href')
                        except Exception:
                            pass

                        # Strategy 2: Look for first <a> in any cell (TechnipFMC fallback)
                        if not title:
                            for cell in cells:
                                try:
                                    link = cell.locator('a').first
                                    if await link.count() > 0:
                                        title = await link.inner_text(timeout=5000)
                                        url = await link.get_attribute('href')
                                        break
                                except Exception:
                                    continue

                        if not title or not url:
                            continue

                        # Extract location - try dedicated column, then fallback
                        location = 'Unknown'
                        try:
                            loc_cell = row.locator('td.colLocation').first
                            if await loc_cell.count() > 0:
                                location = await loc_cell.inner_text(timeout=5000)
                            elif len(cells) > 1:
                                # Fallback: second cell for TechnipFMC layout
                                cell_text = await cells[1].inner_text(timeout=5000)
                                if cell_text and cell_text.strip() != title.strip():
                                    location = cell_text
                        except Exception:
                            pass

                        # Extract req ID from dedicated facility cell (Phillips 66)
                        req_id = ''
                        try:
                            facility_cell = row.locator('td.colFacility span.jobFacility').first
                            if await facility_cell.count() > 0:
                                req_id = (await facility_cell.inner_text(timeout=5000)).strip()
                        except Exception:
                            pass

                        # Fallback: extract req ID from URL (TechnipFMC: /job/.../JOBID/)
                        if not req_id and url:
                            url_parts = url.rstrip('/').split('/')
                            if len(url_parts) > 0:
                                req_id = url_parts[-1]

                        # Extract posted date if column exists
                        posted_date_text = None
                        try:
                            date_cell = row.locator('td.colDate').first
                            if await date_cell.count() > 0:
                                posted_date_text = (await date_cell.inner_text(timeout=5000)).strip()
                            elif len(cells) > 2:
                                posted_date_text = await cells[2].inner_text(timeout=5000)
                        except Exception:
                            pass

                        # Build full URL
                        base_url = self.config.get('base_url', '')
                        domain = base_url.split('/search-jobs')[0] if '/search-jobs' in base_url else base_url
                        full_url = url if url.startswith('http') else f"{domain}{url}"

                        # Clean location text (remove extra whitespace/newlines)
                        location = ' '.join(location.split()).strip()

                        jobs.append({
                            'Title': title.strip(),
                            'ApplyUrl': full_url,
                            'Locations': [{'FormattedName': location}],
                            'City': location.split(',')[0].strip() if ',' in location else location,
                            'Country': location.split(',')[-1].strip() if ',' in location else 'Unknown',
                            'Categories': [],
                            'Skills': [],
                            'PostedDate': posted_date_text.strip() if posted_date_text else None,
                            'ExternalReferenceCode': req_id
                        })

                    except Exception as e:
                        self.logger.debug("table_row_extraction_failed", error=str(e))
                        continue

                self.logger.info("css_fallback_complete", layout="table", jobs_extracted=len(jobs))
                return jobs

            # Fallback to list-based layout (Halliburton)
            job_cards = await page.locator(
                '#search-results-list li, '
                '.search-results-list .job-result, '
                '[data-job-id]'
            ).all()

            if job_cards and len(job_cards) > 0:
                self.logger.info("list_layout_detected", cards_count=len(job_cards))

                for card in job_cards:
                    try:
                        # Extract title and URL
                        title_link = card.locator(
                            'h2 a, '
                            '[role="heading"] a, '
                            '.job-title a'
                        ).first

                        title = await title_link.inner_text()
                        url = await title_link.get_attribute('href')

                        # Extract location
                        location_elem = card.locator(
                            '.job-location, '
                            '.location-text, '
                            'span[class*="location"]'
                        ).first

                        location = await location_elem.inner_text() if await location_elem.count() > 0 else 'Unknown'

                        # Build full URL
                        base_url = self.config.get('base_url', '')
                        domain = base_url.split('/search-jobs')[0] if '/search-jobs' in base_url else base_url
                        full_url = url if url.startswith('http') else f"{domain}{url}"

                        jobs.append({
                            'Title': title.strip(),
                            'ApplyUrl': full_url,
                            'Locations': [{'FormattedName': location.strip()}],
                            'City': location.strip().split(',')[0] if ',' in location else location.strip(),
                            'Country': 'US',
                            'Categories': [],
                            'Skills': [],
                            'PostedDate': None,
                            'ExternalReferenceCode': ''
                        })

                    except Exception as e:
                        self.logger.debug("css_card_extraction_failed", error=str(e))
                        continue

                self.logger.info("css_fallback_complete", layout="list", jobs_extracted=len(jobs))
                return jobs

            self.logger.warning("no_jobs_found_in_page", layouts_tried=["table", "list"])
            return []

        except Exception as e:
            self.logger.error("css_extraction_failed", error=str(e))
            return []

    def _map_job_data(self, raw_job: dict, page_url: str) -> dict:
        """
        Map TalentBrew JSON fields to JobPosting model fields.

        Args:
            raw_job: Raw job dict from JSON extraction
            page_url: URL of the page this job was found on

        Returns:
            Dict with JobPosting-compatible fields
        """
        # Extract location from structured Locations array
        location = 'Unknown'
        if raw_job.get('Locations') and len(raw_job['Locations']) > 0:
            location = raw_job['Locations'][0].get('FormattedName', 'Unknown')
        elif raw_job.get('City'):
            # Fallback to City + Country if Locations array is empty
            city = raw_job.get('City', '')
            country = raw_job.get('Country', '')
            location = f"{city}, {country}" if city and country else city or country or 'Unknown'

        # Extract category for skills
        skills = []
        if raw_job.get('Categories') and len(raw_job['Categories']) > 0:
            skills.append(raw_job['Categories'][0].get('Name', ''))

        # Add additional fields as skills
        if raw_job.get('Skills'):
            skills.extend(raw_job['Skills'])

        # Add job family from AdditionalFields if available
        for field in raw_job.get('AdditionalFields', []):
            if field.get('Name') == 'cust_jobfamily' and field.get('RawValue'):
                skills.append(field['RawValue'])

        # Parse posted date
        posted_date = None
        if raw_job.get('PostedDate'):
            try:
                posted_date = dateparser.parse(raw_job['PostedDate'])
            except Exception as e:
                self.logger.debug("date_parse_failed", date_str=raw_job.get('PostedDate'), error=str(e))

        # Build description (JSON doesn't include full description, use summary info)
        # NOTE: For TechnipFMC, this will be replaced with full detail page content
        description_parts = []

        if raw_job.get('Categories') and len(raw_job['Categories']) > 0:
            description_parts.append(f"Category: {raw_job['Categories'][0].get('Name', 'N/A')}")

        # Use Locations details for richer description
        if raw_job.get('Locations') and len(raw_job['Locations']) > 0:
            loc = raw_job['Locations'][0]
            if loc.get('Division1'):  # State
                description_parts.append(f"State: {loc.get('Division1')}")
            if loc.get('Division2'):  # County
                description_parts.append(f"County: {loc.get('Division2')}")

        description = ' | '.join(description_parts) if description_parts else f"{raw_job.get('Title', 'Job')} at {self.company_name}"

        # Ensure minimum description length (JobPosting requires min_length=10)
        if len(description) < 10:
            description = f"{raw_job.get('Title', 'Job posting')} position at {self.company_name} in {location}"

        # Extract employment type from JSON data
        employment_type = None
        # Try direct fields first
        emp_type_raw = (
            raw_job.get('EmploymentType')
            or raw_job.get('PositionType')
            or raw_job.get('JobType')
            or raw_job.get('TimeType')
        )
        if emp_type_raw:
            employment_type = self._normalize_employment_type(emp_type_raw)

        # Check AdditionalFields for custom employment type
        if not employment_type:
            for field in raw_job.get('AdditionalFields', []):
                field_name = field.get('Name', '').lower()
                if field_name in ('cust_employment_type', 'cust_job_type', 'cust_positiontype',
                                  'employmenttype', 'timetype', 'cust_timetype'):
                    if field.get('RawValue'):
                        employment_type = self._normalize_employment_type(field['RawValue'])
                        break

        # Infer from title if still unknown
        if not employment_type:
            title_lower = raw_job.get('Title', '').lower()
            if 'intern' in title_lower or 'student' in title_lower or 'co-op' in title_lower:
                employment_type = 'Internship'
            elif 'contract' in title_lower or 'contingent' in title_lower:
                employment_type = 'Contractor'

        return {
            'title': raw_job.get('Title', 'Unknown Title'),
            'company': self.company_name,
            'location': location,
            'description': description,
            'url': raw_job.get('ApplyUrl', ''),
            'posted_date': posted_date,
            'skills': [s for s in skills if s],  # Filter empty strings
            'salary': None,  # Not available in TalentBrew JSON
            'requisition_id': raw_job.get('ExternalReferenceCode', None),
            'employment_type': employment_type
        }

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """
        Extract job listing summary data from search results page.

        Implements abstract method from BaseScraper. Delegates to _extract_page_jobs
        and maps the results.

        Args:
            page: Playwright page showing job listings

        Returns:
            List of dicts with at minimum: title, url, company
        """
        raw_jobs = await self._extract_page_jobs(page)

        listings = []
        for raw_job in raw_jobs:
            try:
                mapped = self._map_job_data(raw_job, page.url)
                listings.append({
                    'title': mapped['title'],
                    'url': mapped['url'],
                    'company': mapped['company'],
                    'location': mapped['location']
                })
            except Exception as e:
                self.logger.warning("listing_map_failed", error=str(e))
                continue

        return listings

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """
        Extract full job details from job detail page.

        For TechnipFMC, this fetches the full job description from individual job pages
        since the table view only shows title/location.

        Args:
            page: Playwright page instance
            job_url: URL of job detail page

        Returns:
            Dict with job detail fields (description, skills, posted_date)
        """
        try:
            await self._fetch_page(page, job_url)

            # Extract description from detail page
            description = ''
            try:
                # Try TechnipFMC-specific selector first
                desc_elem = page.locator('.jobdescription').first

                if await desc_elem.count() > 0:
                    description = await desc_elem.inner_text()
                else:
                    # Fallback to standard selectors
                    desc_elem = page.locator(
                        '.job-description, '
                        '[data-automation-id="jobPostingDescription"], '
                        '.ats-description, '
                        'span[itemprop="description"]'
                    ).first

                    if await desc_elem.count() > 0:
                        description = await desc_elem.inner_text()
            except Exception as e:
                self.logger.debug("description_extraction_failed", error=str(e))

            # Extract posted date from detail page
            posted_date = None
            try:
                date_elem = page.locator(
                    '.job-date, '
                    '.posted-date, '
                    '[class*="date"]'
                ).first

                if await date_elem.count() > 0:
                    date_text = await date_elem.inner_text()
                    # Clean "Posted" prefix if present
                    date_text = date_text.replace('Posted', '').strip()
                    posted_date = dateparser.parse(date_text)
            except Exception as e:
                self.logger.debug("date_extraction_failed", error=str(e))

            # Extract skills/qualifications
            skills = []
            try:
                skills_elem = page.locator(
                    '.qualifications, '
                    '.requirements, '
                    '[class*="skill"]'
                ).first

                if await skills_elem.count() > 0:
                    skills_text = await skills_elem.inner_text()
                    # Simple heuristic: split by newlines and filter
                    skills = [s.strip() for s in skills_text.split('\n') if s.strip() and len(s.strip()) > 3]
            except Exception as e:
                self.logger.debug("skills_extraction_failed", error=str(e))

            return {
                'description': description if description else '',
                'posted_date': posted_date,
                'skills': skills
            }

        except Exception as e:
            self.logger.error("job_detail_extraction_failed", url=job_url, error=str(e))
            return {
                'description': '',
                'posted_date': None,
                'skills': []
            }
