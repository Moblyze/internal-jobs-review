"""
NES Fircroft adapter — scrapes the world's 2nd-largest energy staffing company.

NES Fircroft (nesfircroft.com) is powered by the Vennture ATS/job board platform.
The site is a JS-rendered SPA; its static HTML contains no job listings.

HOW THIS WORKS (reverse-engineered from cdn2.wearevennture.co.uk/cdn/jobsearch/js/main.js):
  1. GET  https://gateway.wearevennture.co.uk/auth?session=
         → returns {"jwt": "<token>", ...}  (no login required — public anon JWT)
  2. POST https://gateway.wearevennture.co.uk/job-search?local=uk&organisation=
         Authorization: Bearer <jwt>
         Body: {"keywords": "<kw>", "page": 1, "pageSize": 50,
                "sortBy": "createddate", "sortType": "desc"}
         → returns {"jobs": [...], "totalCount": N, "nextPageToken": "..."}

The `local` value "uk" comes from window.ConnectorDynamicSearchArgs.folder embedded in
the job-search page HTML:
  <script>var ConnectorDynamicSearchArgs = {folder: "uk", language: "en", ...}</script>

The JWT is short-lived (~4 hours) and is obtained fresh per run.

PAGINATION: use `nextPageToken` field returned in each response — pass it as
`"pageToken": "<value>"` in the next POST body.

RATE LIMITING: The gateway enforces per-IP limits. Use REQUEST_DELAY (≥2 s) between
calls.  A single page of 50 results per keyword is safe; do NOT loop >5 pages per run.

END-CLIENT VISIBILITY: NES Fircroft does not expose end-client/operator names in
structured API fields (the `tenant` field always says "NES Fircroft"). Client names
sometimes appear in the free-text `description` field (e.g., "Supporting ADNOC on …",
"contracted by Equinor to …") but this is incidental and not reliable.

No API key required.
"""

import re
import time
import json
import logging
from datetime import datetime
from typing import Optional

import httpx

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

BASE_URL = "https://www.nesfircroft.com"
GATEWAY_BASE = "https://gateway.wearevennture.co.uk"
AUTH_URL = f"{GATEWAY_BASE}/auth"
SEARCH_URL = f"{GATEWAY_BASE}/job-search"

# ConnectorDynamicSearchArgs.folder value embedded in NES Fircroft's job-search page HTML.
LOCAL_PARAM = "uk"

# Seconds between HTTP requests — gateway rate-limits aggressive crawlers.
REQUEST_DELAY = 2.5

