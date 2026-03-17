"""
Rigg Access adapter - scrapes rope access, NDT, and wind energy jobs.

Rigg Access (rigg-access.com) is a Wappler/dmxAppConnect-powered job board
focused on rope access, NDT (non-destructive testing), and wind energy jobs
worldwide. Jobs are loaded dynamically via a server-side API.

API endpoint: /api/Queries/GetJobs
Parameters: offset, limit, jobcatid

Categories loaded from: /api/Queries/GetLiveJobCats

No API key required - the API is public.
"""

import time
import logging
from datetime import datetime

import httpx

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

BASE_URL = "https://www.rigg-access.com"
API_BASE = f"{BASE_URL}/api/Queries"
JOBS_API = f"{API_BASE}/GetJobs"
CATEGORIES_API = f"{API_BASE}/GetLiveJobCats"

# Default page size
DEFAULT_LIMIT = 20

# Delay between API requests (seconds)
REQUEST_DELAY = 1.0

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.rigg-access.com/jobs",
}


class RiggAccessAggregator(BaseAggregator):
    """API adapter for Rigg Access (rigg-access.com).

    Rope access, NDT, and wind energy job board. Uses a dmxAppConnect
    server-connect API that returns JSON job data directly.

    API endpoint: /api/Queries/GetJobs?offset=0&limit=20&jobcatid=
    Categories: /api/Queries/GetLiveJobCats
    """

    name = "riggaccess"

    def __init__(self):
        self._client: httpx.Client | None = None
        self._categories: list[dict] | None = None

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

    def _fetch_categories(self) -> list[dict]:
        """Fetch available job categories from the API.

        Returns list of dicts with keys like: JobsCatId, JobsCatName, etc.
        """
        if self._categories is not None:
            return self._categories

        client = self._get_client()
        try:
            resp = client.get(CATEGORIES_API)
            resp.raise_for_status()
            data = resp.json()
            # The API returns nested data under a query key
            if isinstance(data, dict):
                for key in data:
                    if isinstance(data[key], list):
                        self._categories = data[key]
                        return self._categories
            if isinstance(data, list):
                self._categories = data
                return self._categories
        except Exception as e:
            logger.warning(f"RiggAccess: failed to fetch categories: {e}")

        self._categories = []
        return self._categories

    def _fetch_jobs(self, offset: int = 0, limit: int = DEFAULT_LIMIT,
                    jobcatid: str = "") -> list[dict]:
        """Fetch jobs from the API.

        Args:
            offset: Pagination offset
            limit: Number of results per page
            jobcatid: Category ID filter (empty string = all categories)

        Returns:
            List of job dicts from the API response.
        """
        client = self._get_client()
        time.sleep(REQUEST_DELAY)

        params = {
            "offset": str(offset),
            "limit": str(limit),
        }
        if jobcatid:
            params["jobcatid"] = jobcatid

        try:
            resp = client.get(JOBS_API, params=params)
            resp.raise_for_status()
            data = resp.json()

            # dmxAppConnect APIs typically nest data under a query name key
            if isinstance(data, dict):
                for key in data:
                    if isinstance(data[key], list):
                        return data[key]
            if isinstance(data, list):
                return data

        except Exception as e:
            logger.warning(f"RiggAccess: API request failed: {e}")

        return []

    def _job_to_posting(self, job_data: dict) -> JobPosting | None:
        """Convert an API job dict into a JobPosting.

        Expected fields vary by API response structure. Common fields:
        - JobTitle, CompanyName, Location, Description, JobId, DatePosted
        - JobsCatName (category), Salary, JobType
        """
        try:
            # Try various field name patterns (API may use different casing)
            title = (
                job_data.get("JobTitle")
                or job_data.get("jobtitle")
                or job_data.get("title")
                or ""
            )
            if not title:
                return None

            company = (
                job_data.get("CompanyName")
                or job_data.get("companyname")
                or job_data.get("company")
                or "Unknown"
            )

            location = (
                job_data.get("Location")
                or job_data.get("location")
                or job_data.get("JobLocation")
                or "Global"
            )

            description = (
                job_data.get("Description")
                or job_data.get("description")
                or job_data.get("JobDescription")
                or job_data.get("ShortDescription")
                or ""
            )
            if not description or len(description) < 10:
                category = (
                    job_data.get("JobsCatName")
                    or job_data.get("category")
                    or "Rope Access"
                )
                description = f"{title} at {company} - {location}. Category: {category}"

            # Build URL - try to find a slug or ID
            job_id = (
                job_data.get("JobId")
                or job_data.get("jobid")
                or job_data.get("id")
                or job_data.get("ID")
                or ""
            )
            slug = (
                job_data.get("JobSlug")
                or job_data.get("slug")
                or ""
            )

            if slug:
                url = f"{BASE_URL}/job/{slug}"
            elif job_id:
                url = f"{BASE_URL}/job/{job_id}"
            else:
                # Fallback to jobs page
                url = f"{BASE_URL}/jobs"

            # Salary
            salary = (
                job_data.get("Salary")
                or job_data.get("salary")
                or job_data.get("SalaryRange")
            )
            if salary and isinstance(salary, (int, float)):
                salary = str(salary)

            # Employment type
            emp_type = (
                job_data.get("JobType")
                or job_data.get("jobtype")
                or job_data.get("EmploymentType")
            )

            # Posted date
            posted_date = None
            date_str = (
                job_data.get("DatePosted")
                or job_data.get("dateposted")
                or job_data.get("CreatedDate")
                or job_data.get("created_at")
            )
            if date_str:
                posted_date = self._parse_date(str(date_str))

            return JobPosting(
                title=title,
                company=company,
                location=location,
                description=description,
                url=url,
                salary=salary,
                posted_date=posted_date,
                employment_type=emp_type,
                source_aggregator="riggaccess",
            )

        except Exception as e:
            logger.debug(f"RiggAccess: failed to convert job data: {e}")
            return None

    def _parse_date(self, date_str: str) -> datetime | None:
        """Parse date strings from the API."""
        if not date_str:
            return None

        # Try ISO format first (most likely from API)
        for fmt in (
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%dT%H:%M:%S.%f",
            "%Y-%m-%d",
            "%d/%m/%Y",
            "%m/%d/%Y",
            "%d-%m-%Y",
        ):
            try:
                return datetime.strptime(date_str.strip()[:19], fmt[:19] if 'T' in fmt else fmt)
            except ValueError:
                continue

        # Try ISO with timezone
        try:
            return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            pass

        return None

    def _keyword_matches_category(self, keyword: str) -> str:
        """Map a keyword to a Rigg Access category ID.

        Returns empty string to search all categories if no match found.
        """
        categories = self._fetch_categories()
        if not categories:
            return ""

        kw = keyword.lower()

        # Try to match keyword to category names
        for cat in categories:
            cat_name = (
                cat.get("JobsCatName", "")
                or cat.get("name", "")
                or ""
            ).lower()

            # Direct keyword match
            if kw in cat_name or cat_name in kw:
                return str(
                    cat.get("JobsCatId")
                    or cat.get("id")
                    or ""
                )

        # Common keyword to category mapping
        keyword_hints = {
            "rope access": "rope",
            "ndt": "ndt",
            "wind": "wind",
            "turbine": "wind",
            "offshore": "offshore",
            "inspection": "ndt",
            "technician": "rope",
        }

        for hint_kw, hint_cat in keyword_hints.items():
            if hint_kw in kw:
                for cat in categories:
                    cat_name = (
                        cat.get("JobsCatName", "")
                        or cat.get("name", "")
                        or ""
                    ).lower()
                    if hint_cat in cat_name:
                        return str(
                            cat.get("JobsCatId")
                            or cat.get("id")
                            or ""
                        )

        return ""  # All categories

    def count(self, filters: AggregatorFilters) -> int:
        """Get approximate count of matching jobs."""
        total = 0
        checked_cats: set[str] = set()

        for keyword in filters.keywords[:3]:
            cat_id = self._keyword_matches_category(keyword)
            if cat_id in checked_cats:
                continue
            checked_cats.add(cat_id)

            try:
                # Fetch first page to count results
                jobs = self._fetch_jobs(offset=0, limit=1, jobcatid=cat_id)
                # If we get results, fetch a larger batch to estimate
                if jobs:
                    larger = self._fetch_jobs(offset=0, limit=100, jobcatid=cat_id)
                    total += len(larger)
                logger.info(f"RiggAccess: category '{cat_id or 'all'}' has {total} jobs")
            except Exception as e:
                logger.warning(f"RiggAccess count failed: {e}")

        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search Rigg Access for rope access/NDT/wind energy jobs.

        Uses the /api/Queries/GetJobs endpoint with offset-based pagination.
        """
        results: list[JobPosting] = []
        seen: set[str] = set()
        searched_cats: set[str] = set()

        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break

            cat_id = self._keyword_matches_category(keyword)
            if cat_id in searched_cats:
                continue
            searched_cats.add(cat_id)

            offset = 0
            max_pages = 5
            pages_fetched = 0

            while pages_fetched < max_pages and len(results) < filters.max_results:
                try:
                    logger.info(
                        f"RiggAccess: fetching offset={offset} limit={DEFAULT_LIMIT} "
                        f"cat={cat_id or 'all'}"
                    )
                    jobs_data = self._fetch_jobs(
                        offset=offset,
                        limit=DEFAULT_LIMIT,
                        jobcatid=cat_id,
                    )

                    if not jobs_data:
                        break

                    for job_data in jobs_data:
                        if len(results) >= filters.max_results:
                            break

                        job = self._job_to_posting(job_data)
                        if job is None:
                            continue

                        # Dedup by URL
                        url_str = str(job.url)
                        if url_str in seen:
                            continue
                        seen.add(url_str)

                        # Dedup by title+company
                        dedup_key = f"{job.title.lower()}|{job.company.lower()}"
                        if dedup_key in seen:
                            continue
                        seen.add(dedup_key)

                        results.append(job)

                    # If fewer results than limit, no more pages
                    if len(jobs_data) < DEFAULT_LIMIT:
                        break

                    offset += DEFAULT_LIMIT
                    pages_fetched += 1

                except Exception as e:
                    logger.warning(f"RiggAccess search failed at offset {offset}: {e}")
                    break

        logger.info(f"RiggAccess: found {len(results)} unique jobs")
        return results[:filters.max_results]
