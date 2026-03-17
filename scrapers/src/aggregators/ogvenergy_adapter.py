"""OGV Energy adapter - scrapes energy jobs from jobs.globalenergynetwork.net.

OGV Energy (ogv.energy) redirects its job board to jobs.globalenergynetwork.net,
which runs WordPress with the WP Job Manager plugin. Job listings are loaded via
AJAX using the standard WP Job Manager endpoint.

AJAX endpoint: /jm-ajax/get_listings/
Search param: search_keywords
Pagination: page (1-indexed), per_page (default 10)

The AJAX endpoint returns JSON with an HTML snippet in the "html" field that
contains <li class="job_listing"> elements.

No API key required — this is a web scraper using the public AJAX API.
"""

import re
import time
import json
import logging
from datetime import datetime

import httpx
from bs4 import BeautifulSoup

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

BASE_URL = "https://jobs.globalenergynetwork.net"
AJAX_URL = f"{BASE_URL}/jm-ajax/get_listings/"

# WP Job Manager default per_page
PER_PAGE = 10
MAX_PAGES_PER_KEYWORD = 5

# Delay between requests (seconds)
REQUEST_DELAY = 1.5

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": f"{BASE_URL}/jobs/",
}


class OGVEnergyAggregator(BaseAggregator):
    """Scraper adapter for OGV Energy / Global Energy Network job board."""

    name = "ogvenergy"

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

    def _fetch_listings(self, keyword: str, page: int = 1,
                        per_page: int = PER_PAGE) -> dict:
        """
        Fetch job listings from the WP Job Manager AJAX endpoint.

        Returns the JSON response dict with keys:
        - found_jobs (bool): whether any jobs were found
        - html (str): HTML snippet containing job listing <li> elements
        - filter_value (list): applied filters
        - max_num_pages (int): total number of pages
        - showing (str): e.g. "Showing all 42 jobs"
        """
        client = self._get_client()
        time.sleep(REQUEST_DELAY)

        params = {
            "search_keywords": keyword,
            "search_location": "",
            "per_page": str(per_page),
            "orderby": "featured",
            "order": "DESC",
            "page": str(page),
        }

        resp = client.get(AJAX_URL, params=params)
        resp.raise_for_status()

        try:
            return resp.json()
        except json.JSONDecodeError:
            logger.warning("OGVEnergy: invalid JSON response from AJAX endpoint")
            return {"found_jobs": False, "html": "", "max_num_pages": 0}

    def _parse_results_count(self, data: dict) -> int:
        """Extract total results count from the AJAX response."""
        showing = data.get("showing", "")
        if showing:
            # "Showing all 42 jobs" or "Showing 1-10 of 42 jobs"
            match = re.search(r"(\d+)\s+jobs?", showing, re.IGNORECASE)
            if match:
                return int(match.group(1))
            # "Showing all X" without "jobs"
            match = re.search(r"all\s+(\d+)", showing, re.IGNORECASE)
            if match:
                return int(match.group(1))
            # "Showing X-Y of Z"
            match = re.search(r"of\s+(\d+)", showing, re.IGNORECASE)
            if match:
                return int(match.group(1))
        return 0

    def _parse_listings_html(self, html: str) -> list[dict]:
        """
        Parse job listings from the HTML snippet returned by the AJAX endpoint.

        Each listing is an <li> with class "job_listing" containing:
        - <a href="..."> wrapping the entire listing
        - <div class="position"><h3>Title</h3></div>
        - <ul class="meta">
            <li class="location">Location</li>
            <li class="company">Company <img ...></li>
            <li class="job-type contract">Contract</li>
            <li class="date"><time datetime="...">X days ago</time></li>
          </ul>
        """
        if not html:
            return []

        soup = BeautifulSoup(html, "html.parser")
        jobs = []

        for li in soup.find_all("li", class_="job_listing"):
            try:
                # URL from the wrapping <a> tag
                link = li.find("a")
                if not link:
                    continue
                href = link.get("href", "")
                if not href:
                    continue

                # Title
                title_el = li.select_one(".position h3, h3")
                title = title_el.get_text(strip=True) if title_el else ""
                if not title:
                    continue

                # Company
                company_el = li.select_one("li.company, .company")
                company = "Unknown"
                if company_el:
                    # Company element may contain an image; get just the text
                    company = company_el.get_text(strip=True)
                    if not company:
                        # Try the strong/span inside
                        inner = company_el.find(["strong", "span"])
                        company = inner.get_text(strip=True) if inner else "Unknown"

                # Location
                loc_el = li.select_one("li.location, .location")
                location = loc_el.get_text(strip=True) if loc_el else "Unknown"

                # Job type
                type_el = li.select_one("li.job-type, .job-type")
                job_type = type_el.get_text(strip=True) if type_el else ""

                # Date
                date_text = ""
                time_el = li.find("time")
                if time_el:
                    date_text = time_el.get("datetime", "") or time_el.get_text(strip=True)
                else:
                    date_el = li.select_one("li.date, .date")
                    if date_el:
                        date_text = date_el.get_text(strip=True)

                # Tags (from WP Job Manager Tags plugin)
                tags = []
                tag_els = li.select(".job-manager-tag, .tag")
                for tag_el in tag_els:
                    tag_text = tag_el.get_text(strip=True)
                    if tag_text:
                        tags.append(tag_text)

                jobs.append({
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": href,
                    "date_text": date_text,
                    "employment_type": job_type,
                    "tags": tags,
                })

            except Exception as e:
                logger.debug(f"OGVEnergy: error parsing listing: {e}")
                continue

        return jobs

    def _parse_date(self, date_text: str) -> datetime | None:
        """Parse date strings from OGV Energy listings."""
        if not date_text:
            return None
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d", "%d/%m/%Y",
                    "%d %b %Y", "%B %d, %Y"):
            try:
                return datetime.strptime(date_text.strip(), fmt)
            except ValueError:
                continue
        # Handle relative dates like "2 days ago"
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
                data = self._fetch_listings(keyword, page=1)
                if data.get("found_jobs"):
                    count = self._parse_results_count(data)
                    total += count
                    logger.info(f"OGVEnergy: '{keyword}' has {count:,} results")
            except Exception as e:
                logger.warning(f"OGVEnergy count failed for '{keyword}': {e}")
        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """
        Search OGV Energy for jobs matching filters.

        Uses the WP Job Manager AJAX endpoint to fetch paginated results.
        The endpoint returns JSON with an HTML snippet containing job listings.
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
                    data = self._fetch_listings(keyword, page=page)

                    if not data.get("found_jobs"):
                        break

                    listings = self._parse_listings_html(data.get("html", ""))
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

                        # Also dedup by title+company
                        dedup_key = f"{listing['title'].lower()}|{listing['company'].lower()}"
                        if dedup_key in seen:
                            continue
                        seen.add(dedup_key)

                        # Build description
                        description = (
                            f"{listing['title']} at {listing['company']} "
                            f"- {listing['location']}"
                        )
                        if listing.get("tags"):
                            description += f". Tags: {', '.join(listing['tags'])}"

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
                                source_aggregator="ogvenergy",
                            )
                            results.append(job)
                            keyword_results += 1
                        except Exception as e:
                            logger.debug(
                                f"OGVEnergy: skipping job (validation): {e}"
                            )

                    # Check if there are more pages
                    max_pages = data.get("max_num_pages", 1)
                    if isinstance(max_pages, str):
                        try:
                            max_pages = int(max_pages)
                        except ValueError:
                            max_pages = 1
                    if page >= max_pages:
                        break
                    page += 1

                except Exception as e:
                    logger.warning(
                        f"OGVEnergy search failed for '{keyword}' page {page}: {e}"
                    )
                    break

            logger.info(f"OGVEnergy: '{keyword}' yielded {keyword_results} jobs")

        logger.info(f"OGVEnergy: found {len(results)} unique jobs total")
        return results[:filters.max_results]
