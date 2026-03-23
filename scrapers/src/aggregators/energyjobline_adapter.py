"""
Energy Jobline adapter - scrapes the world's largest energy-specific job board.

Covers renewables, O&G, nuclear, power, and EV sectors with 10K-20K active jobs.
Uses httpx + BeautifulSoup to scrape search results and JSON-LD structured data
from detail pages. Handles the site's bot verification challenge automatically.

No API key required - this is a web scraper.

DISABLED (2026-03-23): The site's bot verification now requires an interactive
browser button press ("Press the button to continue") which cannot be solved by
httpx. Would need Playwright or similar headless browser to bypass. Disable to
avoid wasting CI time with failed bot challenges on every request.
"""

import re
import json
import time
import logging
from datetime import datetime
from urllib.parse import urlencode

import httpx
from bs4 import BeautifulSoup

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

BASE_URL = "https://www.energyjobline.com"

# Mapping from our job_types to Energy Jobline URL path segments.
# "Contractor" on EJL maps to "/freelancer" in the URL path.
EJL_EMPLOYMENT_TYPE_MAP = {
    "contract": "freelancer",
    "contractor": "freelancer",
    "temporary": "freelancer",
    "full_time": "full-time",
    "full-time": "full-time",
    "part_time": "part-time",
    "part-time": "part-time",
}

