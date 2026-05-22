"""Cammach Bryant adapter - scrapes North Sea contract jobs from wearecammach.com.

Cammach Bryant is an Aberdeen-based specialist recruitment agency focused on
North Sea and UK oil & gas contract positions. Nearly every posting is UK/North
Sea, making it extremely high signal for offshore energy contractors.

The site (wearecammach.com) is fully server-rendered. All visible contract jobs
are delivered on a single page: https://wearecammach.com/jobs/filter/?jobType=3
No real pagination exists — page=N query params return the same 39-card payload.
Total contract pool is ~39 jobs at any given time.

Card HTML structure per job:
  <div class="col-lg-6 ... job-card">
    <div class="card ...">
      <div class="text-blue text-uppercase my-3">Oil &amp; Gas</div>
      <h3 class="mb-4">Welder</h3>
      <div class="icons ...">
        <div class="d-flex ..."><img alt="job location" .../>Aberdeen</div>
        <div class="d-flex ..."><img alt="job type" .../>Temporary</div>
        <div class="d-flex ..."><img alt="job hours" .../>Full-time</div>
        <div class="d-flex ..."><img alt="job industry" .../>Trades</div>
      </div>
      <div class="copy mb-4">Description snippet...</div>
      <div class="d-md-flex mt-auto ...">
        <a class="... button-blue" href="https://wearecammach.com/jobs/jo0000029910">View Job Post</a>
        <a class="... button-blue" href="https://wearecammach.com/jobs/jo0000029910#apply">Quick Apply</a>
      </div>
    </div>
  </div>

End-employer (operator) is NOT surfaced in card listings. The snippet text
sometimes mentions "our client" generically; the actual operator name may appear
in the full job detail page body, but we do not fetch detail pages to avoid
hammering a small agency site. Source field is set to "Cammach Bryant" as the
posting agency — the end-employer should be treated as unknown from card data.

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

BASE_URL = "https://wearecammach.com"
# jobType=3 = CONTRACT roles (Moblyze priority filter)
JOBS_FILTER_URL = f"{BASE_URL}/jobs/filter/?jobType=3"

# Conservative delay — small agency site, single-page load
REQUEST_DELAY = 2.0
# On 429, back off before retrying once
RATE_LIMIT_BACKOFF = 15.0

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
    "Referer": "https://wearecammach.com/",
}

# Regex for canonical job ID path (dedupe helper)
JOB_ID_RE = re.compile(r"/jobs/(jo\d+)$")


class CammachBryantAggregator(BaseAggregator):
    """Scraper adapter for Cammach Bryant (wearecammach.com).

    Aberdeen / North Sea contract specialist. All active contract jobs are
    delivered on a single server-rendered page — no pagination needed.
    Performs one HTTP request per search() call (no per-keyword fetches).
    Filters by keyword relevance in-memory after fetching the full job list.

    Registry entry:
        "cammachbryant": CammachBryantAggregator,
    Import:
        from src.aggregators.cammachbryant_adapter import CammachBryantAggregator
    """

    name = "cammachbryant"

    def __init__(self):
        self._client: httpx.Client | None = None

    def is_configured(self) -> bool:
        """No API key needed - always configured."""
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

    def _fetch_page(self, url: str) -> BeautifulSoup | None:
        """Fetch a URL with rate limiting and return parsed HTML.

        Returns None on connection failure or non-200 response so callers
        can degrade gracefully. On 429, backs off and retries once.
        """
        client = self._get_client()
        time.sleep(REQUEST_DELAY)
        try:
            resp = client.get(url)
        except (httpx.ConnectTimeout, httpx.ConnectError) as e:
            logger.warning(f"CammachBryant: connection failed for {url}: {e}")
            return None
        except httpx.TimeoutException as e:
            logger.warning(f"CammachBryant: request timed out for {url}: {e}")
            return None
        except httpx.RemoteProtocolError as e:
            logger.warning(f"CammachBryant: protocol error for {url}: {e}")
            return None

        if resp.status_code == 429:
            logger.warning(
                f"CammachBryant: 429 rate-limit on {url}, "
                f"backing off {RATE_LIMIT_BACKOFF}s"
            )
            time.sleep(RATE_LIMIT_BACKOFF)
            try:
                resp = client.get(url)
            except Exception as e:
                logger.warning(f"CammachBryant: retry after 429 failed: {e}")
                return None

        if resp.status_code != 200:
            logger.warning(f"CammachBryant: HTTP {resp.status_code} for {url}")
            return None

        return BeautifulSoup(resp.text, "html.parser")

    def _parse_listings(self, soup: BeautifulSoup) -> list[dict]:
        """Parse all job cards from the filter page.

        Each card is a div.job-card. Extracts title, location, discipline
        (sector), job type, description snippet, and canonical URL.

        The canonical URL is the /jobs/joNNNNNN link (no #apply fragment).
        Both links appear in each card — we dedupe by job ID.
        """
        jobs = []
        seen_ids: set[str] = set()

        for card in soup.select("div.job-card"):
            try:
                # Title from h3.mb-4
                title_el = card.select_one("h3.mb-4")
                if not title_el:
                    continue
                title = title_el.get_text(strip=True)
                if not title:
                    continue

                # Canonical URL — first button-blue link WITHOUT #apply fragment
                url = ""
                job_id = ""
                for a in card.select("a.button-blue"):
                    href = a.get("href", "")
                    m = JOB_ID_RE.search(href)
                    if m:
                        job_id = m.group(1)
                        url = href  # already canonical — no fragment
                        break

                if not url or not job_id:
                    continue

                # Dedupe by job ID
                if job_id in seen_ids:
                    continue
                seen_ids.add(job_id)

                # Discipline / sector from .text-blue.text-uppercase
                discipline_el = card.select_one(".text-blue.text-uppercase")
                discipline = discipline_el.get_text(strip=True) if discipline_el else ""

                # Location, job type, hours, industry from .icons divs
                # Each div contains an <img alt="job X"> followed by the value
                location = ""
                job_type = "Contract"
                for icon_div in card.select(".icons div"):
                    img = icon_div.find("img")
                    if not img:
                        continue
                    alt = img.get("alt", "").lower()
                    # Text content minus the img tag
                    text = icon_div.get_text(strip=True)
                    if "location" in alt:
                        location = text
                    elif "type" in alt:
                        job_type = text

                if not location:
                    location = "Aberdeen, UK"  # Cammach Bryant default

                # Description snippet from .copy.mb-4
                snippet_el = card.select_one(".copy.mb-4")
                snippet = snippet_el.get_text(strip=True) if snippet_el else ""
                if not snippet or len(snippet) < 10:
                    snippet = f"{title} - {discipline}" if discipline else title

                jobs.append({
                    "title": title,
                    "company": "Cammach Bryant",  # agency; end-employer not in card
                    "location": location,
                    "url": url,
                    "discipline": discipline,
                    "employment_type": job_type,
                    "description": snippet,
                })

            except Exception as e:
                logger.debug(f"CammachBryant: error parsing card: {e}")
                continue

        return jobs

    def _matches_keywords(self, listing: dict, keywords: list[str]) -> bool:
        """Check if a listing matches any of the given keywords.

        Searches title, description, and discipline fields.
        Case-insensitive substring match.
        """
        if not keywords:
            return True
        haystack = " ".join([
            listing.get("title", ""),
            listing.get("description", ""),
            listing.get("discipline", ""),
        ]).lower()
        return any(kw.lower() in haystack for kw in keywords)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def count(self, filters: AggregatorFilters) -> int:
        """Get approximate count of matching contract jobs."""
        soup = self._fetch_page(JOBS_FILTER_URL)
        if soup is None:
            return 0
        listings = self._parse_listings(soup)
        matched = [l for l in listings if self._matches_keywords(l, filters.keywords)]
        logger.info(
            f"CammachBryant: {len(matched)} of {len(listings)} contract jobs "
            f"match keywords {filters.keywords}"
        )
        return len(matched)

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Fetch all Cammach Bryant contract jobs and filter by keywords.

        Single HTTP request — all ~39 contract roles are on one page.
        No pagination required (confirmed: page=N params return the same payload).

        Returns empty list gracefully on network failure.
        """
        logger.info(f"CammachBryant: fetching {JOBS_FILTER_URL}")
        soup = self._fetch_page(JOBS_FILTER_URL)
        if soup is None:
            logger.warning("CammachBryant: page fetch failed, returning empty results")
            return []

        all_listings = self._parse_listings(soup)
        logger.info(f"CammachBryant: parsed {len(all_listings)} contract listings from page")

        results: list[JobPosting] = []
        for listing in all_listings:
            if len(results) >= filters.max_results:
                break

            if not self._matches_keywords(listing, filters.keywords):
                continue

            try:
                job = JobPosting(
                    title=listing["title"],
                    company=listing["company"],
                    location=listing["location"],
                    description=listing["description"],
                    url=listing["url"],
                    posted_date=None,  # not present in card listings
                    employment_type=listing.get("employment_type"),
                    source_aggregator="cammachbryant",
                )
                results.append(job)
            except Exception as e:
                logger.debug(f"CammachBryant: skipping job (validation): {e}")

        logger.info(
            f"CammachBryant: {len(results)} jobs matched keywords {filters.keywords}"
        )
        return results
