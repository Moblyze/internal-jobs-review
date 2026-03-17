"""
OceanCrew adapter - scrapes maritime crew jobs from oceancrew.org.

OceanCrew is a Laravel-based maritime job board covering offshore, merchant,
drilling, cruises/yachts, and catering positions worldwide. ~29K active jobs.

Categories: offshore, merchant, drilling, cruises-yahts, catering
Search: /vacancies/{category}?page={n}
Individual job: /vacancies/{category}/{role}/{slug}

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

BASE_URL = "https://oceancrew.org"

# OceanCrew category slugs for targeted scraping
CATEGORIES = ["offshore", "merchant", "drilling", "cruises-yahts", "catering"]

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
}


class OceanCrewAggregator(BaseAggregator):
    """Scraper adapter for OceanCrew (oceancrew.org).

    Maritime job board with categories: offshore, merchant, drilling,
    cruises & yachts, catering. Jobs are listed in .job-item cards with
    pagination via ?page=N query parameter.
    """

    name = "oceancrew"

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

    def _build_search_url(self, category: str = "offshore", page: int = 1) -> str:
        """Build category listing URL with pagination.

        Pattern: /vacancies/{category}?page={n}
        """
        url = f"{BASE_URL}/vacancies/{category}"
        if page > 1:
            url += f"?page={page}"
        return url

    def _parse_listing_page(self, soup: BeautifulSoup) -> list[dict]:
        """Parse job listings from a category page.

        HTML structure per job (inside .job-item):
          <div class="job-item mb-30">
            <div class="job-instructor-profile">
              <div class="job-instructor-img">
                <img alt="Company Name" ...>
              </div>
              <div class="job-instructor-title">
                <div class="job-tag"><span class="tag-normal">full time</span></div>
                <p>DD-MM-YYYY</p>
                <h5><a href="https://oceancrew.org/vacancies/...">Title</a></h5>
                <p>Description snippet...</p>
                <div class="job-meta">
                  <span><i class="far fa-user-ninja"></i> Role</span>
                  <span><i class="fal fa-usd-circle"></i> Salary info</span>
                </div>
              </div>
            </div>
          </div>
        """
        jobs = []

        for item in soup.select(".job-item"):
            try:
                # Skip ad placeholders
                if "adsbygoogle" in str(item.get("class", [])):
                    continue

                profile = item.select_one(".job-instructor-title")
                if not profile:
                    continue

                # Title and URL from h5 > a
                title_link = profile.select_one("h5 a")
                if not title_link:
                    continue
                title = title_link.get_text(strip=True)
                href = title_link.get("href", "")
                if not title or not href:
                    continue
                if not href.startswith("http"):
                    href = BASE_URL + href

                # Company from the image alt text
                img = item.select_one(".job-instructor-img img")
                company = img.get("alt", "Unknown") if img else "Unknown"
                if not company or company == "":
                    company = "Unknown"

                # Job type from tag
                tag_el = profile.select_one(".job-tag .tag-normal")
                job_type = tag_el.get_text(strip=True) if tag_el else None

                # Date - first <p> tag in the title section (format: DD-MM-YYYY)
                date_text = ""
                p_tags = profile.find_all("p", recursive=False)
                for p in p_tags:
                    text = p.get_text(strip=True)
                    if re.match(r"\d{2}-\d{2}-\d{4}", text):
                        date_text = text
                        break

                # Description snippet - second <p> tag or text after h5
                description = ""
                for p in p_tags:
                    text = p.get_text(strip=True)
                    if not re.match(r"\d{2}-\d{2}-\d{4}", text) and len(text) > 20:
                        description = text
                        break

                # Role from job-meta
                role = ""
                meta_spans = profile.select(".job-meta span")
                if meta_spans:
                    role = meta_spans[0].get_text(strip=True)

                # Salary from job-meta
                salary = None
                if len(meta_spans) > 1:
                    salary_text = meta_spans[1].get_text(strip=True)
                    if "not specified" not in salary_text.lower():
                        salary = salary_text

                # Build description if not found
                if not description or len(description) < 10:
                    description = f"{title} at {company}"
                    if role:
                        description += f" - Role: {role}"

                jobs.append({
                    "title": title,
                    "company": company,
                    "location": "Maritime / Offshore",
                    "url": href,
                    "employment_type": job_type,
                    "date_text": date_text,
                    "description": description,
                    "salary": salary,
                    "role": role,
                })

            except Exception as e:
                logger.debug(f"OceanCrew: error parsing listing: {e}")
                continue

        return jobs

    def _parse_max_page(self, soup: BeautifulSoup) -> int:
        """Extract the maximum page number from pagination links."""
        max_page = 1
        for link in soup.select(".pagination a, .basic-pagination a"):
            href = link.get("href", "")
            match = re.search(r"page=(\d+)", href)
            if match:
                page_num = int(match.group(1))
                max_page = max(max_page, page_num)
        return max_page

    def _parse_date(self, date_text: str) -> datetime | None:
        """Parse OceanCrew date format DD-MM-YYYY."""
        if not date_text:
            return None
        try:
            return datetime.strptime(date_text.strip(), "%d-%m-%Y")
        except ValueError:
            pass
        # Try alternative formats
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
            try:
                return datetime.strptime(date_text.strip(), fmt)
            except ValueError:
                continue
        return None

    def _keyword_matches_category(self, keyword: str) -> list[str]:
        """Map keywords to relevant OceanCrew categories.

        Returns list of category slugs most relevant to the keyword.
        """
        kw = keyword.lower()

        # Maritime-specific keyword to category mapping
        category_map = {
            "offshore": ["offshore"],
            "marine": ["offshore", "merchant"],
            "maritime": ["offshore", "merchant"],
            "merchant": ["merchant"],
            "drilling": ["drilling"],
            "cruise": ["cruises-yahts"],
            "yacht": ["cruises-yahts"],
            "catering": ["catering"],
            "cook": ["catering"],
            "chef": ["catering"],
            "deck": ["offshore", "merchant"],
            "engine": ["offshore", "merchant"],
            "captain": ["offshore", "merchant"],
            "master": ["offshore", "merchant"],
            "mate": ["offshore", "merchant"],
            "oiler": ["offshore", "merchant"],
            "able seaman": ["offshore", "merchant"],
            "bosun": ["offshore", "merchant"],
        }

        for term, cats in category_map.items():
            if term in kw:
                return cats

        # Default: search offshore and merchant (most relevant for energy sector)
        return ["offshore"]

    def count(self, filters: AggregatorFilters) -> int:
        """Get approximate count of matching jobs."""
        total = 0
        checked_categories: set[str] = set()

        for keyword in filters.keywords[:3]:
            categories = self._keyword_matches_category(keyword)
            for cat in categories:
                if cat in checked_categories:
                    continue
                checked_categories.add(cat)

                try:
                    url = self._build_search_url(cat)
                    soup = self._fetch_page(url)
                    max_page = self._parse_max_page(soup)
                    listings = self._parse_listing_page(soup)
                    # Estimate: listings per page * max pages
                    per_page = len(listings) if listings else 0
                    estimated = per_page * max_page
                    total += estimated
                    logger.info(
                        f"OceanCrew: category '{cat}' has ~{estimated} jobs "
                        f"({per_page}/page x {max_page} pages)"
                    )
                except Exception as e:
                    logger.warning(f"OceanCrew count failed for category '{cat}': {e}")

        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search OceanCrew for maritime jobs matching filters.

        Scrapes category listing pages. For each keyword, determines the most
        relevant OceanCrew categories and scrapes them with pagination.
        """
        results: list[JobPosting] = []
        seen: set[str] = set()
        scraped_categories: set[str] = set()

        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break

            categories = self._keyword_matches_category(keyword)

            for category in categories:
                if len(results) >= filters.max_results:
                    break
                if category in scraped_categories:
                    continue
                scraped_categories.add(category)

                page = 1
                max_pages = 3  # Safety limit per category

                while page <= max_pages and len(results) < filters.max_results:
                    try:
                        url = self._build_search_url(category, page=page)
                        logger.info(f"OceanCrew: fetching {url}")
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

                            dedup_key = f"{listing['title'].lower()}|{listing['company'].lower()}"
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
                                    salary=listing.get("salary"),
                                    employment_type=listing.get("employment_type"),
                                    source_aggregator="oceancrew",
                                )
                                results.append(job)
                            except Exception as e:
                                logger.debug(f"OceanCrew: skipping job (validation): {e}")

                        # Check if there are more pages
                        total_pages = self._parse_max_page(soup)
                        if page >= total_pages:
                            break

                        page += 1

                    except Exception as e:
                        logger.warning(
                            f"OceanCrew search failed for '{category}' page {page}: {e}"
                        )
                        break

        logger.info(f"OceanCrew: found {len(results)} unique jobs")
        return results[:filters.max_results]
