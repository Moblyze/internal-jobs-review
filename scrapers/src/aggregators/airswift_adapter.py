"""
Airswift adapter - scrapes jobs from the world's largest energy staffing agency.

Airswift (airswift.com/jobs) is a global workforce solutions provider with
9,000+ contractors across energy, infrastructure, and technology sectors.
~700+ active jobs at any time.

Search URL: /jobs?page_num={page}
Job detail: /jobs/{slug-id}
Job cards: article.c-card-job-item with employment type, date, location, title

No API key required - this is a web scraper.
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

BASE_URL = "https://www.airswift.com"
SEARCH_URL = f"{BASE_URL}/jobs"

# Airswift sector URL mappings
SECTOR_MAP = {
    "oil": "energy/oil-gas",
    "gas": "energy/oil-gas",
    "renewable": "energy/renewables",
    "solar": "energy/renewables",
    "wind": "energy/renewables",
    "nuclear": "energy/nuclear",
    "power": "energy/power",
    "offshore": "energy/offshore-marine",
    "marine": "energy/offshore-marine",
    "mining": "process/mining-metals",
    "infrastructure": "infrastructure",
}

# Delay between requests (seconds)
REQUEST_DELAY = 1.5

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.airswift.com/",
}


class AirswiftAggregator(BaseAggregator):
    """Scraper adapter for Airswift (airswift.com/jobs).

    Global energy staffing agency with contract and permanent roles.
    Pagination via ?page_num=N, ~24 jobs per page.

    Job card structure (article.c-card-job-item):
      <article class="c-card-job-item">
        <div class="c-card-job-item__top">
          <p class="c-card-job-item__top-cell--left">Contract</p>
          <p class="c-card-job-item__top-cell--right">17 Mar 2026</p>
        </div>
        <p class="c-card-job-item__location">Location</p>
        <p class="c-card-job-item__title"><a href="/jobs/{slug}">Title</a></p>
        <p class="c-card-job-item__summary">Description...</p>
      </article>
    """

    name = "airswift"

    def __init__(self):
        self._client: httpx.Client | None = None

    def is_configured(self) -> bool:
        """No API key needed - always configured."""
        return True

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                timeout=30,
                follow_redirects=True,
                headers=HEADERS,
            )
        return self._client

    def _fetch_page(self, url: str) -> BeautifulSoup:
        """Fetch a page and return parsed BeautifulSoup."""
        client = self._get_client()
        time.sleep(REQUEST_DELAY)
        resp = client.get(url)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")

    def _build_search_url(self, page: int = 1) -> str:
        """Build paginated search URL.

        Airswift uses ?page_num=N for pagination.
        """
        if page > 1:
            return f"{SEARCH_URL}?page_num={page}"
        return SEARCH_URL

    def _parse_listing_page(self, soup: BeautifulSoup) -> list[dict]:
        """Parse job listing cards from search results page.

        Each job is in an <article class="c-card-job-item"> with:
        - Employment type in .c-card-job-item__top-cell--left
        - Date in .c-card-job-item__top-cell--right
        - Location in .c-card-job-item__location
        - Title/URL in .c-card-job-item__title > a
        - Description in .c-card-job-item__summary
        """
        jobs = []

        for article in soup.select("article.c-card-job-item"):
            try:
                # Title and URL
                title_el = article.select_one(".c-card-job-item__title a")
                if not title_el:
                    continue
                title = title_el.get_text(strip=True)
                href = title_el.get("href", "")
                if not title or not href:
                    continue
                if not href.startswith("http"):
                    href = BASE_URL + href

                # Employment type
                type_el = article.select_one(
                    ".c-card-job-item__top-cell--left, "
                    ".c-card-job-item__top-cell:first-child"
                )
                emp_type = None
                if type_el:
                    # Text is mixed with img tag, get text only
                    emp_type = type_el.get_text(strip=True)

                # Date
                date_el = article.select_one(
                    ".c-card-job-item__top-cell--right, "
                    ".c-card-job-item__top-cell:last-child"
                )
                date_text = ""
                if date_el:
                    date_text = date_el.get_text(strip=True)

                # Location
                loc_el = article.select_one(".c-card-job-item__location")
                location = "Unknown"
                if loc_el:
                    location = loc_el.get_text(strip=True)

                # Description summary
                summary_el = article.select_one(".c-card-job-item__summary")
                description = ""
                if summary_el:
                    description = summary_el.get_text(strip=True)

                if not description or len(description) < 10:
                    description = f"{title} at Airswift - {location}"

                jobs.append({
                    "title": title,
                    "company": "Airswift",  # All jobs are Airswift placements
                    "location": location,
                    "url": href,
                    "employment_type": emp_type,
                    "date_text": date_text,
                    "description": description,
                })

            except Exception as e:
                logger.debug(f"Airswift: error parsing listing: {e}")
                continue

        return jobs

    def _parse_results_count(self, soup: BeautifulSoup) -> tuple[int, int]:
        """Extract total results and total pages from search header.

        Looks for text like "Found 732 jobs on 31 pages".
        Returns (total_jobs, total_pages).
        """
        total_jobs = 0
        total_pages = 1

        # Look for the results summary text
        header = soup.select_one(
            ".c-card-job-header__summary, "
            ".c-card-job-header, "
            ".c-card-job__wrapper"
        )
        if header:
            text = header.get_text(strip=True)
            jobs_match = re.search(r"Found\s+([\d,]+)\s+jobs?", text, re.IGNORECASE)
            if jobs_match:
                total_jobs = int(jobs_match.group(1).replace(",", ""))
            pages_match = re.search(r"on\s+([\d,]+)\s+pages?", text, re.IGNORECASE)
            if pages_match:
                total_pages = int(pages_match.group(1).replace(",", ""))

        # Fallback: count pagination links
        if total_pages <= 1:
            page_links = soup.select(".c-pagination__link")
            for link in page_links:
                href = link.get("href", "")
                match = re.search(r"page_num=(\d+)", href)
                if match:
                    total_pages = max(total_pages, int(match.group(1)))

        return total_jobs, total_pages

    def _parse_date(self, date_text: str) -> datetime | None:
        """Parse Airswift date format like '17 Mar 2026'."""
        if not date_text:
            return None
        for fmt in ("%d %b %Y", "%d %B %Y", "%Y-%m-%d", "%m/%d/%Y", "%b %d, %Y"):
            try:
                return datetime.strptime(date_text.strip(), fmt)
            except ValueError:
                continue
        return None

    def _keyword_matches(self, job: dict, keywords: list[str]) -> bool:
        """Check if a job matches any of the search keywords."""
        if not keywords:
            return True

        searchable = " ".join([
            job.get("title", ""),
            job.get("description", ""),
            job.get("location", ""),
        ]).lower()

        for kw in keywords:
            # Check individual words in multi-word keywords
            words = kw.lower().split()
            if all(word in searchable for word in words):
                return True

        return False

    def count(self, filters: AggregatorFilters) -> int:
        """Get approximate count of matching jobs on Airswift."""
        try:
            url = self._build_search_url()
            soup = self._fetch_page(url)
            total_jobs, _ = self._parse_results_count(soup)
            return total_jobs
        except Exception as e:
            logger.warning(f"Airswift count failed: {e}")
            return 0

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search Airswift for energy sector contract/permanent jobs.

        Scrapes paginated search results. Airswift doesn't support server-side
        keyword filtering, so we fetch pages and filter locally by keyword.
        """
        results: list[JobPosting] = []
        seen: set[str] = set()

        try:
            # First page to get total count
            url = self._build_search_url(page=1)
            logger.info(f"Airswift: fetching {url}")
            soup = self._fetch_page(url)

            total_jobs, total_pages = self._parse_results_count(soup)
            logger.info(f"Airswift: {total_jobs} total jobs on {total_pages} pages")

            # Process first page
            listings = self._parse_listing_page(soup)
            for listing in listings:
                if len(results) >= filters.max_results:
                    break
                if not self._keyword_matches(listing, filters.keywords):
                    continue

                job_url = listing["url"]
                if job_url in seen:
                    continue
                seen.add(job_url)

                dedup_key = f"{listing['title'].lower()}|{listing['location'].lower()}"
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)

                posted_date = self._parse_date(listing.get("date_text", ""))

                try:
                    job = JobPosting(
                        title=listing["title"],
                        company=listing["company"],
                        location=listing["location"],
                        description=listing["description"],
                        url=job_url,
                        posted_date=posted_date,
                        employment_type=listing.get("employment_type"),
                        source_aggregator="airswift",
                    )
                    results.append(job)
                except Exception as e:
                    logger.debug(f"Airswift: skipping job (validation): {e}")

            # Continue with remaining pages
            max_pages = min(total_pages, 10)  # Safety limit
            page = 2

            while page <= max_pages and len(results) < filters.max_results:
                try:
                    url = self._build_search_url(page=page)
                    logger.info(f"Airswift: fetching page {page}")
                    soup = self._fetch_page(url)

                    listings = self._parse_listing_page(soup)
                    if not listings:
                        break

                    for listing in listings:
                        if len(results) >= filters.max_results:
                            break
                        if not self._keyword_matches(listing, filters.keywords):
                            continue

                        job_url = listing["url"]
                        if job_url in seen:
                            continue
                        seen.add(job_url)

                        dedup_key = f"{listing['title'].lower()}|{listing['location'].lower()}"
                        if dedup_key in seen:
                            continue
                        seen.add(dedup_key)

                        posted_date = self._parse_date(listing.get("date_text", ""))

                        try:
                            job = JobPosting(
                                title=listing["title"],
                                company=listing["company"],
                                location=listing["location"],
                                description=listing["description"],
                                url=job_url,
                                posted_date=posted_date,
                                employment_type=listing.get("employment_type"),
                                source_aggregator="airswift",
                            )
                            results.append(job)
                        except Exception as e:
                            logger.debug(f"Airswift: skipping job (validation): {e}")

                    page += 1

                except Exception as e:
                    logger.warning(f"Airswift search failed on page {page}: {e}")
                    break

        except Exception as e:
            logger.warning(f"Airswift search failed: {e}")

        logger.info(f"Airswift: found {len(results)} matching jobs")
        return results[:filters.max_results]
