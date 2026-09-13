#!/usr/bin/env python3
"""Unit tests for the Zoho Recruit hosted career-site scraper.

Run with: python -m pytest tests/test_zoho_recruit.py -v
"""

import html as htmllib
import json

import pytest

from src.scrapers.zoho_recruit import ZohoRecruitScraper


def _scraper(**extra):
    cfg = {'name': 'Madre Integrated Engineering', 'platform': 'zoho_recruit',
           'sheet_name': 'Madre Integrated Engineering', 'rate_limit_delay': 0,
           'base_url': 'https://madre-me.zohorecruit.com/jobs/Careers', **extra}
    return ZohoRecruitScraper(cfg)


def _job(jid, title, city='Doha', publish=True, locked=False, desc='<p>Do the work.</p>'):
    return {'id': jid, 'Posting_Title': title, 'City': city, 'Country': 'Qatar',
            'Date_Opened': '2026-09-01', 'Job_Type': 'Full Time', 'Industry': 'Marine',
            'Job_Description': desc, 'Publish': publish, 'Is_Locked': locked}


def _page_html(jobs):
    blob = htmllib.escape(json.dumps(jobs), quote=True)
    return f'<html><body><input type="hidden" value="{blob}" id="jobs"></body></html>'


class TestZohoRecruitScraper:
    def test_requires_base_url(self):
        with pytest.raises(ValueError):
            ZohoRecruitScraper({'name': 'X', 'sheet_name': 'X', 'rate_limit_delay': 0})

    def test_origin_derived_from_base_url(self):
        s = _scraper()
        assert s.origin == 'https://madre-me.zohorecruit.com'

    def test_extract_jobs_blob_parses_embedded_json(self):
        s = _scraper()
        jobs = [_job('1', 'Network Technician')]
        blob = s._extract_jobs_blob(_page_html(jobs))
        assert blob == jobs

    def test_extract_jobs_blob_missing_input_raises(self):
        s = _scraper()
        with pytest.raises(RuntimeError, match='No #jobs hidden input'):
            s._extract_jobs_blob('<html><body>nothing here</body></html>')

    def test_build_job_data_maps_fields(self):
        s = _scraper()
        data = s._build_job_data(_job('792788', 'Network Technician'))
        assert data['title'] == 'Network Technician'
        assert data['location'] == 'Doha, Qatar'
        assert data['url'] == 'https://madre-me.zohorecruit.com/jobs/Careers/792788'
        assert data['requisition_id'] == '792788'
        assert 'Do the work.' in data['description']

    @pytest.mark.asyncio
    async def test_extract_all_jobs_filters_unpublished_and_locked(self):
        s = _scraper()
        jobs = [
            _job('1', 'Published Open'),
            _job('2', 'Unpublished', publish=False),
            _job('3', 'Locked', locked=True),
        ]

        class FakeResp:
            text = _page_html(jobs)

            def raise_for_status(self):
                pass

        s._session.get = lambda url, timeout=30: FakeResp()
        result = await s.extract_all_jobs()
        assert [j.title for j in result] == ['Published Open']

    @pytest.mark.asyncio
    async def test_extract_all_jobs_returns_empty_when_blob_missing(self):
        s = _scraper()

        class FakeResp:
            text = '<html><body>no jobs input</body></html>'

            def raise_for_status(self):
                pass

        s._session.get = lambda url, timeout=30: FakeResp()
        assert await s.extract_all_jobs() == []
