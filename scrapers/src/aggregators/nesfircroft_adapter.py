"""
NES Fircroft adapter - scrapes the world's largest energy staffing company.

NES Fircroft (nesfircroft.com) is a Vennture-powered job board and the world's
largest engineering and technical staffing company for the energy sector.
Covers O&G, renewables, power, nuclear, mining, chemicals, and life sciences.

The site uses a client-side JavaScript job search (Vennture Dynamic Job Search)
that loads jobs via AJAX. We query the Vennture API directly to get structured
job data.

Search: /job-search/?query={keyword}&type={Contract|Permanent}
API: Vennture connector renders jobs client-side; we scrape the search page.

No API key required - this is a web scraper.
"""

import re
import time
import json
import logging
from datetime import datetime
from urllib.parse import urlencode

import httpx
from bs4 import BeautifulSoup

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

BASE_URL = "https://www.nesfircroft.com"
SEARCH_URL = f"{BASE_URL}/job-search/"

# Vennture CDN base for the dynamic search JS
VENNTURE_CDN = "https://cdn2.wearevennture.co.uk"

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
    "Referer": "https://www.nesfircroft.com/job-search/",
}

# NES Fircroft regional/industry URL patterns for targeted scraping
INDUSTRY_PAGES = {
    "oil_gas": "/industries/oil-and-gas-recruitment/",
    "renewable": "/industries/renewable-energy-recruitment/",
    "nuclear": "/industries/nuclear-recruitment/",
    "mining": "/industries/mining-recruitment/",
    "power": "/industries/power-recruitment/",
    "chemicals": "/industries/chemicals-recruitment/",
    "life_sciences": "/industries/life-science-recruitment/",
}

# Map our job_types to NES Fircroft types
EMPLOYMENT_TYPE_MAP = {
    "contract": "Contract",
    "contractor": "Contract",
    "temporary": "Contract",
    "full_time": "Permanent",
    "full-time": "Permanent",
    "permanent": "Permanent",
}


