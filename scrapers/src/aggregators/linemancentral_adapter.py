"""Lineman Central adapter - extracts lineworker job data from Wix state pages.

LinemanCentral.com is a niche board for journeyman/apprentice linemen, cable
splicers, tree trimmers, and groundhands.  The actual job board lives at
jobs.linemancentral.com (behind Cloudflare), but each state page on the Wix
marketing site embeds structured hiring-company data in its SSR warmup JSON.

This adapter:
1. Fetches the sitemap to discover all state job pages.
2. For each state page, extracts the Wix warmup JSON.
3. Parses the ``hiringcompanies`` collection to build JobPosting objects.

No API key is required.
"""

import re
import json
import logging
from datetime import datetime
from typing import Optional
from urllib.parse import unquote

import httpx
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
import warnings

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

# Top states by lineman job volume for prioritised fetching.
PRIORITY_STATES = [
    "texas", "florida", "california", "ohio", "pennsylvania",
    "georgia", "north-carolina", "virginia", "illinois", "louisiana",
    "alabama", "michigan", "new-york", "indiana", "tennessee",
    "missouri", "minnesota", "wisconsin", "oklahoma", "colorado",
]


class LinemanCentralAggregator(BaseAggregator):
    name = "linemancentral"
    SITEMAP_URL = "https://www.linemancentral.com/dynamic-linemanjobs-sitemap.xml"
    BASE_URL = "https://www.linemancentral.com"

    HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    def is_configured(self) -> bool:
        return True

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_state_urls(self) -> list[str]:
        """Fetch the sitemap and return all state job-page URLs."""
        try:
            resp = httpx.get(self.SITEMAP_URL, headers=self.HEADERS,
                             follow_redirects=True, timeout=15)
            resp.raise_for_status()
            # Use html.parser; lxml-xml may not be installed
            soup = BeautifulSoup(resp.text, "html.parser")
            urls = [loc.get_text(strip=True) for loc in soup.find_all("loc")]
            logger.info(f"LinemanCentral: found {len(urls)} state pages in sitemap")
            return urls
        except Exception as e:
            logger.warning(f"LinemanCentral: failed to fetch sitemap: {e}")
            return []

    @staticmethod
    def _sort_urls_by_priority(urls: list[str]) -> list[str]:
        """Sort URLs so high-volume states come first."""
        def priority_key(url: str) -> int:
            slug = url.rstrip("/").rsplit("/", 1)[-1]
            for i, state in enumerate(PRIORITY_STATES):
                if state in slug:
                    return i
            return len(PRIORITY_STATES)
        return sorted(urls, key=priority_key)

    def _extract_warmup_data(self, html: str) -> Optional[dict]:
        """Extract the Wix warmup JSON from a state page."""
        match = re.search(
            r'<script type="application/json" id="wix-warmup-data">(.*?)</script>',
            html, re.DOTALL,
        )
        if not match:
            return None
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            return None

    def _extract_state_from_warmup(self, warmup: dict) -> str:
        """Pull the state name from the lineman-jobs collection."""
        try:
            records = (
                warmup["appsWarmupData"]["dataBinding"]["dataStore"]
                ["recordsByCollectionId"].get("lineman-jobs", {})
            )
            for record in records.values():
                state = record.get("state", "")
                if state:
                    return state
        except (KeyError, TypeError):
            pass
        return "Unknown"

    def _extract_career_center_link(self, warmup: dict) -> str:
        """Get the jobs.linemancentral.com search link for this state."""
        try:
            records = (
                warmup["appsWarmupData"]["dataBinding"]["dataStore"]
                ["recordsByCollectionId"].get("lineman-jobs", {})
            )
            for record in records.values():
                link = record.get("linktocareercenter", "")
                if link:
                    return link
        except (KeyError, TypeError):
            pass
        return ""

    def _extract_companies(self, warmup: dict) -> list[dict]:
        """Extract hiring company records from the warmup data."""
        try:
            records = (
                warmup["appsWarmupData"]["dataBinding"]["dataStore"]
                ["recordsByCollectionId"].get("hiringcompanies", {})
            )
            return list(records.values())
        except (KeyError, TypeError):
            return []

    def _company_to_job(self, company: dict, state: str, keyword_filter: list[str]) -> Optional[dict]:
        """Convert a hiring-company record into a job-like dict.

        Each company record represents one or more open positions at that employer
        in the given state.  We synthesise a job posting from the available fields.

        Keyword filtering is intentionally lenient: every result from this source
        is a lineman/lineworker role, so we always match on energy/utility/lineman
        keywords. The downstream relevance filter handles further quality control.
        """
        title_raw = company.get("title", "").strip()
        if not title_raw:
            return None

        # Build a descriptive job title
        openings = company.get("currentOpenings", "")
        job_title = f"Lineman / Line Worker at {title_raw}"

        # Build description from available text fields
        parts = []
        for field in ("generalAboutText", "journeymanText", "apprenticeshipText",
                      "hiringProcessText", "payAndSalaryText"):
            val = company.get(field, "")
            if val and len(val) > 10:
                parts.append(val)
        description = " ".join(parts) if parts else f"Lineman job openings at {title_raw} in {state}"

        # URL - prefer the company self-URL, fall back to apply link
        url = company.get("selfUrl", "") or company.get("applyNowLink", "")
        if not url:
            return None

        # Salary info
        salary = company.get("payAndSalaryText", "")

        # Location
        location = f"{state}, US"

        return {
            "title": job_title,
            "company": title_raw,
            "location": location,
            "description": description[:2000],
            "url": url,
            "salary": salary[:200] if salary else None,
            "openings": openings,
            "state": state,
        }

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def count(self, filters: AggregatorFilters) -> int:
        """Estimate total jobs across all state pages."""
        urls = self._get_state_urls()
        # Each state page typically has 10-25 hiring companies
        return len(urls) * 15  # rough estimate

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        results: list[JobPosting] = []
        seen: set[str] = set()

        all_urls = self._get_state_urls()
        if not all_urls:
            logger.warning("LinemanCentral: no state URLs found")
            return []

        # Prioritise high-volume states
        all_urls = self._sort_urls_by_priority(all_urls)

        for page_url in all_urls:
            if len(results) >= filters.max_results:
                break

            try:
                resp = httpx.get(page_url, headers=self.HEADERS,
                                 follow_redirects=True, timeout=20)
                if resp.status_code != 200:
                    continue

                warmup = self._extract_warmup_data(resp.text)
                if not warmup:
                    continue

                state = self._extract_state_from_warmup(warmup)
                companies = self._extract_companies(warmup)

                for company in companies:
                    if len(results) >= filters.max_results:
                        break

                    job_data = self._company_to_job(
                        company, state, keyword_filter=filters.keywords,
                    )
                    if not job_data:
                        continue

                    dedup_key = f"{job_data['company'].lower()}|{state.lower()}"
                    if dedup_key in seen:
                        continue
                    seen.add(dedup_key)

                    try:
                        job = JobPosting(
                            title=job_data["title"],
                            company=job_data["company"],
                            location=job_data["location"],
                            description=job_data["description"],
                            url=job_data["url"],
                            salary=job_data.get("salary"),
                            employment_type="Contract/Traveling",
                            source_aggregator="linemancentral",
                        )
                        results.append(job)
                    except Exception as e:
                        logger.debug(f"Skipping LinemanCentral company: {e}")

            except Exception as e:
                logger.warning(f"LinemanCentral: failed to fetch {page_url}: {e}")

        logger.info(f"LinemanCentral: found {len(results)} unique jobs")
        return results[: filters.max_results]
