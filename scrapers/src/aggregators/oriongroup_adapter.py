"""Orion Group adapter — pulls energy/offshore contract jobs from orionjobs.com.

Orion Group (orionjobs.com) is an Aberdeen-based global energy staffing agency
with a dedicated subsea/diving division. Covers UK/North Sea, Norway, Middle
East, West Africa, and US Gulf of Mexico with predominantly contract roles.

Platform: Vennture (wearevennture.co.uk) — React SPA powered by a REST gateway.

API flow:
  1. POST https://gateway.wearevennture.co.uk/auth?session=&user=
     → returns {jwt, sid, uid, ...} — anonymous JWT, no login required.
     JWT expires in ~4 h (nbf→exp in payload).  The adapter fetches a fresh
     one per run (stateless).

  2. POST https://gateway.wearevennture.co.uk/job-search?local=uk&organisation=
     Authorization: Bearer <jwt>
     Body: {"pageSize": 50, "nextPageToken": "<token>"}   # token omitted page 1
     → returns {jobs: [...], totalCount, nextPageToken, count}

     NOTE: The server does NOT filter by keyword or jobType — it returns the
     full catalog in newest-first order. Client-side keyword matching is applied
     by this adapter after fetching each page.

  3. Paginate via nextPageToken until exhausted or max_results reached.

No API key required. The anonymous auth endpoint returns a valid JWT.

Endpoint confirmed 2026-05-22 with 203 live jobs, nextPageToken pagination.
"""

import time
import logging
from datetime import datetime

import httpx

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

# Vennture gateway (serves orionjobs.com job-search React app)
GATEWAY_BASE = "https://gateway.wearevennture.co.uk"
AUTH_URL = f"{GATEWAY_BASE}/auth"
SEARCH_URL = f"{GATEWAY_BASE}/job-search"

# The "local" identifier maps this request to the Orion Group tenant
LOCAL = "uk"

# Canonical job board base URL for building full job links
SITE_BASE = "https://www.orionjobs.com"

# Page size used per API request (max observed: 50)
PAGE_SIZE = 50

# Delay between paginated requests
REQUEST_DELAY = 1.5

# Max pages to fetch when no results limit is hit
MAX_PAGES = 10

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": SITE_BASE,
    "Referer": f"{SITE_BASE}/job-search/",
    "Content-Type": "application/json",
}


