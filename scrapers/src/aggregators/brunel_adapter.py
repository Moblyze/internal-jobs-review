"""
Brunel adapter - queries Brunel's internal publications search API.

Brunel (brunel.net) is a global staffing agency with strong presence in
conventional energy (oil & gas, offshore, subsea), renewable energy, mining,
and life sciences. A high-priority source for CONTRACT roles in UK/North Sea,
Norway, Middle East, Netherlands, and APAC.

The site is a Next.js / Sitecore headless SPA served via Netlify. The job
search is powered by a first-party REST API at api.brunel.net, which is
proxied through the same-origin at /api/search/PublicationsSearch/. The
subscription key (public, embedded in the JS bundle) is required.

Discovered via JS bundle analysis of:
  https://us.brunel.net/_next/static/chunks/pages/_app-*.js

API:
  POST https://www.brunel.net/api/search/PublicationsSearch/Get
  Header: Ocp-Apim-Subscription-Key: eb0dfbddc7564004b2da4d064f2c54e2
  Body (JSON):
    {
      "page": 1,           -- 1-indexed
      "pageSize": 48,      -- max observed: 48
      "language": "en-US",
      "searchText": "offshore",
      "countryPreset": ["USA"],  -- optional; omit for global
      "sortOrder": "0"     -- 0 = relevance
    }
  Response:
    { "totalCount": N, "publications": [...], "facets": {...} }

  Each publication has:
    publicationId, title, city, countryName, country (ISO-3), region,
    introduction (HTML), organisation (HTML, sometimes the end-client),
    branche, areaOfExpertise, businessLine, startDate, endDate, workLevel

Job detail URL:
  https://www.brunel.net/en/jobs/{title-slugified}-{publicationId.lower()}
  (slug: lowercase, spaces and special chars replaced with hyphens)

No API key required from the user — subscription key is public/static.
"""

import re
import time
import json
import logging
from datetime import datetime

import httpx
from bs4 import BeautifulSoup

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

BASE_URL = "https://www.brunel.net"

# Proxy endpoint discovered in the Next.js bundle
SEARCH_API_URL = f"{BASE_URL}/api/search/PublicationsSearch/Get"

# Public subscription key embedded in the Next.js bundle
OCP_APIM_KEY = "eb0dfbddc7564004b2da4d064f2c54e2"

# Max page size accepted by the API
PAGE_SIZE = 48

# Polite delay between requests (seconds)
REQUEST_DELAY = 1.5

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Content-Type": "application/json",
    "Ocp-Apim-Subscription-Key": OCP_APIM_KEY,
    "Referer": f"{BASE_URL}/en-us/jobs",
    "Origin": BASE_URL,
}

# Map filters.countries values to Brunel countryPreset ISO-3 codes
COUNTRY_MAP = {
    "us": "USA",
    "usa": "USA",
    "gb": "GBR",
    "uk": "GBR",
    "nl": "NLD",
    "no": "NOR",
    "au": "AUS",
    "sg": "SGP",
    "qa": "QAT",
    "ae": "ARE",
}


def _slugify(text: str) -> str:
    """Convert job title to URL slug (mirrors Brunel's toSlug() JS method)."""
    text = text.lower().strip()
    # Replace non-alphanumeric chars with hyphens
    text = re.sub(r"[^a-z0-9]+", "-", text)
    # Remove leading/trailing hyphens
    text = text.strip("-")
    return text


def _strip_html(html: str) -> str:
    """Strip HTML tags and collapse whitespace."""
    if not html:
        return ""
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _build_job_url(title: str, publication_id: str) -> str:
    """Build canonical job detail URL from title and publicationId."""
    slug = _slugify(title)
    pub_lower = publication_id.lower()
    return f"{BASE_URL}/en/jobs/{slug}-{pub_lower}"


