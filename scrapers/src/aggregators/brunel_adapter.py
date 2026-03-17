"""
Brunel adapter - scrapes global energy staffing agency jobs from brunel.net.

Brunel (brunel.net) is a global staffing agency with strong presence in
conventional energy, renewable energy, mining, and life sciences. ~280+ active
US-focused jobs at any time.

The site uses a Sitecore-powered React search component that loads job data
client-side. We scrape the server-rendered HTML which contains job cards
in the initial page load.

Search URL: /en-us/jobs (with client-side filtering)
Job detail: /en-us/jobs/{title-vacancy-id}
Category: /en-us/jobs/united-states/{category}
Keyword: /en-us/jobs/keyword/{keyword}/united-states

Pagination: ?page={n} (12, 24, or 48 per page)

No API key required - this is a web scraper.
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

BASE_URL = "https://www.brunel.net"
JOBS_URL = f"{BASE_URL}/en-us/jobs"

# Brunel category URL segments
CATEGORY_MAP = {
    "oil": "conventional-energy",
    "gas": "conventional-energy",
    "energy": "conventional-energy",
    "renewable": "renewable-energy",
    "solar": "renewable-energy",
    "wind": "renewable-energy",
    "mining": "mining",
    "life science": "life-sciences",
    "pharma": "life-sciences",
    "automotive": "automotive",
    "it": "it",
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
    "Referer": "https://www.brunel.net/",
}


class BrunelAggregator(BaseAggregator):
    """Scraper adapter for Brunel (brunel.net/en-us/jobs).

    Global energy staffing agency. The site uses a Sitecore CMS with React
    search components. Job listings are partially server-rendered.

    Job cards contain:
    - Title with link to /en-us/jobs/{title-vacancy-id}
    - Location (e.g., "Usa, Carlsbad")
    - Education level
    - Experience requirement
    - Position summary

    Vacancy IDs follow pattern: {slug}-{TR|VR}-{number}
    """

    name = "brunel"

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

    def _build_search_url(self, keyword: str = "", category: str = "",
                          page: int = 1) -> str:
        """Build Brunel search URL.

        URL patterns:
        - All US jobs: /en-us/jobs
        - By category: /en-us/jobs/united-states/{category}
        - By keyword: /en-us/jobs/keyword/{keyword}/united-states
        - Pagination: append ?page={n}
        """
        if keyword:
            # Clean keyword for URL path (replace spaces with -)
            clean_kw = keyword.lower().strip().replace(" ", "-")
            url = f"{JOBS_URL}/keyword/{clean_kw}/united-states"
        elif category:
            url = f"{JOBS_URL}/united-states/{category}"
        else:
            url = JOBS_URL

        if page > 1:
            url += f"?page={page}"

        return url

    def _parse_listing_page(self, soup: BeautifulSoup) -> list[dict]:
        """Parse job listing cards from the search page.

        Brunel renders job cards with links to detail pages. The card structure
        includes title, location, education, experience, and summary.
        """
        jobs = []

        # Find all job detail links matching the pattern /en-us/jobs/{slug-id}
        job_links = soup.find_all("a", href=re.compile(
            r"/en-us/jobs/[\w-]+-(?:tr|vr)-\d+", re.IGNORECASE
        ))

        # Process unique links (each job appears twice - title and "read more")
        seen_hrefs: set[str] = set()

        for link in job_links:
            href = link.get("href", "")
            if not href:
                continue

            # Normalize and deduplicate
            if not href.startswith("http"):
                href = BASE_URL + href
            if href in seen_hrefs:
                continue
            seen_hrefs.add(href)

            # Get the title from the link text
            title = link.get_text(strip=True)
            if not title or len(title) < 3:
                continue

            # Skip navigation/utility links
            if title.lower() in ("read more", "apply now", "view", "details"):
                continue

            # Try to find parent card container for more data
            card = link.find_parent(
                ["div", "article", "li"],
                class_=re.compile(r"card|job|vacancy|result", re.IGNORECASE)
            )

            location = "United States"
            education = ""
            experience = ""
            summary = ""

            if card:
                # Location - look for text with "Usa," pattern
                card_text = card.get_text(separator="|", strip=True)
                loc_match = re.search(
                    r"(?:Usa|United States),\s*([^|]+)",
                    card_text, re.IGNORECASE
                )
                if loc_match:
                    location = f"USA, {loc_match.group(1).strip()}"

                # Education level
                edu_match = re.search(
                    r"(Secondary School|Bachelor|Master|PhD|Professional|Academic)",
                    card_text, re.IGNORECASE
                )
                if edu_match:
                    education = edu_match.group(1)

                # Experience
                exp_match = re.search(
                    r"(\d+-\d+ Years?|>\d+ Years?|Not applicable)",
                    card_text, re.IGNORECASE
                )
                if exp_match:
                    experience = exp_match.group(1)

                # Summary - look for paragraph-length text
                for p in card.find_all(["p", "div"]):
                    text = p.get_text(strip=True)
                    if len(text) > 50 and title.lower() not in text.lower()[:20]:
                        summary = text[:500]
                        break

            # Extract vacancy ID from URL
            vacancy_id = ""
            id_match = re.search(r"-((?:tr|vr)-\d+)$", href, re.IGNORECASE)
            if id_match:
                vacancy_id = id_match.group(1).upper()

            if not summary or len(summary) < 10:
                summary = f"{title} - Brunel - {location}"
                if experience:
                    summary += f". Experience: {experience}"

            jobs.append({
                "title": title,
                "company": "Brunel",
                "location": location,
                "url": href,
                "description": summary,
                "requisition_id": vacancy_id,
                "education": education,
                "experience": experience,
            })

        return jobs

    def _parse_results_count(self, soup: BeautifulSoup) -> tuple[int, int]:
        """Extract total results and page info.

        Looks for text like "12 of 280" or similar patterns.
        Returns (total_jobs, items_per_page).
        """
        total_jobs = 0
        per_page = 12

        text = soup.get_text()
        # Pattern: "12 of 280"
        match = re.search(r"(\d+)\s+of\s+(\d+)", text)
        if match:
            per_page = int(match.group(1))
            total_jobs = int(match.group(2))

        return total_jobs, per_page

    def _try_api(self, keyword: str = "", page: int = 1,
                 page_size: int = 48) -> list[dict]:
        """Try to query Brunel's job alert / search API.

        Brunel has a /en-us/api/jobalert/create endpoint, suggesting they
        may have a search API too.
        """
        client = self._get_client()

        api_urls = [
            f"{BASE_URL}/en-us/api/jobs/search",
            f"{BASE_URL}/api/jobs/search",
            f"{BASE_URL}/en-us/api/vacancy/search",
        ]

        params = {
            "keyword": keyword,
            "page": str(page),
            "pageSize": str(page_size),
            "country": "united-states",
        }

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
                    if isinstance(data, dict):
                        for key in ("vacancies", "jobs", "results", "items"):
                            if key in data and isinstance(data[key], list):
                                return data[key]
                    if isinstance(data, list):
                        return data
            except (httpx.HTTPStatusError, json.JSONDecodeError, Exception) as e:
                logger.debug(f"Brunel: API attempt {api_url} failed: {e}")
                continue

        return []

    def _parse_date(self, date_str: str) -> datetime | None:
        """Parse date strings from Brunel."""
        if not date_str:
            return None
        for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d %b %Y",
                     "%d-%m-%Y", "%m/%d/%Y"):
            try:
                return datetime.strptime(date_str.strip()[:19], fmt)
            except ValueError:
                continue
        return None

    def _keyword_to_category(self, keyword: str) -> str:
        """Map a keyword to a Brunel category slug."""
        kw = keyword.lower()
        for term, category in CATEGORY_MAP.items():
            if term in kw:
                return category
        return ""

    def count(self, filters: AggregatorFilters) -> int:
        """Get approximate count of matching jobs."""
        try:
            url = self._build_search_url()
            soup = self._fetch_page(url)
            total_jobs, _ = self._parse_results_count(soup)
            if total_jobs > 0:
                return total_jobs

            # Fallback: count listings
            listings = self._parse_listing_page(soup)
            return len(listings)
        except Exception as e:
            logger.warning(f"Brunel count failed: {e}")
            return 0

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search Brunel for energy sector jobs.

        Tries:
        1. API query (if available)
        2. Keyword URL scraping (/en-us/jobs/keyword/{kw}/united-states)
        3. Category URL scraping (/en-us/jobs/united-states/{category})
        4. General listing scraping
        """
        results: list[JobPosting] = []
        seen: set[str] = set()

        # Try API first for each keyword
        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break

            api_jobs = self._try_api(keyword=keyword)
            if api_jobs:
                logger.info(f"Brunel: API returned {len(api_jobs)} jobs for '{keyword}'")
                for job_data in api_jobs:
                    if len(results) >= filters.max_results:
                        break

                    title = (
                        job_data.get("title")
                        or job_data.get("jobTitle")
                        or job_data.get("name")
                        or ""
                    )
                    if not title:
                        continue

                    url = (
                        job_data.get("url")
                        or job_data.get("detailUrl")
                        or ""
                    )
                    if url and not url.startswith("http"):
                        url = BASE_URL + url
                    if not url:
                        url = JOBS_URL

                    if url in seen:
                        continue
                    seen.add(url)

                    location = job_data.get("location", "United States")
                    description = job_data.get("description", "")
                    if not description or len(description) < 10:
                        description = f"{title} - Brunel - {location}"

                    try:
                        job = JobPosting(
                            title=title,
                            company="Brunel",
                            location=location,
                            description=description,
                            url=url,
                            posted_date=self._parse_date(
                                job_data.get("datePosted", "")
                            ),
                            employment_type=job_data.get("employmentType"),
                            requisition_id=job_data.get("vacancyId", ""),
                            source_aggregator="brunel",
                        )
                        results.append(job)
                    except Exception as e:
                        logger.debug(f"Brunel: skipping API job: {e}")

                continue  # API worked, skip scraping

        # Fallback: scrape pages
        if not results:
            scraped_urls: set[str] = set()

            for keyword in filters.keywords:
                if len(results) >= filters.max_results:
                    break

                # Try keyword URL
                page = 1
                max_pages = 5

                while page <= max_pages and len(results) < filters.max_results:
                    try:
                        # Try keyword search URL first, then category
                        category = self._keyword_to_category(keyword)
                        url = self._build_search_url(
                            keyword=keyword, page=page
                        )

                        if url in scraped_urls:
                            break
                        scraped_urls.add(url)

                        logger.info(f"Brunel: fetching {url}")
                        soup = self._fetch_page(url)

                        listings = self._parse_listing_page(soup)
                        if not listings:
                            # Try category URL as fallback
                            if category and page == 1:
                                url = self._build_search_url(
                                    category=category, page=page
                                )
                                if url not in scraped_urls:
                                    scraped_urls.add(url)
                                    soup = self._fetch_page(url)
                                    listings = self._parse_listing_page(soup)
                            if not listings:
                                break

                        for listing in listings:
                            if len(results) >= filters.max_results:
                                break

                            job_url = listing["url"]
                            if job_url in seen:
                                continue
                            seen.add(job_url)

                            dedup_key = (
                                f"{listing['title'].lower()}"
                                f"|{listing['location'].lower()}"
                            )
                            if dedup_key in seen:
                                continue
                            seen.add(dedup_key)

                            try:
                                job = JobPosting(
                                    title=listing["title"],
                                    company=listing["company"],
                                    location=listing["location"],
                                    description=listing["description"],
                                    url=job_url,
                                    requisition_id=listing.get("requisition_id"),
                                    employment_type="Contract",
                                    source_aggregator="brunel",
                                )
                                results.append(job)
                            except Exception as e:
                                logger.debug(f"Brunel: skipping job: {e}")

                        page += 1

                    except Exception as e:
                        logger.warning(
                            f"Brunel search failed for '{keyword}' page {page}: {e}"
                        )
                        break

        logger.info(f"Brunel: found {len(results)} jobs")
        return results[:filters.max_results]
