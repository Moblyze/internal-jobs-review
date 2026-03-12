import os
import httpx
import logging
from datetime import datetime
from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)


class AdzunaAggregator(BaseAggregator):
    name = "adzuna"
    BASE_URL = "https://api.adzuna.com/v1/api/jobs"

    def __init__(self):
        self.app_id = os.getenv('ADZUNA_APP_ID', '')
        self.app_key = os.getenv('ADZUNA_APP_KEY', '')

    def is_configured(self) -> bool:
        return bool(self.app_id and self.app_key)

    def _search_api(self, keyword: str, country: str, page: int = 1,
                    results_per_page: int = 20) -> dict:
        """Make a single API request.

        Searches by keyword only -- no contract_time filter is applied because:
        1. Many energy/trades contract jobs aren't tagged as "contract" in Adzuna
        2. The contract_time param returns 400 on some country endpoints
        3. Relevance filtering in the dedup layer handles quality control
        """
        url = f"{self.BASE_URL}/{country}/search/{page}"
        params = {
            "app_id": self.app_id,
            "app_key": self.app_key,
            "what": keyword,
            "results_per_page": results_per_page,
            "content-type": "application/json",
        }
        resp = httpx.get(url, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def count(self, filters: AggregatorFilters) -> int:
        total = 0
        for country in filters.countries:
            for keyword in filters.keywords:
                try:
                    data = self._search_api(keyword, country, page=1, results_per_page=1)
                    total += data.get("count", 0)
                except Exception as e:
                    logger.warning(f"Adzuna count failed for '{keyword}' in {country}: {e}")
        return total

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        results = []
        seen = set()

        for country in filters.countries:
            for keyword in filters.keywords:
                if len(results) >= filters.max_results:
                    break
                try:
                    remaining = filters.max_results - len(results)
                    per_page = min(50, remaining)
                    data = self._search_api(keyword, country, page=1,
                                            results_per_page=per_page)

                    for item in data.get("results", []):
                        title = item.get("title", "").strip()
                        company = (item.get("company", {}) or {}).get("display_name", "Unknown").strip()
                        if not title:
                            continue

                        dedup_key = f"{title.lower()}|{company.lower()}"
                        if dedup_key in seen:
                            continue
                        seen.add(dedup_key)

                        url = item.get("redirect_url", "")
                        if not url:
                            continue

                        location = (item.get("location", {}) or {}).get("display_name", "Unknown")
                        description = item.get("description", "")
                        if len(description) < 10:
                            description = f"{title} at {company} - {location}"

                        # Build salary string
                        salary = None
                        if item.get("salary_min") and item.get("salary_max"):
                            salary = f"${item['salary_min']:,.0f} - ${item['salary_max']:,.0f}"
                        elif item.get("salary_min"):
                            salary = f"${item['salary_min']:,.0f}+"

                        # Parse date
                        posted_date = None
                        if item.get("created"):
                            try:
                                posted_date = datetime.fromisoformat(item["created"].replace("Z", "+00:00"))
                            except (ValueError, TypeError):
                                pass

                        employment_type = item.get("contract_type") or item.get("contract_time") or None

                        try:
                            job = JobPosting(
                                title=title,
                                company=company,
                                location=location,
                                description=description,
                                url=url,
                                salary=salary,
                                posted_date=posted_date,
                                employment_type=employment_type,
                                source_aggregator="adzuna",
                            )
                            results.append(job)
                        except Exception as e:
                            logger.debug(f"Skipping Adzuna job: {e}")

                except Exception as e:
                    logger.warning(f"Adzuna search failed for '{keyword}' in {country}: {e}")

        logger.info(f"Adzuna: found {len(results)} unique jobs")
        return results[:filters.max_results]
