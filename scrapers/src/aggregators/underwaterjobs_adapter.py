"""UnderwaterJobs adapter - scrapes commercial diving and ROV jobs.

UnderwaterJobs.com (underwaterjobs.com) is a niche job board for underwater
professionals. Categories include commercial diving (inland, inshore, offshore,
saturation), ROV Operations, ADS Operations, and Aquaculture.

Listing URL:  https://www.underwaterjobs.com/all_jobs/
  - Shows all active jobs in "brief" view (default).
  - Each job is a <div class="results"> block under <div id="idjobsearchresults">.
  - Title/URL: <h2><a href="...">Title</a></h2>
  - Company/Location: <p class="desc"> – first <a> text is company, then
    " - City - Province/State - COUNTRY" text follows.
  - Posted date: <p class="posted"> e.g. "Posted: Yesterday" / "Posted: Apr 7".
  - Pagination: page count shown in h2 "All Jobs (1 to N from TOTAL)".
    There is no paginated next-link; the site has a small inventory (< 100 jobs).

No API key required – pure web scraper.
"""

import re
import time
import logging
from datetime import datetime, timedelta

import httpx
from bs4 import BeautifulSoup

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

BASE_URL = "https://www.underwaterjobs.com"

# Delay between requests (seconds). This is a low-traffic niche board.
REQUEST_DELAY = 2.0

# On 429 back-off before giving up.
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

# Subsea/energy-relevant job title keywords (used to filter by relevance when
# keywords are provided; if none match, all commercial-diving jobs are returned).
RELEVANT_TITLE_KEYWORDS = [
    "rov", "sat", "saturation", "offshore", "subsea", "diving supervisor",
    "commercial diver", "surface supply", "bell", "inspection", "irm",
    "ads", "atmospheric", "pipeline",
]


def _normalize_relative_date(date_text: str) -> datetime | None:
    """Parse UnderwaterJobs relative/absolute date strings.

    Observed patterns:
      "Yesterday"
      "Apr 7"
      "Mar 5"
      "Jan 12"
      "May 11"
    """
    if not date_text:
        return None

    text = date_text.strip()

    if text.lower() == "yesterday":
        return datetime.utcnow() - timedelta(days=1)

    if text.lower() == "today":
        return datetime.utcnow()

    # Try "Mon DD" style (e.g. "Apr 7")
    current_year = datetime.utcnow().year
    for fmt in (f"%b %d %Y", f"%B %d %Y"):
        try:
            return datetime.strptime(f"{text} {current_year}", fmt)
        except ValueError:
            pass

    # Try ISO and other absolute formats
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%d %b %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue

    try:
        import dateparser
        return dateparser.parse(text)
    except (ImportError, Exception):
        pass

    return None


