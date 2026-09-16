"""Pinpoint ATS career board scraper.

Pinpoint (pinpointhq.com) publishes a company's whole board as JSON at
`/postings.json`, unauthenticated and unpaginated: V.Group's board returns all
377 postings in one request, matching its sitemap exactly, so nothing is held
back. That makes this a plain HTTP adapter with no browser, which is faster and
far less brittle than driving the rendered page.

Built for the CrewBase replacement, where three employers are on Pinpoint.

⚠️ NOT currently used by V.Group, the board this was written against. Its feed
tags all 377 postings to its London head office (postcode SW1), including
"Motorman for cruise vessel Ultramarine" and "V.Ships Manila", while its own
posting page shows the location as "Shipboard" and never says London. Ingesting
that would put false geography on 363 public job pages, and CrewBase's own
location data for V.Group is better ("Worldwide", "United Arab Emirates"). So
the adapter is ready and tested, and the tenant is a separate decision.

Config:
    platform: pinpoint
    base_url: "https://<tenant>.pinpointhq.com/"

WHY NOT html_generic: its only JSON mode (`portal_api_url`) is hardcoded to the
OSM Thome portal's schema (`job.name`/`slug`/`locations[]`), which does not
describe Pinpoint's shape at all.

Response shape (verified live 2026-09-16):
    {"data": [{
        "id": "334361",
        "title": "Motorman for cruise vessel Ultramarine",
        "url": "https://<tenant>.pinpointhq.com/en/postings/<uuid>",
        "description": "<div>...</div>",          # HTML
        "key_responsibilities": "<ol>...</ol>",     # HTML, present on every row
        "skills_knowledge_expertise": "<div>...</div>",
        "benefits": "<div>...</div>",
        "employment_type_text": "Contract",
        "compensation": "$4,308 - $5,738 / month",  # only when compensation_visible
        "compensation_visible": false,
        "location": {"city": "London", "province": "United Kingdom"},
        "job": {"department": {...}, "division": {...}}
    }, ...]}
"""

from typing import Optional

import httpx
import structlog
from bs4 import BeautifulSoup
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

# Every part of a Pinpoint posting that is body copy, in reading order. These
# are all genuinely part of the posting, so joining them is fuller capture, not
# padding. Measured on V.Group's 363 real vacancies (as TEXT, after stripping
# the HTML): `description` alone has a median of 158 characters and only 78 rows
# clear the site's 600-character publish gate; joined, the median is 260 and 144
# clear it. Even joined, most of this board is too thin to publish, which is a
# property of the postings rather than of the capture.
BODY_FIELDS = [
    ('description', None),
    ('key_responsibilities', 'key_responsibilities_header'),
    ('skills_knowledge_expertise', 'skills_knowledge_expertise_header'),
    ('benefits', 'benefits_header'),
]


def postings_url(base_url: str) -> str:
    """The JSON endpoint for a Pinpoint tenant."""
    return f"{base_url.rstrip('/')}/postings.json"


# Location records that describe an open advert rather than a posted vacancy.
# V.Group files 14 rows under a location literally named "Register Interest"
# ("V.Ships Manila (Officers)", "V.Ships India"), which are talent-pool adverts,
# not jobs, and must not become job pages.
NON_VACANCY_LOCATION_NAMES = {'register interest', 'talent pool', 'speculative'}


def is_vacancy(posting: dict) -> bool:
    """False for talent-pool adverts dressed up as postings."""
    name = str((posting.get('location') or {}).get('name') or '').strip().lower()
    return name not in NON_VACANCY_LOCATION_NAMES


