"""
Atlas Professionals / Atlas NextWave adapter.

Atlas Professionals (atlasprofessionals.com) redirects to atlasnextwave.com, a
WordPress site powered by the WP REST API.  Jobs are exposed as a custom post
type (`/wp/v2/job`) with rich taxonomy support — no JS rendering needed.

KEY DISCOVERY: WordPress REST API at atlasnextwave.com, confirmed 2026-05-22.
  GET https://atlasnextwave.com/wp-json/wp/v2/job
  Params:
    per_page  — up to 100 (server cap)
    page      — 1-indexed
    type-of-work — comma-sep taxonomy term IDs; 17=Contract, 11=Temporary
    job-category — comma-sep category IDs (see CATEGORY_IDS below)
    search    — freetext title search (WP search, title-only — sparse)
    _embed    — "wp:term" embeds all taxonomy terms inline (avoids N+1 lookups)
  Response headers: X-WP-Total, X-WP-TotalPages (for pagination)
  Response body: JSON array of job objects

EMBEDDED TAXONOMY FIELDS (via _embed=wp:term):
  Each job has `_embedded.wp:term` — a list of term-lists, one per taxonomy:
    job-category, client-name, country, duration, job-region, schedule, type-of-work
  client-name terms expose the END-EMPLOYER (e.g., "Saipem", "Allseas", "OOS Parent").
  Slugs named "Foo Parent" or "Foo Sales Account" refer to the same operator.

JOB CATEGORIES relevant to Moblyze (energy/offshore/marine):
  15=Offshore Marine, 123=ROV, 124=Diving & Inspection, 9=Seismic, 23=Dredging,
  31=Drilling & Well Services, 253=Well Services, 243=Drilling, 78=Survey,
  246=Hydrographic Survey, 244=Dredging & Port Construction, 294=Decommissioning,
  28=Energy, 251=Construction & Commissioning, 254=Operations & Maintenance,
  255=Technical & Engineering, 269=Cable Lay, 37=Renewables, 38=Offshore Wind

EMPLOYMENT TYPES:
  17=Contract, 11=Temporary, 21=Permanent
  This adapter requests Contract + Temporary only (Moblyze focus on contingent roles).

END-CLIENT VISIBILITY: EXCELLENT. The client-name taxonomy contains real operator
  names (Saipem, Allseas, Equinor, SBM Offshore, etc.) embedded directly in each
  job record via _embed=wp:term. Names ending in "Parent" or "Sales Account" refer
  to the same end-employer — the adapter strips those suffixes.

RATE LIMITING: WordPress REST API — polite 1.5 s between requests is safe.
  Max per_page=100; a full scrape with filters is ~4-5 pages (400-500 jobs).

No API key required.
"""

import re
import time
import logging
from datetime import datetime
from html import unescape
from typing import Optional

import httpx

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

BASE_URL = "https://atlasnextwave.com"
JOBS_API = f"{BASE_URL}/wp-json/wp/v2/job"

# Seconds between requests — WP REST API is polite at 1.5 s
REQUEST_DELAY = 1.5

# Max items per page — server enforces 100
PAGE_SIZE = 100

# Contract=17, Temporary=11 — these are the contingent-work taxonomy IDs
CONTRACT_TYPE_IDS = "17,11"

# Energy/offshore/marine category IDs to restrict results to Moblyze-relevant roles.
# Comma-separated string used as WP API query param.
# Includes offshore, subsea, ROV, diving, seismic, drilling, survey, renewables, etc.
ENERGY_CATEGORY_IDS = ",".join(str(i) for i in [
    15,   # Offshore Marine
    123,  # ROV
    124,  # Diving & Inspection
    9,    # Seismic
    23,   # Dredging
    31,   # Drilling & Well Services
    243,  # Drilling (alt taxonomy)
    253,  # Well Services (alt taxonomy)
    78,   # Survey
    246,  # Hydrographic Survey
    244,  # Dredging & Port Construction
    294,  # Decommissioning
    28,   # Energy
    251,  # Construction & Commissioning
    254,  # Operations & Maintenance
    255,  # Technical & Engineering
    269,  # Cable Lay
    37,   # Renewables
    38,   # Offshore Wind
])

# Keywords to check against job titles when filtering (case-insensitive).
# Used for the keyword-match search mode (less strict than category mode).
KEYWORD_TITLE_PATTERN = re.compile(
    r"\b(rov|subsea|diver|diving|offshore|marine|inspection|dp|dynamic positioning|"
    r"seismic|survey|hydrographic|drilling|well|vessel|deck|engineer|mechanic|"
    r"technician|cable|renewable|wind|decommission|dredg)\b",
    re.IGNORECASE,
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Referer": f"{BASE_URL}/en/vacancies/",
}


def _clean_client_name(name: str) -> str:
    """Strip CRM suffixes ('Parent', 'Sales Account') from client-name taxonomy values."""
    name = name.strip()
    for suffix in (" Parent", " Sales Account", " parent", " sales account"):
        if name.endswith(suffix):
            name = name[: -len(suffix)].strip()
            break
    return name