class OrionGroupAggregator(BaseAggregator):
    """API adapter for Orion Group (orionjobs.com).

    Aberdeen-based energy staffing with a dedicated diving/subsea division.
    Covers North Sea, Norway, Middle East, West Africa, US Gulf of Mexico.

    The Vennture gateway does not support server-side keyword filtering — all
    203 live jobs are returned in newest-first order. This adapter fetches
    the catalog in 50-job pages and matches keywords client-side against
    title + description + searchSnippet.

    End-employer / operator visibility: NOT available. Orion Group posts
    are agency-blind ("our client is seeking…"). The consultant field
    exposes the Orion recruiter name and email, not the end operator.
    """

    name = "oriongroup"

    def __init__(self) -> None:
        self._client: httpx.Client | None = None
        self._jwt: str | None = None

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

    def _fetch_jwt(self) -> str:
        """Obtain an anonymous JWT from the Vennture auth endpoint.

        The endpoint accepts empty session/user strings and returns a valid
        JWT with role=JobSearch, expiry ~4 h from issuance.
        """
        client = self._get_client()
        try:
            resp = client.get(
                AUTH_URL,
                params={"session": "", "user": ""},
            )
            resp.raise_for_status()
            data = resp.json()
            jwt = data.get("jwt", "")
            if not jwt:
                raise ValueError(f"No jwt in auth response: {data}")
            logger.debug("OrionGroup: obtained fresh JWT")
            return jwt
        except Exception as e:
            raise RuntimeError(f"OrionGroup: auth failed: {e}") from e

    def _get_jwt(self) -> str:
        """Return cached JWT, refreshing if not yet obtained."""
        if self._jwt is None:
            self._jwt = self._fetch_jwt()
        return self._jwt

    def _search_page(
        self,
        next_page_token: str | None = None,
    ) -> dict:
        """Fetch one page of the job catalog from the gateway.

        Args:
            next_page_token: Token from previous page response, or None for page 1.

        Returns:
            Raw API response dict with keys: jobs, totalCount, nextPageToken, count.

        Raises:
            RuntimeError: on HTTP error or unexpected response.
        """
        client = self._get_client()
        jwt = self._get_jwt()

        body: dict = {"pageSize": PAGE_SIZE}
        if next_page_token:
            body["nextPageToken"] = next_page_token

        try:
            resp = client.post(
                SEARCH_URL,
                params={"local": LOCAL, "organisation": ""},
                json=body,
                headers={"Authorization": f"Bearer {jwt}"},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(
                f"OrionGroup: search page HTTP error {e.response.status_code}: {e}"
            ) from e
        except Exception as e:
            raise RuntimeError(f"OrionGroup: search page failed: {e}") from e

    # ------------------------------------------------------------------
    # Keyword matching (client-side, since gateway doesn't filter)
    # ------------------------------------------------------------------

    def _keyword_matches(self, job_data: dict, keyword: str) -> bool:
        """Return True if keyword appears in the job's searchable text fields."""
        kw = keyword.lower()
        searchable = " ".join(
            str(job_data.get(field) or "")
            for field in ("title", "description", "searchSnippet")
        ).lower()
        return kw in searchable

    def _any_keyword_matches(self, job_data: dict, keywords: list[str]) -> bool:
        """Return True if any keyword matches the job."""
        return any(self._keyword_matches(job_data, kw) for kw in keywords)

    # ------------------------------------------------------------------
    # Data conversion
    # ------------------------------------------------------------------

    def _location_str(self, location: object) -> str:
        """Normalise location field to a plain string."""
        if not location:
            return "Unknown"
        if isinstance(location, dict):
            addr = location.get("address", "")
            return addr.strip() if addr else "Unknown"
        return str(location).strip() or "Unknown"

    def _parse_date(self, date_str: str | None) -> datetime | None:
        """Parse ISO date strings from the API."""
        if not date_str:
            return None
        for fmt in (
            "%Y-%m-%dT%H:%M:%S.%fZ",
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d",
        ):
            try:
                return datetime.strptime(date_str[:26], fmt[:len(date_str[:26])])
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            pass
        return None

    def _job_to_posting(self, job_data: dict) -> JobPosting | None:
        """Convert a Vennture API job dict to a JobPosting.

        The API exposes these fields per job:
          id, slug, url, reference, expiryDate, title, description,
          postDate, salaryMaximum, salaryMinimum, salaryText, salaryCurrency,
          location {address, lat, lng}, jobTypes [str], sector, remoteWorking,
          consultant {firstname, lastname, email, position}, searchSnippet

        End-employer is not available (agency-blind). Company is always
        "Orion Group" (recruiter, not operator).
        """
        try:
            title = (job_data.get("title") or "").strip()
            if not title:
                return None

            location = self._location_str(job_data.get("location"))

            # Build full URL
            rel_url = (job_data.get("url") or "").strip()
            if rel_url.startswith("http"):
                url = rel_url
            elif rel_url:
                url = f"{SITE_BASE}{rel_url}"
            else:
                slug = (job_data.get("slug") or "").strip()
                job_id = job_data.get("id")
                if slug:
                    url = f"{SITE_BASE}/job/{slug}/"
                elif job_id:
                    url = f"{SITE_BASE}/job/{job_id}/"
                else:
                    return None  # No way to form a URL

            # Description — use API description or fall back to snippet
            description = (
                (job_data.get("description") or "").strip()
                or (job_data.get("searchSnippet") or "").strip()
            )
            if len(description) < 10:
                description = f"{title} at Orion Group - {location}"

            # Employment type — jobTypes is a list e.g. ['Contract']
            job_types = job_data.get("jobTypes") or []
            employment_type = job_types[0] if job_types else None

            # Salary
            salary = (job_data.get("salaryText") or "").strip() or None

            # Requisition ID (Orion's reference e.g. "PR/082306")
            reference = (job_data.get("reference") or "").strip() or None

            posted_date = self._parse_date(
                job_data.get("postDate") or job_data.get("expiryDate")
            )

            return JobPosting(
                title=title,
                company="Orion Group",
                location=location,
                description=description,
                url=url,  # type: ignore[arg-type]
                posted_date=posted_date,
                employment_type=employment_type,
                salary=salary,
                requisition_id=reference,
                source_aggregator="oriongroup",
            )

        except Exception as e:
            logger.debug(f"OrionGroup: skipping job (conversion error): {e}")
            return None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def is_configured(self) -> bool:
        """No API key required — always configured."""
        return True

    def count(self, filters: AggregatorFilters) -> int:
        """Return approximate count of matching jobs.

        Fetches page 1 only and extracts totalCount, then checks how many
        jobs on that page match the keywords to estimate a ratio.
        """
        try:
            data = self._search_page()
        except Exception as e:
            logger.warning(f"OrionGroup: count failed: {e}")
            return 0

        total = data.get("totalCount") or 0
        if not total:
            return 0

        # Estimate match ratio from the first page
        page_jobs = data.get("jobs") or []
        if not page_jobs:
            return 0

        matched = sum(
            1 for j in page_jobs
            if self._any_keyword_matches(j, filters.keywords)
        )
        ratio = matched / len(page_jobs)
        estimated = int(total * ratio)
        logger.info(
            f"OrionGroup: totalCount={total}, page1 match ratio={ratio:.2f}, "
            f"estimated={estimated}"
        )
        return estimated

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Fetch and keyword-filter jobs from the Orion Group catalog.

        Strategy:
          1. Fetch pages of 50 jobs via the Vennture gateway (newest-first).
          2. Client-side filter: any of filters.keywords in title/description/snippet.
          3. Optional client-side job-type filter if filters.job_types excludes
             permanent (Orion's jobTypes are 'Contract' or 'Permanent').
          4. Stop when max_results reached or catalog exhausted.
        """
        results: list[JobPosting] = []
        seen: set[str] = set()

        # Determine whether to restrict to contract/temporary
        want_contract_only = (
            filters.job_types
            and "permanent" not in [jt.lower() for jt in filters.job_types]
            and any(
                jt.lower() in ("contract", "contractor", "temporary")
                for jt in filters.job_types
            )
        )

        next_page_token: str | None = None
        pages_fetched = 0

        while pages_fetched < MAX_PAGES and len(results) < filters.max_results:
            try:
                if pages_fetched > 0:
                    time.sleep(REQUEST_DELAY)

                logger.info(
                    f"OrionGroup: fetching page {pages_fetched + 1} "
                    f"(token={'<page1>' if not next_page_token else next_page_token[:12] + '…'})"
                )
                data = self._search_page(next_page_token)

            except Exception as e:
                logger.warning(f"OrionGroup: fetch failed on page {pages_fetched + 1}: {e}")
                break

            jobs_on_page = data.get("jobs") or []
            if not jobs_on_page:
                logger.debug("OrionGroup: empty page, stopping")
                break

            for job_data in jobs_on_page:
                if len(results) >= filters.max_results:
                    break

                # Client-side keyword filter
                if not self._any_keyword_matches(job_data, filters.keywords):
                    continue

                # Client-side job-type filter (optional)
                if want_contract_only:
                    job_types = [jt.lower() for jt in (job_data.get("jobTypes") or [])]
                    if not any(jt in ("contract", "contractor", "temporary") for jt in job_types):
                        continue

                posting = self._job_to_posting(job_data)
                if posting is None:
                    continue

                url_str = str(posting.url)
                if url_str in seen:
                    continue
                seen.add(url_str)

                results.append(posting)

            pages_fetched += 1

            next_page_token = data.get("nextPageToken") or None
            if not next_page_token:
                logger.debug("OrionGroup: no nextPageToken, catalog exhausted")
                break

        logger.info(f"OrionGroup: returning {len(results)} jobs")
        return results[: filters.max_results]
