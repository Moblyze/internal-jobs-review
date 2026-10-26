"""WordPress REST API job board scraper (RecruiterWP and similar plugins).

Some WordPress job boards register their listings as a public custom post type,
so the whole board, with full descriptions, is one paginated JSON endpoint. That
beats scraping the listing: FacetWP/"load more" boards render a page at a time
through an AJAX nonce, and a browser run only ever saw the first page.

Used by: WRS (Worldwide Recruitment Solutions, jobs.worldwide-rs.com, post type
`recruiterwp_job`, 145 live jobs on 2026-10-26; the old HTML config read only
the 14-job "marine" filter).

Config:
    platform: wp_rest
    base_url: "https://jobs.worldwide-rs.com/"
    wp_rest_config:
      post_type: "recruiterwp_job"     # the REST base, see /wp-json/wp/v2/types
      per_page: 100                    # WordPress caps this at 100

Response shape (verified live 2026-10-26): a JSON array, `X-WP-TotalPages`
header for paging, each item with `link`, `slug`, `date`, `title.rendered` and
`content.rendered` (HTML, median ~3,200 chars). The location is the first
"Location:" line of the body; the post's `class_list` also carries a
`location-<slug>` term that backs it up.
"""

import asyncio
import re
from datetime import datetime
from html import unescape
from typing import Optional

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
MAX_PAGES = 20  # safety cap: 2,000 jobs at 100 per page
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)

_LOCATION_RE = re.compile(r'Location:\s*\n?\s*([^\n]+)', re.IGNORECASE)
_CONTRACT_RE = re.compile(r'(?:Contract|Job Type|Type):\s*\n?\s*([^\n]+)', re.IGNORECASE)


def html_to_text(html: Optional[str]) -> str:
    """Body HTML as plain text, one block per line."""
    if not html:
        return ''
    soup = BeautifulSoup(html, 'html.parser')
    for el in soup(['script', 'style']):
        el.decompose()
    text = soup.get_text(separator='\n', strip=True)
    return '\n'.join(line.strip() for line in text.split('\n') if line.strip())


def build_location(text: str, class_list: Optional[list] = None) -> str:
    """The body's "Location:" value, else the `location-<slug>` term, else ''."""
    match = _LOCATION_RE.search(text)
    if match:
        value = match.group(1).strip()
        # Some posts run the next field on the same line ("...Azerbaijan Contract: ...").
        value = re.split(r'\s+(?:Contract|Rate|Working Arrangement|Type|Salary)\s*:', value)[0].strip()
        if value:
            return value
    for cls in class_list or []:
        if isinstance(cls, str) and cls.startswith('location-'):
            return cls[len('location-'):].replace('-', ' ').title()
    return ''


def build_employment_type_text(text: str) -> Optional[str]:
    match = _CONTRACT_RE.search(text)
    return match.group(1).strip() if match else None


def build_posted_date(post: dict) -> Optional[datetime]:
    raw = post.get('date_gmt') or post.get('date')
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw))
    except ValueError:
        return None


def build_job_data(post: dict, company: str) -> Optional[dict]:
    """Map one REST post to JobPosting fields, or None when it has no usable body."""
    title = unescape(str((post.get('title') or {}).get('rendered') or '')).strip()
    url = str(post.get('link') or '').strip()
    description = html_to_text((post.get('content') or {}).get('rendered'))
    if not title or not url or len(description) < 10:
        return None
    return {
        'title': title,
        'company': company,
        'location': build_location(description, post.get('class_list')) or 'Location Not Specified',
        'description': description,
        'url': url,
        'posted_date': build_posted_date(post),
        'salary': extract_salary(description),
        'requisition_id': str(post.get('slug') or post.get('id') or '') or None,
    }


class WPRestScraper(BaseScraper):
    """Scraper for WordPress boards that expose jobs through /wp-json/wp/v2/<type>."""

    def __init__(self, config: dict):
        super().__init__(config)
        self.base_url = config.get('base_url', '').rstrip('/')
        rest = config.get('wp_rest_config', {})
        self.post_type = rest.get('post_type', 'job')
        self.per_page = min(int(rest.get('per_page', 100)), 100)

    async def extract_job_listings(self, page: Page) -> list[dict]:
        """Not used: the REST endpoint returns whole posts."""
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        """Not used: there is no second request to make."""
        return {}

    async def _fetch_posts(self) -> list[dict]:
        endpoint = f"{self.base_url}/wp-json/wp/v2/{self.post_type}"
        posts: list[dict] = []
        async with httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT, headers={'User-Agent': USER_AGENT}, follow_redirects=True
        ) as client:
            page_num = 1
            while page_num <= MAX_PAGES:
                response = await client.get(
                    endpoint, params={'per_page': self.per_page, 'page': page_num, 'status': 'publish'}
                )
                if response.status_code == 400:  # WordPress: page past the last
                    break
                response.raise_for_status()
                batch = response.json()
                if not isinstance(batch, list) or not batch:
                    break
                posts.extend(batch)
                if page_num >= int(response.headers.get('X-WP-TotalPages', 1)):
                    break
                page_num += 1
                await asyncio.sleep(self.rate_limit_delay)
        return posts

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        try:
            posts = await self._fetch_posts()
        except (httpx.HTTPError, ValueError) as exc:
            self.logger.error('wp_rest_fetch_failed', base_url=self.base_url, error=str(exc))
            return []

        self.logger.info('wp_rest_posts_fetched', count=len(posts))
        if max_jobs:
            posts = posts[:max_jobs]

        jobs: list[JobPosting] = []
        for post in posts:
            job_data = build_job_data(post, self.company_name)
            if not job_data:
                continue
            job_data['employment_type'] = self._normalize_employment_type(
                build_employment_type_text(job_data['description'])
            )
            try:
                jobs.append(JobPosting(**self._enrich_with_certifications(job_data)))
            except ValidationError as exc:
                self.logger.warning('wp_rest_job_invalid', title=job_data['title'][:60], error=str(exc))

        self.logger.info('extraction_complete', company=self.company_name, total_jobs=len(jobs))
        return jobs