def build_location(posting: dict) -> str:
    """"City, Province" from a posting, or a sensible partial.

    `province` is usually a country on this platform but not always: US boards
    put a state there. Both geocode correctly as "City, Province", so the pair
    is passed through rather than being second-guessed into a country.

    ⚠️ A TENANT CAN DEFAULT THIS TO ITS HEAD OFFICE. V.Group returns city
    "London", postcode SW1, for all 377 of its postings, including "Motorman
    for cruise vessel Ultramarine" and "V.Ships Manila"; its own posting page
    displays the location as "Shipboard" (`location.name`) and never shows
    London. Before adding a Pinpoint tenant, check whether every posting shares
    one city. If it does, the structured location is an HQ default and
    publishing it would put false geography on the site, which is why V.Group
    is deliberately not configured. See the module docstring.
    """
    location = posting.get('location') or {}
    city = str(location.get('city') or '').strip()
    province = str(location.get('province') or '').strip()
    parts = [p for p in (city, province) if p]
    if len(parts) == 2 and parts[0].lower() == parts[1].lower():
        parts = parts[:1]
    return ', '.join(parts) if parts else 'Location Not Specified'


def build_description(posting: dict) -> str:
    """The posting's body as text, with each section's own heading kept."""
    chunks: list[str] = []
    for field, header_field in BODY_FIELDS:
        html = (posting.get(field) or '').strip()
        if not html:
            continue
        text = BeautifulSoup(html, 'html.parser').get_text(separator='\n', strip=True)
        if not text:
            continue
        header = (posting.get(header_field) or '').strip() if header_field else ''
        chunks.append(f"{header}\n{text}" if header else text)
    return '\n\n'.join(chunks).strip()


def build_salary(posting: dict) -> Optional[str]:
    """Pay only when the employer chose to show it.

    Pinpoint pre-formats it with its period attached ("$4,308 - $5,738 /
    month"), which is exactly the shape the rest of the pipeline wants: an
    amount with no period is unusable downstream. `compensation_visible` is the
    employer's own decision, so a hidden figure is never published.
    """
    if not posting.get('compensation_visible'):
        return None
    compensation = (posting.get('compensation') or '').strip()
    return compensation or None


class PinpointScraper(BaseScraper):
    """Scraper for Pinpoint-hosted career boards."""

    def __init__(self, config: dict):
        super().__init__(config)
        self.base_url = config.get('base_url', '')

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """Not used: the JSON endpoint returns whole postings, not stubs."""
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """Not used: there is no second request to make."""
        return {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        url = postings_url(self.base_url)
        try:
            async with httpx.AsyncClient(
                timeout=REQUEST_TIMEOUT, headers={'User-Agent': USER_AGENT}
            ) as client:
                response = await client.get(url)
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            self.logger.error('pinpoint_fetch_failed', url=url, error=str(exc))
            return []

        postings = payload.get('data') or []
        total = len(postings)
        postings = [p for p in postings if is_vacancy(p)]
        self.logger.info(
            'pinpoint_postings_fetched',
            url=url,
            count=len(postings),
            skipped_non_vacancies=total - len(postings),
        )
        if max_jobs:
            postings = postings[:max_jobs]

        jobs: list[JobPosting] = []
        for posting in postings:
            title = str(posting.get('title') or '').strip()
            job_url = str(posting.get('url') or '').strip()
            description = build_description(posting)
            if not title or not job_url or len(description) < 10:
                self.logger.debug(
                    'pinpoint_posting_skipped',
                    title=title[:60],
                    has_url=bool(job_url),
                    description_chars=len(description),
                )
                continue

            job_data = {
                'title': title,
                'company': self.company_name,
                'location': build_location(posting),
                'description': description,
                'url': job_url,
                # Pinpoint's feed carries no posted date, so none is invented.
                'posted_date': None,
                'employment_type': self._normalize_employment_type(
                    posting.get('employment_type_text')
                ),
                'requisition_id': str(posting.get('id') or '') or None,
                'salary': build_salary(posting),
            }

            try:
                jobs.append(JobPosting(**self._enrich_with_certifications(job_data)))
            except ValidationError as exc:
                self.logger.warning(
                    'pinpoint_job_invalid', title=title[:60], error=str(exc)
                )

        self.logger.info('extraction_complete', company=self.company_name, total_jobs=len(jobs))
        return jobs
