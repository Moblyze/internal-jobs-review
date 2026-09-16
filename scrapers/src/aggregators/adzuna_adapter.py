import os
import re
import json
import httpx
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Optional
from bs4 import BeautifulSoup
from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

# Adzuna's search API returns a *snippet*, not the full description: it hard-caps
# the `description` field at 500 characters and appends a horizontal-ellipsis.
# That is an API-side cap, not ours -- there is no truncation in this repo. It
# left 966 active rows sitting at exactly 500 chars, all of which the public jobs
# site rejects because it requires 600+ characters. The full text is available in
# the schema.org JobPosting JSON-LD on the Adzuna details page (redirect_url), so
# we re-fetch it for anything that comes back looking truncated.
ADZUNA_SNIPPET_LEN = 500
DETAIL_FETCH_WORKERS = 4
DETAIL_FETCH_TIMEOUT = 20.0
# Google Sheets caps a cell at 50,000 chars; stay well clear. Real descriptions
# do not come near this, so it is a guard rail rather than a truncation policy.
DESCRIPTION_MAX_LEN = 20000
DETAIL_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)


def _looks_truncated(description: str) -> bool:
    """True if a description looks like an Adzuna snippet rather than full text.

    Adzuna ends its snippets with a horizontal ellipsis (U+2026). The length
    check is a belt-and-braces fallback in case the ellipsis ever changes.
    """
    if not description:
        return False
    return description.endswith("…") or len(description) >= ADZUNA_SNIPPET_LEN


def _build_salary(item: dict) -> Optional[str]:
    """The employer's stated pay, or None when Adzuna is only guessing.

    ADZUNA PREDICTS SALARIES, AND SAYS SO (verified 2026-09-16).
    ---------------------------------------------------------
    `salary_is_predicted` is "1" when the figure is Adzuna's own model output
    rather than anything the employer published. Their details page renders
    exactly that: "$81,680 per year - estimated". We were ingesting those as if
    the employer had stated them: 844 of the 969 Adzuna rows carrying a salary
    had salary_min == salary_max, the shape of a point estimate.

    That matters beyond tidiness. This value reaches a public job page and, for
    a released trade, the JobPosting `baseSalary` in the structured data. An
    estimate presented as the job's pay is wrong on the page and a
    structured-data policy problem in the markup, so a predicted salary is
    dropped rather than published.

    The period is stated explicitly because the old string had none at all.
    Adzuna returns these annualized, which is what their own page shows.
    """
    if str(item.get("salary_is_predicted", "")).strip() in ("1", "true", "True"):
        return None

    low, high = item.get("salary_min"), item.get("salary_max")
    if low and high:
        if float(low) == float(high):
            return f"${float(low):,.0f} per year"
        return f"${float(low):,.0f} - ${float(high):,.0f} per year"
    if low:
        return f"${float(low):,.0f}+ per year"
    return None


def detail_url(url: str, app_id: str = "") -> str:
    """Normalize an Adzuna job URL to the details page that serves JSON-LD.

    Two traps, both verified against live pages 2026-09-16:

    1. Adzuna hands back two URL shapes. `/details/<id>` renders the job page;
       `/land/ad/<id>?se=<token>` is a click-through wrapper that 403s outside a
       browser session. 444 of the 951 truncated rows in the sheet are the
       `/land/ad` shape, so without this rewrite half the backfill fails.
    2. `/details/<id>` with no query string also 403s. The same id WITH the API
       attribution params returns 200 (or a clean 410 for an expired posting).
       So a 403 here is a URL-shape problem, not a dead job -- do not read it as
       evidence the posting is gone.
    """
    base = url.split("?", 1)[0].split("#", 1)[0]
    base = re.sub(r"/land/ad/(\d+)", r"/details/\1", base)
    source = app_id or os.getenv("ADZUNA_APP_ID", "") or "api"
    return f"{base}?utm_medium=api&utm_source={source}"


def _extract_jsonld_description(html: str) -> str | None:
    """Pull the full description out of a schema.org JobPosting JSON-LD block.

    Follows the same pattern as the EnergyJobline adapter's detail parsing.
    """
    soup = BeautifulSoup(html, "html.parser")
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        candidates = data if isinstance(data, list) else [data]
        for entry in candidates:
            if not isinstance(entry, dict):
                continue
            if entry.get("@type") != "JobPosting":
                continue
            desc_html = entry.get("description") or ""
            if not desc_html:
                continue
            text = BeautifulSoup(desc_html, "html.parser").get_text(
                separator="\n", strip=True
            )
            if text:
                return text
    return None


class AdzunaAggregator(BaseAggregator):
    name = "adzuna"
    BASE_URL = "https://api.adzuna.com/v1/api/jobs"

    def __init__(self):
        self.app_id = os.getenv('ADZUNA_APP_ID', '')
        self.app_key = os.getenv('ADZUNA_APP_KEY', '')
        # Escape hatch: set ADZUNA_FETCH_FULL_DESCRIPTIONS=0 to fall back to the
        # 500-char API snippets (e.g. if Adzuna ever starts blocking the fetch).
        self.fetch_full_descriptions = os.getenv(
            'ADZUNA_FETCH_FULL_DESCRIPTIONS', '1'
        ).strip().lower() not in ('0', 'false', 'no')

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

    def _fetch_full_description(self, client: httpx.Client, url: str) -> str | None:
        """Fetch a job's full description from its Adzuna details page.

        Returns None on any failure (including HTTP 410, which Adzuna serves for
        jobs that have since expired) so the caller keeps the snippet.
        """
        try:
            resp = client.get(detail_url(url, self.app_id))
        except httpx.HTTPError as exc:
            logger.debug(f"Adzuna detail fetch failed for {url}: {exc}")
            return None
        if resp.status_code != 200:
            logger.debug(f"Adzuna detail fetch {resp.status_code} for {url}")
            return None
        try:
            return _extract_jsonld_description(resp.text)
        except Exception as exc:  # defensive: never let parsing kill a scrape
            logger.debug(f"Adzuna detail parse failed for {url}: {exc}")
            return None

    def _enrich_descriptions(self, jobs: list[JobPosting]) -> None:
        """Replace truncated Adzuna snippets with the full description, in place.

        Only jobs whose description still looks like a snippet are fetched, and
        only an improvement is kept -- a shorter or empty result is discarded.
        """
        targets = [j for j in jobs if _looks_truncated(j.description)]
        if not targets:
            return

        upgraded = 0
        headers = {"User-Agent": DETAIL_USER_AGENT}
        with httpx.Client(
            follow_redirects=True, timeout=DETAIL_FETCH_TIMEOUT, headers=headers
        ) as client:
            with ThreadPoolExecutor(max_workers=DETAIL_FETCH_WORKERS) as pool:
                futures = {
                    pool.submit(self._fetch_full_description, client, str(job.url)): job
                    for job in targets
                }
                for future in as_completed(futures):
                    job = futures[future]
                    full = future.result()
                    if full and len(full) > len(job.description):
                        job.description = full[:DESCRIPTION_MAX_LEN]
                        upgraded += 1

        logger.info(
            f"Adzuna: recovered full descriptions for {upgraded}/{len(targets)} "
            f"truncated jobs"
        )

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

                        salary = _build_salary(item)

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

        results = results[:filters.max_results]

        if self.fetch_full_descriptions:
            self._enrich_descriptions(results)

        logger.info(f"Adzuna: found {len(results)} unique jobs")
        return results
