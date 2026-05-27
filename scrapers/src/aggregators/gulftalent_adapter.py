"""GulfTalent aggregator adapter.

GulfTalent (gulftalent.com) is the largest *structured* job board in the Gulf /
Middle East. It carries strong oil & gas + construction volume, so it is useful
for ENERGY BREADTH. Note: it is a permanent / direct-hire board — contract roles
are a small minority (the rotational Gulf contract supply comes through the
staffing-agency adapters: airswift, nesfircroft, petroplan, oriongroup, ...).

Anti-bot note: GulfTalent sits behind Akamai, which 403s plain HTTP and headless
Chromium. Only a HEADED browser passes, so this adapter launches Playwright with
``headless=False``. In CI it must run under a virtual display (``xvfb-run``).
This is the only headed adapter in the system.

Page structure (category/industry listing pages):
  - Total count banner: ``"233 Jobs found"``
  - Job rows: ``tr.content-visibility-auto`` (one per job)
      title   : ``a.ga-job-impression``  (text; ``data-ga-dimension-three`` = country
                slug, ``data-ga-label`` = job id, ``href`` = /{country}/jobs/{slug}-{id})
      company : ``td.col-sm-21 a[href*='/companies/']`` (text)
      location: ``td.col-sm-6 span[title]``  (e.g. "Doha, Qatar")
      date    : ``td.col-sm-4``  (e.g. "22 May")
  - Pagination: append ``/{n}`` to the path (page 1 is the bare path).
"""

import logging
import re
from datetime import datetime

from bs4 import BeautifulSoup

from src.aggregators.base import BaseAggregator, AggregatorFilters
from src.aggregators.cleanup import sanitize_location
from src.models.job import JobPosting

logger = logging.getLogger(__name__)

BASE_URL = "https://www.gulftalent.com"
RESULTS_PER_PAGE = 25
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Energy / trades-relevant entry points (verified to return 200 listing pages).
# `industry/*` = sector taxonomy, `category/*` = profession taxonomy.
GULFTALENT_PATHS = [
    "jobs/industry/oil-gas",
    "jobs/category/petroleum-engineering",
]

_CONTRACT_RE = re.compile(r"\b(contract|contractor|rotational|rotation)\b", re.IGNORECASE)
_TEMP_RE = re.compile(r"\b(temporary|temp|seasonal)\b", re.IGNORECASE)
_COUNT_RE = re.compile(r"([\d,]+)\s+Jobs?\s+found", re.IGNORECASE)
_JOB_HREF_RE = re.compile(r"^/[a-z][a-z-]+/jobs/[a-z0-9].*[-_]\d{4,}$")


