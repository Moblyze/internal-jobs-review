"""IQrewing (iqrewing.com) seafarer vacancy board scraper.

IQrewing ("IQREW Management", Saint Petersburg) is a crewing agency. CrewBase
lists it as "IQrewing" (248 active rows on Oct 27, 2026); its own board listed 121
sea vacancies the same day. Built for the CrewBase replacement.

The board is plain server-rendered HTML, no browser needed:

- Listing, `/eng/jobs?page=N` (10 per page): each vacancy is an
  `<a href=".../eng/job/<id>" data-category="sea">` card whose text runs
  rank, vessel type, "DWT:", n, "Engine:", make, "HP:", n, "Joining date:",
  dd-mm-yyyy, contract length. The category counts sit above the list
  ("At sea (121)", "Ashore (0)", "Oil and gas (0)").
- Detail, `/eng/job/<id>`: the same facts plus a free-text block under a
  "Description" heading (often the monthly wage).

The vacancy is aboard a ship, so the location is "Worldwide" (CrewBase uses the
same value for most IQrewing rows). The manager's name, email and phone number on
each page are personal data and are NOT captured: lines that are only a phone
number are dropped from the description.

robots.txt (verified Oct 27, 2026): `Disallow:` (nothing disallowed). There is no
sitemap.

Config:
    platform: iqrewing
    base_url: "https://iqrewing.com/eng/jobs"
"""

import asyncio
import re
from typing import Callable, Optional

import httpx
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper
from src.utils.salary import extract_salary

logger = structlog.get_logger()

REQUEST_TIMEOUT = 30.0
USER_AGENT = 'Mozilla/5.0 (compatible; MoblyzeJobScraper/1.0; +https://moblyze.me)'
MAX_PAGES = 60  # 13 on Oct 27, 2026
LOCATION = 'Worldwide'

_FACT_LABELS = ('DWT:', 'Engine:', 'HP:', 'Joining date:')
_PHONE_LINE_RE = re.compile(r'^[+\d][\d\s()+-]{6,}\d(\s+\w+)?$')


def parse_card_text(parts: list[str]) -> dict:
    """Map a card's text pieces to fields.

    ['Motorman', 'Container (More 2000TEU)', 'DWT:', '22308', 'Engine:',
     'MAN-BW (2str)', 'HP:', '22771', 'Joining date:', '20-06-2026', '6 months']
    """
    parts = [p.strip() for p in parts if p and p.strip()]
    out = {'title': parts[0] if parts else '', 'vessel': '', 'facts': {}, 'duration': ''}
    i = 1
    if i < len(parts) and parts[i] not in _FACT_LABELS:
        out['vessel'] = parts[i]
        i += 1
    while i < len(parts):
        if parts[i] in _FACT_LABELS and i + 1 < len(parts):
            out['facts'][parts[i].rstrip(':')] = parts[i + 1]
            i += 2
        else:
            if re.search(r'\b(month|week|day)s?\b', parts[i], re.IGNORECASE):
                out['duration'] = parts[i]
            i += 1
    return out


def parse_listing(html: str) -> list[dict]:
    """Vacancy cards on one listing page."""
    soup = BeautifulSoup(html, 'html.parser')
    cards = []
    seen = set()
    for a in soup.select('a[href*="/job/"]'):
        href = a.get('href') or ''
        m = re.search(r'/job/(\d+)\b', href)
        if not m or m.group(1) in seen:
            continue
        seen.add(m.group(1))
        card = parse_card_text(list(a.stripped_strings))
        if not card['title']:
            continue
        card.update({'url': href, 'job_id': m.group(1), 'category': a.get('data-category') or ''})
        cards.append(card)
    return cards


def listed_total(html: str) -> Optional[int]:
    """Sum of the category counts ("At sea (121)", "Ashore (0)", ...)."""
    counts = re.findall(r'(?:At sea|Ashore|Oil and gas)\s*\((\d+)\)', html)
    return sum(int(c) for c in counts) if counts else None


def parse_detail_description(html: str) -> str:
    """The free-text block under the "Description" heading, minus phone-only lines."""
    soup = BeautifulSoup(html, 'html.parser')
    label = soup.find(lambda t: t.name in ('div', 'h2', 'h3') and t.get_text(strip=True) == 'Description')
    if not label:
        return ''
    body = label.find_next_sibling('p')
    if not body:
        return ''
    lines = [ln.strip() for ln in body.get_text('\n', strip=True).split('\n')]
    lines = [ln for ln in lines if ln and not _PHONE_LINE_RE.match(ln)]
    return '\n'.join(lines).strip()


