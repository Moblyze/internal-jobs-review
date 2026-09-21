#!/usr/bin/env python3
"""Tests for html_generic's portal-API listing mapping and sitemap presence-only guard.

These used to be the OSM Thome tests. The fixtures below are a synthetic portal
on an example host instead, because the mapping and the presence-only guard are
generic html_generic behavior and are worth covering without pinning the tests
to one live source.

OSM Thome itself is scraped, on Jesse's decision of 2026-09-21; see the
osm_thome entry in scrapers/config/companies.yaml for the reasoning and for what
its robots.txt says.

The browser-based portal-API fallback that used to be tested here is gone and
stays gone. It re-issued a portal-API call from inside a headless browser when
the plain call came back 403. The plain call returns HTTP 200 again (measured
2026-09-21, 453 jobs), so nothing needs it.

Run with: python -m pytest tests/test_html_generic_portal_api.py -v
"""

import pytest

from src.scrapers.html_generic import HtmlGenericScraper


def _scraper():
    return HtmlGenericScraper({
        'name': 'Example Portal', 'platform': 'html_generic', 'sheet_name': 'Example Portal',
        'base_url': 'https://jobs.example.com/', 'rate_limit_delay': 0,
        'html_config': {'portal_api_url': 'https://portal.example.com/api/jobs',
                        'sitemap_url': 'https://jobs.example.com/sitemap.xml',
                        'sitemap_job_pattern': '/jobs/', 'skip_detail_pages': True},
    })


def test_portal_job_maps_description_location_and_type():
    job = {'id': '12538', 'name': 'Electrician (ELEC) | Bulkcarrier | Worldwide', 'slug': 'electrician-elec',
           'is_active': True, 'is_expired': False, 'locations': [{'label': 'Worldwide', 'value': 1}],
           'employment_types': [{'label': 'Contractual', 'value': 13}],
           'description': '<p>Join us as an <b>Electrician</b>.</p><p>Keep systems safe.</p>'}
    listing = _scraper()._portal_job_to_listing(job)
    assert listing['url'] == 'https://jobs.example.com/jobs/12538/electrician-elec'
    assert listing['location'] == 'Worldwide'
    assert listing['description'] == 'Join us as an\nElectrician\n.\nKeep systems safe.'
    assert listing['employment_type'] == 'Contractual'


def test_portal_job_skips_expired():
    assert _scraper()._portal_job_to_listing({'id': '1', 'name': 'X', 'is_active': True, 'is_expired': True}) is None


def test_browser_portal_api_fallback_is_gone():
    """A robots-disallowed 403 must not be retried from inside a browser page."""
    assert not hasattr(HtmlGenericScraper, '_extract_listings_from_portal_api_via_browser')


@pytest.mark.asyncio
async def test_sitemap_fallback_keeps_only_known_jobs_when_api_is_down(monkeypatch):
    """With the API down, the sitemap is a presence signal for jobs already on file.

    A sitemap row carries a URL and a slug but no advert text, so it can never
    be exported on its own (the 60-char description floor drops it). The guard
    under test is the filter that happens BEFORE that: unknown URLs are dropped
    outright so a brand new job is not turned into a title-only row.
    """
    s = _scraper()
    s._extract_listings_from_portal_api = lambda: []
    sitemap_rows = [
        {'title': 'Known Oiler', 'url': 'https://jobs.example.com/jobs/526/known',
         'company': 'Example Portal', 'location': 'Worldwide'},
        {'title': 'New Wiper', 'url': 'https://jobs.example.com/jobs/999/new',
         'company': 'Example Portal'},
    ]
    s._extract_listings_from_sitemap = lambda: sitemap_rows
    s.set_known_url_checker(lambda url: url.endswith('/526/known'))

    seen = []

    async def fake_detail(page, url):
        seen.append(url)
        return {'description': 'A real advert body long enough to clear the sixty character floor.'}

    s.extract_job_detail = fake_detail

    class _FakePage:
        pass

    class _FakeContext:
        async def new_page(self):
            return _FakePage()

    async def fake_context():
        return _FakeContext()

    async def fake_close():
        return None

    s._get_browser_context = fake_context
    s._close_browser = fake_close

    jobs = await s.extract_all_jobs()
    assert seen == ['https://jobs.example.com/jobs/526/known']
    assert [str(j.url) for j in jobs] == ['https://jobs.example.com/jobs/526/known']
