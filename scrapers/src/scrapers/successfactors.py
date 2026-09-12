"""SuccessFactors/TalentBrew scraper for Halliburton career portal."""

import asyncio
import json
import random
import re
from datetime import datetime
from typing import Callable, Optional

import dateparser
import httpx
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page, TimeoutError as PlaywrightTimeout

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()

# Detail-page description containers, in order of preference. TalentBrew job
# pages (Halliburton) carry the full posting in a JSON-LD JobPosting block and
# in div.ats-description; section.job-description wraps the whole card.
_DESCRIPTION_SELECTORS = [
    'div.ats-description',
    '.ats-description',
    'span[itemprop="description"]',
    '.jobdescription',
    'section.job-description',
    '.job-description',
    '[data-automation-id="jobPostingDescription"]',
]
_BLOCK_TAGS = ['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'section']

# SuccessFactors pages sometimes include cookie/privacy banners whose links
# look enough like job cards that the CSS fallback extractor picks them up.
# Drop these before Pydantic validation to keep logs clean and the dedup
# tracker free of noise.
_NON_JOB_TITLES = {
    'cookie policy',
    'cookie information',
    'cookie settings',
    'cookie preferences',
    'privacy policy',
    'privacy notice',
    'privacy statement',
    'terms of use',
    'terms and conditions',
    'accessibility statement',
    'legal notice',
    'imprint',
}
_NON_JOB_TITLE_PREFIXES = (
    'cookie ',
    'privacy ',
    'terms ',
)


class SuccessFactorsScraper(BaseScraper):
    """
    Scraper for SuccessFactors career portals using TalentBrew frontend.

    Halliburton's careers.halliburton.com site embeds job data as JSON in the page HTML
    via console.log() statement. This scraper extracts that JSON for reliable pagination
    and job data retrieval.

    Pagination uses URL-based pattern: /search-jobs&p={page_number}

    Detail pages are fetched with plain HTTP first (they are server-rendered,
    and the 2026-09 Halliburton rows showed the browser path storing the
    53-79 char listing summary instead of the ~3,000 char posting); the
    browser is only used for a detail page the HTTP fetch cannot read.
    """

    def __init__(self, config: dict):
        super().__init__(config)
        self._known_url_checker: Optional[Callable[[str], bool]] = None
        self._http: Optional[httpx.AsyncClient] = None
        self._detail_lengths: list[int] = []

    def set_known_url_checker(self, checker: Callable[[str], bool]) -> None:
        """Jobs already exported skip the detail fetch: the lifecycle diff only
        needs their URL, and the tracker filters them out before export."""
        self._known_url_checker = checker

    def _http_headers(self) -> dict:
        return {
            'User-Agent': (
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        }

    @staticmethod
    def _html_to_text(node) -> str:
        if node is None:
            return ''
        for br in node.find_all('br'):
            br.replace_with('\n')
        for tag in node.find_all(_BLOCK_TAGS):
            tag.insert_before('\n')
            tag.insert_after('\n')
        lines = [' '.join(ln.split()) for ln in node.get_text().split('\n')]
        return '\n'.join(ln for ln in lines if ln)

    @classmethod
    def parse_detail_html(cls, html: str) -> dict:
        """Pull the posting body out of a detail page's HTML.

        Prefers the JSON-LD JobPosting description (complete, structured),
        then the longest of the known description containers.
        """
        soup = BeautifulSoup(html, 'html.parser')
        description = ''
        source = None
        for script in soup.select('script[type="application/ld+json"]'):
            try:
                data = json.loads(script.string or '')
            except (ValueError, TypeError):
                continue
            items = data if isinstance(data, list) else [data]
            for item in items:
                if isinstance(item, dict) and item.get('@type') == 'JobPosting' and item.get('description'):
                    text = cls._html_to_text(BeautifulSoup(item['description'], 'html.parser'))
                    if len(text) > len(description):
                        description, source = text, 'json-ld'
        if len(description) < 200:
            # First selector (most specific container) with a real body wins;
            # only if none has one, fall back to the longest text seen.
            longest, longest_source = description, source
            for selector in _DESCRIPTION_SELECTORS:
                best = ''
                for node in soup.select(selector):
                    text = cls._html_to_text(node)
                    if len(text) > len(best):
                        best = text
                if len(best) >= 200:
                    return {'description': best, 'source': selector}
                if len(best) > len(longest):
                    longest, longest_source = best, selector
            description, source = longest, longest_source
        return {'description': description, 'source': source}

    async def _fetch_detail_http(self, job_url: str) -> dict:
        """Plain GET of the detail page; {} when the page cannot be read."""
        if self._http is None:
            self._http = httpx.AsyncClient(headers=self._http_headers(), follow_redirects=True)
        try:
            resp = await self._http.get(job_url, timeout=30.0)
        except httpx.HTTPError as e:
            self.logger.warning("detail_http_failed", url=job_url, error=str(e))
            return {}
        if resp.status_code != 200:
            self.logger.warning("detail_http_status", url=job_url, status=resp.status_code)
            return {}
        parsed = self.parse_detail_html(resp.text)
        if not parsed['description']:
            self.logger.warning("detail_http_no_description", url=job_url)
            return {}
        return {'description': parsed['description'], 'posted_date': None, 'skills': [],
                'source': parsed['source']}

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
        self._detail_lengths = []
        skipped_known = 0

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
            # URLs collected so far in this run. A page that adds nothing new
            # means pagination has wrapped or the site is ignoring the page
            # parameter (Phillips 66, 2026-09: ?p=N returned page 1 every time,
            # and ?startrow=N past the end returns a fallback set, so the
            # "empty page" stop above never fired and the scraper re-fetched
            # the same detail pages until it hit the company timeout).
            seen_urls: set[str] = set()

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

                # Drop jobs already collected on an earlier page; stop when a
                # whole page is repeats.
                fresh_jobs = []
                for raw_job in page_jobs:
                    apply_url = (raw_job.get('ApplyUrl') or '').strip()
                    if apply_url and apply_url in seen_urls:
                        continue
                    if apply_url:
                        seen_urls.add(apply_url)
                    fresh_jobs.append(raw_job)

                if not fresh_jobs:
                    self.logger.info(
                        "pagination_complete",
                        reason="no_new_jobs_on_page",
                        page_num=page_num,
                        repeated=len(page_jobs),
                    )
                    break
                page_jobs = fresh_jobs

                self.logger.info("page_extracted", page_num=page_num, jobs_count=len(page_jobs))

                # Map and validate each job
                for raw_job in page_jobs:
                    # Filter out non-job links (cookie banner / legal footer rows
                    # that the fallback CSS extractor occasionally picks up).
                    _title = (raw_job.get('Title') or '').strip().lower()
                    if _title in _NON_JOB_TITLES or any(
                        _title.startswith(p) for p in _NON_JOB_TITLE_PREFIXES
                    ):
                        continue
                    try:
                        job_data = self._map_job_data(raw_job, page_url)

                        known = bool(
                            job_data.get('url') and self._known_url_checker
                            and self._known_url_checker(job_data['url'])
                        )
                        if known:
                            # Already on the sheet: URL is all the lifecycle
                            # needs; the tracker drops this job before export.
                            skipped_known += 1
                        # Fetch full job details if URL is available (TechnipFMC needs this)
                        elif job_data.get('url') and len(job_data.get('description', '')) < 100:
                            self.logger.debug("fetching_full_details", url=job_data['url'])
                            try:
                                detail_data = await self.extract_job_detail(page, job_data['url'])
                                # Update with full description if available
                                if detail_data.get('description') and len(detail_data['description']) > len(job_data.get('description', '')):
                                    job_data['description'] = detail_data['description']
                                    self._detail_lengths.append(len(detail_data['description']))
                                else:
                                    self.logger.warning(
                                        "detail_description_not_longer",
                                        url=job_data['url'],
                                        summary_len=len(job_data.get('description', '')),
                                        detail_len=len(detail_data.get('description') or ''),
                                    )
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

            self._log_extraction_complete(jobs, page_num, skipped_known)
            return jobs

        finally:
            if context:
                await self._close_browser()
            if self._http is not None:
                await self._http.aclose()
                self._http = None

    def _log_extraction_complete(self, jobs: list, page_num: int, skipped_known: int) -> None:
        lengths = sorted(self._detail_lengths)
        self.logger.info(
            "extraction_complete",
            total_jobs=len(jobs),
            pages_processed=page_num,
            listing_only=skipped_known,
            details_fetched=len(lengths),
            detail_len_min=lengths[0] if lengths else None,
            detail_len_median=lengths[len(lengths) // 2] if lengths else None,
            detail_len_max=lengths[-1] if lengths else None,
        )

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

            # Fallback to list-based layout (Halliburton, PG&E)
            # Note: prefer '#search-results-list li' over '[data-job-id]' to avoid
            # matching Save Job <button data-job-id> elements on PG&E-style portals.
            job_cards = await page.locator(
                '#search-results-list li, '
                '.search-results-list .job-result'
            ).all()

            if job_cards and len(job_cards) > 0:
                self.logger.info("list_layout_detected", cards_count=len(job_cards))

                for card in job_cards:
                    try:
                        title = None
                        url = None

                        # Strategy A: link-inside-heading (Halliburton: <h2><a>Title</a></h2>)
                        title_link = card.locator(
                            'h2 a, '
                            '[role="heading"] a, '
                            '.job-title a'
                        ).first

                        if await title_link.count() > 0:
                            title = await title_link.inner_text(timeout=5000)
                            url = await title_link.get_attribute('href', timeout=5000)

                        # Strategy B: heading-inside-link (PG&E: <a><h2>Title</h2></a>)
                        if not title:
                            outer_link = card.locator('a:has(h2)').first
                            if await outer_link.count() > 0:
                                url = await outer_link.get_attribute('href', timeout=5000)
                                heading = outer_link.locator('h2').first
                                if await heading.count() > 0:
                                    title = await heading.inner_text(timeout=5000)

                        # Strategy C: any <a> that looks like a job link
                        if not title:
                            any_link = card.locator('a[href*="/job/"]').first
                            if await any_link.count() > 0:
                                url = await any_link.get_attribute('href', timeout=5000)
                                title = (await any_link.inner_text(timeout=5000)).strip().split('\n')[0]

                        if not title or not url:
                            self.logger.debug("css_card_no_title_or_url", card_html=(await card.inner_html())[:200])
                            continue

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
        # Server-rendered pages: one plain GET, no browser.
        http_detail = await self._fetch_detail_http(job_url)
        if http_detail.get('description'):
            self.logger.debug("detail_via_http", url=job_url, source=http_detail.get('source'),
                              length=len(http_detail['description']))
            return {k: v for k, v in http_detail.items() if k != 'source'}

        try:
            await self._fetch_page(page, job_url)

            # Extract description from the rendered DOM: parse the page HTML
            # with the same rules as the HTTP path (JSON-LD first, then the
            # longest known container) instead of `.first` of a selector list,
            # which picked the wrapper section on Halliburton.
            description = ''
            try:
                parsed = self.parse_detail_html(await page.content())
                description = parsed['description']
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
