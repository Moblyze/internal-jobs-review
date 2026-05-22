"""
Petroplan adapter — queries the TXM Group WordPress REST API for Petroplan jobs.

Petroplan (petroplan.com) is a global O&G contract staffing agency specialising
in subsea, inspection, offshore, and energy roles across UK/North Sea, Middle
East, US Gulf Coast, West Africa, and APAC. In early 2026 Petroplan's own job
board was migrated under the TXM Group umbrella (its parent company). The
Petroplan website now redirects candidates to txmgroup.com/about/careers/.

DATA SOURCE:
  txmgroup.com/wp-json/wp/v2/job
  Custom post type "job" exposed via the WordPress REST API (no auth required).
  Backed by Bullhorn ATS via WP-All-Import — ACF fields surface the full
  Bullhorn vacancy record including employment type, location, salary, and
  end-client (client_corporation_name).

ENDPOINT:
  GET https://txmgroup.com/wp-json/wp/v2/job
  Query params:
    per_page  — max 100 (WP default cap)
    page      — 1-indexed pagination
    search    — full-text search (WP's native search on title + content)
    _fields   — field projection (optional, used to reduce response size)

  Response: JSON array of job objects. Pagination info via response headers:
    X-WP-Total        — total matching jobs
    X-WP-TotalPages   — total pages

  Each job object has:
    id              — WP post ID
    title.rendered  — job title (duplicated in acf.title)
    link            — canonical URL on txmgroup.com
    date            — publish timestamp
    acf             — Bullhorn ACF fields:
      title                  — job title
      publicDescription      — HTML job description
      employmenttype         — "Contract", "Permanent", etc.
      countryname            — e.g. "United Kingdom"
      city / state / zip     — granular location
      client_corporation_name — end-client/employer name (Bullhorn CRM)
      client_corporation_id   — Bullhorn client ID
      payrate                — hourly/daily rate (numeric, 0 if not disclosed)
      salaryunit             — "Per Hour", "Per Day", etc.
      yearsrequired          — min experience years (numeric)
      startdate              — epoch ms
      dateadded              — epoch ms (Bullhorn created date)
      isopen                 — "1" if still open

STRATEGY:
  Search the API for each keyword. Because WP full-text search only matches
  title and post content (ACF fields are not indexed), we also fall back to
  fetching all jobs and doing in-process keyword filtering on the description
  text when the keyword search returns 0 results. This two-pass approach
  ensures we do not miss O&G roles whose description is rich but whose title
  is generic (e.g. "Engineer — Offshore").

  Employment type filter: prefer CONTRACT roles; when contract jobs are
  scarce we include all types and annotate the type in the returned posting.

END-EMPLOYER RECOVERABILITY:
  Full — acf.client_corporation_name contains the Bullhorn client record name
  (e.g. "Petroplan", "TXM Group", or the end-operator). When payrate > 0 the
  rate and unit are embedded in the salary field.

RATE LIMITING:
  No documented rate limit. We use a 1.5 s inter-request delay and limit
  per_page to 100 to stay polite.
"""

import re
import time
import json
import logging
from datetime import datetime, timezone

import httpx

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

BASE_URL = "https://txmgroup.com"
JOB_API_URL = f"{BASE_URL}/wp-json/wp/v2/job"
JOB_DETAIL_BASE = f"{BASE_URL}/jobs"

# WP REST API hard-caps per_page at 100
PAGE_SIZE = 100

# Polite inter-request delay (seconds)
REQUEST_DELAY = 1.5

# Max pages to fetch per keyword when paginating
MAX_PAGES_PER_KEYWORD = 5

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": f"{BASE_URL}/about/careers/",
}

# Employment types we prefer (contract / contingent work)
PREFERRED_TYPES = frozenset(
    {
        "contract",
        "contractor",
        "temporary",
        "temp",
        "contingent",
        "freelance",
        "interim",
    }
)


# ── Helpers ────────────────────────────────────────────────────────────────────


def _strip_html(html: str) -> str:
    """Strip HTML tags and collapse whitespace."""
    if not html:
        return ""
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&[a-z]+;", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _epoch_ms_to_datetime(epoch_ms_str: str) -> datetime | None:
    """Convert Bullhorn epoch-millisecond string to a UTC datetime."""
    try:
        ms = int(epoch_ms_str)
        if ms <= 0:
            return None
        return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
    except (ValueError, TypeError, OSError):
        return None


def _parse_wp_date(date_str: str | None) -> datetime | None:
    """Parse WordPress ISO-8601 date string."""
    if not date_str:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(date_str[:19], "%Y-%m-%dT%H:%M:%S").replace(
                tzinfo=timezone.utc
            )
        except (ValueError, TypeError):
            continue
    return None


