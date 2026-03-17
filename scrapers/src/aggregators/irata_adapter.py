"""
IRATA Jobs adapter - scrapes the official IRATA rope access trade association board.

IRATA International (irata.org/jobs) is the leading trade association for
industrial rope access. Their jobs board lists positions from IRATA member
companies. Typically has a small number of highly-targeted rope access roles.

HTML structure: Simple Bootstrap-based page with .media elements for each job.
No API — pure HTML scraping.

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

BASE_URL = "https://irata.org"
JOBS_URL = f"{BASE_URL}/jobs"

# Delay between requests (seconds)
REQUEST_DELAY = 2.0

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class IRATAAggregator(BaseAggregator):
    """Scraper adapter for IRATA International Jobs Board (irata.org/jobs).

    The official trade association board for industrial rope access. Jobs are
    listed on a single page in .media divs with company, location, and date.

    Job listing structure:
      <div class="media">
        <div class="media-body">
          <a href="/jobs/article/{slug}/">
            <h3 class="media-heading">Title <small>DD/MM/YYYY</small></h3>
          </a>
          <div class="row">
            <div class="col-xs-9">
              <p>
                <span class="text-uppercase">COMPANY NAME</span><br>
                Location
              </p>
            </div>
          </div>
        </div>
      </div>
    """

    name = "irata"

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

    def _fetch_jobs_page(self) -> BeautifulSoup:
        """Fetch the IRATA jobs board page."""
        client = self._get_client()
        time.sleep(REQUEST_DELAY)
        resp = client.get(JOBS_URL)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")

    def _parse_listings(self, soup: BeautifulSoup) -> list[dict]:
        """Parse all job listings from the IRATA jobs page.

        Each job is in a .media div with:
        - Title and URL in h3.media-heading > a (parent)
        - Date in h3 > small (format: DD/MM/YYYY)
        - Company in span.text-uppercase
        - Location in text after <br> in the <p> element
        """
        jobs = []

        for media in soup.select(".media"):
            try:
                body = media.select_one(".media-body")
                if not body:
                    continue

                # Title and URL from the heading link
                heading = body.select_one("h3.media-heading")
                if not heading:
                    continue

                # The <a> wraps the <h3> in IRATA's markup
                link = body.select_one("a[href*='/jobs/article/']")
                if not link:
                    continue

                href = link.get("href", "")
                if not href:
                    continue
                if not href.startswith("http"):
                    href = BASE_URL + href

                # Date from <small> inside h3
                date_text = ""
                small = heading.find("small")
                if small:
                    date_text = small.get_text(strip=True)
                    small.extract()  # Remove so it doesn't appear in title

                # Title is the remaining text in h3
                title = heading.get_text(strip=True)
                if not title:
                    continue

                # Company from span.text-uppercase
                company_span = body.select_one("span.text-uppercase")
                company = company_span.get_text(strip=True) if company_span else "Unknown"

                # Location from the text after the company
                location = "Global"
                p_el = body.select_one("p[style]")
                if p_el:
                    # Get all text nodes after the <br>
                    br = p_el.find("br")
                    if br and br.next_sibling:
                        loc_text = ""
                        for sibling in br.next_siblings:
                            if hasattr(sibling, "get_text"):
                                loc_text += sibling.get_text(strip=True)
                            elif isinstance(sibling, str):
                                loc_text += sibling.strip()
                        if loc_text.strip():
                            location = loc_text.strip()

                jobs.append({
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": href,
                    "date_text": date_text,
                })

            except Exception as e:
                logger.debug(f"IRATA: error parsing listing: {e}")
                continue

        return jobs

    def _parse_date(self, date_text: str) -> datetime | None:
        """Parse IRATA date format DD/MM/YYYY."""
        if not date_text:
            return None
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y"):
            try:
                return datetime.strptime(date_text.strip(), fmt)
            except ValueError:
                continue
        return None

    def _keyword_matches(self, job: dict, keywords: list[str]) -> bool:
        """Check if a job matches any of the search keywords.

        Since IRATA doesn't have a search function, we filter locally.
        All IRATA jobs are rope access related, so we're lenient with matching.
        """
        if not keywords:
            return True

        # Build searchable text from job fields
        searchable = " ".join([
            job.get("title", ""),
            job.get("company", ""),
            job.get("location", ""),
        ]).lower()

        # Rope access related keywords always match IRATA jobs
        rope_access_terms = {
            "rope access", "irata", "rope", "ndt", "height", "inspection",
            "wind turbine", "wind energy", "offshore", "industrial",
            "abseil", "climbing", "at height", "technician",
        }

        for kw in keywords:
            kw_lower = kw.lower()
            # Direct match in job text
            if kw_lower in searchable:
                return True
            # Keyword is a rope access term (all IRATA jobs are relevant)
            for term in rope_access_terms:
                if term in kw_lower:
                    return True

        return False

    def count(self, filters: AggregatorFilters) -> int:
        """Get count of matching jobs on IRATA board.

        IRATA typically has a small number of jobs (5-20), all on one page.
        """
        try:
            soup = self._fetch_jobs_page()
            listings = self._parse_listings(soup)
            matched = [j for j in listings if self._keyword_matches(j, filters.keywords)]
            return len(matched)
        except Exception as e:
            logger.warning(f"IRATA count failed: {e}")
            return 0

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search IRATA jobs board for rope access positions.

        IRATA has a single page of jobs with no search/filter functionality,
        so we fetch all jobs and filter locally by keyword matching.
        """
        results: list[JobPosting] = []
        seen: set[str] = set()

        try:
            soup = self._fetch_jobs_page()
            listings = self._parse_listings(soup)

            for listing in listings:
                if len(results) >= filters.max_results:
                    break

                # Filter by keywords
                if not self._keyword_matches(listing, filters.keywords):
                    continue

                # Dedup by URL
                job_url = listing["url"]
                if job_url in seen:
                    continue
                seen.add(job_url)

                posted_date = self._parse_date(listing.get("date_text", ""))

                # Build description
                description = (
                    f"{listing['title']} at {listing['company']} "
                    f"- {listing['location']}. "
                    f"IRATA rope access position."
                )

                try:
                    job = JobPosting(
                        title=listing["title"],
                        company=listing["company"],
                        location=listing["location"],
                        description=description,
                        url=job_url,
                        posted_date=posted_date,
                        employment_type="Rope Access",
                        source_aggregator="irata",
                    )
                    results.append(job)
                except Exception as e:
                    logger.debug(f"IRATA: skipping job (validation): {e}")

        except Exception as e:
            logger.warning(f"IRATA search failed: {e}")

        logger.info(f"IRATA: found {len(results)} matching jobs")
        return results[:filters.max_results]
