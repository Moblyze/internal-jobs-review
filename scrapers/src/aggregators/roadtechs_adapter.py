"""
Roadtechs.com scraper adapter.

Roadtechs is a bulletin-board style job site for traveling contract work
in nuclear, power generation, petrochemical, and industrial sectors.
No API key required -- scrapes the public search page.

Job boards available:
  nuke, petro, green, trans, const, hsdod, syard, comp, aero, over, medi, manuf

Search endpoint: /search/search.php
  - search: keyword query (supports "or", "and", "not")
  - area: board code or "all"
  - corp: job type filter ("Contract", "Temp to Direct", "Direct Hire")
  - pglo: pagination offset (20 results per page)
"""

import re
import logging
from datetime import datetime
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from src.models.job import JobPosting
from src.aggregators.base import BaseAggregator, AggregatorFilters

logger = logging.getLogger(__name__)

# Map our energy_trades-style keywords to Roadtechs board codes for targeted searches
BOARD_CODES = {
    "nuke": "Nuclear Power",
    "petro": "Petro-Chem / Fossil / Offshore",
    "green": "Alternative Energy",
    "trans": "Electric Transmission & Distribution",
    "const": "Construction",
    "hsdod": "Homeland Security / DoD / Federal",
    "syard": "Shipyard / Marine",
    "comp": "Computer / Telecom",
    "aero": "Aerospace / Aircraft",
    "over": "Overseas",
    "medi": "Medical / Pharmaceutical",
    "manuf": "Manufacturing",
}

RESULTS_PER_PAGE = 20
BASE_URL = "https://www.roadtechs.com"
SEARCH_URL = f"{BASE_URL}/search/search.php"

# Roadtechs search treats multi-word queries as AND, which is too restrictive.
# For compound keywords like "electrician energy", we extract the core trade term.
# These qualifier words are removed to get broader results on Roadtechs.
QUALIFIER_WORDS = {
    "energy", "utility", "pipeline", "power", "plant", "solar", "wind",
    "nuclear", "offshore", "marine", "industrial", "construction",
    "commercial", "residential", "federal", "government", "travel",
    "traveling", "contract", "temporary",
}


