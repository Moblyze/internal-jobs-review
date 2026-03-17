"""
gCaptain Jobs adapter - scrapes the largest maritime/offshore job board.

gCaptain (jobsite.gcaptain.com) is a Cloudflare-protected maritime job site
with ~60K views/month. Uses httpx + BeautifulSoup to scrape search results.

Cloudflare challenge: The site uses Cloudflare managed challenge which cannot
be solved programmatically without a headless browser. This adapter handles
the challenge gracefully by detecting the block and reporting it.

No API key required - this is a web scraper (when Cloudflare allows through).
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

BASE_URL = "https://jobsite.gcaptain.com"

# Delay between requests to avoid rate limiting
REQUEST_DELAY = 2.0

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://jobsite.gcaptain.com/",
}


class GCaptainAggregator(BaseAggregator):
    """Scraper adapter for gCaptain Jobs (jobsite.gcaptain.com).

    Maritime and offshore job board with Cloudflare protection.
    Search URL pattern: /jobs/?search_keywords={keyword}&search_location={location}
    Pagination: /jobs/page/{page}/?search_keywords={keyword}
    Job detail: /job/{slug}/
    """

    name = "gcaptain"

    def __init__(self):
        self._client: httpx.Client | None = None
        self._cf_blocked = False

    def is_configured(self) -> bool:
        """No API key needed - always configured (may be blocked by Cloudflare)."""
        return True

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                timeout=30,
                follow_redirects=True,
                headers=HEADERS,
            )
        return self._client

    def _is_cf_challenge(self, resp: httpx.Response) -> bool:
        """Check if Cloudflare is blocking us with a managed challenge."""
        text = resp.text[:2000] if resp.text else ""
        return (
            "Just a moment" in text
            or "challenge-platform" in text
            or "_cf_chl_opt" in text
        )

    def _fetch_page(self, url: str) -> BeautifulSoup | None:
        """Fetch a page, returning None if Cloudflare blocks us."""
        if self._cf_blocked:
            return None

        client = self._get_client()
        time.sleep(REQUEST_DELAY)

        try:
            resp = client.get(url)
            if self._is_cf_challenge(resp):
                logger.warning(
                    "gCaptain: Cloudflare challenge detected - cannot scrape. "
                    "Site requires browser-based verification."
                )
                self._cf_blocked = True
                return None
            resp.raise_for_status()
            return BeautifulSoup(resp.text, "html.parser")
        except httpx.HTTPStatusError as e:
            logger.warning(f"gCaptain: HTTP error {e.response.status_code} for {url}")
            return None
        except Exception as e:
            logger.warning(f"gCaptain: request error for {url}: {e}")
            return None

    def _build_search_url(self, keyword: str, location: str = "",
                          page: int = 1) -> str:
        """Build search URL for gCaptain job board.

        URL pattern: /jobs/page/{page}/?search_keywords={keyword}&search_location={location}
        Page 1 omits the /page/1/ segment.
        """
        base = f"{BASE_URL}/jobs/"
        if page > 1:
            base = f"{BASE_URL}/jobs/page/{page}/"

        params = f"?search_keywords={keyword}"
        if location:
            params += f"&search_location={location}"
        return base + params

    def _parse_listing_page(self, soup: BeautifulSoup) -> list[dict]:
        """Parse job listings from search results page.

        gCaptain uses WP Job Manager plugin. Expected structure:
          <ul class="job_listings">
            <li class="job_listing" data-...>
              <a href="/job/{slug}/">
                <div class="position"><h3>Title</h3></div>
                <div class="company"><strong>Company</strong></div>
                <div class="location">Location</div>
                <ul class="meta">
                  <li class="job-type contract">Contract</li>
                  <li class="date">Posted X ago</li>
                </ul>
              </a>
            </li>
        """
        jobs = []

        # WP Job Manager uses <li class="job_listing"> elements
        for li in soup.select("li.job_listing, li[class*=job_listing]"):
            try:
                link = li.find("a", href=True)
                if not link:
                    continue

                href = link.get("href", "")
                if not href.startswith("http"):
                    href = BASE_URL + href

                # Title
                title_el = li.select_one(".position h3, .job_listing-title, h3")
                title = title_el.get_text(strip=True) if title_el else ""
                if not title:
                    continue

                # Company
                company_el = li.select_one(".company strong, .job_listing-company strong, .company")
                company = company_el.get_text(strip=True) if company_el else "Unknown"

                # Location
                loc_el = li.select_one(".location, .job_listing-location")
                location = loc_el.get_text(strip=True) if loc_el else "Unknown"

                # Job type
                type_el = li.select_one(".job-type, [class*=job-type]")
                job_type = type_el.get_text(strip=True) if type_el else None

                # Date
                date_el = li.select_one(".date time, .date, .listed-date")
                date_text = date_el.get_text(strip=True) if date_el else ""

                jobs.append({
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": href,
                    "employment_type": job_type,
                    "date_text": date_text,
                })
            except Exception as e:
                logger.debug(f"gCaptain: error parsing listing: {e}")
                continue

        return jobs

    def _parse_results_count(self, soup: BeautifulSoup) -> int:
        """Extract total results count from search header."""
        # WP Job Manager typically shows "X Jobs Found" or "Showing X-Y of Z"
        found_el = soup.select_one(".showing_jobs, .job-count, .results-found")
        if found_el:
            text = found_el.get_text(strip=True)
            match = re.search(r"(\d[\d,]*)", text)
            if match:
                return int(match.group(1).replace(",", ""))

        # Fallback: count the listings on the page
        listings = soup.select("li.job_listing, li[class*=job_listing]")
        return len(listings)

    def _parse_date(self, date_text: str) -> datetime | None:
        """Parse date strings like 'Posted 2 days ago' or '03/15/2026'."""
        if not date_text:
            return None
        for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%b %d, %Y", "%B %d, %Y"):
            try:
                return datetime.strptime(date_text.strip(), fmt)
            except ValueError:
                continue
        return None

    def count(self, filters: AggregatorFilters) -> int:
        """Get approximate count of matching jobs."""
        total = 0
        for keyword in filters.keywords[:3]:
            try:
                url = self._build_search_url(keyword)
                soup = self._fetch_page(url)
                if soup is None:
                    continue
                count = self._parse_results_count(soup)
                total += count
                logger.info(f"gCaptain: '{keyword}' has {count} results")
            except Exception as e:
                logger.warning(f"gCaptain count failed for '{keyword}': {e}")
        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search gCaptain for maritime/offshore jobs matching filters."""
        results: list[JobPosting] = []
        seen: set[str] = set()

        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break

            page = 1
            max_pages = 5

            while page <= max_pages and len(results) < filters.max_results:
                try:
                    url = self._build_search_url(keyword, page=page)
                    logger.info(f"gCaptain: fetching {url}")
                    soup = self._fetch_page(url)

                    if soup is None:
                        break

                    listings = self._parse_listing_page(soup)
                    if not listings:
                        break

                    for listing in listings:
                        if len(results) >= filters.max_results:
                            break

                        # Dedup by URL
                        job_url = listing["url"]
                        if job_url in seen:
                            continue
                        seen.add(job_url)

                        # Dedup by title+company
                        dedup_key = f"{listing['title'].lower()}|{listing['company'].lower()}"
                        if dedup_key in seen:
                            continue
                        seen.add(dedup_key)

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
                                source_aggregator="gcaptain",
                            )
                            results.append(job)
                        except Exception as e:
                            logger.debug(f"gCaptain: skipping job (validation): {e}")

                    page += 1

                except Exception as e:
                    logger.warning(f"gCaptain search failed for '{keyword}' page {page}: {e}")
                    break

        logger.info(f"gCaptain: found {len(results)} unique jobs")
        return results[:filters.max_results]
