from jobspy import scrape_jobs
from datetime import datetime
from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters
import logging

logger = logging.getLogger(__name__)

class JobSpyAggregator(BaseAggregator):
    name = "jobspy"

    # Results to request per keyword/country combination
    RESULTS_PER_KEYWORD = 30

    def is_configured(self) -> bool:
        return True  # No API key needed

    def _map_country(self, country_code: str) -> str:
        """Map 2-letter code to jobspy country format."""
        mapping = {"us": "USA", "gb": "UK", "au": "Australia", "ca": "Canada", "no": "Norway"}
        return mapping.get(country_code.lower(), country_code)

    def _map_job_type(self, job_type: str) -> str:
        """Map our job type to jobspy format."""
        mapping = {"contract": "contract", "temporary": "contract", "full-time": "fulltime", "part-time": "parttime"}
        return mapping.get(job_type.lower(), job_type)

    def _clean_employment_type(self, raw_type) -> str:
        """Clean employment type, handling nan and None values."""
        type_str = str(raw_type).strip()
        if not type_str or type_str.lower() in ('nan', 'none', ''):
            return 'Unknown'
        # Normalize common formats
        type_lower = type_str.lower()
        if 'full' in type_lower and 'time' in type_lower:
            return 'Full-time'
        if 'part' in type_lower and 'time' in type_lower:
            return 'Part-time'
        if 'contract' in type_lower:
            return 'Contract'
        if 'temp' in type_lower:
            return 'Temporary'
        if 'intern' in type_lower:
            return 'Internship'
        return type_str

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        seen = set()
        results = []
        # Note: "google" was tested but hangs frequently, "zip_recruiter" returns 429s
        sites = ["indeed", "glassdoor", "linkedin"]

        # Don't filter by job_type - many relevant contingent roles are posted
        # as fulltime or without a type. The relevance filter handles quality.

        total_searches = len(filters.countries) * len(filters.keywords)
        search_num = 0

        for country in filters.countries:
            country_indeed = self._map_country(country)
            for keyword in filters.keywords:
                search_num += 1
                # Always search ALL keywords for breadth, even if we have
                # enough results. We deduplicate and trim at the end.
                try:
                    logger.warning(f"  JobSpy [{search_num}/{total_searches}] '{keyword}' in {country}...")
                    jobs_df = scrape_jobs(
                        site_name=sites,
                        search_term=keyword,
                        results_wanted=self.RESULTS_PER_KEYWORD,
                        country_indeed=country_indeed,
                    )
                    keyword_count = 0
                    for _, row in jobs_df.iterrows():
                        title = str(row.get('title', '')).strip()
                        company = str(row.get('company', '')).strip()
                        if not title or not company or title == 'nan' or company == 'nan':
                            continue
                        dedup_key = f"{title.lower()}|{company.lower()}"
                        if dedup_key in seen:
                            continue
                        seen.add(dedup_key)

                        # Build URL safely
                        url = str(row.get('job_url', row.get('link', '')))
                        if not url or url == 'nan':
                            continue

                        description = str(row.get('description', ''))
                        if description == 'nan':
                            description = 'No description available'

                        location = str(row.get('location', ''))
                        if location == 'nan':
                            location = 'Unknown'

                        employment_type = self._clean_employment_type(
                            row.get('job_type', 'Unknown')
                        )

                        try:
                            job = JobPosting(
                                title=title,
                                company=company,
                                location=location,
                                description=description if len(description) >= 10 else f"{description} - {title} at {company}",
                                url=url,
                                employment_type=employment_type,
                                source_aggregator="jobspy",
                            )
                            results.append(job)
                            keyword_count += 1
                        except Exception as e:
                            logger.debug(f"Skipping job due to validation: {e}")
                            continue

                    logger.warning(f"  JobSpy [{search_num}/{total_searches}] -> {keyword_count} new jobs (total: {len(results)})")

                except Exception as e:
                    logger.warning(f"  JobSpy [{search_num}/{total_searches}] FAILED '{keyword}' in {country}: {e}")
                    continue

        logger.warning(f"  JobSpy: found {len(results)} unique jobs across {len(filters.keywords)} keywords x {len(filters.countries)} countries")
        return results[:filters.max_results]

    def count(self, filters: AggregatorFilters) -> int:
        # JobSpy doesn't have a count-only endpoint, so we do a limited search
        limited = AggregatorFilters(
            keywords=filters.keywords[:3],  # Sample first 3 keywords
            job_types=filters.job_types,
            countries=filters.countries[:1],  # First country only
            max_results=10
        )
        return len(self.search(limited))