def _keyword_in_text(keyword: str, *texts: str) -> bool:
    """Case-insensitive keyword match against any of the provided text strings."""
    kw = keyword.lower()
    for text in texts:
        if text and kw in text.lower():
            return True
    return False


# ── Main Adapter ───────────────────────────────────────────────────────────────


class PetroplanAggregator(BaseAggregator):
    """
    Adapter for Petroplan (petroplan.com) via TXM Group's WordPress REST API.

    Petroplan is part of TXM Group and its job listings are published on
    txmgroup.com under a 'job' custom post type backed by Bullhorn ATS.
    The WP REST API endpoint is unauthenticated and returns full ACF field
    data including end-client names, employment type, and salary rate.

    Contract/contingent roles are preferred; all employment types are returned
    if no contract roles match the search terms.

    End-employer: recoverable via acf.client_corporation_name (Bullhorn client
    record) — typically "Petroplan" or the end-operator name.
    """

    name = "petroplan"

    def __init__(self) -> None:
        self._client: httpx.Client | None = None

    def is_configured(self) -> bool:
        """Always configured — no API key required."""
        return True

    # ── HTTP client ───────────────────────────────────────────────────────────

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                timeout=30,
                follow_redirects=True,
                headers=HEADERS,
            )
        return self._client

    # ── API calls ─────────────────────────────────────────────────────────────

    def _fetch_jobs(
        self,
        search: str | None = None,
        page: int = 1,
        per_page: int = PAGE_SIZE,
    ) -> tuple[list[dict], int]:
        """
        Call the TXM Group WP REST job endpoint.

        Returns (jobs_list, total_count). On any error returns ([], 0).
        """
        client = self._get_client()
        params: dict = {"per_page": per_page, "page": page}
        if search:
            params["search"] = search

        time.sleep(REQUEST_DELAY)
        try:
            resp = client.get(JOB_API_URL, params=params)
            resp.raise_for_status()

            total = int(resp.headers.get("X-WP-Total", "0"))
            jobs = resp.json()
            if not isinstance(jobs, list):
                logger.debug(
                    f"Petroplan API: unexpected response type for search={search!r}"
                )
                return [], 0
            return jobs, total

        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            logger.warning(f"Petroplan API error (search={search!r}): {exc}")
            return [], 0
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning(f"Petroplan API parse error (search={search!r}): {exc}")
            return [], 0

    # ── Parsing ───────────────────────────────────────────────────────────────

    def _job_to_posting(self, job: dict) -> JobPosting | None:
        """
        Convert a WP REST job object to a JobPosting.

        Returns None if the job is missing critical data (title or URL).
        """
        acf = job.get("acf") or {}

        # Title: prefer ACF (Bullhorn canonical) over WP rendered title
        title = (acf.get("title") or "").strip()
        if not title:
            title = (
                (job.get("title") or {}).get("rendered") or ""
            ).strip()
        if not title:
            return None

        # Skip closed/deleted jobs flagged by Bullhorn
        if str(acf.get("isopen", "1")) == "0":
            return None
        if str(acf.get("isdeleted", "0")) == "1":
            return None
        if str(acf.get("ispublic", "1")) == "0":
            return None

        # URL — use WP canonical link (on txmgroup.com/jobs/<slug>)
        url = (job.get("link") or "").strip()
        if not url:
            wp_id = job.get("id")
            url = f"{JOB_DETAIL_BASE}/?p={wp_id}" if wp_id else JOB_DETAIL_BASE

        # Location
        city = (acf.get("city") or "").strip()
        state = (acf.get("state") or "").strip()
        country = (acf.get("countryname") or "").strip()
        parts = [p for p in [city, state, country] if p]
        location = ", ".join(parts) if parts else "Global"

        # Description from Bullhorn publicDescription (HTML)
        raw_desc = acf.get("publicDescription") or ""
        description = _strip_html(raw_desc)
        if len(description) < 10:
            description = f"{title} — Petroplan / TXM Group — {location}"

        # Employment type
        emp_type = (acf.get("employmenttype") or "").strip() or None

        # Salary / rate
        salary: str | None = None
        try:
            payrate = float(acf.get("payrate") or 0)
            sal_unit = (acf.get("salaryunit") or "").strip()
            if payrate > 0:
                salary = f"{payrate:.2f} {sal_unit}".strip()
        except (ValueError, TypeError):
            pass

        # Date posted: prefer Bullhorn dateadded (epoch ms), fall back to WP date
        date_added_str = str(acf.get("dateadded") or "")
        posted = _epoch_ms_to_datetime(date_added_str)
        if posted is None:
            posted = _parse_wp_date(job.get("date"))

        # End-employer via Bullhorn client_corporation_name
        company = (acf.get("client_corporation_name") or "Petroplan").strip()
        if not company:
            company = "Petroplan"

        # Requisition ID: use WP post ID as stable reference (Bullhorn ID is in ACF)
        req_id = str(acf.get("id") or job.get("id") or "").strip() or None

        try:
            return JobPosting(
                title=title,
                company=company,
                location=location,
                description=description[:1000],
                url=url,  # type: ignore[arg-type]
                posted_date=posted,
                employment_type=emp_type,
                salary=salary,
                requisition_id=req_id,
                source_aggregator="petroplan",
            )
        except Exception as exc:
            logger.debug(f"Petroplan: skipping job '{title}': {exc}")
            return None

    # ── Public interface ──────────────────────────────────────────────────────

    def count(self, filters: AggregatorFilters) -> int:
        """
        Return approximate count of matching jobs.

        Queries the first keyword against the API and returns X-WP-Total.
        Falls back to a no-filter count if the keyword returns 0.
        """
        keyword = filters.keywords[0] if filters.keywords else None
        _, total = self._fetch_jobs(search=keyword, page=1, per_page=1)
        if total == 0 and keyword:
            # Keyword didn't match WP title/content; try unfiltered count
            _, total = self._fetch_jobs(search=None, page=1, per_page=1)
        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """
        Search Petroplan / TXM Group for O&G contract jobs.

        Strategy:
        1. For each keyword, query the WP REST API with ?search=<keyword>.
           WP searches title + content (ACF publicDescription is synced into
           post content by WP-All-Import).
        2. If any keyword returns 0 results, fall back to fetching ALL jobs
           (no search param) and applying in-process keyword filtering.
        3. Prefer CONTRACT/Temporary employment types; include all types when
           no preferred-type jobs are found for a given keyword.
        4. Deduplicate across keywords using job URL as the stable key.
        5. Respect filters.max_results.
        """
        results: list[JobPosting] = []
        seen_urls: set[str] = set()

        keywords = filters.keywords or [""]

        for keyword in keywords:
            if len(results) >= filters.max_results:
                break

            logger.info(f"Petroplan: searching '{keyword}'")

            # ── Pass 1: API keyword search ────────────────────────────────
            keyword_results: list[JobPosting] = []
            page = 1
            all_zero = False

            while len(keyword_results) < filters.max_results and page <= MAX_PAGES_PER_KEYWORD:
                raw_jobs, total = self._fetch_jobs(
                    search=keyword or None,
                    page=page,
                    per_page=PAGE_SIZE,
                )
                if not raw_jobs:
                    if page == 1:
                        all_zero = True
                    break

                for job in raw_jobs:
                    posting = self._job_to_posting(job)
                    if posting is None:
                        continue
                    url_key = str(posting.url)
                    if url_key in seen_urls:
                        continue
                    seen_urls.add(url_key)
                    keyword_results.append(posting)

                fetched_so_far = (page - 1) * PAGE_SIZE + len(raw_jobs)
                if fetched_so_far >= total or len(raw_jobs) < PAGE_SIZE:
                    break
                page += 1

            # ── Pass 2: Fallback — fetch all, filter in-process ───────────
            if all_zero and keyword:
                logger.info(
                    f"Petroplan: no WP search results for '{keyword}'; "
                    "falling back to full fetch + in-process filter"
                )
                page = 1
                while page <= MAX_PAGES_PER_KEYWORD:
                    raw_jobs, total = self._fetch_jobs(
                        search=None,
                        page=page,
                        per_page=PAGE_SIZE,
                    )
                    if not raw_jobs:
                        break

                    for job in raw_jobs:
                        acf = job.get("acf") or {}
                        title_text = (
                            (acf.get("title") or "")
                            + " "
                            + (
                                (job.get("title") or {}).get("rendered") or ""
                            )
                        )
                        desc_text = _strip_html(acf.get("publicDescription") or "")

                        if not _keyword_in_text(keyword, title_text, desc_text):
                            continue

                        posting = self._job_to_posting(job)
                        if posting is None:
                            continue
                        url_key = str(posting.url)
                        if url_key in seen_urls:
                            continue
                        seen_urls.add(url_key)
                        keyword_results.append(posting)

                    fetched_so_far = (page - 1) * PAGE_SIZE + len(raw_jobs)
                    if fetched_so_far >= total or len(raw_jobs) < PAGE_SIZE:
                        break
                    page += 1

            # ── Prefer contract roles ─────────────────────────────────────
            contract_jobs = [
                j
                for j in keyword_results
                if (j.employment_type or "").lower() in PREFERRED_TYPES
            ]
            chosen = contract_jobs if contract_jobs else keyword_results

            for posting in chosen:
                if len(results) >= filters.max_results:
                    break
                results.append(posting)

        logger.info(f"Petroplan: returning {len(results)} jobs total")
        return results[: filters.max_results]