# Delay between requests (seconds) to respect crawl-delay of 10 in robots.txt
REQUEST_DELAY = 2.0

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class EnergyJoblineAggregator(BaseAggregator):
    """Scraper adapter for Energy Jobline (energyjobline.com)."""

    name = "energyjobline"

    def __init__(self):
        self._bot_token: str | None = None
        self._client: httpx.Client | None = None

    # Adapter disabled since 2026-03-23: bot verification now requires an
    # interactive browser button press that httpx cannot solve.  Would need
    # Playwright integration to re-enable.
    DISABLED = True
    DISABLED_REASON = "energyjobline.com bot challenge requires interactive browser (since 2026-03-23)"

    def is_configured(self) -> bool:
        if self.DISABLED:
            logger.info(f"EnergyJobline: DISABLED - {self.DISABLED_REASON}")
            return False
        return True

    # ------------------------------------------------------------------
    # Bot verification
    # ------------------------------------------------------------------

    def _get_client(self) -> httpx.Client:
        """Return a reusable httpx client with bot verification cookie."""
        if self._client is not None:
            return self._client

        self._client = httpx.Client(
            headers=HEADERS,
            follow_redirects=True,
            timeout=30,
        )
        self._solve_bot_challenge()
        return self._client

    def _solve_bot_challenge(self) -> None:
        """
        Hit the site to trigger the bot challenge, extract the verification
        token from the redirect URL, and set it as a cookie.

        The challenge page redirects to:
          /profiles/recruiter/botchallenge.html?token=<hex>&target=<path>
        The JS on that page sets cookie  bot_verified=<token>  and redirects
        back to the target. We replicate that programmatically.
        """
        resp = self._client.get(f"{BASE_URL}/jobs")
        url_str = str(resp.url)
        match = re.search(r"token=([a-f0-9]+)", url_str)
        if match:
            self._bot_token = match.group(1)
            self._client.cookies.set("bot_verified", self._bot_token, domain="www.energyjobline.com")
            logger.debug(f"EnergyJobline: bot challenge solved, token={self._bot_token[:8]}...")
        else:
            # Page might have loaded without challenge (unlikely but handle gracefully)
            logger.debug("EnergyJobline: no bot challenge detected")

    def _fetch_page(self, url: str) -> BeautifulSoup:
        """Fetch a page and return parsed BeautifulSoup, handling bot re-challenges."""
        client = self._get_client()
        time.sleep(REQUEST_DELAY)
        resp = client.get(url)

        # Check if we hit a bot re-challenge
        if "botchallenge" in str(resp.url) or "I am human" in resp.text[:2000]:
            logger.debug("EnergyJobline: bot re-challenge, re-solving...")
            self._solve_bot_challenge()
            time.sleep(REQUEST_DELAY)
            resp = client.get(url)

        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")

    # ------------------------------------------------------------------
    # URL building
    # ------------------------------------------------------------------

    def _build_search_url(self, keyword: str, job_types: list[str] | None = None,
                          page: int = 0) -> str:
        """
        Build a search URL.

        Examples:
          /jobs?keywords=subsea&page=0
          /jobs/freelancer?keywords=subsea&page=0  (contract filter)
        """
        # Determine employment type path segment
        type_segment = ""
        if job_types:
            for jt in job_types:
                mapped = EJL_EMPLOYMENT_TYPE_MAP.get(jt.lower())
                if mapped:
                    type_segment = f"/{mapped}"
                    break

        params = {"keywords": keyword}
        if page > 0:
            params["page"] = str(page)

        return f"{BASE_URL}/jobs{type_segment}?{urlencode(params)}"

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def _parse_listing_page(self, soup: BeautifulSoup) -> list[dict]:
        """
        Parse job listing cards from a search results page.

        Returns a list of dicts with keys:
          title, company, location, url, date_text, terms, node_id
        """
        jobs = []
        for article in soup.select("article.node-job"):
            try:
                # Title and URL
                link = article.select_one("a.recruiter-job-link")
                if not link:
                    continue
                title_raw = link.get_text(strip=True)
                href = link.get("href", "")
                if not href:
                    continue
                if not href.startswith("http"):
                    href = f"{BASE_URL}{href}"

                # Strip " in <Location>" suffix from title if present
                # e.g. "Safety Coordinator in Jacksonville" -> "Safety Coordinator"
                title = re.sub(r"\s+in\s+[A-Z][\w\s,]+$", "", title_raw).strip()
                if not title:
                    title = title_raw

                # Company
                company_el = article.select_one(".recruiter-company-profile-job-organization a")
                company = company_el.get_text(strip=True) if company_el else "Unknown"

                # Location
                loc_el = article.select_one(".location span")
                location = loc_el.get_text(strip=True) if loc_el else "Unknown"

                # Date
                date_el = article.select_one(".date")
                date_text = date_el.get_text(strip=True).rstrip(",") if date_el else ""

                # Terms / skills
                terms_el = article.select_one(".terms")
                terms = terms_el.get_text(strip=True) if terms_el else ""

                # Node ID from article id attribute (e.g. "node-29539384")
                node_id = article.get("id", "").replace("node-", "")

                jobs.append({
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": href,
                    "date_text": date_text,
                    "terms": terms,
                    "node_id": node_id,
                })
            except Exception as e:
                logger.debug(f"EnergyJobline: error parsing listing card: {e}")
                continue

        return jobs

    def _parse_results_count(self, soup: BeautifulSoup) -> int:
        """Extract total results count from the search results header."""
        header = soup.select_one(".search-result-header")
        if header:
            text = header.get_text(strip=True)
            match = re.search(r"([\d,]+)\s*Jobs?", text)
            if match:
                return int(match.group(1).replace(",", ""))
        return 0

    def _fetch_job_detail(self, url: str) -> dict:
        """
        Fetch a job detail page and extract structured data from JSON-LD.

        Returns dict with keys: description, salary, employment_type, posted_date
        """
        result = {}
        try:
            soup = self._fetch_page(url)

            # Parse JSON-LD structured data (schema.org JobPosting)
            for script in soup.find_all("script", type="application/ld+json"):
                try:
                    data = json.loads(script.string or "")
                    if data.get("@type") != "JobPosting":
                        continue

                    # Description (HTML stripped to text)
                    desc_html = data.get("description", "")
                    if desc_html:
                        desc_soup = BeautifulSoup(desc_html, "html.parser")
                        result["description"] = desc_soup.get_text(separator=" ", strip=True)

                    # Salary
                    base_salary = data.get("baseSalary")
                    if base_salary and isinstance(base_salary, dict):
                        value = base_salary.get("value", {})
                        if isinstance(value, dict):
                            min_val = value.get("minValue", "")
                            max_val = value.get("maxValue", "")
                            currency = base_salary.get("currency", "")
                            unit = value.get("unitText", "")
                            if min_val and max_val:
                                result["salary"] = f"{currency} {min_val}-{max_val} {unit}".strip()
                            elif min_val:
                                result["salary"] = f"{currency} {min_val}+ {unit}".strip()

                    # Employment type
                    emp_type = data.get("employmentType")
                    if emp_type:
                        if isinstance(emp_type, list):
                            result["employment_type"] = ", ".join(emp_type)
                        else:
                            result["employment_type"] = str(emp_type)

                    # Posted date
                    date_posted = data.get("datePosted")
                    if date_posted:
                        try:
                            result["posted_date"] = datetime.fromisoformat(date_posted)
                        except (ValueError, TypeError):
                            pass

                    break  # Found the JobPosting, stop
                except (json.JSONDecodeError, TypeError):
                    continue

            # Fallback: get description from page body if JSON-LD didn't have it
            if "description" not in result:
                body = soup.select_one(".field--body, .node__content .field--name-body")
                if body:
                    result["description"] = body.get_text(separator=" ", strip=True)[:2000]

            # Fallback: employment type from page
            if "employment_type" not in result:
                emp_el = soup.select_one("[class*=employment-type]")
                if emp_el:
                    result["employment_type"] = emp_el.get_text(strip=True)

        except Exception as e:
            logger.debug(f"EnergyJobline: error fetching detail {url}: {e}")

        return result

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def count(self, filters: AggregatorFilters) -> int:
        """Get count of matching jobs from the first keyword search."""
        total = 0
        for keyword in filters.keywords[:3]:  # Limit to first 3 keywords for speed
            try:
                url = self._build_search_url(keyword, filters.job_types)
                soup = self._fetch_page(url)
                count = self._parse_results_count(soup)
                total += count
                logger.info(f"EnergyJobline: '{keyword}' has {count:,} results")
            except Exception as e:
                logger.warning(f"EnergyJobline count failed for '{keyword}': {e}")
        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """
        Search Energy Jobline for jobs matching filters.

        For each keyword:
        1. Fetch search results page(s) with optional contract filter
        2. Parse listing cards for title, company, location, URL
        3. Fetch detail pages to get description, salary, employment type
        4. Return list of validated JobPosting objects

        Respects rate limits with delays between requests.
        """
        results: list[JobPosting] = []
        seen: set[str] = set()

        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break

            page = 0
            keyword_results = 0
            max_pages = 5  # Safety limit to avoid excessive scraping

            while page < max_pages and len(results) < filters.max_results:
                try:
                    url = self._build_search_url(keyword, filters.job_types, page=page)
                    logger.info(f"EnergyJobline: fetching {url}")
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

                        # Fetch detail page for description, salary, employment type
                        detail = self._fetch_job_detail(job_url)

                        description = detail.get("description", "")
                        if not description or len(description) < 10:
                            # Fallback: build minimal description from listing data
                            description = f"{listing['title']} at {listing['company']} - {listing['location']}"
                            if listing["terms"]:
                                description += f". Skills: {listing['terms']}"

                        # Parse date from listing text if detail didn't provide it
                        posted_date = detail.get("posted_date")
                        if not posted_date and listing["date_text"]:
                            try:
                                posted_date = datetime.strptime(listing["date_text"], "%m/%d/%Y")
                            except (ValueError, TypeError):
                                pass

                        try:
                            job = JobPosting(
                                title=listing["title"],
                                company=listing["company"],
                                location=listing["location"],
                                description=description,
                                url=job_url,
                                salary=detail.get("salary"),
                                posted_date=posted_date,
                                employment_type=detail.get("employment_type"),
                                source_aggregator="energyjobline",
                            )
                            results.append(job)
                            keyword_results += 1
                        except Exception as e:
                            logger.debug(f"EnergyJobline: skipping job (validation): {e}")

                    page += 1

                except Exception as e:
                    logger.warning(f"EnergyJobline search failed for '{keyword}' page {page}: {e}")
                    break

            logger.info(f"EnergyJobline: '{keyword}' yielded {keyword_results} jobs")

        logger.info(f"EnergyJobline: found {len(results)} unique jobs total")
        return results[:filters.max_results]

    def search_fast(self, filters: AggregatorFilters) -> list[JobPosting]:
        """
        Fast search that only parses listing pages without fetching detail pages.

        Use this when you need quick results and don't need full descriptions
        or salary data. Much faster since it avoids per-job detail page requests.
        """
        results: list[JobPosting] = []
        seen: set[str] = set()

        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break

            page = 0
            max_pages = 3

            while page < max_pages and len(results) < filters.max_results:
                try:
                    url = self._build_search_url(keyword, filters.job_types, page=page)
                    soup = self._fetch_page(url)
                    listings = self._parse_listing_page(soup)
                    if not listings:
                        break

                    for listing in listings:
                        if len(results) >= filters.max_results:
                            break

                        job_url = listing["url"]
                        dedup_key = f"{listing['title'].lower()}|{listing['company'].lower()}"
                        if job_url in seen or dedup_key in seen:
                            continue
                        seen.add(job_url)
                        seen.add(dedup_key)

                        description = f"{listing['title']} at {listing['company']} - {listing['location']}"
                        if listing["terms"]:
                            description += f". Skills: {listing['terms']}"

                        posted_date = None
                        if listing["date_text"]:
                            try:
                                posted_date = datetime.strptime(listing["date_text"], "%m/%d/%Y")
                            except (ValueError, TypeError):
                                pass

                        try:
                            job = JobPosting(
                                title=listing["title"],
                                company=listing["company"],
                                location=listing["location"],
                                description=description,
                                url=job_url,
                                posted_date=posted_date,
                                source_aggregator="energyjobline",
                            )
                            results.append(job)
                        except Exception as e:
                            logger.debug(f"EnergyJobline: skipping job: {e}")

                    page += 1

                except Exception as e:
                    logger.warning(f"EnergyJobline fast search failed: {e}")
                    break

        return results[:filters.max_results]
