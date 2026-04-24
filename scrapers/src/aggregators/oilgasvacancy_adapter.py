"""Oil Gas Vacancy adapter - scrapes global offshore energy jobs.

OilGasVacancy.com is a WordPress-based job board focused on global offshore and
energy sector positions. The site uses WP Job Manager for individual job listings
but search uses the standard WordPress search (/?s=keyword).

Search URL pattern: https://www.oilgasvacancy.com/?s=<keyword>
Pagination: /page/<N>/?s=<keyword>  (1-indexed)
Job listings use <li class="job_listing"> elements with:
  - <a href="..."> wrapping the listing
  - .position > h3 for title
  - ul.meta > li.location, li.company, li.job-type

The site also has country-specific pages (e.g. /jobs-in-usa/) which can be
used as an alternative search strategy for location-specific queries.

No API key required — this is a web scraper.
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

BASE_URL = "https://www.oilgasvacancy.com"

# Delay between requests (seconds). Bumped 2026-04-24: prior 1.5s was
# triggering 429 rate limits across multiple search profiles per day.
REQUEST_DELAY = 4.0
MAX_PAGES_PER_KEYWORD = 3
# On 429, back off this many seconds before abandoning the keyword.
RATE_LIMIT_BACKOFF = 15.0

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class OilGasVacancyAggregator(BaseAggregator):
    """Scraper adapter for OilGasVacancy.com — global offshore energy jobs."""

    name = "oilgasvacancy"

    def __init__(self):
        self._client: httpx.Client | None = None

    def is_configured(self) -> bool:
        """No API key needed — always configured."""
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

    def _build_search_url(self, keyword: str, page: int = 1) -> str:
        """
        Build a WordPress search URL for Oil Gas Vacancy.

        Page 1: https://www.oilgasvacancy.com/?s=subsea
        Page N: https://www.oilgasvacancy.com/page/N/?s=subsea
        """
        encoded_kw = keyword.replace(" ", "+")
        if page <= 1:
            return f"{BASE_URL}/?s={encoded_kw}"
        return f"{BASE_URL}/page/{page}/?s={encoded_kw}"

    def _fetch_page(self, url: str) -> BeautifulSoup:
        """Fetch a page with rate limiting and return parsed HTML.

        On HTTP 429, sleep RATE_LIMIT_BACKOFF seconds and retry once.
        If the retry also 429s, raise so the caller breaks out of the
        keyword loop rather than hammering the site.
        """
        client = self._get_client()
        time.sleep(REQUEST_DELAY)
        resp = client.get(url)
        if resp.status_code == 429:
            logger.warning(
                f"OilGasVacancy: 429 rate-limit on {url}, "
                f"backing off {RATE_LIMIT_BACKOFF}s"
            )
            time.sleep(RATE_LIMIT_BACKOFF)
            resp = client.get(url)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")

    def _parse_results_count(self, soup: BeautifulSoup) -> int:
        """
        Extract total results count from the pagination.

        Pagination shows "Page 1 of N" where N is total pages.
        We multiply by the estimated per-page count.
        """
        pag = soup.select_one(".pagination")
        if pag:
            pages_span = pag.select_one("span.pages")
            if pages_span:
                text = pages_span.get_text(strip=True)
                match = re.search(r"of\s+(\d+)", text)
                if match:
                    total_pages = int(match.group(1))
                    # Estimate: count items on current page * total pages
                    items = soup.select("li.job_listing")
                    per_page = len(items) if items else 10
                    return total_pages * per_page

        # Fallback: just count items on the page
        items = soup.select("li.job_listing")
        return len(items)

    def _parse_listing_page(self, soup: BeautifulSoup) -> list[dict]:
        """
        Parse job listings from a search results page.

        Each listing is an <li class="job_listing"> containing:
        - <a href="..."> wrapping the content
        - <div class="position"><h3>Title</h3></div>
        - <ul class="meta">
            <li class="location">Location</li>
            <li class="company">Company Name</li>
            <li class="job-type full-time">Full Time</li>
          </ul>
        """
        jobs = []

        for li in soup.select("li.job_listing"):
            try:
                # URL from the wrapping <a> tag
                link = li.find("a")
                if not link:
                    continue
                href = link.get("href", "")
                if not href:
                    continue

                # Title from .position > h3
                title_el = li.select_one(".position h3, h3")
                title = title_el.get_text(strip=True) if title_el else ""
                if not title:
                    continue

                # Company from li.company in the meta list
                company_el = li.select_one("li.company")
                company = company_el.get_text(strip=True) if company_el else "Unknown"

                # Location from li.location
                loc_el = li.select_one("li.location")
                location = loc_el.get_text(strip=True) if loc_el else "Unknown"

                # Job type from li.job-type
                type_el = li.select_one("li.job-type")
                job_type = type_el.get_text(strip=True) if type_el else ""

                # Date — check for time element or date li
                date_text = ""
                time_el = li.find("time")
                if time_el:
                    date_text = time_el.get("datetime", "") or time_el.get_text(strip=True)
                else:
                    date_el = li.select_one("li.date")
                    if date_el:
                        date_text = date_el.get_text(strip=True)

                jobs.append({
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": href,
                    "date_text": date_text,
                    "employment_type": job_type,
                })

            except Exception as e:
                logger.debug(f"OilGasVacancy: error parsing listing: {e}")
                continue

        # Also parse blog-style post listings (WP search may return posts)
        # These appear as <article> elements in the search results
        for article in soup.select("article.post, article.type-post"):
            try:
                link = article.find("a")
                if not link:
                    continue
                href = link.get("href", "")
                title_el = article.select_one("h2 a, h3 a, .entry-title a")
                if not title_el:
                    continue
                title = title_el.get_text(strip=True)
                if not title:
                    continue

                # These are typically company overview posts, not individual jobs
                # Include them as they often list multiple vacancies
                desc_el = article.select_one(".entry-content, .entry-summary, p")
                description = desc_el.get_text(strip=True) if desc_el else ""

                jobs.append({
                    "title": title,
                    "company": "See listing",
                    "location": "Various",
                    "url": href,
                    "date_text": "",
                    "employment_type": "",
                    "description": description,
                })
            except Exception as e:
                logger.debug(f"OilGasVacancy: error parsing article: {e}")
                continue

        return jobs

    def _has_next_page(self, soup: BeautifulSoup, current_page: int) -> bool:
        """Check if there is a next page in the pagination."""
        pag = soup.select_one(".pagination")
        if not pag:
            return False

        # Look for the next page link
        next_link = pag.find("a", class_="page", title=str(current_page + 1))
        if next_link:
            return True

        # Also check for "next" span/link
        next_span = pag.select_one("#tie-next-page a, a.next")
        return next_span is not None

    def _parse_date(self, date_text: str) -> datetime | None:
        """Parse date strings."""
        if not date_text:
            return None
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d", "%d/%m/%Y",
                    "%d %b %Y", "%B %d, %Y"):
            try:
                return datetime.strptime(date_text.strip(), fmt)
            except ValueError:
                continue
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
                logger.info(f"OilGasVacancy: '{keyword}' has {count:,} results")
            except Exception as e:
                logger.warning(f"OilGasVacancy count failed for '{keyword}': {e}")
        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """
        Search Oil Gas Vacancy for jobs matching filters.

        For each keyword:
        1. Fetch WordPress search results page(s)
        2. Parse job listing <li> elements and blog post articles
        3. Return list of validated JobPosting objects
        """
        results: list[JobPosting] = []
        seen: set[str] = set()

        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break

            page = 1
            keyword_results = 0

            while page <= MAX_PAGES_PER_KEYWORD and len(results) < filters.max_results:
                try:
                    url = self._build_search_url(keyword, page=page)
                    logger.info(f"OilGasVacancy: fetching {url}")
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
                                posted_date=posted_date,
                                employment_type=listing.get("employment_type"),
                                source_aggregator="oilgasvacancy",
                            )
                            results.append(job)
                            keyword_results += 1
                        except Exception as e:
                            logger.debug(
                                f"OilGasVacancy: skipping job (validation): {e}"
                            )

                    # Check for next page
                    if not self._has_next_page(soup, page):
                        break
                    page += 1

                except Exception as e:
                    logger.warning(
                        f"OilGasVacancy search failed for '{keyword}' page {page}: {e}"
                    )
                    break

            logger.info(f"OilGasVacancy: '{keyword}' yielded {keyword_results} jobs")

        logger.info(f"OilGasVacancy: found {len(results)} unique jobs total")
        return results[:filters.max_results]