class NESFircroftAggregator(BaseAggregator):
    """Scraper adapter for NES Fircroft (nesfircroft.com).

    World's largest energy staffing company. The site uses Vennture's dynamic
    job search which renders jobs client-side via JavaScript. Since we can't
    execute JS, we attempt to:
    1. Scrape the server-rendered search page for any static content
    2. Query industry-specific landing pages for job listings
    3. Fall back to the Vennture API if available

    Note: NES Fircroft's main job search requires JavaScript rendering. This
    adapter provides partial coverage via direct page scraping.
    """

    name = "nesfircroft"

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

    def _try_vennture_api(self, keyword: str = "", job_type: str = "",
                          page: int = 1, page_size: int = 20) -> list[dict]:
        """Attempt to query the Vennture job search API directly.

        The Vennture dynamic search connector typically uses endpoints like:
        /api/jobsearch/search or similar patterns. This method tries common
        API patterns used by Vennture-powered sites.
        """
        client = self._get_client()

        # Common Vennture API patterns
        api_urls = [
            f"{BASE_URL}/api/jobsearch/search",
            f"{BASE_URL}/api/jobs/search",
            f"{BASE_URL}/umbraco/api/jobsearch/search",
        ]

        params = {
            "keywords": keyword,
            "page": str(page),
            "pageSize": str(page_size),
            "sortBy": "createddate",
            "sortType": "desc",
        }
        if job_type:
            params["type"] = job_type

        for api_url in api_urls:
            try:
                time.sleep(REQUEST_DELAY)
                resp = client.get(
                    api_url,
                    params=params,
                    headers={
                        **HEADERS,
                        "Accept": "application/json",
                        "X-Requested-With": "XMLHttpRequest",
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, dict) and "jobs" in data:
                        return data["jobs"]
                    if isinstance(data, dict) and "results" in data:
                        return data["results"]
                    if isinstance(data, list):
                        return data
            except (httpx.HTTPStatusError, json.JSONDecodeError, Exception) as e:
                logger.debug(f"NESFircroft: API attempt {api_url} failed: {e}")
                continue

        return []

    def _scrape_industry_page(self, industry_path: str) -> list[dict]:
        """Scrape an industry landing page for job listings.

        Industry pages sometimes have statically rendered job listings
        or embedded structured data.
        """
        jobs = []
        try:
            url = f"{BASE_URL}{industry_path}"
            soup = self._fetch_page(url)

            # Look for JSON-LD structured data
            for script in soup.find_all("script", type="application/ld+json"):
                try:
                    data = json.loads(script.string or "")
                    if isinstance(data, dict) and data.get("@type") == "JobPosting":
                        jobs.append(self._parse_jsonld_job(data))
                    elif isinstance(data, list):
                        for item in data:
                            if isinstance(item, dict) and item.get("@type") == "JobPosting":
                                jobs.append(self._parse_jsonld_job(item))
                except (json.JSONDecodeError, TypeError):
                    continue

            # Look for job listing elements on the page
            for link in soup.select("a[href*='/job/'], a[href*='/jobs/']"):
                href = link.get("href", "")
                title = link.get_text(strip=True)
                if href and title and len(title) > 3:
                    if not href.startswith("http"):
                        href = BASE_URL + href
                    jobs.append({
                        "title": title,
                        "url": href,
                        "company": "NES Fircroft",
                        "location": "Various",
                    })

        except Exception as e:
            logger.debug(f"NESFircroft: failed to scrape {industry_path}: {e}")

        return jobs

    def _parse_jsonld_job(self, data: dict) -> dict:
        """Parse a JSON-LD JobPosting into a job dict."""
        title = data.get("title", "")
        company = "NES Fircroft"
        hiring_org = data.get("hiringOrganization", {})
        if isinstance(hiring_org, dict):
            company = hiring_org.get("name", company)

        location = "Various"
        job_location = data.get("jobLocation", {})
        if isinstance(job_location, dict):
            address = job_location.get("address", {})
            if isinstance(address, dict):
                parts = []
                for field in ("addressLocality", "addressRegion", "addressCountry"):
                    val = address.get(field, "")
                    if val:
                        parts.append(str(val))
                if parts:
                    location = ", ".join(parts)

        return {
            "title": title,
            "company": company,
            "location": location,
            "url": data.get("url", f"{BASE_URL}/job-search/"),
            "description": data.get("description", ""),
            "employment_type": data.get("employmentType", ""),
            "date_posted": data.get("datePosted", ""),
            "salary": "",
        }

    def _scrape_search_page(self, keyword: str = "") -> list[dict]:
        """Scrape the main search page.

        The Vennture dynamic search renders client-side, so we may not get
        job listings. We try to extract any server-rendered content.
        """
        jobs = []
        try:
            url = SEARCH_URL
            if keyword:
                url += f"?query={keyword}"

            soup = self._fetch_page(url)

            # Check for server-rendered job cards
            for card in soup.select(
                ".job-card, .search-result, .vacancy-card, "
                "[class*=job-item], [class*=vacancy]"
            ):
                title_el = card.select_one("h2, h3, h4, a[href*='/job']")
                if not title_el:
                    continue

                title = title_el.get_text(strip=True)
                href = ""
                if title_el.name == "a":
                    href = title_el.get("href", "")
                else:
                    link = card.select_one("a[href*='/job']")
                    if link:
                        href = link.get("href", "")

                if not title or not href:
                    continue
                if not href.startswith("http"):
                    href = BASE_URL + href

                location = "Various"
                loc_el = card.select_one("[class*=location]")
                if loc_el:
                    location = loc_el.get_text(strip=True)

                jobs.append({
                    "title": title,
                    "company": "NES Fircroft",
                    "location": location,
                    "url": href,
                })

            # Also check for JSON-LD on the search page
            for script in soup.find_all("script", type="application/ld+json"):
                try:
                    data = json.loads(script.string or "")
                    if isinstance(data, list):
                        for item in data:
                            if isinstance(item, dict) and item.get("@type") == "JobPosting":
                                jobs.append(self._parse_jsonld_job(item))
                except (json.JSONDecodeError, TypeError):
                    continue

        except Exception as e:
            logger.warning(f"NESFircroft: search page scrape failed: {e}")

        return jobs

    def _parse_date(self, date_str: str) -> datetime | None:
        """Parse date strings from various formats."""
        if not date_str:
            return None
        for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y", "%m/%d/%Y",
                     "%d %b %Y", "%B %d, %Y"):
            try:
                return datetime.strptime(date_str.strip()[:19], fmt)
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            pass
        return None

    def _keyword_to_industries(self, keyword: str) -> list[str]:
        """Map a keyword to relevant NES Fircroft industry pages."""
        kw = keyword.lower()
        matches = []

        industry_keywords = {
            "oil_gas": ["oil", "gas", "petroleum", "upstream", "downstream",
                        "refinery", "pipeline", "subsea"],
            "renewable": ["renewable", "solar", "wind", "green energy",
                          "clean energy", "sustainability"],
            "nuclear": ["nuclear", "decommissioning", "radiation"],
            "mining": ["mining", "metals", "minerals", "quarry"],
            "power": ["power", "electricity", "grid", "transmission",
                       "distribution", "utility"],
            "chemicals": ["chemical", "petrochemical", "pharma"],
            "life_sciences": ["life science", "pharmaceutical", "biotech", "medical"],
        }

        for industry, terms in industry_keywords.items():
            for term in terms:
                if term in kw:
                    matches.append(industry)
                    break

        # Default to oil_gas and renewable if no specific match
        if not matches:
            matches = ["oil_gas", "renewable"]

        return matches

    def count(self, filters: AggregatorFilters) -> int:
        """Get approximate count of matching jobs.

        Limited by JS-rendered search. Returns estimate from API or page scraping.
        """
        total = 0
        try:
            # Try API first
            for keyword in filters.keywords[:2]:
                api_jobs = self._try_vennture_api(keyword=keyword)
                if api_jobs:
                    total += len(api_jobs)
                    continue

                # Fallback: count from industry pages
                industries = self._keyword_to_industries(keyword)
                for ind in industries[:2]:
                    path = INDUSTRY_PAGES.get(ind, "")
                    if path:
                        jobs = self._scrape_industry_page(path)
                        total += len(jobs)
        except Exception as e:
            logger.warning(f"NESFircroft count failed: {e}")

        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search NES Fircroft for energy sector jobs.

        Tries multiple approaches:
        1. Vennture API direct query
        2. Search page scraping
        3. Industry page scraping

        Note: Results may be limited due to client-side JS rendering.
        """
        results: list[JobPosting] = []
        seen: set[str] = set()

        # Determine employment type filter
        job_type = ""
        if filters.job_types:
            for jt in filters.job_types:
                mapped = EMPLOYMENT_TYPE_MAP.get(jt.lower())
                if mapped:
                    job_type = mapped
                    break

        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break

            # Strategy 1: Try Vennture API
            api_jobs = self._try_vennture_api(
                keyword=keyword, job_type=job_type
            )
            if api_jobs:
                logger.info(f"NESFircroft: API returned {len(api_jobs)} jobs for '{keyword}'")
                for job_data in api_jobs:
                    if len(results) >= filters.max_results:
                        break

                    title = (
                        job_data.get("title")
                        or job_data.get("jobTitle")
                        or job_data.get("Title")
                        or ""
                    )
                    if not title:
                        continue

                    url = (
                        job_data.get("url")
                        or job_data.get("detailUrl")
                        or job_data.get("Url")
                        or ""
                    )
                    if url and not url.startswith("http"):
                        url = BASE_URL + url
                    if not url:
                        url = SEARCH_URL

                    if url in seen:
                        continue
                    seen.add(url)

                    location = (
                        job_data.get("location")
                        or job_data.get("Location")
                        or "Various"
                    )
                    description = (
                        job_data.get("description")
                        or job_data.get("summary")
                        or f"{title} - NES Fircroft - {location}"
                    )
                    if len(description) < 10:
                        description = f"{title} - NES Fircroft - {location}"

                    date_str = (
                        job_data.get("datePosted")
                        or job_data.get("createdDate")
                        or job_data.get("publishDate")
                        or ""
                    )

                    try:
                        job = JobPosting(
                            title=title,
                            company="NES Fircroft",
                            location=location,
                            description=description,
                            url=url,
                            posted_date=self._parse_date(date_str),
                            employment_type=job_data.get("type", job_type),
                            source_aggregator="nesfircroft",
                        )
                        results.append(job)
                    except Exception as e:
                        logger.debug(f"NESFircroft: skipping API job: {e}")

                continue  # API worked, skip scraping for this keyword

            # Strategy 2: Scrape search page
            search_jobs = self._scrape_search_page(keyword)
            if search_jobs:
                logger.info(
                    f"NESFircroft: search page has {len(search_jobs)} jobs for '{keyword}'"
                )
                for job_data in search_jobs:
                    if len(results) >= filters.max_results:
                        break

                    url = job_data.get("url", "")
                    if url in seen:
                        continue
                    seen.add(url)

                    description = job_data.get("description", "")
                    if not description or len(description) < 10:
                        description = (
                            f"{job_data.get('title', '')} - NES Fircroft "
                            f"- {job_data.get('location', 'Various')}"
                        )

                    try:
                        job = JobPosting(
                            title=job_data.get("title", ""),
                            company=job_data.get("company", "NES Fircroft"),
                            location=job_data.get("location", "Various"),
                            description=description,
                            url=url or SEARCH_URL,
                            posted_date=self._parse_date(job_data.get("date_posted", "")),
                            employment_type=job_data.get("employment_type"),
                            source_aggregator="nesfircroft",
                        )
                        results.append(job)
                    except Exception as e:
                        logger.debug(f"NESFircroft: skipping scraped job: {e}")

                continue

            # Strategy 3: Scrape industry pages
            industries = self._keyword_to_industries(keyword)
            for ind in industries:
                if len(results) >= filters.max_results:
                    break

                path = INDUSTRY_PAGES.get(ind, "")
                if not path:
                    continue

                ind_jobs = self._scrape_industry_page(path)
                logger.info(
                    f"NESFircroft: industry page '{ind}' has {len(ind_jobs)} jobs"
                )

                for job_data in ind_jobs:
                    if len(results) >= filters.max_results:
                        break

                    url = job_data.get("url", "")
                    if url in seen:
                        continue
                    seen.add(url)

                    description = job_data.get("description", "")
                    if not description or len(description) < 10:
                        description = (
                            f"{job_data.get('title', '')} - NES Fircroft "
                            f"- {job_data.get('location', 'Various')}"
                        )

                    try:
                        job = JobPosting(
                            title=job_data.get("title", ""),
                            company=job_data.get("company", "NES Fircroft"),
                            location=job_data.get("location", "Various"),
                            description=description,
                            url=url or SEARCH_URL,
                            posted_date=self._parse_date(job_data.get("date_posted", "")),
                            employment_type=job_data.get("employment_type"),
                            source_aggregator="nesfircroft",
                        )
                        results.append(job)
                    except Exception as e:
                        logger.debug(f"NESFircroft: skipping industry job: {e}")

        logger.info(f"NESFircroft: found {len(results)} jobs total")
        return results[:filters.max_results]
