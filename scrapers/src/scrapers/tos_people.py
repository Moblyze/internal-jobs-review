"""TOS (jobs.tospeople.com) job board scraper.

TOS is a Dutch crew and workforce agency (offshore, maritime, dredging, towage).
CrewBase lists it as "TOS Recruitment" (464 active rows on Oct 27, 2026); its own
board listed 351 postings the same day. Built for the CrewBase replacement.

The board is a Next.js app with no public JSON API and no sitemap, but every page
is server-rendered and carries its data in the React Server Components payload
(`self.__next_f.push([1, "..."])` script chunks):

- Listing, `/en?page=N` (8 per page, "Page 1 of 44"): one object per posting,
      {"id": "<uuid>", "title": "...", "summary": "...", "shortId": "10688",
       "languagesIso6393": "eng", "state": "JOB_POSTING_STATE_OPEN",
       "createdAt": "2026-10-19T07:38:54Z",
       "slot1FilterValue": ["<uuid>"],   # Location
       "slot2FilterValue": ["<uuid>"],   # Workfield
       "slot3FilterValue": [...], ...}
  plus the filter definitions that name those value ids:
      {"filterName": "Location", "filterSlot": ..., "values":
          [{"valueId": "<uuid>", "stringValue": "Southeast Asia"}, ...]}
  The `assignedMembers` (recruiter names and emails) are personal data and are
  deliberately NOT captured.
- Detail, `/en/job-posting/<shortId>/<slug>`: the body is a ProseMirror document,
  `"content": {"type": "doc", "content": [...]}`, flattened here to text. The
  trailing "CONTACT" section is dropped.

robots.txt (verified Oct 27, 2026): `Allow: /`. A posting that no longer exists
answers HTTP 500 (not 404), so a 500 on a detail page is skipped, never treated as
proof the job is gone.

Config:
    platform: tos_people
    base_url: "https://jobs.tospeople.com/en"
    exclude_workfields: ["Port & Logistics"]   # optional
"""

import asyncio
import json
import re
from datetime import datetime
from typing import Callable, Optional

import httpx
import structlog
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper
from src.utils.salary import extract_salary

logger = structlog.get_logger()

REQUEST_TIMEOUT = 30.0
USER_AGENT = 'Mozilla/5.0 (compatible; MoblyzeJobScraper/1.0; +https://moblyze.me)'
MAX_PAGES = 120  # 44 on Oct 27, 2026; a guard against a pagination loop