class UnderwaterJobsAggregator(BaseAggregator):
    """Scraper adapter for UnderwaterJobs.com.

    Covers: commercial diving (offshore, saturation, inshore, inland),
    ROV Operations, ADS Operations — niche underwater-professional board.
    No API key required.
    """

    name = "underwaterjobs"

    def __init__(self):
        self._client: httpx.Client | None = None

    def is_configured(self) -> bool:
        """No API key required — always configured."""
        return True

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                headers=HEADERS,
                follow_redirects=True,
                timeout=30,
            )
        return self._client

    def _fetch_page(self, url: str) -> BeautifulSoup:
        """Fetch a page with rate-limiting; retry once on 429."""
        client = self._get_client()
        time.sleep(REQUEST_DELAY)
        resp = client.get(url)
        if resp.status_code == 429:
            logger.warning(
                f"UnderwaterJobs: 429 on {url}, "
                f"backing off {RATE_LIMIT_BACKOFF}s"
            )
            time.sleep(RATE_LIMIT_BACKOFF)
            resp = client.get(url)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")

    def _parse_total_count(self, soup: BeautifulSoup) -> int:
        """Extract total job count from heading e.g. 'All Jobs (1 to 8 from 8)'."""
        h2 = soup.select_one(".flat-title h2, h2")
        if h2:
            match = re.search(r"from\s+(\d+)", h2.get_text())
            if match:
                return int(match.group(1))
        return len(soup.select("div.results"))

    def _parse_listing_page(self, soup: BeautifulSoup) -> list[dict]:
        """Parse job result blocks from the all_jobs listing page.

        HTML structure per job:
            <div class="results phpjob_listfeatured">
              <h2><a href="https://www.underwaterjobs.com/job/title/ID/">Title</a></h2>
              <p class="desc">
                <a href="...employer...">Company Name</a> - City - Province - COUNTRY<br/>
                Description: short snippet... <a ...>More details »</a>
              </p>
              <p class="posted">Posted: Apr 7 - Views: 5577</p>
            </div>
        """
        jobs = []

        for div in soup.select("div.results"):
            try:
                # Title and URL
                title_link = div.select_one("h2 a")
                if not title_link:
                    continue
                title = title_link.get_text(strip=True)
                href = title_link.get("href", "")
                if not title or not href:
                    continue
                if not href.startswith("http"):
                    href = BASE_URL + href

                # Company/location from the desc paragraph
                desc_p = div.select_one("p.desc")
                company = "Unknown"
                location = "Unknown"
                description = ""

                if desc_p:
                    # Company from first <a class="hilink"> in desc
                    company_link = desc_p.find("a", class_="hilink")
                    if company_link:
                        company = company_link.get_text(strip=True)

                    # Location: direct text node after the company <a> and before <br>.
                    # HTML: <a>Company</a> - City - Province - COUNTRY<br/>
                    # NavigableString siblings after the company link.
                    if company_link:
                        loc_text = ""
                        for sibling in company_link.next_siblings:
                            if getattr(sibling, "name", None) == "br":
                                break
                            text = str(sibling)
                            loc_text += text
                        loc_text = loc_text.strip()
                        # Strip leading " - " separator
                        loc_text = re.sub(r"^\s*[-–]\s*", "", loc_text)
                        # Split " City - Province - COUNTRY" parts
                        location_parts = [p.strip() for p in loc_text.split("-") if p.strip()]
                        if location_parts:
                            location = ", ".join(location_parts)

                    # Description: text after <br>, before "More details"
                    # Use separator to pull full text then slice after <br>
                    raw = desc_p.get_text(separator="\n")
                    desc_match = re.search(
                        r"Description:\s*(.+?)(?:\nMore details|$)", raw, re.DOTALL
                    )
                    if desc_match:
                        description = desc_match.group(1).strip()

                if not description or len(description) < 10:
                    description = f"{title} at {company} — {location}"

                # Posted date from <p class="posted">
                posted_text = ""
                posted_p = div.select_one("p.posted")
                if posted_p:
                    raw_posted = posted_p.get_text(strip=True)
                    # "Posted: Apr 7 - Views: 5577"
                    post_match = re.search(r"Posted:\s*(.+?)(?:\s*-\s*Views|$)", raw_posted)
                    if post_match:
                        posted_text = post_match.group(1).strip()

                jobs.append({
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": href,
                    "description": description,
                    "date_text": posted_text,
                })

            except Exception as e:
                logger.debug(f"UnderwaterJobs: error parsing listing: {e}")
                continue

        return jobs

    def _keyword_matches(self, title: str, description: str, keywords: list[str]) -> bool:
        """Return True if any keyword is found in title or description (case-insensitive)."""
        if not keywords:
            return True  # no keyword filter = include all
        combined = (title + " " + description).lower()
        return any(kw.lower() in combined for kw in keywords)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def count(self, filters: AggregatorFilters) -> int:
        """Get total active job count from all_jobs listing."""
        try:
            url = f"{BASE_URL}/all_jobs/"
            soup = self._fetch_page(url)
            total = self._parse_total_count(soup)
            logger.info(f"UnderwaterJobs: {total} active jobs")
            return total
        except Exception as e:
            logger.warning(f"UnderwaterJobs count failed: {e}")
            return 0

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Scrape the all_jobs listing and return matching JobPosting objects.

        Strategy:
        1. Fetch https://www.underwaterjobs.com/all_jobs/ (all jobs, brief view).
        2. Parse the result divs.
        3. Apply keyword filter (if any keywords provided).
        4. Return up to filters.max_results JobPostings.

        This board has a small inventory (< 100 jobs total) so one page suffices.
        """
        results: list[JobPosting] = []
        seen: set[str] = set()

        try:
            url = f"{BASE_URL}/all_jobs/"
            logger.info(f"UnderwaterJobs: fetching {url}")
            soup = self._fetch_page(url)
            listings = self._parse_listing_page(soup)
            logger.info(f"UnderwaterJobs: parsed {len(listings)} raw listings")

            for listing in listings:
                if len(results) >= filters.max_results:
                    break

                # Keyword filter
                if not self._keyword_matches(
                    listing["title"], listing["description"], filters.keywords
                ):
                    logger.debug(
                        f"UnderwaterJobs: skipping '{listing['title']}' (no keyword match)"
                    )
                    continue

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

                posted_date = _normalize_relative_date(listing.get("date_text", ""))

                try:
                    job = JobPosting(
                        title=listing["title"],
                        company=listing["company"],
                        location=listing["location"],
                        description=listing["description"],
                        url=job_url,
                        posted_date=posted_date,
                        employment_type=None,
                        source_aggregator="underwaterjobs",
                    )
                    results.append(job)
                except Exception as e:
                    logger.debug(f"UnderwaterJobs: skipping job (validation): {e}")

        except Exception as e:
            logger.warning(f"UnderwaterJobs search failed: {e}")

        logger.info(f"UnderwaterJobs: returning {len(results)} jobs")
        return results[: filters.max_results]