class RoadtechsAggregator(BaseAggregator):
    """Scraper adapter for Roadtechs.com job board."""
    name = "roadtechs"

    def __init__(self):
        self._client = httpx.Client(
            timeout=30,
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            },
        )

    def is_configured(self) -> bool:
        """Roadtechs requires no API key -- always configured."""
        return True

    def _fetch_search_page(self, keyword: str, area: str = "all",
                           corp: str = "Contract", pglo: int = 0) -> str:
        """Fetch a single search results page."""
        params = {
            "search": keyword,
            "area": area,
            "corp": corp,
        }
        if pglo > 0:
            params["pglo"] = pglo

        resp = self._client.get(SEARCH_URL, params=params)
        resp.raise_for_status()
        return resp.text

    def _parse_total_hits(self, soup: BeautifulSoup) -> int:
        """Extract total hit count from 'Results X - Y of Z hits' text."""
        text = soup.get_text()
        match = re.search(r"of\s+(\d[\d,]*)\s+hits?", text)
        if match:
            return int(match.group(1).replace(",", ""))
        return 0

    def _parse_results(self, html: str) -> list[dict]:
        """Parse search results page into raw job dicts.

        HTML structure per result (inside <ol>):
          <li value="N">
            <img src="const.gif" ...>
            <a href="/board/wwwboard/getpost.php?rec_nbr=NNNN">
              [$$$] [Discipline] Title - Company <i>Date</i>
            </a><br>
            Location: <font color="red"><b>City State Country</b></font><br>
            Job Type: <font color="#AA6000"><b>Contract</b></font><br>
            <font size="-1">Description snippet...</font><br>
            <a href="..."><font color="#008800" size="-1">URL</font></a>
          </li><p>
        """
        soup = BeautifulSoup(html, "html.parser")
        jobs = []

        # Find all <li> elements that have a value attribute (numbered results)
        for li in soup.find_all("li", attrs={"value": True}):
            job_data = self._parse_list_item(li)
            if job_data:
                jobs.append(job_data)

        return jobs

    def _parse_list_item(self, li) -> dict | None:
        """Extract job data from a single search result <li> element."""
        try:
            # Find the first getpost link (title link, not the URL display link)
            link = li.find("a", href=re.compile(r"getpost\.php\?rec_nbr=\d+"))
            if not link:
                return None

            href = link.get("href", "")
            full_url = urljoin(BASE_URL, href)

            # Extract record number for dedup
            rec_match = re.search(r"rec_nbr=(\d+)", href)
            rec_nbr = rec_match.group(1) if rec_match else None

            # --- TITLE & COMPANY ---
            # The link text contains: [$$$] [Discipline] Title - Company <i>Date</i>
            # Get link text without the <i> date element
            date_el = link.find("i")
            if date_el:
                date_text = date_el.get_text(strip=True)
                date_el.extract()  # Remove from tree so it doesn't appear in title
            else:
                date_text = ""

            # Build title text by inserting spaces only where needed at tag boundaries.
            # BeautifulSoup's get_text() jams words together at <b> boundaries,
            # but separator=" " adds unwanted spaces (e.g., "Electrician s").
            # Solution: insert thin markers, then clean up.
            raw_title = self._get_clean_text(link)
            # Remove [$$$] prefix
            title_text = re.sub(r"\[\$+\]\s*", "", raw_title).strip()

            if not title_text:
                return None

            # Company is typically after the last " - " in the title text.
            # Sometimes the dash has no trailing space: "Electrician- Company Name"
            # Normalize "- " patterns first, then split.
            company = "Unknown"
            # Normalize variants like "word- company" or "word -company" to "word - company"
            normalized = re.sub(r'\s*-\s+', ' - ', title_text)
            normalized = re.sub(r'\s+-\s*', ' - ', normalized)
            if " - " in normalized:
                parts = normalized.split(" - ")
                # Last segment is usually company
                candidate = parts[-1].strip()
                # Rest is the title
                title = " - ".join(parts[:-1]).strip()
                if candidate and len(candidate) > 1:
                    company = candidate
            else:
                title = title_text

            if not title:
                return None

            # --- LOCATION ---
            # Location is in: <font color="red"><b>City State Country</b></font>
            location = "United States"
            loc_font = li.find("font", attrs={"color": "red"})
            if loc_font:
                loc_text = loc_font.get_text(strip=True)
                if loc_text:
                    # Normalize whitespace
                    location = re.sub(r"\s+", " ", loc_text).strip()

            # --- JOB TYPE ---
            # Job Type in: <font color="#AA6000"><b>Contract</b></font>
            job_type = "contract"
            type_font = li.find("font", attrs={"color": "#AA6000"})
            if type_font:
                jt = type_font.get_text(strip=True)
                if jt:
                    job_type = jt.lower()

            # --- DESCRIPTION ---
            # Description in: <font size="-1"> (first one, not the URL display)
            description = f"{title} - {company} - {location}"
            desc_fonts = li.find_all("font", attrs={"size": "-1"})
            for font in desc_fonts:
                text = self._get_clean_text(font)
                # Skip the URL display font (it contains the getpost path)
                if "getpost.php" in text:
                    continue
                if text and len(text) > 10:
                    description = text
                    break

            # --- POSTED DATE ---
            posted_date = None
            if date_text:
                date_match = re.search(
                    r"(January|February|March|April|May|June|July|August|September|"
                    r"October|November|December)\s+(\d{1,2}),?\s+(\d{4})",
                    date_text, re.IGNORECASE
                )
                if date_match:
                    try:
                        date_str = f"{date_match.group(1)} {date_match.group(2)}, {date_match.group(3)}"
                        posted_date = datetime.strptime(date_str, "%B %d, %Y")
                    except (ValueError, TypeError):
                        pass

            return {
                "title": title,
                "company": company,
                "location": location,
                "description": description,
                "url": full_url,
                "employment_type": job_type,
                "posted_date": posted_date,
                "rec_nbr": rec_nbr,
            }

        except Exception as e:
            logger.debug(f"Failed to parse Roadtechs list item: {e}")
            return None

    def count(self, filters: AggregatorFilters) -> int:
        """Get approximate count of matching jobs."""
        total = 0
        seen_kw = set()
        for keyword in filters.keywords:
            simple = self._simplify_keyword(keyword)
            if simple.lower() in seen_kw:
                continue
            seen_kw.add(simple.lower())
            try:
                html = self._fetch_search_page(simple, area="all", corp="Contract")
                soup = BeautifulSoup(html, "html.parser")
                hits = self._parse_total_hits(soup)
                total += hits
            except Exception as e:
                logger.warning(f"Roadtechs count failed for '{simple}': {e}")
        return total

    @staticmethod
    def _get_clean_text(element) -> str:
        """Extract text from an element, handling <b> tag boundaries cleanly.

        BeautifulSoup's get_text() jams text at tag boundaries:
            '<b>Electrician</b>s' -> 'Electricians' (correct, no separator)
        But with separator=' ':
            '<b>Electrician</b>s' -> 'Electrician s' (wrong, extra space)
        And without separator:
            'Journeyman<b>Electrician</b>s' -> 'JourneymanElectricians' (wrong, missing space)

        This method uses get_text() without separator (preserving suffixes like 's')
        then adds spaces between words that got jammed by looking for lowercase-to-uppercase
        transitions or similar patterns.
        """
        text = element.get_text(strip=True)
        # Fix word-jamming: insert space before uppercase letter preceded by lowercase
        # e.g., "JourneymanElectricians" -> "Journeyman Electricians"
        text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
        # Fix: "word[" -> "word [" (bracket after word)
        text = re.sub(r'(\w)\[', r'\1 [', text)
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def _simplify_keyword(self, keyword: str) -> str:
        """Simplify compound keywords for Roadtechs search.

        Roadtechs search treats multi-word queries as AND, which is too
        restrictive for compound terms like 'electrician energy'. We extract
        the core trade term by removing common qualifier words.
        """
        words = keyword.lower().split()
        core_words = [w for w in words if w not in QUALIFIER_WORDS]
        # If all words were qualifiers, keep the original
        return " ".join(core_words) if core_words else keyword

    def search(self, filters: AggregatorFilters) -> list[JobPosting]:
        """Search Roadtechs for jobs matching filters."""
        results = []
        seen_rec_nbrs = set()
        seen_titles = set()

        # Simplify and deduplicate keywords for Roadtechs
        simplified = []
        seen_kw = set()
        for kw in filters.keywords:
            simple = self._simplify_keyword(kw)
            if simple.lower() not in seen_kw:
                seen_kw.add(simple.lower())
                simplified.append(simple)

        for keyword in simplified:
            if len(results) >= filters.max_results:
                break

            pglo = 0
            pages_fetched = 0
            max_pages = 5  # Safety limit per keyword

            while len(results) < filters.max_results and pages_fetched < max_pages:
                try:
                    html = self._fetch_search_page(
                        keyword, area="all", corp="Contract", pglo=pglo
                    )
                    raw_jobs = self._parse_results(html)

                    if not raw_jobs:
                        break  # No more results

                    for job_data in raw_jobs:
                        if len(results) >= filters.max_results:
                            break

                        # Dedup by record number
                        rec = job_data.get("rec_nbr")
                        if rec and rec in seen_rec_nbrs:
                            continue
                        if rec:
                            seen_rec_nbrs.add(rec)

                        # Dedup by title+company
                        dedup_key = f"{job_data['title'].lower()}|{job_data['company'].lower()}"
                        if dedup_key in seen_titles:
                            continue
                        seen_titles.add(dedup_key)

                        # Skip closed positions
                        if "position closed" in job_data["title"].lower():
                            continue

                        try:
                            job = JobPosting(
                                title=job_data["title"],
                                company=job_data["company"],
                                location=job_data["location"],
                                description=job_data["description"],
                                url=job_data["url"],
                                employment_type=job_data.get("employment_type", "contract"),
                                posted_date=job_data.get("posted_date"),
                                source_aggregator="roadtechs",
                            )
                            results.append(job)
                        except Exception as e:
                            logger.debug(f"Skipping Roadtechs job: {e}")

                    pages_fetched += 1
                    pglo += RESULTS_PER_PAGE

                    # If we got fewer than a full page, no more results
                    if len(raw_jobs) < RESULTS_PER_PAGE:
                        break

                except Exception as e:
                    logger.warning(f"Roadtechs search failed for '{keyword}' page {pages_fetched}: {e}")
                    break

        logger.info(f"Roadtechs: found {len(results)} unique jobs")
        return results[:filters.max_results]
