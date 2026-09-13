#!/usr/bin/env python3
"""Unit tests for the Lever ATS scraper (default + EU data-region hosts).

Run with: python -m pytest tests/test_lever.py -v
"""

from datetime import datetime

import pytest

from src.scrapers.lever import LeverScraper


def _scraper(**extra):
    cfg = {'name': 'Columbia Shipmanagement', 'platform': 'lever', 'sheet_name': 'Columbia Shipmanagement',
           'base_url': 'https://jobs.eu.lever.co/csmcy', 'rate_limit_delay': 0,
           'lever_slug': 'csmcy', 'lever_region': 'eu', **extra}
    return LeverScraper(cfg)


def _posting(pid, text, locations=None, created=1757000000000):
    return {'id': pid, 'text': text, 'hostedUrl': f'https://jobs.eu.lever.co/csmcy/{pid}',
            'createdAt': created,
            'categories': {'location': 'Worldwide', 'allLocations': locations or [], 'commitment': 'Full-time',
                           'department': 'Marine'},
            'descriptionPlain': 'Sail the seas.'}


class TestLeverScraper:
    def test_slug_and_region_from_config(self):
        s = _scraper()
        assert s.slug == 'csmcy' and s.region == 'eu'
        assert s.postings_url == 'https://api.eu.lever.co/v0/postings/csmcy?mode=json'

    def test_default_region_from_url_has_no_region_prefix(self):
        s = LeverScraper({'name': 'X', 'sheet_name': 'X', 'rate_limit_delay': 0,
                           'base_url': 'https://jobs.lever.co/acme'})
        assert s.slug == 'acme' and s.region is None
        assert s.postings_url == 'https://api.lever.co/v0/postings/acme?mode=json'

    def test_eu_region_parsed_from_hosted_url(self):
        s = LeverScraper({'name': 'X', 'sheet_name': 'X', 'rate_limit_delay': 0,
                           'base_url': 'https://jobs.eu.lever.co/csmcy'})
        assert s.slug == 'csmcy' and s.region == 'eu'
        assert s.postings_url == 'https://api.eu.lever.co/v0/postings/csmcy?mode=json'

    def test_missing_slug_raises(self):
        with pytest.raises(ValueError):
            LeverScraper({'name': 'X', 'sheet_name': 'X', 'base_url': 'https://example.com/'})

    def test_build_job_data_maps_fields(self):
        s = _scraper()
        data = s._build_job_data(_posting('e4b0', '1ST OFFICER NAVIGATION', locations=['Jakarta', 'Manila']))
        assert data['title'] == '1ST OFFICER NAVIGATION'
        assert data['location'] == 'Jakarta; Manila'
        assert data['url'] == 'https://jobs.eu.lever.co/csmcy/e4b0'
        assert data['requisition_id'] == 'e4b0'
        assert data['employment_type'] == 'Full-Time'
        assert data['posted_date'] == datetime.utcfromtimestamp(1757000000000 / 1000)

    def test_location_falls_back_to_single_location_field(self):
        s = _scraper()
        data = s._build_job_data(_posting('1', 'AMOS Administrator'))
        assert data['location'] == 'Worldwide'

    @pytest.mark.asyncio
    async def test_extract_all_jobs_reads_list_response(self):
        s = _scraper()

        class FakeResp:
            def raise_for_status(self):
                pass

            def json(self):
                return [_posting('1', 'A'), _posting('2', 'B')]

        s._session.get = lambda url, timeout=30: FakeResp()
        jobs = await s.extract_all_jobs()
        assert [j.title for j in jobs] == ['A', 'B']

    @pytest.mark.asyncio
    async def test_extract_all_jobs_rejects_non_list_response(self):
        s = _scraper()

        class FakeResp:
            def raise_for_status(self):
                pass

            def json(self):
                return {'error': 'not found'}

        s._session.get = lambda url, timeout=30: FakeResp()
        jobs = await s.extract_all_jobs()
        assert jobs == []