# Max jobs per page (gateway caps at 50).
PAGE_SIZE = 50

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Origin": BASE_URL,
    "Referer": f"{BASE_URL}/job-search/",
    "Accept": "application/json",
}

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

    Hits the Vennture gateway API directly — no Playwright needed.
    Obtains a short-lived anon JWT, then POSTs keyword searches to
    /job-search.  Returns real structured job data including title,
    location, URL, employment type, salary, and description.
    """

    name = "nesfircroft"

    def __init__(self):
        self._client: Optional[httpx.Client] = None
        self._jwt: Optional[str] = None
        self._jwt_expires_at: float = 0.0

    def is_configured(self) -> bool:
        """No API key needed — always configured."""
        return True

    # ------------------------------------------------------------------
    # Internal HTTP helpers
    # ------------------------------------------------------------------

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                timeout=30,
                follow_redirects=True,
                headers=HEADERS,
            )
        return self._client

    def _get_jwt(self) -> str:
        """Return a valid anon JWT, refreshing if expired or missing."""
        now = time.time()
        if self._jwt and now < self._jwt_expires_at - 60:
            return self._jwt

        client = self._get_client()
        try:
            resp = client.get(
                AUTH_URL,
                params={"session": ""},
            )
            resp.raise_for_status()
            data = resp.json()
            self._jwt = data["jwt"]
            # JWT payload encodes exp; decode it without a library
            try:
                import base64
                payload_b64 = self._jwt.split(".")[1]
                # Pad base64
                padding = 4 - len(payload_b64) % 4
                payload_b64 += "=" * (padding % 4)
                payload = json.loads(base64.urlsafe_b64decode(payload_b64))
                self._jwt_expires_at = float(payload.get("exp", now + 14400))
            except Exception:
                self._jwt_expires_at = now + 14400  # 4-hour fallback

            logger.debug("NESFircroft: obtained fresh JWT")
            return self._jwt
        except Exception as e:
            raise RuntimeError(f"NESFircroft: failed to obtain JWT: {e}") from e

    def _search_page(
        self,
        keyword: str,
        job_types: list[str],
        page: int = 1,
        page_token: Optional[str] = None,
    ) -> dict:
        """POST one search page to the Vennture gateway.

        Returns the raw parsed JSON dict (keys: jobs, totalCount, nextPageToken, …).
        Raises on HTTP error or gateway-level failure.
        """
        jwt = self._get_jwt()
        client = self._get_client()

        body: dict = {
            "keywords": keyword,
            "page": page,
            "pageSize": PAGE_SIZE,
            "sortBy": "createddate",
            "sortType": "desc",
        }
        if job_types:
            body["jobTypes"] = job_types
        if page_token:
            body["pageToken"] = page_token

        params = {"local": LOCAL_PARAM, "organisation": ""}

        time.sleep(REQUEST_DELAY)
        resp = client.post(
            SEARCH_URL,
            params=params,
            json=body,
            headers={
                **HEADERS,
                "Authorization": f"Bearer {jwt}",
                "Content-Type": "application/json",
            },
        )
        resp.raise_for_status()

        # Response may contain non-UTF-8 bytes in descriptions.
        raw = resp.content.decode("utf-8", errors="replace")
        data = json.loads(raw)

        if data.get("message") == "Failed to execute job search":
            raise RuntimeError("NESFircroft: gateway returned 'Failed to execute job search'")

        return data

    # ------------------------------------------------------------------
    # Parsing helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
        if not date_str:
            return None
        for fmt in (
            "%Y-%m-%dT%H:%M:%S.%fZ",
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%d",
        ):
            try:
                return datetime.strptime(date_str[:26], fmt)
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _parse_location(loc_field) -> str:
        if isinstance(loc_field, dict):
            addr = loc_field.get("address", "").strip()
            return addr if addr else "Various"
        if isinstance(loc_field, str):
            return loc_field.strip() or "Various"
        return "Various"

    @staticmethod
    def _parse_salary(job: dict) -> Optional[str]:
        salary_text = (job.get("salaryText") or "").strip()
        if salary_text and salary_text.lower() not in ("0", "competitive", ""):
            return salary_text
        lo = job.get("salaryMinimum", "0")
        hi = job.get("salaryMaximum", "0")
        currency = job.get("salaryCurrency", "")
        try:
            lo_f = float(lo or 0)
            hi_f = float(hi or 0)
            if lo_f > 0 or hi_f > 0:
                return f"{currency} {lo_f:,.0f} – {hi_f:,.0f}".strip()
        except (ValueError, TypeError):
            pass
        return None

    def _job_to_posting(self, job: dict, employment_type_hint: str = "") -> Optional[JobPosting]:
        """Convert a Vennture API job dict to a JobPosting, or None if invalid."""
        title = (job.get("title") or "").strip()
        if not title:
            return None

        # URL: relative path like /job/slug/ — prepend BASE_URL
        url_path = (job.get("url") or "").strip()
        if not url_path:
            slug = job.get("slug", "")
            url_path = f"/job/{slug}/" if slug else "/job-search/"
        url = url_path if url_path.startswith("http") else BASE_URL + url_path

        location = self._parse_location(job.get("location"))

        description = (job.get("description") or "").strip()
        if not description or len(description) < 10:
            description = f"{title} — NES Fircroft — {location}"

        # Employment type: use API value if present, else hint from filters
        job_types_raw = job.get("jobTypes") or []
        employment_type: Optional[str] = None
        if job_types_raw:
            employment_type = ", ".join(str(t) for t in job_types_raw)
        elif employment_type_hint:
            employment_type = employment_type_hint

        try:
            return JobPosting(
                title=title,
                company="NES Fircroft",
                location=location,
                description=description,
                url=url,
                posted_date=self._parse_date(job.get("postDate") or job.get("expiryDate")),
                employment_type=employment_type,
                salary=self._parse_salary(job),
                requisition_id=job.get("reference") or None,
                source_aggregator="nesfircroft",
            )
        except Exception as e:
            logger.debug(f"NESFircroft: skipping job '{title}': {e}")
            return None

    # ------------------------------------------------------------------
    # Public interface (BaseAggregator)
    # ------------------------------------------------------------------

    def count(self, filters: AggregatorFilters) -> int:
        """Return approximate count of matching jobs via a single API call."""
        keyword = filters.keywords[0] if filters.keywords else ""
        try:
            data = self._search_page(keyword=keyword, job_types=[], page=1)
            return data.get("totalCount") or 0
        except Exception as e:
            logger.warning(f"NESFircroft count failed: {e}")
            return 0

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search NES Fircroft via the Vennture gateway API.

        Authenticates anonymously, posts keyword searches, and returns
        real structured job listings.  Fetches up to 2 pages (100 jobs)
        per keyword to respect rate limits; deduplicates by URL.
        """
        results: list[JobPosting] = []
        seen: set[str] = set()

        # Map our job_type strings to Vennture values
        vennture_types: list[str] = []
        for jt in (filters.job_types or []):
            mapped = EMPLOYMENT_TYPE_MAP.get(jt.lower())
            if mapped and mapped not in vennture_types:
                vennture_types.append(mapped)

        employment_hint = vennture_types[0] if vennture_types else ""

        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break

            page_token: Optional[str] = None
            for page_num in range(1, 4):  # max 3 pages (150 jobs) per keyword
                if len(results) >= filters.max_results:
                    break

                try:
                    data = self._search_page(
                        keyword=keyword,
                        job_types=vennture_types,
                        page=page_num,
                        page_token=page_token if page_num > 1 else None,
                    )
                except RuntimeError as e:
                    logger.warning(f"NESFircroft: search failed for '{keyword}' page {page_num}: {e}")
                    break
                except Exception as e:
                    logger.warning(f"NESFircroft: HTTP error for '{keyword}' page {page_num}: {e}")
                    break

                jobs_raw = data.get("jobs") or []
                total_count = data.get("totalCount", 0)
                page_token = data.get("nextPageToken") or None

                logger.info(
                    f"NESFircroft: keyword='{keyword}' page={page_num} "
                    f"got {len(jobs_raw)} jobs (total={total_count})"
                )

                for job_data in jobs_raw:
                    if len(results) >= filters.max_results:
                        break

                    posting = self._job_to_posting(job_data, employment_hint)
                    if posting is None:
                        continue

                    url_str = str(posting.url)
                    if url_str in seen:
                        continue
                    seen.add(url_str)

                    results.append(posting)

                # Stop paginating if no more pages
                if not page_token or len(jobs_raw) < PAGE_SIZE:
                    break

        logger.info(f"NESFircroft: found {len(results)} jobs total")
        return results[: filters.max_results]
