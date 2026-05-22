"""
Spencer Ogden adapter — a pure-play energy/maritime staffing agency.

Spencer Ogden (www.spencer-ogden.com) covers oil & gas, offshore wind, renewable
energy, and infrastructure across US Gulf, UK/North Sea, Norway, Middle East,
West Africa, Brazil, and APAC. High contract-role density.

NOTE: The legacy domain spencerogden.com is parked by Gandi.net (no HTTPS).
The live site is at www.spencer-ogden.com (redirects also work from spencer-ogden.com).
The site is a Next.js/React SPA hosted on the Sourceflow platform, which powers
the job database under the hood at spencer-ogden.sites.sourceflow.co.uk.

HOW THIS WORKS (reverse-engineered from the Sourceflow shared JS bundle):

  The Sourceflow platform SDK exposes a first-party search API at:

    POST https://spencer-ogden.sites.sourceflow.co.uk/_sf/api/v1/jobs/search.json
    Content-Type: application/json

    Body:
      {
        "job_search": {
          "query":        "<keyword string>",
          "location":     {},                       -- empty = global
          "filters":      {},                       -- optional category filters
          "commute_filter": {},
          "offset":       0,                        -- 0-based pagination offset
          "jobs_per_page": 20                       -- max observed: 20
        }
      }

    Response:
      {
        "total_size": N,
        "results": [
          {
            "job": {
              "id": "<uuid>",
              "title": "...",
              "description": "<HTML>",
              "addresses": ["City, Country"],
              "external_reference": "...",        -- job reference number
              "url_slug": "Title-Slug-123456",
              "salary_package": null | "...",
              "salary_low": 0.0,
              "salary_high": 0.0,
              "consultant_name": "...",
              "created_at": <unix_timestamp>,
              "published_at": <unix_timestamp>,
              "categories": [
                {"id": "...", "name": "Contract Types", "values": [{"name": "Contract"}]},
                {"id": "...", "name": "Business Sectors", "values": [...]},
                {"id": "...", "name": "Disciplines", "values": [...]}
              ],
              "derived_info": {
                "locations": [
                  {
                    "location_type": "LOCALITY",
                    "postal_address": {
                      "region_code": "GB",
                      "administrative_area": "Scotland",
                      "locality": "Aberdeen",
                      "address_lines": ["Aberdeen, UK"]
                    }
                  }
                ]
              }
            }
          }, ...
        ],
        "metadata": {
          "next_page_token": "...",
          "request_id": "..."
        }
      }

PAGINATION: offset-based. Use `offset = (page - 1) * jobs_per_page`.

EMPLOYMENT TYPE: the "Contract Types" category contains "Contract", "Permanent",
"Temporary" etc. Filter on category values to restrict to contract/temp.

END-CLIENT VISIBILITY: Spencer Ogden does not expose operator/client names in
structured fields — company is always "Spencer Ogden". However, the description
HTML often mentions the end-client (e.g., "Spencer Ogden is supporting a leading
offshore wind developer..."). Reliable extraction would require NLP; raw
descriptions are returned so callers can mine them if needed.

No API key required — the endpoint is public.
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

# Live site URL (parked spencerogden.com domain is NOT used)
BASE_URL = "https://www.spencer-ogden.com"

# Sourceflow platform host for Spencer Ogden — exposes the job search API
SF_HOST = "https://spencer-ogden.sites.sourceflow.co.uk"
SEARCH_URL = f"{SF_HOST}/_sf/api/v1/jobs/search.json"

# Sourceflow API caps at 20 results per page
PAGE_SIZE = 20

# Polite delay between requests (seconds)
REQUEST_DELAY = 2.0

# Max pages to fetch per keyword to avoid hammering the API
MAX_PAGES_PER_KEYWORD = 5

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Referer": f"{BASE_URL}/jobs",
    "Origin": BASE_URL,
}

# Sourceflow "Contract Types" category values we treat as contract/temp roles
CONTRACT_TYPE_VALUES = {"contract", "temporary", "temp", "contractor"}


class SpencerOgdenAggregator(BaseAggregator):
    """Adapter for Spencer Ogden (www.spencer-ogden.com).

    Hits the Sourceflow platform job search API at
    spencer-ogden.sites.sourceflow.co.uk/_sf/api/v1/jobs/search.json.
    No authentication required — the endpoint is public.

    Covers oil & gas, offshore wind, renewables, and infrastructure roles
    across US Gulf, UK/North Sea, Norway, Middle East, West Africa, Brazil,
    and APAC.  Spencer Ogden is a pure-play energy/maritime staffing agency
    with one of the highest contract-role densities of any specialist source.

    End-client/operator names are NOT exposed in structured fields (company
    is always "Spencer Ogden"), but description text sometimes names the
    operator — returned descriptions allow downstream NLP extraction.
    """

    name = "spencerogden"

    def __init__(self):
        self._client: Optional[httpx.Client] = None

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

    def _search_page(self, keyword: str, offset: int = 0) -> dict:
        """POST one search page to the Sourceflow API.

        Returns the full parsed JSON response dict.
        Raises httpx.HTTPStatusError on non-2xx responses.
        """
        client = self._get_client()
        body = {
            "job_search": {
                "query": keyword,
                "location": {},
                "filters": {},
                "commute_filter": {},
                "offset": offset,
                "jobs_per_page": PAGE_SIZE,
            }
        }

        time.sleep(REQUEST_DELAY)
        resp = client.post(SEARCH_URL, json=body)
        resp.raise_for_status()

        raw = resp.content.decode("utf-8", errors="replace")
        return json.loads(raw)

    # ------------------------------------------------------------------
    # Parsing helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _strip_html(html: str) -> str:
        """Strip HTML tags and collapse whitespace."""
        if not html:
            return ""
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text).strip()
        return text

    @staticmethod
    def _parse_timestamp(ts) -> Optional[datetime]:
        """Convert a Unix timestamp (int/float) or None to datetime."""
        if not ts:
            return None
        try:
            return datetime.utcfromtimestamp(float(ts))
        except (ValueError, TypeError, OSError):
            return None

    @staticmethod
    def _parse_location(job: dict) -> str:
        """Extract the best available location string from a Sourceflow job dict.

        Priority:
          1. derived_info.locations[0].postal_address.address_lines[0]
          2. addresses[0]  (already a "City, Country" string)
          3. "Global"
        """
        # Try derived_info.locations first (more structured)
        derived = job.get("derived_info") or {}
        locations = derived.get("locations") or []
        if locations:
            postal = locations[0].get("postal_address") or {}
            address_lines = postal.get("address_lines") or []
            if address_lines and address_lines[0].strip():
                return address_lines[0].strip()

        # Fall back to the flat addresses list
        addresses = job.get("addresses") or []
        if addresses and isinstance(addresses[0], str) and addresses[0].strip():
            return addresses[0].strip()

        return "Global"

    @staticmethod
    def _parse_employment_type(job: dict) -> Optional[str]:
        """Extract employment/contract type from the categories list."""
        for cat in job.get("categories") or []:
            if (cat.get("name") or "").lower() in ("contract types", "contract type"):
                values = [v.get("name", "") for v in (cat.get("values") or [])]
                if values:
                    return ", ".join(values)
        return None

    @staticmethod
    def _is_contract_or_temp(job: dict) -> bool:
        """Return True if the job has a Contract or Temporary type tag.

        If no Contract Types category is present, we cannot confirm type —
        return True to err on the side of inclusion (Spencer Ogden is
        primarily a contract agency).
        """
        for cat in job.get("categories") or []:
            if (cat.get("name") or "").lower() in ("contract types", "contract type"):
                values = {(v.get("name") or "").lower() for v in (cat.get("values") or [])}
                return bool(values & CONTRACT_TYPE_VALUES)
        return True  # no type tag → include by default

    @staticmethod
    def _parse_salary(job: dict) -> Optional[str]:
        """Extract salary information if available."""
        salary_pkg = (job.get("salary_package") or "").strip()
        if salary_pkg and salary_pkg.lower() not in ("", "0", "competitive", "tbc"):
            return salary_pkg

        lo = job.get("salary_low", 0.0)
        hi = job.get("salary_high", 0.0)
        try:
            lo_f = float(lo or 0)
            hi_f = float(hi or 0)
            if lo_f > 0 or hi_f > 0:
                return f"{lo_f:,.0f} – {hi_f:,.0f}"
        except (ValueError, TypeError):
            pass

        return None

    def _build_job_url(self, url_slug: str) -> str:
        """Build the canonical public job URL from the Sourceflow url_slug."""
        if not url_slug:
            return f"{BASE_URL}/jobs"
        slug = url_slug.strip("/")
        return f"{BASE_URL}/jobs/{slug}"

    def _job_to_posting(self, job: dict) -> Optional[JobPosting]:
        """Convert a Sourceflow API job dict to a JobPosting, or None if invalid."""
        title = (job.get("title") or "").strip()
        if not title:
            return None

        url_slug = job.get("url_slug") or ""
        url = self._build_job_url(url_slug)

        location = self._parse_location(job)

        # Description: strip HTML, fall back to title+location stub
        desc_html = job.get("description") or ""
        description = self._strip_html(desc_html)
        if not description or len(description) < 10:
            description = f"{title} — Spencer Ogden — {location}"

        employment_type = self._parse_employment_type(job)

        # Posted date from published_at (unix timestamp)
        posted_date = self._parse_timestamp(job.get("published_at") or job.get("created_at"))

        salary = self._parse_salary(job)

        req_id = (
            str(job.get("external_reference"))
            if job.get("external_reference")
            else job.get("id") or None
        )

        try:
            return JobPosting(
                title=title,
                company="Spencer Ogden",
                location=location,
                description=description,
                url=url,
                posted_date=posted_date,
                employment_type=employment_type,
                salary=salary,
                requisition_id=req_id,
                source_aggregator="spencerogden",
            )
        except Exception as exc:
            logger.debug(f"SpencerOgden: skipping job '{title}': {exc}")
            return None

    # ------------------------------------------------------------------
    # Public interface (BaseAggregator)
    # ------------------------------------------------------------------

    def count(self, filters: AggregatorFilters) -> int:
        """Return total job count for the first keyword via a single API call."""
        keyword = filters.keywords[0] if filters.keywords else ""
        try:
            data = self._search_page(keyword=keyword, offset=0)
            return data.get("total_size") or 0
        except Exception as exc:
            logger.warning(f"SpencerOgden count failed: {exc}")
            return 0

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search Spencer Ogden via the Sourceflow job search API.

        Queries the API for each keyword in filters.keywords. Paginates up
        to MAX_PAGES_PER_KEYWORD pages per keyword. Deduplicates by URL.
        Skips jobs whose Contract Types tag does not include contract/temp
        (unless the tag is absent — Spencer Ogden is primarily contract).

        Returns at most filters.max_results postings.
        """
        results: list[JobPosting] = []
        seen_urls: set[str] = set()

        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break

            logger.info(f"SpencerOgden: searching keyword='{keyword}'")

            for page_num in range(MAX_PAGES_PER_KEYWORD):
                if len(results) >= filters.max_results:
                    break

                offset = page_num * PAGE_SIZE
                try:
                    data = self._search_page(keyword=keyword, offset=offset)
                except Exception as exc:
                    logger.warning(
                        f"SpencerOgden: API error for '{keyword}' offset={offset}: {exc}"
                    )
                    break

                total_size = data.get("total_size") or 0
                raw_results = data.get("results") or []

                logger.info(
                    f"SpencerOgden: keyword='{keyword}' offset={offset} "
                    f"got {len(raw_results)} of {total_size} total"
                )

                if not raw_results:
                    break

                for entry in raw_results:
                    if len(results) >= filters.max_results:
                        break

                    job = entry.get("job") or {}
                    if not job:
                        continue

                    # Filter to contract/temp roles only
                    if not self._is_contract_or_temp(job):
                        logger.debug(
                            f"SpencerOgden: skipping non-contract job '{job.get('title')}'"
                        )
                        continue

                    posting = self._job_to_posting(job)
                    if posting is None:
                        continue

                    url_str = str(posting.url)
                    if url_str in seen_urls:
                        continue
                    seen_urls.add(url_str)

                    results.append(posting)

                # No more pages if we received fewer than a full page
                fetched_so_far = offset + len(raw_results)
                if len(raw_results) < PAGE_SIZE or fetched_so_far >= total_size:
                    break

        logger.info(f"SpencerOgden: found {len(results)} jobs total")
        return results[: filters.max_results]
