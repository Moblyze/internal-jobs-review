"""ROV Planet / Ocean Robotics Planet adapter — ROV & subsea industry jobs.

rovplanet.com (now branded OceanRoboticsPlanet.com) is the industry publication
for marine robotics: ROV, AUV, gliders, subsea inspection, and offshore survey.
The site runs a curated job board at /jobs/list2.

Listing URL:  https://rovplanet.com/jobs/list2
  - Single-page listing; all active jobs shown on one page (typically 10–30).
  - Each job is a <div class="list-car-box"> wrapped in an <a href=".."> tag.
  - Title:    <div class="jobtitle">
  - Company:  <div class="company">
  - Location: <div class="location">
  - Date:     <div class="savjobbra"> e.g. "Posted: 05-03-2026"
  - Experience: <div class="savbalra"> e.g. "5+ years experience"
  - Job URL:  the wrapping <a href> resolves relative to /jobs/ → /slug-date

No API key required – pure web scraper.
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

BASE_URL = "https://rovplanet.com"
LISTING_URL = f"{BASE_URL}/jobs/list2"

# Delay between requests — this is a low-traffic niche site.
REQUEST_DELAY = 2.0

# On 429, back off before giving up.
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


def _resolve_job_url(href: str) -> str:
    """Resolve a relative job link to an absolute URL.

    Observed patterns:
      ../slug-date            → https://rovplanet.com/slug-date
      /slug-date              → https://rovplanet.com/slug-date
      https://rovplanet.com/… → unchanged
    """
    if href.startswith("http"):
        return href
    if href.startswith("../"):
        return f"{BASE_URL}/{href[3:]}"
    if href.startswith("/"):
        return BASE_URL + href
    # Fallback: treat as relative to /jobs/
    return f"{BASE_URL}/jobs/{href}"


def _parse_date(date_text: str) -> datetime | None:
    """Parse 'Posted: DD-MM-YYYY' or 'DD-MM-YYYY' to datetime."""
    if not date_text:
        return None
    # Strip "Posted:" prefix
    text = re.sub(r"(?i)^posted:\s*", "", date_text).strip()
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
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


class ROVPlanetAggregator(BaseAggregator):
    """Scraper adapter for ROV Planet / OceanRoboticsPlanet.com.

    Curated job board for the ROV, AUV, subsea inspection, and offshore survey
    industry. Operated by Tech Markets Media Ltd. (Aberdeen-based publisher).
    No API key required.
    """

    name = "rovplanet"

    def __init__(self):
        self._client: httpx.Client | None = None

    def is_configured(self) -> bool:
        """No API key needed — always configured."""
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
                f"ROVPlanet: 429 on {url}, "
                f"backing off {RATE_LIMIT_BACKOFF}s"
            )
            time.sleep(RATE_LIMIT_BACKOFF)
            resp = client.get(url)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")

    def _parse_listing_page(self, soup: BeautifulSoup) -> list[dict]:
        """Parse job cards from the /jobs/list2 listing page.

        HTML structure per job:
            <a href="../slug-date">
              <div class="list-car-box">
                <div class="row">
                  <div class="col-lg-12 ...">
                    <div class="jobtitle">Title</div>
                    <div class="company">Company Name</div>
                    <div class="location">City, Country</div>
                  </div>
                  <div class="szurke">
                    <div class="savbalra">N years experience</div>
                    <div class="savjobbra">Posted: DD-MM-YYYY</div>
                  </div>
                </div>
              </div>
            </a>
        """
        jobs = []

        for a_tag in soup.find_all("a", href=True):
            box = a_tag.select_one(".list-car-box")
            if not box:
                continue

            try:
                href = _resolve_job_url(a_tag.get("href", ""))

                title_el = box.select_one(".jobtitle")
                if not title_el:
                    continue
                title = title_el.get_text(strip=True)
                if not title:
                    continue

                company_el = box.select_one(".company")
                company = company_el.get_text(strip=True) if company_el else "Unknown"
                if not company:
                    company = "Unknown"

                location_el = box.select_one(".location")
                location = location_el.get_text(strip=True) if location_el else "Unknown"
                if not location:
                    location = "Unknown"

                date_el = box.select_one(".savjobbra")
                date_text = date_el.get_text(strip=True) if date_el else ""

                exp_el = box.select_one(".savbalra")
                experience = exp_el.get_text(strip=True) if exp_el else ""

                # Build description from available fields
                description = f"{title} at {company}"
                if location and location != "Unknown":
                    description += f" — {location}"
                if experience and "n/a" not in experience.lower():
                    description += f". Required experience: {experience}"

                jobs.append({
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": href,
                    "date_text": date_text,
                    "experience": experience,
                    "description": description,
                })

            except Exception as e:
                logger.debug(f"ROVPlanet: error parsing job card: {e}")
                continue

        return jobs

    def _keyword_matches(self, title: str, description: str, keywords: list[str]) -> bool:
        """Return True if any keyword is found in title or description."""
        if not keywords:
            return True
        combined = (title + " " + description).lower()
        return any(kw.lower() in combined for kw in keywords)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def count(self, filters: AggregatorFilters) -> int:
        """Return count of active jobs on the board."""
        try:
            soup = self._fetch_page(LISTING_URL)
            listings = self._parse_listing_page(soup)
            count = len(listings)
            logger.info(f"ROVPlanet: {count} active jobs on board")
            return count
        except Exception as e:
            logger.warning(f"ROVPlanet count failed: {e}")
            return 0

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Scrape the ROV Planet job board and return matching JobPostings.

        Strategy:
        1. Fetch https://rovplanet.com/jobs/list2 (single-page listing).
        2. Parse all <a href><div class="list-car-box"> cards.
        3. Apply keyword filter if provided.
        4. Return up to filters.max_results JobPostings.
        """
        results: list[JobPosting] = []
        seen: set[str] = set()

        try:
            logger.info(f"ROVPlanet: fetching {LISTING_URL}")
            soup = self._fetch_page(LISTING_URL)
            listings = self._parse_listing_page(soup)
            logger.info(f"ROVPlanet: parsed {len(listings)} raw listings")

            for listing in listings:
                if len(results) >= filters.max_results:
                    break

                # Keyword filter
                if not self._keyword_matches(
                    listing["title"], listing["description"], filters.keywords
                ):
                    logger.debug(
                        f"ROVPlanet: skipping '{listing['title']}' (no keyword match)"
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

                posted_date = _parse_date(listing.get("date_text", ""))

                try:
                    job = JobPosting(
                        title=listing["title"],
                        company=listing["company"],
                        location=listing["location"],
                        description=listing["description"],
                        url=job_url,
                        posted_date=posted_date,
                        employment_type=None,
                        source_aggregator="rovplanet",
                    )
                    results.append(job)
                except Exception as e:
                    logger.debug(f"ROVPlanet: skipping job (validation): {e}")

        except Exception as e:
            logger.warning(f"ROVPlanet search failed: {e}")

        logger.info(f"ROVPlanet: returning {len(results)} jobs")
        return results[: filters.max_results]
