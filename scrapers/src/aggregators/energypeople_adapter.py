"""Energy People adapter - scrapes energy sector jobs from jobs.energypeople.com.

Energy People (formerly OilCareers) hosts 20K+ energy jobs across O&G, renewables,
nuclear, and power sectors. The job board runs on Drupal with Search API Views,
accessible at jobs.energypeople.com.

Search URL pattern: https://jobs.energypeople.com/jobs?search=<keyword>
Job detail pattern: https://jobs.energypeople.com/job/<id>/<slug>
Pagination: ?search=<keyword>&page=<0-indexed>

No API key required — this is a web scraper.

DISABLED (2026-03-23): The jobs.energypeople.com subdomain refuses all connections
(ECONNREFUSED). The main energypeople.com domain is still live but the Drupal job
board subdomain appears to be decommissioned. Disable to avoid wasting CI time.
"""

import re
import time
import logging
from datetime import datetime

import httpx
from bs4 import BeautifulSoup

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

BASE_URL = "https://jobs.energypeople.com"
SEARCH_URL = f"{BASE_URL}/jobs"

# Delay between requests (seconds) to be respectful
REQUEST_DELAY = 1.5
MAX_PAGES_PER_KEYWORD = 5
RESULTS_PER_PAGE = 25  # Drupal default pager size

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class EnergyPeopleAggregator(BaseAggregator):
    """Scraper adapter for Energy People (jobs.energypeople.com)."""

    name = "energypeople"

    def __init__(self):
        self._client: httpx.Client | None = None

    # Adapter disabled since 2026-03-23: jobs.energypeople.com refuses all
    # connections (ECONNREFUSED). The subdomain appears decommissioned.
    # Re-enable if the job board subdomain comes back online.
    DISABLED = True
    DISABLED_REASON = "jobs.energypeople.com connection refused - subdomain appears decommissioned (since 2026-03-23)"

    def is_configured(self) -> bool:
        if self.DISABLED:
            logger.info(f"EnergyPeople: DISABLED - {self.DISABLED_REASON}")
            return False
        return True

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_client(self) -> httpx.Client:
        """Return a reusable httpx client."""
        if self._client is None:
            self._client = httpx.Client(
                headers=HEADERS,
                follow_redirects=True,
                timeout=30,
            )
        return self._client

    def _build_search_url(self, keyword: str, page: int = 0) -> str:
        """
        Build a search URL for Energy People.

        Drupal Search API Views uses 0-indexed pagination.
        Example: /jobs?search=subsea+engineer&page=0
        """
        params = {"search": keyword}
        if page > 0:
            params["page"] = str(page)
        return f"{SEARCH_URL}?{'&'.join(f'{k}={v}' for k, v in params.items())}"

    def _fetch_page(self, url: str) -> BeautifulSoup:
        """Fetch a page with rate limiting and return parsed HTML."""
        client = self._get_client()
        time.sleep(REQUEST_DELAY)
        resp = client.get(url)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")

    def _parse_results_count(self, soup: BeautifulSoup) -> int:
        """Extract total results count from the search results header."""
        # Drupal Search API typically shows "X Jobs found" or similar
        count_el = soup.select_one(".view-header, .search-result-header, .results-count")
        if count_el:
            text = count_el.get_text(strip=True)
            match = re.search(r"([\d,]+)\s*(jobs?|results?|vacancies)", text, re.IGNORECASE)
            if match:
                return int(match.group(1).replace(",", ""))

        # Fallback: count items on page and check for pager
        items = soup.select(".views-row, .job-listing, .node-job, article.job")
        return len(items)

    def _parse_listing_page(self, soup: BeautifulSoup) -> list[dict]:
        """
        Parse job listing items from a search results page.

        Energy People Drupal site uses views rows with job node data.
        Multiple possible selectors tried for robustness.
        """
        jobs = []

        # Try common Drupal job listing selectors
        articles = soup.select(
            ".views-row, "
            "article.node-job, "
            ".job-listing, "
            ".search-result, "
            "tr.views-row-inner"
        )

        for article in articles:
            try:
                # Title and URL — look for the primary link
                link = (
                    article.select_one("h2 a, h3 a, .views-field-title a, "
                                       ".job-title a, a.job-link")
                )
                if not link:
                    continue

                title = link.get_text(strip=True)
                href = link.get("href", "")
                if not title or not href:
                    continue

                if not href.startswith("http"):
                    href = f"{BASE_URL}{href}"

                # Company
                company_el = article.select_one(
                    ".views-field-field-company, "
                    ".field-company, "
                    ".company-name, "
                    ".views-field-field-employer"
                )
                company = company_el.get_text(strip=True) if company_el else "Unknown"
                # Strip label prefix like "Company: "
                company = re.sub(r"^(company|employer)\s*:\s*", "", company, flags=re.IGNORECASE).strip()

                # Location
                loc_el = article.select_one(
                    ".views-field-field-location, "
                    ".field-location, "
                    ".location, "
                    ".views-field-field-country"
                )
                location = loc_el.get_text(strip=True) if loc_el else "Unknown"
                location = re.sub(r"^location\s*:\s*", "", location, flags=re.IGNORECASE).strip()

                # Date
                date_el = article.select_one(
                    ".views-field-created, "
                    ".views-field-changed, "
                    ".date-display-single, "
                    ".field-date, "
                    "time"
                )
                date_text = ""
                if date_el:
                    # Check for datetime attribute first
                    date_text = date_el.get("datetime", "") or date_el.get_text(strip=True)

                # Employment type / job type
                type_el = article.select_one(
                    ".views-field-field-job-type, "
                    ".field-job-type, "
                    ".job-type"
                )
                job_type = type_el.get_text(strip=True) if type_el else ""

                # Salary
                salary_el = article.select_one(
                    ".views-field-field-salary, "
                    ".field-salary, "
                    ".salary"
                )
                salary = salary_el.get_text(strip=True) if salary_el else ""
                salary = re.sub(r"^salary\s*:\s*", "", salary, flags=re.IGNORECASE).strip()

                # Description snippet
                desc_el = article.select_one(
                    ".views-field-body, "
                    ".views-field-search-api-excerpt, "
                    ".field-body, "
                    ".description, "
                    ".search-snippet"
                )
                description = desc_el.get_text(strip=True) if desc_el else ""

                jobs.append({
                    "title": title,
                    "company": company if company else "Unknown",
                    "location": location if location else "Unknown",
                    "url": href,
                    "date_text": date_text,
                    "employment_type": job_type,
                    "salary": salary if salary else None,
                    "description": description,
                })

            except Exception as e:
                logger.debug(f"EnergyPeople: error parsing listing: {e}")
                continue

        return jobs

    def _has_next_page(self, soup: BeautifulSoup, current_page: int) -> bool:
        """Check if there is a next page in the Drupal pager."""
        # Drupal pager uses .pager-next or .pager__item--next
        next_link = soup.select_one(
            ".pager-next a, "
            ".pager__item--next a, "
            "li.next a, "
            "a[rel='next']"
        )
        return next_link is not None

    def _parse_date(self, date_text: str) -> datetime | None:
        """Parse date strings from Energy People listings."""
        if not date_text:
            return None
        # Try ISO format first (from datetime attribute)
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d", "%d/%m/%Y",
                    "%d %b %Y", "%d %B %Y", "%b %d, %Y"):
            try:
                return datetime.strptime(date_text.strip(), fmt)
            except ValueError:
                continue
        # Try dateparser as fallback
        try:
            import dateparser
            return dateparser.parse(date_text)
        except (ImportError, Exception):
            pass
        return None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def count(self, filters: AggregatorFilters) -> int:
        """Get approximate count of matching jobs."""
        total = 0
        for keyword in filters.keywords[:3]:
            try:
                url = self._build_search_url(keyword)
                soup = self._fetch_page(url)
                count = self._parse_results_count(soup)
                total += count
                logger.info(f"EnergyPeople: '{keyword}' has {count:,} results")
            except Exception as e:
                logger.warning(f"EnergyPeople count failed for '{keyword}': {e}")
        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """
        Search Energy People for jobs matching filters.

        For each keyword:
        1. Fetch search results page(s) with pagination
        2. Parse listing items for title, company, location, URL
        3. Return list of validated JobPosting objects
        """
        results: list[JobPosting] = []
        seen: set[str] = set()

        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break

            page = 0
            keyword_results = 0

            while page < MAX_PAGES_PER_KEYWORD and len(results) < filters.max_results:
                try:
                    url = self._build_search_url(keyword, page=page)
                    logger.info(f"EnergyPeople: fetching {url}")
                    soup = self._fetch_page(url)

                    listings = self._parse_listing_page(soup)
                    if not listings:
                        break  # No more results

                    for listing in listings:
                        if len(results) >= filters.max_results:
                            break

                        # Dedup by URL
                        job_url = listing["url"]
                        if job_url in seen:
                            continue
                        seen.add(job_url)

                        # Also dedup by title+company
                        dedup_key = f"{listing['title'].lower()}|{listing['company'].lower()}"
                        if dedup_key in seen:
                            continue
                        seen.add(dedup_key)

                        # Build description
                        description = listing.get("description", "")
                        if not description or len(description) < 10:
                            description = (
                                f"{listing['title']} at {listing['company']} "
                                f"- {listing['location']}"
                            )

                        posted_date = self._parse_date(listing.get("date_text", ""))

                        try:
                            job = JobPosting(
                                title=listing["title"],
                                company=listing["company"],
                                location=listing["location"],
                                description=description,
                                url=job_url,
                                salary=listing.get("salary"),
                                posted_date=posted_date,
                                employment_type=listing.get("employment_type"),
                                source_aggregator="energypeople",
                            )
                            results.append(job)
                            keyword_results += 1
                        except Exception as e:
                            logger.debug(f"EnergyPeople: skipping job (validation): {e}")

                    # Check for next page
                    if not self._has_next_page(soup, page):
                        break
                    page += 1

                except Exception as e:
                    logger.warning(
                        f"EnergyPeople search failed for '{keyword}' page {page}: {e}"
                    )
                    break

            logger.info(f"EnergyPeople: '{keyword}' yielded {keyword_results} jobs")

        logger.info(f"EnergyPeople: found {len(results)} unique jobs total")
        return results[:filters.max_results]
