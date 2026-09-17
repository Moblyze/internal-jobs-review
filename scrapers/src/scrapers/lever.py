"""Lever ATS career board scraper.

Lever publishes a company's whole board as unauthenticated JSON. One request
returns every posting with its full description, so this is a plain HTTP
adapter with no browser.

Used by: Columbia Shipmanagement (csmcy, EU region).

Config:
    platform: lever
    base_url: "https://jobs.eu.lever.co/csmcy"    # the public board
    lever_slug: "csmcy"
    lever_region: "eu"                            # omit for the US endpoint

⚠️ REGION MATTERS. Lever runs separate US and EU deployments and a board only
exists on one of them: `api.lever.co/v0/postings/csmcy` 404s while
`api.eu.lever.co/v0/postings/csmcy` returns all 217. A 404 here means the wrong
region, not a dead board, so check the other one before concluding anything.

Response shape (verified live 2026-09-16): a bare JSON array of postings.
    [{
        "id": "<uuid>",
        "text": "1ST OFFICER NAVIGATION",          # the title
        "descriptionPlain": "...",                  # full text, median 1,220 chars
        "additionalPlain": "...",
        "hostedUrl": "https://jobs.eu.lever.co/csmcy/<uuid>",
        "createdAt": 1788777158267,                 # epoch MILLISECONDS
        "categories": {
            "commitment": "Contractual",
            "location": "Worldwide",
            "department": "LINDBLAD EXPEDITIONS",
            "team": "Deck"
        }
    }, ...]
"""

from datetime import datetime, timezone
from typing import Optional

import httpx
import structlog
from playwright.async_api import Page
from pydantic import ValidationError

from src.models.job import JobPosting
from src.scrapers.base import BaseScraper

logger = structlog.get_logger()

REQUEST_TIMEOUT = 30.0
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)


def postings_api_url(slug: str, region: str = '') -> str:
    """The JSON endpoint for a Lever board. `region` is 'eu' or empty for US."""
    host = 'api.eu.lever.co' if str(region).strip().lower() == 'eu' else 'api.lever.co'
    return f"https://{host}/v0/postings/{slug}?mode=json"


def slug_from_base_url(base_url: str) -> str:
    """The board slug from a public Lever URL, e.g. jobs.eu.lever.co/csmcy."""
    return base_url.rstrip('/').split('/')[-1]


def region_from_base_url(base_url: str) -> str:
    """'eu' when the board is on Lever's EU deployment, else ''."""
    return 'eu' if '.eu.lever.co' in base_url.lower() else ''


def build_description(posting: dict) -> str:
    """The posting's body as text.

    `descriptionPlain` already carries the whole advert on the boards measured
    (median 1,220 characters). `additionalPlain` is a short tail that some
    postings use for equal-opportunity or application notes, kept because it is
    part of what the employer published.
    """
    parts = [
        (posting.get('descriptionPlain') or '').strip(),
        (posting.get('additionalPlain') or '').strip(),
    ]
    return '\n\n'.join(p for p in parts if p).strip()


def build_posted_date(posting: dict) -> Optional[datetime]:
    """`createdAt` is epoch MILLISECONDS, not seconds.

    Read as seconds it lands in the year 58,000 and every downstream freshness
    rule breaks quietly, so the conversion is explicit.
    """
    created = posting.get('createdAt')
    if not isinstance(created, (int, float)) or created <= 0:
        return None
    try:
        return datetime.fromtimestamp(created / 1000, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


class LeverScraper(BaseScraper):
    """Scraper for Lever-hosted career boards."""

    def __init__(self, config: dict):
        super().__init__(config)
        self.base_url = config.get('base_url', '')
        self.slug = config.get('lever_slug') or slug_from_base_url(self.base_url)
        self.region = config.get('lever_region') or region_from_base_url(self.base_url)

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """Not used: the JSON endpoint returns whole postings, not stubs."""
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """Not used: there is no second request to make."""
        return {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        url = postings_api_url(self.slug, self.region)
        try:
            async with httpx.AsyncClient(
                timeout=REQUEST_TIMEOUT, headers={'User-Agent': USER_AGENT}
            ) as client:
                response = await client.get(url)
                response.raise_for_status()
                postings = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            self.logger.error(
                'lever_fetch_failed',
                url=url,
                error=str(exc),
                note='a 404 usually means the wrong region; try the other of us/eu',
            )
            return []

        if not isinstance(postings, list):
            self.logger.error('lever_unexpected_payload', url=url)
            return []

        self.logger.info('lever_postings_fetched', url=url, count=len(postings))
        if max_jobs:
            postings = postings[:max_jobs]

        jobs: list[JobPosting] = []
        for posting in postings:
            title = str(posting.get('text') or '').strip()
            job_url = str(posting.get('hostedUrl') or '').strip()
            description = build_description(posting)
            if not title or not job_url or len(description) < 10:
                continue

            categories = posting.get('categories') or {}
            job_data = {
                'title': title,
                'company': self.company_name,
                'location': str(categories.get('location') or '').strip() or 'Location Not Specified',
                'description': description,
                'url': job_url,
                'posted_date': build_posted_date(posting),
                'employment_type': self._normalize_employment_type(categories.get('commitment')),
                'requisition_id': str(posting.get('id') or '') or None,
            }

            try:
                jobs.append(JobPosting(**self._enrich_with_certifications(job_data)))
            except ValidationError as exc:
                self.logger.warning('lever_job_invalid', title=title[:60], error=str(exc))

        self.logger.info('extraction_complete', company=self.company_name, total_jobs=len(jobs))
        return jobs
