import os
import httpx
import logging
from datetime import datetime
from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

class USAJobsAggregator(BaseAggregator):
    name = "usajobs"
    BASE_URL = "https://data.usajobs.gov/api/search"

    def __init__(self):
        self.api_key = os.getenv('USAJOBS_API_KEY', '')
        self.email = os.getenv('USAJOBS_EMAIL', '')

    def is_configured(self) -> bool:
        return bool(self.api_key and self.email)

    def _get_headers(self) -> dict:
        return {
            "Authorization-Key": self.api_key,
            "User-Agent": self.email,
            "Host": "data.usajobs.gov",
        }

    def _search_api(self, keyword: str, page: int = 1, results_per_page: int = 25) -> dict:
        params = {
            "Keyword": keyword,
            "ResultsPerPage": results_per_page,
            "Page": page,
            # 15317 = Temporary, 15318 = Term appointment (both are non-permanent)
            # Omit to get all types, then filter
        }
        resp = httpx.get(self.BASE_URL, params=params, headers=self._get_headers(), timeout=30)
        resp.raise_for_status()
        return resp.json()

    def count(self, filters: AggregatorFilters) -> int:
        if not self.is_configured():
            logger.warning("USAJobs: not configured (missing USAJOBS_API_KEY or USAJOBS_EMAIL)")
            return 0
        total = 0
        for keyword in filters.keywords[:3]:
            try:
                data = self._search_api(keyword, results_per_page=1)
                total += data.get("SearchResult", {}).get("SearchResultCountAll", 0)
            except Exception as e:
                logger.warning(f"USAJobs count failed for '{keyword}': {e}")
        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        if not self.is_configured():
            logger.warning("USAJobs: not configured (missing USAJOBS_API_KEY or USAJOBS_EMAIL)")
            return []

        results = []
        seen = set()

        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break
            try:
                remaining = filters.max_results - len(results)
                data = self._search_api(keyword, results_per_page=min(50, remaining))

                items = data.get("SearchResult", {}).get("SearchResultItems", [])
                for item in items:
                    desc = item.get("MatchedObjectDescriptor", {})

                    title = (desc.get("PositionTitle") or "").strip()
                    company = (desc.get("OrganizationName") or "US Federal Government").strip()
                    if not title:
                        continue

                    url = (desc.get("PositionURI") or "").strip()
                    if not url:
                        continue

                    location = (desc.get("PositionLocationDisplay") or "Unknown").strip()

                    dedup_key = f"{title.lower()}|{company.lower()}|{location.lower()}"
                    if dedup_key in seen:
                        continue
                    seen.add(dedup_key)

                    # Get description from UserArea
                    user_area = desc.get("UserArea", {}).get("Details", {})
                    description = (user_area.get("JobSummary") or "").strip()
                    if len(description) < 10:
                        description = f"{title} at {company} - {location}"

                    # Salary
                    salary = None
                    remuneration = desc.get("PositionRemuneration", [])
                    if remuneration:
                        r = remuneration[0]
                        min_r = r.get("MinimumRange", "")
                        max_r = r.get("MaximumRange", "")
                        rate = r.get("RateIntervalCode", "")
                        if min_r and max_r:
                            salary = f"${float(min_r):,.0f} - ${float(max_r):,.0f} {rate}"

                    # Date
                    posted_date = None
                    pub_date = desc.get("PublicationStartDate")
                    if pub_date:
                        try:
                            posted_date = datetime.fromisoformat(pub_date)
                        except (ValueError, TypeError):
                            pass

                    try:
                        job = JobPosting(
                            title=title,
                            company=company,
                            location=location,
                            description=description,
                            url=url,
                            salary=salary,
                            posted_date=posted_date,
                            employment_type="Federal Contract/Term",
                            source_aggregator="usajobs",
                        )
                        results.append(job)
                    except Exception as e:
                        logger.debug(f"Skipping USAJobs job: {e}")

            except Exception as e:
                logger.warning(f"USAJobs search failed for '{keyword}': {e}")

        logger.info(f"USAJobs: found {len(results)} unique jobs")
        return results[:filters.max_results]
