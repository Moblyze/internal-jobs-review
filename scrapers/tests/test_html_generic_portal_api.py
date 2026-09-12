#!/usr/bin/env python3
"""Tests for the html_generic portal-API mapping and sitemap presence-only guard (OSM Thome fix).

Run with: python -m pytest tests/test_html_generic_portal_api.py -v
"""

import pytest

from src.scrapers.html_generic import HtmlGenericScraper


def _scraper():
    return HtmlGenericScraper({
        'name': 'OSM Thome', 'platform': 'html_generic', 'sheet_name': 'OSM Thome',
        'base_url': 'https://jobs.osmthome.com/', 'rate_limit_delay': 0,
        'html_config': {'portal_api_url': 'https://maritime.osmaportal.com/api/jobs',
                        'sitemap_url': 'https://jobs.osmthome.com/sitemap.xml',
                        'sitemap_job_pattern': '/jobs/', 'skip_detail_pages': True},
    })


def test_portal_job_maps_description_location_and_type():
    job = {'id': '12538', 'name': 'Electrician (ELEC) | Bulkcarrier | Worldwide', 'slug': 'electrician-elec',
           'is_active': True, 'is_expired': False, 'locations': [{'label': 'Worldwide', 'value': 1}],
           'employment_types': [{'label': 'Contractual', 'value': 13}],
           'description': '<p>Join OSM Thome as an <b>Electrician</b>.</p><p>Keep systems safe.</p>'}
    listing = _scraper()._portal_job_to_listing(job)
    assert listing['url'] == 'https://jobs.osmthome.com/jobs/12538/electrician-elec'
    assert listing['location'] == 'Worldwide'
    assert listing['description'] == 'Join OSM Thome as an\nElectrician\n.\nKeep systems safe.'
    assert listing['employment_type'] == 'Contractual'


def test_portal_job_skips_expired():
    assert _scraper()._portal_job_to_listing({'id': '1', 'name': 'X', 'is_active': True, 'is_expired': True}) is None


@pytest.mark.asyncio
async def test_sitemap_fallback_keeps_only_known_jobs_when_api_is_down():
    s = _scraper()
    s._extract_listings_from_portal_api = lambda: []

    async def no_browser_api():
        return []

    s._extract_listings_from_portal_api_via_browser = no_browser_api
    s._extract_listings_from_sitemap = lambda: [
        {'title': 'Known Oiler', 'url': 'https://jobs.osmthome.com/jobs/526/known', 'company': 'OSM Thome', 'location': 'Worldwide'},
        {'title': 'New Wiper', 'url': 'https://jobs.osmthome.com/jobs/999/new', 'company': 'OSM Thome'},
    ]
    s.set_known_url_checker(lambda url: url.endswith('/526/known'))
    jobs = await s.extract_all_jobs()
    assert [str(j.url) for j in jobs] == ['https://jobs.osmthome.com/jobs/526/known']
