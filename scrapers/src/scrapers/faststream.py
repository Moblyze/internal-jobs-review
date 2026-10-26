"""Faststream Recruitment (www.faststream.com) job board scraper.

Faststream is a shipping/maritime/energy recruiter. Its board is server-rendered
with no public API, but robots.txt allows `/job/<slug>` and publishes every live
job in `/job/sitemap.xml` (193 URLs on 2026-10-26, CrewBase showed 107 active).
So: read the sitemap, fetch each detail page over plain HTTP (no browser).

robots.txt (verified 2026-10-26) disallows `/*?*`, `/jobs/*/*/*`, `/api/*` and the
`/job/*/apply` + `save_job` actions; this adapter touches none of those. The bare
`faststream.com` host sits behind an AWS WAF challenge, so only `www.` is used.

Detail page shape: a label/value block (Posted, Sector, Location, Job Ref, Job Type,
Salary, Expiry Date, Contact, Contact Email) followed by "Job Description". The
consultant's name and email are personal data and are deliberately NOT captured.

Config:
    platform: faststream
    base_url: "https://www.faststream.com/"
"""

import asyncio
import re
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
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)
LABELS = ['Posted', 'Sector', 'Location', 'Job Ref', 'Job Type', 'Salary', 'Expiry Date', 'Contact', 'Contact Email']
_NO_PAY_RE = re.compile(r'commensurate|competitive|negotiable|attractive|tbc|on application|doe|depending', re.IGNORECASE)


def _pay(salary_field: str, description: str) -> Optional[str]:
    """The Salary field when it states an amount, else pay found in the body, else None."""
    if salary_field and re.search(r'\d', salary_field) and not _NO_PAY_RE.search(salary_field):
        return salary_field.strip()
    return extract_salary(description)


def parse_sitemap(xml: str) -> list[str]:
    """Job URLs listed in the sitemap, de-duplicated, order kept."""
    seen: dict[str, None] = {}
    for url in re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', xml):
        if '/job/' in url and not url.endswith('/sitemap.xml'):
            seen.setdefault(url, None)
    return list(seen)


def parse_detail(html: str, url: str) -> Optional[dict]:
    """Map one detail page to JobPosting fields, or None when it has no usable body."""
    soup = BeautifulSoup(html, 'html.parser')
    for el in soup(['script', 'style', 'nav', 'footer', 'header']):
        el.decompose()
    lines = [ln.strip() for ln in soup.get_text('\n', strip=True).split('\n') if ln.strip()]
    if 'Job Description' not in lines:
        return None
    cut = lines.index('Job Description')
    head, body = lines[:cut], lines[cut + 1:]
    fields: dict[str, str] = {}
    for i, ln in enumerate(head):
        label = ln.rstrip(':')
        if ln.endswith(':') and label in LABELS and i + 1 < len(head) and not head[i + 1].endswith(':'):
            fields[label] = head[i + 1]
    title_tag = soup.find('h1')
    title = title_tag.get_text(' ', strip=True) if title_tag else (head[0] if head else '')
    # Drop the trailing apply/similar-jobs furniture if present.
    for stop in ('Apply Now', 'Similar Jobs', 'Share this job', 'Back to Job Search'):
        if stop in body:
            body = body[:body.index(stop)]
    description = '\n'.join(body).strip()
    if not title or len(description) < 10:
        return None
    # Header block first, so salary/type/sector sit in the description the way other boards render them.
    header = [f'{k}: {fields[k]}' for k in ('Sector', 'Job Type', 'Salary') if fields.get(k)]
    full = '\n'.join(header + [description]) if header else description
    salary_text = fields.get('Salary', '')
    return {
        'title': title,
        'location': fields.get('Location') or 'Location Not Specified',
        'description': full,
        'url': url,
        'requisition_id': fields.get('Job Ref'),
        'employment_type_text': fields.get('Job Type'),
        'salary': _pay(salary_text, description),
    }


class FaststreamScraper(BaseScraper):
    """Sitemap + detail-page scraper for www.faststream.com."""

    def __init__(self, config: dict):
        super().__init__(config)
        self.base_url = config.get('base_url', 'https://www.faststream.com/').rstrip('/')

    async def extract_job_listings(self, page: Page) -> list[dict]:
        return []

    async def extract_job_detail(self, page: Page, job_url: str) -> dict:
        return {}

    async def extract_all_jobs(self, max_jobs: Optional[int] = None) -> list[JobPosting]:
        jobs: list[JobPosting] = []
        async with httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT, headers={'User-Agent': USER_AGENT}, follow_redirects=True
        ) as client:
            try:
                resp = await client.get(f'{self.base_url}/job/sitemap.xml')
                resp.raise_for_status()
            except httpx.HTTPError as exc:
                self.logger.error('faststream_sitemap_failed', error=str(exc))
                return []
            urls = parse_sitemap(resp.text)
            self.logger.info('faststream_sitemap', count=len(urls))
            if max_jobs:
                urls = urls[:max_jobs]
            for url in urls:
                await asyncio.sleep(self.rate_limit_delay)
                try:
                    page_resp = await client.get(url)
                    if page_resp.status_code in (404, 410):
                        continue  # filled between sitemap and fetch
                    if page_resp.status_code == 202:
                        # AWS WAF challenge: stop rather than hammer or try to solve it.
                        self.logger.error('faststream_waf_challenge', url=url, fetched=len(jobs))
                        break
                    page_resp.raise_for_status()
                except httpx.HTTPError as exc:
                    self.logger.warning('faststream_detail_failed', url=url, error=str(exc))
                    continue
                data = parse_detail(page_resp.text, url)
                if not data:
                    continue
                data['company'] = self.company_name
                data['employment_type'] = self._normalize_employment_type(data.pop('employment_type_text', None))
                try:
                    jobs.append(JobPosting(**self._enrich_with_certifications(data)))
                except ValidationError as exc:
                    self.logger.warning('faststream_job_invalid', title=data['title'][:60], error=str(exc))
        self.logger.info('extraction_complete', company=self.company_name, total_jobs=len(jobs))
        return jobs
