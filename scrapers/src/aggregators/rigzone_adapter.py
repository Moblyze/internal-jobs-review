import httpx
import logging
import re
from datetime import datetime
from bs4 import BeautifulSoup
from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters
from src.aggregators.cleanup import sanitize_location

logger = logging.getLogger(__name__)

# Rigzone employment type IDs (from AdvanceSearch.json)
# 1: Full Time Salaried Employee
# 2: Full Time Contractor
# 3: Part Time Salaried Employee
# 4: Part Time Contractor
# 5: Rotational Salaried Employee
# 6: Rotational Contractor
RIGZONE_CONTRACT_TYPES = "2,4,6"  # All contractor types

BASE_URL = "https://www.rigzone.com"
SEARCH_URL = f"{BASE_URL}/oil/jobs/search/"
RESULTS_PER_PAGE = 20


class RigzoneAggregator(BaseAggregator):
    """Scraper adapter for Rigzone.com — the largest O&G job board."""

    name = "rigzone"

    def __init__(self):
        self._client = None

    def is_configured(self) -> bool:
        """Rigzone is a public website — no API key needed."""
        return True

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                timeout=30,
                follow_redirects=True,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/131.0.0.0 Safari/537.36"
                    ),
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Referer": "https://www.rigzone.com/",
                    "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
                    "Sec-Ch-Ua-Mobile": "?0",
                    "Sec-Ch-Ua-Platform": '"macOS"',
                    "Sec-Fetch-Dest": "document",
                    "Sec-Fetch-Mode": "navigate",
                    "Sec-Fetch-Site": "same-origin",
                    "Sec-Fetch-User": "?1",
                    "Upgrade-Insecure-Requests": "1",
                    "Cache-Control": "max-age=0",
                },
            )
            # Hit the homepage first to get cookies
            try:
                self._client.get("https://www.rigzone.com/")
            except Exception:
                pass
        return self._client

    def _build_search_params(self, keyword: str, page: int = 1,
                             filter_contract: bool = True) -> dict:
        """Build query params for Rigzone search."""
        params = {
            "keyword": keyword,
            "page": str(page),
        }
        if filter_contract:
            params["SearchCriteria_SelectedEmploymentType"] = RIGZONE_CONTRACT_TYPES
        return params

    def _parse_job_listing(self, article, keyword: str) -> JobPosting | None:
        """Parse a single job listing article element into a JobPosting."""
        try:
            # Title and URL from h3 > a
            heading = article.find("div", class_="heading")
            if not heading:
                return None

            title_link = heading.find("h3")
            if not title_link:
                return None
            a_tag = title_link.find("a")
            if not a_tag:
                return None

            title = a_tag.get_text(strip=True)
            href = a_tag.get("href", "")
            if not title or not href:
                return None

            # Build full URL
            if href.startswith("/"):
                url = BASE_URL + href
            elif href.startswith("http"):
                url = href
            else:
                url = BASE_URL + "/" + href

            # Company and location from address tag
            address = heading.find("address")
            company = "Unknown"
            location = "Unknown"
            if address:
                # Address typically contains: "CompanyName  Location"
                # The company name and location are separated by whitespace/elements
                address_text = address.get_text(separator="|", strip=True)
                parts = [p.strip() for p in address_text.split("|") if p.strip()]
                if len(parts) >= 2:
                    company = parts[0]
                    # Validate that the last part is a real location, not a company name
                    location = sanitize_location(parts[-1], company=company)
                elif len(parts) == 1:
                    company = parts[0]

            # Description
            desc_div = article.find("div", class_="description")
            description = ""
            if desc_div:
                text_div = desc_div.find("div", class_="text")
                if text_div:
                    description = text_div.get_text(strip=True)
            if len(description) < 10:
                description = f"{title} at {company} - {location}"

            # Footer details: experience, skills, date
            skills = []
            posted_date = None
            footer = article.find("footer", class_="details")
            if footer:
                # Skills from responsibility span
                resp_span = footer.find("span", class_="responsibility")
                if resp_span:
                    skill_text = resp_span.get_text(strip=True)
                    if skill_text:
                        skills = [s.strip() for s in skill_text.split(",") if s.strip()]

                # Posted date from time element
                time_el = footer.find("time")
                if time_el:
                    date_text = time_el.get_text(strip=True)
                    # Remove "Posted:" prefix
                    date_text = re.sub(r"^Posted:\s*", "", date_text, flags=re.IGNORECASE)
                    posted_date = self._parse_date(date_text)

            # Employment type — we're filtering for contractor roles
            employment_type = "Contractor"

            return JobPosting(
                title=title,
                company=company,
                location=location,
                description=description,
                url=url,
                posted_date=posted_date,
                skills=skills,
                employment_type=employment_type,
                source_aggregator="rigzone",
            )

        except Exception as e:
            logger.debug(f"Skipping Rigzone job listing: {e}")
            return None

    def _parse_date(self, date_text: str) -> datetime | None:
        """Parse Rigzone date strings like '02/28/2026' or 'Feb 28, 2026'."""
        if not date_text:
            return None
        # Try common formats
        for fmt in ("%m/%d/%Y", "%b %d, %Y", "%B %d, %Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(date_text.strip(), fmt)
            except ValueError:
                continue
        # Try dateparser as fallback
        try:
            import dateparser
            return dateparser.parse(date_text)
        except (ImportError, Exception):
            pass
        return None

    def _fetch_page(self, keyword: str, page: int = 1,
                    filter_contract: bool = True) -> tuple[list[JobPosting], int]:
        """Fetch a single page of results. Returns (jobs, total_count)."""
        client = self._get_client()
        params = self._build_search_params(keyword, page, filter_contract)

        resp = client.get(SEARCH_URL, params=params)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "html.parser")

        # Parse total count from "1 - 20 of X Jobs" text
        total_count = 0
        count_text = soup.find(string=re.compile(r"of\s+[\d,]+\s+Jobs?", re.IGNORECASE))
        if count_text:
            match = re.search(r"of\s+([\d,]+)\s+Jobs?", str(count_text), re.IGNORECASE)
            if match:
                total_count = int(match.group(1).replace(",", ""))

        # Parse job listings
        articles = soup.find_all("article", class_="update-block")
        jobs = []
        for article in articles:
            job = self._parse_job_listing(article, keyword)
            if job:
                jobs.append(job)

        return jobs, total_count

    def count(self, filters: AggregatorFilters) -> int:
        """Get approximate count of matching jobs."""
        total = 0
        filter_contract = any(
            jt.lower() in ("contract", "temporary", "contractor")
            for jt in (filters.job_types or [])
        )

        for keyword in filters.keywords:
            try:
                _, count = self._fetch_page(keyword, page=1, filter_contract=filter_contract)
                total += count
            except Exception as e:
                logger.warning(f"Rigzone count failed for '{keyword}': {e}")

        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search Rigzone for jobs matching filters."""
        results = []
        seen = set()

        filter_contract = any(
            jt.lower() in ("contract", "temporary", "contractor")
            for jt in (filters.job_types or [])
        )

        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break

            try:
                page = 1
                max_pages = 5  # Safety limit: 5 pages x 20 = 100 jobs per keyword

                while len(results) < filters.max_results and page <= max_pages:
                    jobs, total = self._fetch_page(keyword, page=page,
                                                   filter_contract=filter_contract)

                    if not jobs:
                        # If contract filter yields nothing on first page, try without
                        if page == 1 and filter_contract:
                            logger.info(
                                f"Rigzone: '{keyword}' with contract filter returned 0, "
                                "retrying without filter"
                            )
                            jobs, total = self._fetch_page(keyword, page=1,
                                                           filter_contract=False)
                            if not jobs:
                                break
                            # Don't continue paginating the unfiltered search
                            filter_contract = False
                        else:
                            break

                    for job in jobs:
                        dedup_key = f"{job.title.lower()}|{job.company.lower()}"
                        if dedup_key in seen:
                            continue
                        seen.add(dedup_key)
                        results.append(job)

                        if len(results) >= filters.max_results:
                            break

                    # Check if there are more pages
                    total_pages = (total + RESULTS_PER_PAGE - 1) // RESULTS_PER_PAGE if total else 1
                    if page >= total_pages:
                        break

                    page += 1

            except Exception as e:
                logger.warning(f"Rigzone search failed for '{keyword}': {e}")

        logger.info(f"Rigzone: found {len(results)} unique jobs")
        return results[:filters.max_results]