def _extract_embedded_terms(job: dict) -> dict[str, list[str]]:
    """Extract taxonomy term names from _embedded['wp:term'] structure.

    Returns a dict keyed by taxonomy slug with lists of term names, e.g.:
      {
        "job-category":  ["ROV"],
        "client-name":   ["Saipem"],
        "country":       ["United Kingdom"],
        "duration":      ["6 months"],
        "job-region":    ["Europe"],
        "schedule":      ["Monday-Friday fulltime"],
        "type-of-work":  ["Contract"],
      }
    """
    result: dict[str, list[str]] = {}
    embedded = job.get("_embedded") or {}
    term_lists = embedded.get("wp:term") or []
    for term_list in term_lists:
        for term in (term_list or []):
            taxonomy = term.get("taxonomy", "")
            name = term.get("name", "").strip()
            if taxonomy and name:
                result.setdefault(taxonomy, []).append(name)
    return result


class AtlasProfessionalsAggregator(BaseAggregator):
    """Adapter for Atlas Professionals / Atlas NextWave (atlasnextwave.com).

    Formerly atlasprofessionals.com — now redirects to atlasnextwave.com.
    A leading offshore/marine/energy staffing specialist (Netherlands HQ),
    strong on North Sea, Norway, Middle East, and APAC. Tier-1 source for
    Dutch and Norwegian offshore roles not appearing on UK-centric boards.

    Uses the WordPress REST API (/wp-json/wp/v2/job) with embedded taxonomy
    terms to retrieve full metadata — client names, countries, durations,
    employment types — in a single API call per page.

    No API key required.
    """

    name = "atlasprofessionals"

    def __init__(self) -> None:
        self._client: Optional[httpx.Client] = None

    def is_configured(self) -> bool:
        """Always configured — no API key needed."""
        return True

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                timeout=30,
                follow_redirects=True,
                headers=HEADERS,
            )
        return self._client

    def _fetch_page(
        self,
        page: int = 1,
        search: str = "",
        use_category_filter: bool = True,
    ) -> tuple[list[dict], int]:
        """Fetch one page of jobs from the WP REST API.

        Returns (jobs_list, total_count).
        Raises on HTTP error.
        """
        params: dict = {
            "per_page": PAGE_SIZE,
            "page": page,
            "type-of-work": CONTRACT_TYPE_IDS,
            "_embed": "wp:term",
        }
        if search:
            params["search"] = search
        if use_category_filter:
            params["job-category"] = ENERGY_CATEGORY_IDS

        client = self._get_client()
        time.sleep(REQUEST_DELAY)

        resp = client.get(JOBS_API, params=params)
        resp.raise_for_status()

        total = int(resp.headers.get("X-WP-Total", "0"))
        jobs = resp.json()
        if not isinstance(jobs, list):
            jobs = []

        return jobs, total

    @staticmethod
    def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
        if not date_str:
            return None
        for fmt in (
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d",
        ):
            try:
                return datetime.strptime(date_str[:19], fmt)
            except ValueError:
                continue
        return None

    def _job_to_posting(self, job: dict) -> Optional[JobPosting]:
        """Convert a WP REST API job object to a JobPosting, or None if invalid."""
        title = unescape((job.get("title") or {}).get("rendered", "")).strip()
        if not title:
            return None

        # URL — always present as 'link'
        url = (job.get("link") or "").strip()
        if not url:
            slug = job.get("slug") or ""
            url = f"{BASE_URL}/job/{slug}/" if slug else f"{BASE_URL}/en/vacancies/"

        # Extract embedded taxonomy terms
        terms = _extract_embedded_terms(job)

        # Location: country name (first), fallback to job-region
        country_names = terms.get("country", [])
        region_names = terms.get("job-region", [])
        if country_names:
            location = country_names[0]
        elif region_names:
            location = region_names[0]
        else:
            # Fallback: parse from class_list
            class_list = job.get("class_list") or []
            country_cls = next(
                (c.replace("country-", "").replace("-", " ").title()
                 for c in class_list if c.startswith("country-")),
                "",
            )
            location = country_cls or "Various"

        # End-client/company — client-name taxonomy
        client_names = terms.get("client-name", [])
        if client_names:
            company = _clean_client_name(unescape(client_names[0]))
        else:
            company = "Atlas Professionals"

        # Employment type
        work_types = terms.get("type-of-work", [])
        employment_type = ", ".join(work_types) if work_types else "Contract"

        # Categories for description
        categories = terms.get("job-category", [])
        duration = terms.get("duration", [])
        schedule = terms.get("schedule", [])

        # Description — build from available structured metadata (content is empty in API)
        desc_parts = [f"{title}"]
        if categories:
            desc_parts.append(f"Category: {', '.join(categories)}")
        if location and location != "Various":
            desc_parts.append(f"Location: {location}")
        if region_names:
            desc_parts.append(f"Region: {', '.join(region_names)}")
        if duration:
            desc_parts.append(f"Duration: {', '.join(duration)}")
        if schedule:
            desc_parts.append(f"Schedule: {', '.join(schedule)}")
        if employment_type:
            desc_parts.append(f"Type: {employment_type}")
        desc_parts.append(f"Source: Atlas Professionals (atlasnextwave.com)")
        description = " | ".join(desc_parts)

        # Posted date
        posted_date = self._parse_date(job.get("date"))

        # Requisition ID — WP post ID as string
        req_id = str(job.get("id")) if job.get("id") else None

        try:
            return JobPosting(
                title=title,
                company=company,
                location=location,
                description=description,
                url=url,
                posted_date=posted_date,
                employment_type=employment_type,
                requisition_id=req_id,
                source_aggregator="atlasprofessionals",
            )
        except Exception as exc:
            logger.debug(f"AtlasProfessionals: skipping job '{title}': {exc}")
            return None

    def _keyword_matches_title(self, title: str, keywords: list[str]) -> bool:
        """Return True if any keyword (or a title pattern) matches the job title."""
        title_lower = title.lower()
        for kw in keywords:
            if kw.lower() in title_lower:
                return True
        # Also accept titles that match the broader energy keyword pattern
        if KEYWORD_TITLE_PATTERN.search(title):
            return True
        return False

    def count(self, filters: AggregatorFilters) -> int:
        """Return approximate count of matching contract jobs."""
        try:
            keyword = filters.keywords[0] if filters.keywords else ""
            _, total = self._fetch_page(page=1, search=keyword, use_category_filter=True)
            return total
        except Exception as exc:
            logger.warning(f"AtlasProfessionals count failed: {exc}")
            return 0

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search Atlas Professionals for offshore/energy contract jobs.

        Strategy:
          1. Fetch all contract/temporary jobs from energy/offshore categories
             using WP REST API with embedded taxonomy terms (one API call per page).
          2. Filter results server-side by keyword match against job title when
             the WP keyword search is too sparse (content field is empty in the API
             so WP's text search only covers titles).
          3. Deduplicate by post ID.

        Embedded taxonomy terms give us client name, country, duration, schedule
        and employment type without extra API calls.
        """
        results: list[JobPosting] = []
        seen_ids: set[str] = set()

        # Determine if we should do keyword-filtered fetch or broad category fetch
        keywords = filters.keywords or []
        do_keyword_search = bool(keywords)

        # If keywords provided, try WP search for each keyword first (fast/targeted),
        # then fall back to full category scan if results are thin.
        if do_keyword_search:
            for keyword in keywords:
                if len(results) >= filters.max_results:
                    break
                try:
                    jobs_raw, total = self._fetch_page(
                        page=1,
                        search=keyword,
                        use_category_filter=False,  # search is already scoped
                    )
                    logger.info(
                        f"AtlasProfessionals: keyword='{keyword}' search returned {total} jobs"
                    )
                    for job in jobs_raw:
                        if len(results) >= filters.max_results:
                            break
                        post_id = str(job.get("id") or "")
                        if post_id in seen_ids:
                            continue
                        seen_ids.add(post_id)
                        posting = self._job_to_posting(job)
                        if posting:
                            results.append(posting)
                except Exception as exc:
                    logger.warning(f"AtlasProfessionals: keyword search '{keyword}' failed: {exc}")

        # Supplement (or replace) with full category-filtered sweep if we need more results
        if len(results) < filters.max_results:
            page = 1
            max_pages = 6  # up to 600 jobs; API currently has ~436 contract jobs
            while len(results) < filters.max_results and page <= max_pages:
                try:
                    jobs_raw, total = self._fetch_page(
                        page=page,
                        search="",
                        use_category_filter=True,
                    )
                    logger.info(
                        f"AtlasProfessionals: category sweep page={page} "
                        f"got {len(jobs_raw)} jobs (total={total})"
                    )
                    if not jobs_raw:
                        break

                    for job in jobs_raw:
                        if len(results) >= filters.max_results:
                            break
                        post_id = str(job.get("id") or "")
                        if post_id in seen_ids:
                            continue
                        seen_ids.add(post_id)

                        # Keyword filter when keywords were requested
                        if do_keyword_search:
                            title = (job.get("title") or {}).get("rendered", "")
                            if not self._keyword_matches_title(title, keywords):
                                continue

                        posting = self._job_to_posting(job)
                        if posting:
                            results.append(posting)

                    fetched_so_far = (page - 1) * PAGE_SIZE + len(jobs_raw)
                    if fetched_so_far >= total or len(jobs_raw) < PAGE_SIZE:
                        break
                    page += 1

                except Exception as exc:
                    logger.warning(
                        f"AtlasProfessionals: category sweep page={page} failed: {exc}"
                    )
                    break

        logger.info(f"AtlasProfessionals: found {len(results)} jobs total")
        return results[: filters.max_results]
