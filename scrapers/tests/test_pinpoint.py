#!/usr/bin/env python3
"""Unit tests for the Pinpoint ATS scraper.

Run with: python -m pytest tests/test_pinpoint.py -v
"""

from datetime import datetime, timezone

import pytest

from src.scrapers.pinpoint import PinpointScraper


def _scraper(**extra):
    cfg = {'name': 'V.Group', 'platform': 'pinpoint', 'sheet_name': 'V.Group',
           'base_url': 'https://vgroup.pinpointhq.com/', 'rate_limit_delay': 0,
           'pinpoint_tenant': 'vgroup', **extra}
    return PinpointScraper(cfg)


def _posting(pid, title, city='London', published='2026-09-01T00:00:00Z'):
    return {'id': pid, 'title': title, 'url': f'https://vgroup.pinpointhq.com/en/postings/{pid}',
            'published_at': published, 'employment_type': 'full_time',
            'location': {'name': 'Shipboard', 'city': city, 'province': 'UK'},
            'description': '<p>Sail the seas.</p>'}


class TestPinpointScraper:
    def test_tenant_from_config_or_url(self):
        assert _scraper().tenant == 'vgroup'
        s = PinpointScraper({'name': 'X', 'sheet_name': 'X', 'rate_limit_delay': 0,
                              'base_url': 'https://acme.pinpointhq.com/careers'})
        assert s.tenant == 'acme'

    def test_missing_tenant_raises(self):
        with pytest.raises(ValueError):
            PinpointScraper({'name': 'X', 'sheet_name': 'X', 'base_url': 'https://example.com/'})

    def test_build_job_data_maps_fields(self):
        s = _scraper()
        data = s._build_job_data(_posting('1', 'Motorman'))
        assert data['title'] == 'Motorman'
        assert data['location'] == 'Shipboard, London, UK'
        assert data['url'] == 'https://vgroup.pinpointhq.com/en/postings/1'
        assert data['requisition_id'] == '1'
        assert data['posted_date'] == datetime(2026, 9, 1, tzinfo=timezone.utc)
        assert data['employment_type'] == 'Full-Time'
        assert 'Sail the seas.' in data['description']

    def test_missing_title_falls_back(self):
        s = _scraper()
        data = s._build_job_data({'id': '2'})
        assert data['title'] == 'Untitled Position'
        assert data['location'] == 'Location Not Specified'

    @pytest.mark.asyncio
    async def test_extract_all_jobs_reads_data_array(self):
        s = _scraper()

        class FakeResp:
            def raise_for_status(self):
                pass

            def json(self):
                return {'data': [_posting('1', 'Motorman'), _posting('2', 'Chef De Partie')]}

        s._session.get = lambda url, timeout=30: FakeResp()
        jobs = await s.extract_all_jobs()
        assert [j.title for j in jobs] == ['Motorman', 'Chef De Partie']

    @pytest.mark.asyncio
    async def test_extract_all_jobs_respects_max_jobs(self):
        s = _scraper()

        class FakeResp:
            def raise_for_status(self):
                pass

            def json(self):
                return {'data': [_posting('1', 'A'), _posting('2', 'B'), _posting('3', 'C')]}

        s._session.get = lambda url, timeout=30: FakeResp()
        jobs = await s.extract_all_jobs(max_jobs=2)
        assert len(jobs) == 2

    @pytest.mark.asyncio
    async def test_extract_all_jobs_returns_empty_on_request_failure(self):
        s = _scraper()

        def boom(url, timeout=30):
            raise RuntimeError("network down")

        s._session.get = boom
        jobs = await s.extract_all_jobs()
        assert jobs == []