class GulfTalentAggregator(BaseAggregator):
    """Scraper adapter for GulfTalent.com (headed Playwright)."""

    name = "gulftalent"

    def is_configured(self) -> bool:
        """Public website — no API key. Requires a headed browser at runtime."""
        return True

    # ------------------------------------------------------------------
    # Pure parsing helpers (unit-tested against a saved fixture)
    # ------------------------------------------------------------------

    def _parse_total_count(self, html: str) -> int:
        """Read the 'N Jobs found' banner. Returns 0 if absent."""
        m = _COUNT_RE.search(html)
        return int(m.group(1).replace(",", "")) if m else 0

    def _detect_employment_type(self, title: str) -> str | None:
        """Infer contract/temporary from the title (listing cards omit the field)."""
        if not title:
            return None
        if _CONTRACT_RE.search(title):
            return "Contract"
        if _TEMP_RE.search(title):
            return "Temporary"
        return None

    def _parse_posted_date(self, text: str) -> datetime | None:
        """Parse GulfTalent's short dates like '22 May' (assume current year)."""
        text = (text or "").strip()
        if not text:
            return None
        year = datetime.utcnow().year
        for fmt in ("%d %b %Y", "%d %B %Y"):
            try:
                return datetime.strptime(f"{text} {year}", fmt)
            except ValueError:
                continue
        try:
            import dateparser
            return dateparser.parse(text)
        except Exception:
            return None

    def _parse_listings(self, html: str) -> list[JobPosting]:
        """Extract JobPostings from a category/industry listing page."""
        soup = BeautifulSoup(html, "html.parser")
        jobs: list[JobPosting] = []

        for row in soup.select("tr.content-visibility-auto"):
            try:
                link = row.select_one("a.ga-job-impression")
                if not link:
                    continue
                href = link.get("href", "")
                if not _JOB_HREF_RE.match(href):
                    continue

                title = link.get_text(strip=True)
                if not title:
                    continue

                country = (link.get("data-ga-dimension-three") or "").replace("-", " ").title()

                # Company: the /companies/ link inside the title cell (not the logo cell).
                company = "Unknown"
                title_cell = row.select_one("td.col-sm-21") or row
                comp_link = title_cell.select_one("a[href*='/companies/']")
                if comp_link and comp_link.get_text(strip=True):
                    company = comp_link.get_text(strip=True)

                # Location: prefer the span title ("City, Country"), else span text, else country.
                location = ""
                loc_span = row.select_one("td.col-sm-6 span[title]")
                if loc_span and loc_span.get("title"):
                    location = loc_span["title"].strip()
                elif loc_span:
                    location = loc_span.get_text(strip=True)
                if not location:
                    location = country or "Unknown"
                location = sanitize_location(location, company=company)

                date_cell = row.select_one("td.col-sm-4")
                posted_date = self._parse_posted_date(date_cell.get_text(strip=True)) if date_cell else None

                req_id = link.get("data-ga-label") or None
                description = f"{title} at {company} — {location}. Listed on GulfTalent."

                jobs.append(JobPosting(
                    title=title,
                    company=company,
                    location=location,
                    description=description,
                    url=BASE_URL + href,
                    posted_date=posted_date,
                    requisition_id=req_id,
                    employment_type=self._detect_employment_type(title),
                    source_aggregator="gulftalent",
                ))
            except Exception as e:
                logger.debug(f"Skipping GulfTalent row: {e}")

        return jobs

    # ------------------------------------------------------------------
    # I/O shell (headed Playwright)
    # ------------------------------------------------------------------

    def _page_url(self, path: str, page: int) -> str:
        path = path.strip("/")
        return f"{BASE_URL}/{path}" if page <= 1 else f"{BASE_URL}/{path}/{page}"

    def _fetch_all(self, urls: list[str]) -> dict[str, str]:
        """Fetch many URLs in one headed browser session. Returns {url: html}."""
        from playwright.sync_api import sync_playwright

        out: dict[str, str] = {}
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=False,
                args=["--disable-blink-features=AutomationControlled"],
            )
            try:
                ctx = browser.new_context(
                    user_agent=USER_AGENT, locale="en-US",
                    viewport={"width": 1366, "height": 900},
                )
                page = ctx.new_page()
                for url in urls:
                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=60000)
                        page.wait_for_timeout(2500)
                        out[url] = page.content()
                    except Exception as e:
                        logger.warning(f"GulfTalent fetch failed for {url}: {e}")
            finally:
                browser.close()
        return out

    def count(self, filters: AggregatorFilters) -> int:
        """Total energy jobs across configured paths (page-1 'Jobs found' banners)."""
        urls = [self._page_url(path, 1) for path in GULFTALENT_PATHS]
        htmls = self._fetch_all(urls)
        return sum(self._parse_total_count(h) for h in htmls.values())

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Scrape configured energy paths, paginating up to max_results.

        Dedups by URL. Because the configured paths are already energy-targeted,
        title-level keyword filtering is intentionally NOT applied here — the
        shared relevance + dedup pipeline in aggregator_cli does the quality
        filtering (include/exclude) on top of this broad category scrape.
        """
        max_results = filters.max_results or 50

        # Build the page URLs we are willing to fetch (cap pages per path).
        urls: list[str] = []
        max_pages = max(1, min(8, (max_results // RESULTS_PER_PAGE) + 1))
        for path in GULFTALENT_PATHS:
            for page in range(1, max_pages + 1):
                urls.append(self._page_url(path, page))

        htmls = self._fetch_all(urls)

        results: list[JobPosting] = []
        seen: set[str] = set()
        for url in urls:
            html = htmls.get(url)
            if not html:
                continue
            for job in self._parse_listings(html):
                key = str(job.url)
                if key in seen:
                    continue
                seen.add(key)
                results.append(job)
                if len(results) >= max_results:
                    logger.info(f"GulfTalent: found {len(results)} unique jobs")
                    return results

        logger.info(f"GulfTalent: found {len(results)} unique jobs")
        return results