def build_description(card: dict, body: str) -> str:
    """Vessel facts first (the board's own header), then the free text."""
    facts = []
    if card.get('vessel'):
        facts.append(f"Vessel type: {card['vessel']}")
    for key in ('DWT', 'Engine', 'HP', 'Joining date'):
        if card['facts'].get(key):
            facts.append(f"{key}: {card['facts'][key]}")
    if card.get('duration'):
        facts.append(f"Contract length: {card['duration']}")
    return '\n'.join(facts + ([body] if body else [])).strip()


class IQrewingScraper(BaseScraper):
    """Listing + detail scraper for iqrewing.com."""

    def __init__(self, config: dict):
        super().__init__(config)
        self.base_url = config.get('base_url', 'https://iqrewing.com/eng/jobs').rstrip('/')
        self.max_new_details = config.get('max_new_details_per_run')
        self._known_url_checker: Optional[Callable[[str], bool]] = None

    def set_known_url_checker(self, checker: Callable[[str], bool]) -> None:
        """Known vacancies skip the detail request; the lifecycle only needs the URL."""
        self._known_url_checker = checker

    def _is_known(self, url: str) -> bool:
        return bool(self._known_url_checker and self._known_url_checker(url))

    async def extract_job_listings(self, page: Page) -> list[dict]:
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        return {}

    async def _get(self, client: httpx.AsyncClient, url: str) -> Optional[str]:
        try:
            resp = await client.get(url)
        except httpx.HTTPError as exc:
            self.logger.warning('iqrewing_request_failed', url=url, error=str(exc))
            return None
        if resp.status_code != 200:
            self.logger.warning('iqrewing_non_200', url=url, status=resp.status_code)
            return None
        return resp.text

    async def fetch_listing(self, client: httpx.AsyncClient) -> list[dict]:
        cards: dict[str, dict] = {}
        total = None
        page = 1
        while page <= MAX_PAGES:
            if page > 1:
                await asyncio.sleep(self.rate_limit_delay)
            html = await self._get(client, self.base_url if page == 1 else f'{self.base_url}?page={page}')
            if html is None:
                break
            if total is None:
                total = listed_total(html)
            new = 0
            for card in parse_listing(html):
                if card['job_id'] not in cards:
                    cards[card['job_id']] = card
                    new += 1
            if new == 0 or (total is not None and len(cards) >= total):
                break
            page += 1
        self.logger.info('iqrewing_listing', pages=page, listed_total=total, found=len(cards))
        return list(cards.values())

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        jobs: list[JobPosting] = []
        skipped_known = new_details = deferred = 0
        async with httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT, headers={'User-Agent': USER_AGENT}, follow_redirects=True
        ) as client:
            cards = await self.fetch_listing(client)
            if max_jobs:
                cards = cards[:max_jobs]
            for card in cards:
                if self._is_known(card['url']):
                    skipped_known += 1
                    description = f"{card['title']} at {self.company_name} (listing only; detail already on file)"
                else:
                    if self.max_new_details and new_details >= self.max_new_details:
                        deferred += 1
                        continue
                    new_details += 1
                    await asyncio.sleep(self.rate_limit_delay)
                    html = await self._get(client, card['url'])
                    description = build_description(card, parse_detail_description(html) if html else '')
                job_data = {
                    'title': card['title'],
                    'company': self.company_name,
                    'location': LOCATION,
                    'description': description,
                    'url': card['url'],
                    'posted_date': None,  # the board shows a joining date, not a posted date
                    'requisition_id': card['job_id'],
                    'employment_type': 'Contractor',
                    'salary': extract_salary(description),
                }
                try:
                    jobs.append(JobPosting(**self._enrich_with_certifications(job_data)))
                except ValidationError as exc:
                    self.logger.warning('iqrewing_job_invalid', title=card['title'][:60], error=str(exc))
        self.logger.info('extraction_complete', company=self.company_name, total_jobs=len(jobs),
                         listing_only=skipped_known, new_details=new_details, deferred=deferred)
        return jobs