class BrunelAggregator(BaseAggregator):
    """Adapter for Brunel (brunel.net) using their internal publications search API.

    Queries the first-party REST API discovered via JS bundle analysis.
    Supports keyword search globally or filtered to specific countries.
    Returns CONTRACT energy/engineering jobs with title, location, and URL.

    The 'organisation' field occasionally names the end-client/operator
    (visible in the introduction HTML text when present).
    """

    name = "brunel"

    def __init__(self):
        self._client: httpx.Client | None = None

    def is_configured(self) -> bool:
        """Always configured — subscription key is bundled."""
        return True

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                timeout=30,
                follow_redirects=True,
                headers=HEADERS,
            )
        return self._client

    def _search_api(
        self,
        search_text: str,
        page: int = 1,
        page_size: int = PAGE_SIZE,
        country_preset: list[str] | None = None,
    ) -> dict:
        """Call the Brunel publications search API.

        Returns the full response dict with 'totalCount' and 'publications'.
        Returns empty dict on failure.
        """
        client = self._get_client()
        payload: dict = {
            "page": page,
            "pageSize": page_size,
            "language": "en-US",
            "sortOrder": "0",
        }
        if search_text:
            payload["searchText"] = search_text
        if country_preset:
            payload["countryPreset"] = country_preset

        time.sleep(REQUEST_DELAY)
        try:
            resp = client.post(SEARCH_API_URL, json=payload)
            resp.raise_for_status()
            if not resp.content:
                logger.debug(f"Brunel API: empty response for '{search_text}'")
                return {}
            return resp.json()
        except (httpx.HTTPStatusError, json.JSONDecodeError, Exception) as exc:
            logger.warning(f"Brunel API error for '{search_text}': {exc}")
            return {}

    def _parse_date(self, date_str: str | None) -> datetime | None:
        """Parse ISO date strings returned by the API."""
        if not date_str:
            return None
        for fmt in (
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d",
        ):
            try:
                return datetime.strptime(date_str[:19], fmt[:len(fmt)])
            except (ValueError, TypeError):
                continue
        return None

    def _publication_to_job(self, pub: dict) -> JobPosting | None:
        """Convert a publication dict to a JobPosting. Returns None if invalid."""
        title = (pub.get("title") or "").strip()
        if not title:
            return None

        pub_id = pub.get("publicationId") or ""
        url = _build_job_url(title, pub_id) if pub_id else f"{BASE_URL}/en/jobs"

        # Build location: "City, CountryName" or "City, Region, CountryName"
        city = (pub.get("city") or "").strip()
        region = (pub.get("region") or "").strip()
        country_name = (pub.get("countryName") or "").strip()

        location_parts = [p for p in [city, region, country_name] if p]
        if location_parts:
            location = ", ".join(location_parts)
        else:
            location = "Global"

        # Description: try multiple fields in priority order
        intro = _strip_html(pub.get("introduction") or "")
        body = _strip_html(pub.get("description") or "")
        summary = _strip_html(pub.get("vacancySummary") or "")
        seo_desc = (pub.get("seoMetaDescription") or "").strip()
        org_text = _strip_html(pub.get("organisation") or "")

        if intro and len(intro) >= 30:
            description = intro[:800]
        elif body and len(body) >= 30:
            description = body[:800]
        elif summary and len(summary) >= 30:
            description = summary[:800]
        elif seo_desc and len(seo_desc) >= 30:
            description = seo_desc[:800]
        elif org_text and len(org_text) >= 30:
            description = org_text[:800]
        else:
            description = f"{title} — Brunel — {location}"

        # End-client: Brunel typically doesn't disclose; org field sometimes has it
        company = "Brunel"

        try:
            return JobPosting(
                title=title,
                company=company,
                location=location,
                description=description,
                url=url,
                posted_date=self._parse_date(pub.get("startDate")),
                employment_type="Contract",
                requisition_id=pub_id or None,
                source_aggregator="brunel",
            )
        except Exception as exc:
            logger.debug(f"Brunel: skipping publication '{title}': {exc}")
            return None

    def count(self, filters: AggregatorFilters) -> int:
        """Return approximate count of matching jobs (first keyword, first page)."""
        keyword = filters.keywords[0] if filters.keywords else ""
        country_preset = self._build_country_preset(filters)
        data = self._search_api(keyword, page=1, page_size=1,
                                country_preset=country_preset)
        return data.get("totalCount", 0)

    def _build_country_preset(self, filters: AggregatorFilters) -> list[str] | None:
        """Map filter countries to Brunel countryPreset codes. None = global."""
        if not filters.countries:
            return None
        codes = []
        for c in filters.countries:
            code = COUNTRY_MAP.get(c.lower())
            if code:
                codes.append(code)
        return codes if codes else None

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search Brunel for energy/engineering contract jobs.

        Queries the publications search API for each keyword. Global search
        (no country filter) is used when filters.countries is not set or
        contains unrecognised country codes, to maximise coverage of Brunel's
        strong non-US markets (UK/North Sea, Norway, Middle East, APAC).
        """
        results: list[JobPosting] = []
        seen_ids: set[str] = set()

        country_preset = self._build_country_preset(filters)

        for keyword in filters.keywords:
            if len(results) >= filters.max_results:
                break

            logger.info(
                f"Brunel: searching '{keyword}' "
                f"(country={country_preset or 'global'})"
            )

            page = 1
            while len(results) < filters.max_results:
                data = self._search_api(
                    search_text=keyword,
                    page=page,
                    page_size=PAGE_SIZE,
                    country_preset=country_preset,
                )
                if not data:
                    break

                total = data.get("totalCount", 0)
                publications = data.get("publications") or []

                if not publications:
                    break

                for pub in publications:
                    if len(results) >= filters.max_results:
                        break

                    pub_id = pub.get("publicationId") or ""
                    dedup_key = pub_id or f"{pub.get('title')}|{pub.get('city')}"
                    if dedup_key in seen_ids:
                        continue
                    seen_ids.add(dedup_key)

                    job = self._publication_to_job(pub)
                    if job:
                        results.append(job)

                # Determine if more pages exist
                fetched_so_far = (page - 1) * PAGE_SIZE + len(publications)
                if fetched_so_far >= total or len(publications) < PAGE_SIZE:
                    break

                page += 1

        logger.info(f"Brunel: found {len(results)} jobs total")
        return results[: filters.max_results]