_PUSH_RE = re.compile(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', re.S)
_DECODER = json.JSONDecoder()


def rsc_payload(html: str) -> str:
    """The page's React Server Components stream, as one decoded string."""
    parts = []
    for chunk in _PUSH_RE.findall(html):
        try:
            parts.append(json.loads(f'"{chunk}"'))
        except ValueError:
            continue
    return ''.join(parts)


def _objects_starting_with(payload: str, prefix: str) -> list[dict]:
    """Every JSON object in the payload whose text starts with `prefix`."""
    found = []
    for m in re.finditer(re.escape(prefix), payload):
        try:
            obj, _ = _DECODER.raw_decode(payload, m.start())
        except ValueError:
            continue
        if isinstance(obj, dict):
            found.append(obj)
    return found


def parse_filters(payload: str) -> dict[str, dict[str, str]]:
    """{filterName: {valueId: label}} from the board's filter definitions."""
    filters: dict[str, dict[str, str]] = {}
    for obj in _objects_starting_with(payload, '{"filterName":'):
        name = str(obj.get('filterName') or '').strip()
        values = {
            str(v.get('valueId')): str(v.get('stringValue') or '').strip()
            for v in obj.get('values') or []
            if v.get('valueId')
        }
        if name:
            filters.setdefault(name, {}).update(values)
    return filters


def parse_postings(payload: str) -> list[dict]:
    """The posting objects on a listing page, de-duplicated by shortId."""
    postings: dict[str, dict] = {}
    for m in re.finditer(r'\{"id":"[0-9a-f-]{36}","title":', payload):
        try:
            obj, _ = _DECODER.raw_decode(payload, m.start())
        except ValueError:
            continue
        short_id = str(obj.get('shortId') or '').strip()
        if short_id and obj.get('title'):
            postings.setdefault(short_id, obj)
    return list(postings.values())


def page_count(payload: str) -> Optional[int]:
    """Total listing pages, from the payload's `"totalPages": "$n44"`."""
    m = re.search(r'"totalPages":"?\$?n?(\d+)', payload)
    return int(m.group(1)) if m else None


def posting_links(html: str) -> dict[str, str]:
    """{shortId: absolute-path} for the posting links on a page."""
    links = {}
    for path, short_id in re.findall(r'href="(/[a-z]{2}/job-posting/(\d+)/[^"/]+)"', html):
        links.setdefault(short_id, path)
    return links


def _filter_label(posting: dict, slot: int, labels: dict[str, str]) -> list[str]:
    return [labels[v] for v in posting.get(f'slot{slot}FilterValue') or [] if v in labels]


def _doc_text(node: dict) -> list[str]:
    """Flatten a ProseMirror node into paragraphs/lines."""
    kind = node.get('type')
    if kind == 'text':
        return [node.get('text') or '']
    if kind == 'hardBreak':
        return ['\n']
    pieces: list[str] = []
    for child in node.get('content') or []:
        pieces.extend(_doc_text(child))
    text = ''.join(pieces)
    if kind == 'listItem':
        return [f"- {text.strip()}\n"]
    if kind in ('paragraph', 'heading'):
        return [text.strip() + '\n'] if text.strip() else []
    return [text]


def parse_detail_description(payload: str) -> str:
    """The posting body from a detail page, without the trailing CONTACT block."""
    docs = _objects_starting_with(payload, '{"type":"doc"')
    if not docs:
        return ''
    # The posting body is the longest doc on the page.
    doc = max(docs, key=lambda d: len(json.dumps(d)))
    blocks = doc.get('content') or []
    kept = []
    for block in blocks:
        if block.get('type') == 'heading':
            heading = ''.join(_doc_text(block)).strip().lower()
            if heading in ('contact', 'contact us', 'contact person'):
                break
        kept.append(block)
    text = ''.join(''.join(_doc_text(b)) for b in kept)
    text = re.sub(r'[ \t]+\n', '\n', text)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def _posted(posting: dict) -> Optional[datetime]:
    raw = posting.get('createdAt')
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
    except ValueError:
        return None


class TosPeopleScraper(BaseScraper):
    """Listing + detail scraper for jobs.tospeople.com."""

    def __init__(self, config: dict):
        super().__init__(config)
        self.base_url = config.get('base_url', 'https://jobs.tospeople.com/en').rstrip('/')
        root = re.match(r'https?://[^/]+', self.base_url)
        self.origin = root.group(0) if root else 'https://jobs.tospeople.com'
        self.exclude_workfields = {str(w).lower() for w in config.get('exclude_workfields') or []}
        self.max_new_details = config.get('max_new_details_per_run')
        self._known_url_checker: Optional[Callable[[str], bool]] = None

    def set_known_url_checker(self, checker: Callable[[str], bool]) -> None:
        """Known postings skip the detail request; the lifecycle only needs the URL."""
        self._known_url_checker = checker

    def _is_known(self, url: str) -> bool:
        return bool(self._known_url_checker and self._known_url_checker(url))

    async def extract_job_listings(self, page: Page) -> list[dict]:
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        return {}

    async def _get(self, client: httpx.AsyncClient, url: str) -> Optional[httpx.Response]:
        try:
            resp = await client.get(url)
        except httpx.HTTPError as exc:
            self.logger.warning('tos_request_failed', url=url, error=str(exc))
            return None
        if resp.status_code != 200:
            self.logger.warning('tos_non_200', url=url, status=resp.status_code)
            return None
        return resp

    async def fetch_listing(self, client: httpx.AsyncClient) -> list[dict]:
        """Every open posting on the board, with location and workfield resolved."""
        cards: dict[str, dict] = {}
        labels: dict[str, dict[str, str]] = {}
        total_pages: Optional[int] = None
        page = 1
        while page <= MAX_PAGES:
            if page > 1:
                await asyncio.sleep(self.rate_limit_delay)
            url = self.base_url if page == 1 else f'{self.base_url}?page={page}'
            resp = await self._get(client, url)
            if resp is None:
                break
            html = resp.text
            payload = rsc_payload(html)
            if total_pages is None:
                total_pages = page_count(payload)
            for name, values in parse_filters(payload).items():
                labels.setdefault(name, {}).update(values)
            links = posting_links(html)
            new = 0
            for posting in parse_postings(payload):
                sid = str(posting['shortId'])
                if sid in cards or sid not in links:
                    continue  # objects not linked on this page are "similar jobs" widgets
                if posting.get('state') and posting['state'] != 'JOB_POSTING_STATE_OPEN':
                    continue
                cards[sid] = {**posting, '_path': links[sid]}
                new += 1
            if new == 0 or (total_pages and page >= total_pages):
                break
            page += 1

        location_labels = labels.get('Location', {})
        workfield_labels = labels.get('Workfield', {})
        out = []
        for sid, posting in cards.items():
            workfields = _filter_label(posting, 2, workfield_labels)
            if workfields and all(w.lower() in self.exclude_workfields for w in workfields):
                continue
            locations = _filter_label(posting, 1, location_labels)
            out.append({
                'title': str(posting.get('title') or '').strip(),
                'url': f"{self.origin}{posting['_path']}",
                'location': ', '.join(locations) if locations else 'Location Not Specified',
                'summary': str(posting.get('summary') or '').strip(),
                'workfield': ', '.join(workfields),
                'posted_date': _posted(posting),
                'requisition_id': sid,
            })
        self.logger.info('tos_listing', pages=page, total_pages=total_pages,
                         postings=len(cards), kept=len(out))
        return out

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        jobs: list[JobPosting] = []
        skipped_known = new_details = deferred = detail_failures = 0
        async with httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT, headers={'User-Agent': USER_AGENT}, follow_redirects=True
        ) as client:
            cards = await self.fetch_listing(client)
            if max_jobs:
                cards = cards[:max_jobs]
            for card in cards:
                description = ''
                if self._is_known(card['url']):
                    skipped_known += 1
                    description = f"{card['title']} at {self.company_name} (listing only; detail already on file)"
                else:
                    if self.max_new_details and new_details >= self.max_new_details:
                        deferred += 1
                        continue
                    new_details += 1
                    await asyncio.sleep(self.rate_limit_delay)
                    resp = await self._get(client, card['url'])
                    if resp is not None:
                        description = parse_detail_description(rsc_payload(resp.text))
                    if not description:
                        description = card['summary']
                    if not description:
                        detail_failures += 1
                        continue
                    header = f"Workfield: {card['workfield']}" if card['workfield'] else ''
                    description = f'{header}\n{description}' if header else description
                job_data = {
                    'title': card['title'],
                    'company': self.company_name,
                    'location': card['location'],
                    'description': description,
                    'url': card['url'],
                    'posted_date': card['posted_date'],
                    'requisition_id': card['requisition_id'],
                    'salary': extract_salary(description),
                }
                try:
                    jobs.append(JobPosting(**self._enrich_with_certifications(job_data)))
                except ValidationError as exc:
                    self.logger.warning('tos_job_invalid', title=card['title'][:60], error=str(exc))
        self.logger.info('extraction_complete', company=self.company_name, total_jobs=len(jobs),
                         listing_only=skipped_known, new_details=new_details, deferred=deferred,
                         detail_failures=detail_failures)
        return jobs
