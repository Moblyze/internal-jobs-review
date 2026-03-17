"""Energy JobSearch adapter - scrapes offshore/subsea contract positions.

EnergyJobSearch.com (also accessible via oilandgasjobsearch.com) is a Next.js
React application that server-side renders job listings. The site specialises in
offshore, subsea, and contract energy positions.

Search URL pattern: https://www.energyjobsearch.com/jobs?query=<keyword>&page=<1-indexed>
Job detail pattern: https://www.energyjobsearch.com/jobs/<category>-jobs/<id>
Job categories include: engineering-jobs, technicians-or-service-jobs, other-jobs,
consulting-jobs, etc.

The HTML uses CSS module classes (e.g. BaseJobCard_root__*, SearchPageJobCard_root__*)
which change on each build. We use partial class name matching to handle this.

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

BASE_URL = "https://www.energyjobsearch.com"
SEARCH_URL = f"{BASE_URL}/jobs"

# Delay between requests (seconds) to be respectful
REQUEST_DELAY = 1.5
MAX_PAGES_PER_KEYWORD = 5

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class EnergyJobSearchAggregator(BaseAggregator):
    """Scraper adapter for Energy JobSearch (energyjobsearch.com)."""

    name = "energyjobsearch"

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
        Build a search URL for Energy JobSearch.

        Uses 1-indexed pagination.
        Example: /jobs?query=subsea+engineer&page=2
        """
        params = f"query={keyword.replace(' ', '+')}"
        if page > 1:
            params += f"&page={page}"
        return f"{SEARCH_URL}?{params}"

    def _fetch_page(self, url: str) -> BeautifulSoup:
        """Fetch a page with rate limiting and return parsed HTML."""
        client = self._get_client()
        time.sleep(REQUEST_DELAY)
        resp = client.get(url)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")

    @staticmethod
    def _select_by_partial_class(soup, tag: str, class_prefix: str):
        """
        Select elements by partial CSS module class name.

        Next.js CSS modules append a hash suffix (e.g. BaseJobCard_root__9JrMV).
        We match on the prefix before the hash.
        """
        return soup.find_all(
            tag, class_=re.compile(rf"^{re.escape(class_prefix)}")
        )

    @staticmethod
    def _find_by_partial_class(element, tag: str, class_prefix: str):
        """Find a single child element by partial CSS module class name."""
        return element.find(
            tag, class_=re.compile(rf"^{re.escape(class_prefix)}")
        )

    def _parse_results_count(self, soup: BeautifulSoup) -> int:
        """Extract total results count from the results header."""
        # Look for "X jobs" text in the results title area
        header = soup.find(
            class_=re.compile(r"Jobs_resultsTitle")
        )
        if header:
            text = header.get_text(strip=True)
            match = re.search(r"([\d,]+)\s*(jobs?|results?)", text, re.IGNORECASE)
            if match:
                return int(match.group(1).replace(",", ""))

        # Fallback: count job cards on the page
        cards = self._select_by_partial_class(soup, "div", "SearchPageJobCard_root")
        if not cards:
            cards = self._select_by_partial_class(soup, "div", "BaseJobCard_root")
        return len(cards)

    def _parse_listing_page(self, soup: BeautifulSoup) -> list[dict]:
        """
        Parse job cards from a search results page.

        The site renders job cards as divs with CSS module classes like:
        - SearchPageJobCard_root__WVxc3 (search result wrapper)
        - BaseJobCard_root__9JrMV (base card component)
        - BaseJobCard_jobTitle__ehsas (job title)
        - JobCompanyName_name__V9AaS (company name)
        - BaseJobCard_companyDetails__98ZeX (location/details)
        """
        jobs = []

        # Find all job cards — try SearchPageJobCard first, then BaseJobCard
        cards = self._select_by_partial_class(soup, "div", "SearchPageJobCard_root")
        if not cards:
            cards = self._select_by_partial_class(soup, "div", "BaseJobCard_root")

        for card in cards:
            try:
                # Title — look for the job title element with link
                title_el = card.find(
                    class_=re.compile(r"BaseJobCard_jobTitle")
                )
                if not title_el:
                    continue

                # The title element may itself be an <a> or contain one
                link = title_el if title_el.name == "a" else title_el.find("a")
                if not link:
                    # Try finding any link within the job title container
                    title_container = card.find(
                        class_=re.compile(r"BaseJobCard_jobTitleContainer")
                    )
                    if title_container:
                        link = title_container.find("a")
                    if not link:
                        continue

                title = link.get_text(strip=True)
                href = link.get("href", "")
                if not title or not href:
                    continue
                if not href.startswith("http"):
                    href = f"{BASE_URL}{href}"

                # Company name
                company_el = card.find(
                    class_=re.compile(r"JobCompanyName_name")
                )
                company = company_el.get_text(strip=True) if company_el else "Unknown"

                # Location — in the company details section
                location = "Unknown"
                details_el = card.find(
                    class_=re.compile(r"BaseJobCard_companyDetails")
                )
                if details_el:
                    # Location is typically a separate element after company
                    spans = details_el.find_all("span")
                    for span in spans:
                        text = span.get_text(strip=True)
                        # Skip if it looks like a company name
                        if text and text != company:
                            location = text
                            break

                # Job info tags (contract type, sector, etc.)
                tags_el = card.find(
                    class_=re.compile(r"JobInfoTagsSection")
                )
                tags = []
                if tags_el:
                    tag_spans = tags_el.find_all("span")
                    tags = [s.get_text(strip=True) for s in tag_spans if s.get_text(strip=True)]

                # Date — look for date/time elements
                date_text = ""
                time_el = card.find("time")
                if time_el:
                    date_text = time_el.get("datetime", "") or time_el.get_text(strip=True)

                jobs.append({
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": href,
                    "date_text": date_text,
                    "tags": tags,
                })

            except Exception as e:
                logger.debug(f"EnergyJobSearch: error parsing job card: {e}")
                continue

        return jobs

    def _has_next_page(self, soup: BeautifulSoup) -> bool:
        """Check if there is a next page button/link."""
        # Look for pagination elements
        next_btn = soup.find(
            class_=re.compile(r"Pagination.*next|next.*page", re.IGNORECASE)
        )
        if next_btn:
            return True

        # Check for standard pagination links
        pag = soup.find("nav", {"aria-label": re.compile(r"pagination", re.IGNORECASE)})
        if pag:
            # Look for a "next" link that isn't disabled
            next_link = pag.find("a", {"aria-label": re.compile(r"next", re.IGNORECASE)})
            if next_link and not next_link.get("aria-disabled"):
                return True

        return False

    def _parse_date(self, date_text: str) -> datetime | None:
        """Parse date strings from Energy JobSearch listings."""
        if not date_text:
            return None
        for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%S%z",
                    "%Y-%m-%d", "%d/%m/%Y", "%d %b %Y", "%b %d, %Y"):
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
                logger.info(f"EnergyJobSearch: '{keyword}' has {count:,} results")
            except Exception as e:
                logger.warning(f"EnergyJobSearch count failed for '{keyword}': {e}")
        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """
        Search Energy JobSearch for jobs matching filters.

        For each keyword:
        1. Fetch SSR search results page(s)
        2. Parse job cards using partial CSS module class matching
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
                    logger.info(f"EnergyJobSearch: fetching {url}")
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

                        # Build description from available data
                        description = (
                            f"{listing['title']} at {listing['company']} "
                            f"- {listing['location']}"
                        )
                        if listing.get("tags"):
                            description += f". Tags: {', '.join(listing['tags'])}"

                        posted_date = self._parse_date(listing.get("date_text", ""))

                        # Determine employment type from tags
                        employment_type = None
                        for tag in listing.get("tags", []):
                            tag_lower = tag.lower()
                            if any(t in tag_lower for t in
                                   ("contract", "freelance", "temporary")):
                                employment_type = "Contractor"
                                break
                            elif "permanent" in tag_lower or "full-time" in tag_lower:
                                employment_type = "Full-Time"
                                break

                        try:
                            job = JobPosting(
                                title=listing["title"],
                                company=listing["company"],
                                location=listing["location"],
                                description=description,
                                url=job_url,
                                posted_date=posted_date,
                                employment_type=employment_type,
                                source_aggregator="energyjobsearch",
                            )
                            results.append(job)
                            keyword_results += 1
                        except Exception as e:
                            logger.debug(
                                f"EnergyJobSearch: skipping job (validation): {e}"
                            )

                    # Check for next page
                    if not self._has_next_page(soup):
                        break
                    page += 1

                except Exception as e:
                    logger.warning(
                        f"EnergyJobSearch search failed for '{keyword}' page {page}: {e}"
                    )
                    break

            logger.info(f"EnergyJobSearch: '{keyword}' yielded {keyword_results} jobs")

        logger.info(f"EnergyJobSearch: found {len(results)} unique jobs total")
        return results[:filters.max_results]
