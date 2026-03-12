"""OilJobFinder adapter - scrapes O&G jobs from OilJobFinder's J2C widget.

OilJobFinder.com hosts a Jobs2Careers (J2C) widget that displays oil/gas/energy
jobs. This adapter searches by keyword, parses the server-rendered HTML, and
constructs clickthrough URLs using the J2C URL scheme.

No API key is required. The adapter scrapes the public /members/more-jobs/ page.
"""

import re
import logging
from datetime import datetime

import httpx
from bs4 import BeautifulSoup

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

# Maximum number of paginated pages to fetch per keyword.
MAX_PAGES_PER_KEYWORD = 8
RESULTS_PER_PAGE = 25  # J2C returns 25 per page


class OilJobFinderAggregator(BaseAggregator):
    name = "oiljobfinder"
    BASE_URL = "https://www.oiljobfinder.com/members/more-jobs/"

    HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    def is_configured(self) -> bool:
        # No API key needed - scrapes public pages.
        return True

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _fetch_page(self, keywords: str, page: int = 1) -> str:
        """Fetch a single results page from the J2C widget."""
        if page == 1:
            url = self.BASE_URL
        else:
            url = f"{self.BASE_URL}page/{page}/"

        params = {"j2c_keywords": keywords}
        resp = httpx.get(url, params=params, headers=self.HEADERS,
                         follow_redirects=True, timeout=30)
        resp.raise_for_status()
        return resp.text

    @staticmethod
    def _build_j2c_url(onclick: str) -> str | None:
        """Construct a Jobs2Careers clickthrough URL from the onclick attribute.

        The j2c_view JS function builds:
            https://www.jobs2careers.com/click.php?jid=<hex(m)><hex(o,8)><hex(r,8)>
        """
        match = re.search(r"j2c_view\((\d+),\s*(\d+),\s*(\d+)", onclick)
        if not match:
            return None
        r_val, o_val, m_val = int(match.group(1)), int(match.group(2)), int(match.group(3))
        jid = format(m_val, "x") + format(o_val, "x").zfill(8) + format(r_val, "x").zfill(8)
        return f"https://www.jobs2careers.com/click.php?jid={jid}"

    @staticmethod
    def _parse_posted_date(text: str) -> datetime | None:
        """Parse 'Posted March 2, 2026' into a datetime."""
        text = text.replace("Posted ", "").strip()
        for fmt in ("%B %d, %Y", "%b %d, %Y"):
            try:
                return datetime.strptime(text, fmt)
            except ValueError:
                continue
        return None

    def _parse_page(self, html: str) -> list[dict]:
        """Parse job cards from an HTML page. Returns raw dicts."""
        soup = BeautifulSoup(html, "html.parser")
        jobs = []

        for div in soup.find_all("div", class_="j2c-job"):
            title_div = div.find("div", class_="j2c-title")
            if not title_div:
                continue
            link = title_div.find("a")
            if not link:
                continue

            title = link.get_text(strip=True)
            if not title:
                continue

            # Build URL from onclick
            onclick = link.get("onclick", "")
            url = self._build_j2c_url(onclick)
            if not url:
                continue

            company_el = div.find("span", class_="j2c-company")
            location_el = div.find("span", class_="j2c-location")
            desc_el = div.find("div", class_="j2c-description")
            date_el = div.find("div", class_="j2c-post-date")

            company = company_el.get_text(strip=True) if company_el else "Unknown"
            location = location_el.get_text(strip=True) if location_el else "Unknown"
            description = desc_el.get_text(strip=True) if desc_el else ""
            if len(description) < 10:
                description = f"{title} at {company} - {location}"

            posted_date = None
            if date_el:
                posted_date = self._parse_posted_date(date_el.get_text(strip=True))

            jobs.append({
                "title": title,
                "company": company,
                "location": location,
                "description": description,
                "url": url,
                "posted_date": posted_date,
            })

        return jobs

    def _has_next_page(self, html: str, current_page: int) -> bool:
        """Check if there is a next page link in the pagination."""
        soup = BeautifulSoup(html, "html.parser")
        pager = soup.find("div", class_="j2c-pager")
        if not pager:
            return False
        next_link = pager.find("a", class_="page-numbers",
                               href=re.compile(rf"/page/{current_page + 1}/"))
        return next_link is not None

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def count(self, filters: AggregatorFilters) -> int:
        """Estimate job count by fetching page 1 and checking pagination."""
        total = 0
        for keyword in filters.keywords[:3]:
            try:
                html = self._fetch_page(keyword, page=1)
                soup = BeautifulSoup(html, "html.parser")
                job_count = len(soup.find_all("div", class_="j2c-job"))

                # Check pagination for last page number
                pager = soup.find("div", class_="j2c-pager")
                if pager:
                    page_nums = pager.find_all("a", class_="page-numbers")
                    max_page = 1
                    for pn in page_nums:
                        href = pn.get("href", "")
                        page_match = re.search(r"/page/(\d+)/", href)
                        if page_match:
                            max_page = max(max_page, int(page_match.group(1)))
                    total += max_page * RESULTS_PER_PAGE
                else:
                    total += job_count
            except Exception as e:
                logger.warning(f"OilJobFinder count failed for '{keyword}': {e}")
        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        results: list[JobPosting] = []
        seen: set[str] = set()

        # Combine keywords into a single search string for broader results
        keyword_str = " ".join(filters.keywords[:5])

        for keyword in [keyword_str] + filters.keywords:
            if len(results) >= filters.max_results:
                break

            page = 1
            while page <= MAX_PAGES_PER_KEYWORD and len(results) < filters.max_results:
                try:
                    html = self._fetch_page(keyword, page=page)
                    raw_jobs = self._parse_page(html)

                    if not raw_jobs:
                        break

                    for job_data in raw_jobs:
                        if len(results) >= filters.max_results:
                            break

                        dedup_key = f"{job_data['title'].lower()}|{job_data['company'].lower()}"
                        if dedup_key in seen:
                            continue
                        seen.add(dedup_key)

                        try:
                            job = JobPosting(
                                title=job_data["title"],
                                company=job_data["company"],
                                location=job_data["location"],
                                description=job_data["description"],
                                url=job_data["url"],
                                posted_date=job_data.get("posted_date"),
                                source_aggregator="oiljobfinder",
                            )
                            results.append(job)
                        except Exception as e:
                            logger.debug(f"Skipping OilJobFinder job: {e}")

                    if not self._has_next_page(html, page):
                        break
                    page += 1

                except Exception as e:
                    logger.warning(f"OilJobFinder search failed for '{keyword}' page {page}: {e}")
                    break

        logger.info(f"OilJobFinder: found {len(results)} unique jobs")
        return results[: filters.max_results]
