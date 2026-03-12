import os
import time
import httpx
import logging
from datetime import datetime
from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

# Jooble uses country-specific subdomains for their API
COUNTRY_SUBDOMAINS = {
    "us": "us.jooble.org",
    "gb": "gb.jooble.org",
    "uk": "gb.jooble.org",
    "au": "au.jooble.org",
    "ca": "ca.jooble.org",
    "de": "de.jooble.org",
    "fr": "fr.jooble.org",
}

# Job type qualifiers to append to keywords for non-full-time filtering.
# We cycle through these to maximise result diversity.
NON_FULLTIME_QUALIFIERS = [
    "contract",
    "temporary",
    "freelance",
    "contractor",
]

# Titles that strongly signal full-time permanent roles -- skip these
FULLTIME_TITLE_SIGNALS = [
    "permanent",
    "staff ",
    "full time",
    "full-time",
]

# Max pages to iterate per keyword+country combination
MAX_PAGES_PER_QUERY = 3

# Results per page -- Jooble default is ~20, request more
RESULTS_PER_PAGE = 20

# Polite delay between API requests (seconds)
REQUEST_DELAY = 0.4


class JoobleAggregator(BaseAggregator):
    name = "jooble"

    def __init__(self):
        self.api_key = os.getenv('JOOBLE_API_KEY', '')

    def is_configured(self) -> bool:
        return bool(self.api_key)

    # ------------------------------------------------------------------
    # API helpers
    # ------------------------------------------------------------------

    def _api_url(self, country: str) -> str:
        """Build the Jooble API URL for a given country code."""
        subdomain = COUNTRY_SUBDOMAINS.get(country.lower(), "jooble.org")
        return f"https://{subdomain}/api/{self.api_key}"

    def _post_search(self, keyword: str, country: str = "us",
                     location: str = "", page: int = 1) -> dict:
        """Execute a single Jooble API search request."""
        url = self._api_url(country)
        body = {
            "keywords": keyword,
            "location": location,
            "page": page,
            "ResultOnPage": RESULTS_PER_PAGE,
        }
        resp = httpx.post(url, json=body, timeout=30)
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # Keyword expansion
    # ------------------------------------------------------------------

    @staticmethod
    def _build_search_terms(keywords: list[str],
                            job_types: list[str] | None) -> list[str]:
        """
        Build effective search terms by combining keywords with job-type
        qualifiers.  Each keyword is paired with each relevant qualifier
        to maximise non-full-time coverage.

        Also includes the bare keyword (no qualifier) so we don't miss
        results that Jooble already tags as contract/temporary.
        """
        qualifiers = set()
        if job_types:
            for jt in job_types:
                jt_lower = jt.lower().strip()
                if jt_lower in ("contract", "temporary", "freelance", "contractor"):
                    qualifiers.add(jt_lower)
        # Always include contract + temporary as baseline
        qualifiers.update(["contract", "temporary"])

        terms: list[str] = []
        for kw in keywords:
            # Bare keyword first (catches jobs already tagged non-FT)
            terms.append(kw)
            # Then with each qualifier
            for q in sorted(qualifiers):
                # Skip if keyword already contains the qualifier
                if q in kw.lower():
                    continue
                terms.append(f"{kw} {q}")
        return terms

    # ------------------------------------------------------------------
    # Result filtering
    # ------------------------------------------------------------------

    @staticmethod
    def _looks_fulltime(title: str, employment_type: str) -> bool:
        """Heuristic: return True if the job looks like a full-time permanent role."""
        title_lower = title.lower()
        emp_lower = (employment_type or "").lower()

        # If the API explicitly says full-time and nothing else, skip
        if emp_lower in ("full-time", "full time", "permanent"):
            return True

        for signal in FULLTIME_TITLE_SIGNALS:
            if signal in title_lower:
                return True

        return False

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def count(self, filters: AggregatorFilters) -> int:
        if not self.is_configured():
            logger.warning("Jooble: not configured (missing JOOBLE_API_KEY)")
            return 0

        total = 0
        sample_keywords = filters.keywords[:3]
        for country in filters.countries:
            for keyword in sample_keywords:
                try:
                    search_term = f"{keyword} contract"
                    data = self._post_search(search_term, country=country)
                    total += data.get("totalCount", 0)
                    time.sleep(REQUEST_DELAY)
                except Exception as e:
                    logger.warning(f"Jooble count failed for '{keyword}' in {country}: {e}")
        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        if not self.is_configured():
            logger.warning("Jooble: not configured (missing JOOBLE_API_KEY)")
            return []

        results: list[JobPosting] = []
        seen: set[str] = set()

        search_terms = self._build_search_terms(filters.keywords, filters.job_types)

        for country in filters.countries:
            if len(results) >= filters.max_results:
                break

            for term in search_terms:
                if len(results) >= filters.max_results:
                    break

                # Paginate through multiple pages per term
                for page in range(1, MAX_PAGES_PER_QUERY + 1):
                    if len(results) >= filters.max_results:
                        break

                    try:
                        data = self._post_search(
                            keyword=term,
                            country=country,
                            page=page,
                        )
                        time.sleep(REQUEST_DELAY)

                        jobs_on_page = data.get("jobs", [])
                        if not jobs_on_page:
                            break  # No more pages

                        new_on_page = 0
                        for item in jobs_on_page:
                            if len(results) >= filters.max_results:
                                break

                            job = self._parse_job(item, seen)
                            if job is not None:
                                results.append(job)
                                new_on_page += 1

                        logger.debug(
                            f"Jooble [{country}] '{term}' p{page}: "
                            f"{len(jobs_on_page)} raw, {new_on_page} new"
                        )

                        # Stop paginating if page was small (likely last page)
                        if len(jobs_on_page) < RESULTS_PER_PAGE // 2:
                            break

                    except Exception as e:
                        logger.warning(f"Jooble search failed for '{term}' in {country} p{page}: {e}")
                        break  # Don't keep retrying on error

        logger.info(f"Jooble: found {len(results)} unique non-FT jobs across {len(filters.countries)} countries")
        return results[:filters.max_results]

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def _parse_job(self, item: dict, seen: set[str]) -> JobPosting | None:
        """Parse a single Jooble job item. Returns None if it should be skipped."""
        title = (item.get("title") or "").strip()
        company = (item.get("company") or "Unknown").strip()
        if not title or not company:
            return None

        # Dedup by title+company
        dedup_key = f"{title.lower()}|{company.lower()}"
        if dedup_key in seen:
            return None
        seen.add(dedup_key)

        link = (item.get("link") or "").strip()
        if not link:
            return None

        # Employment type from API
        employment_type = (item.get("type") or "").strip()

        # Filter out obvious full-time permanent roles
        if self._looks_fulltime(title, employment_type):
            logger.debug(f"Jooble: skipping full-time job: {title}")
            return None

        # Default employment type to Contract if empty
        if not employment_type:
            employment_type = "Contract"

        snippet = (item.get("snippet") or "").strip()
        if len(snippet) < 10:
            snippet = f"{title} at {company}"

        location = (item.get("location") or "Unknown").strip()
        salary = (item.get("salary") or "").strip() or None

        posted_date = None
        if item.get("updated"):
            try:
                posted_date = datetime.fromisoformat(
                    item["updated"].replace("Z", "+00:00")
                )
            except (ValueError, TypeError):
                pass

        try:
            return JobPosting(
                title=title,
                company=company,
                location=location,
                description=snippet,
                url=link,
                salary=salary,
                posted_date=posted_date,
                employment_type=employment_type,
                source_aggregator="jooble",
            )
        except Exception as e:
            logger.debug(f"Skipping Jooble job: {e}")
            return None
