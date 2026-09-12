#!/usr/bin/env python3
"""Unit tests for the Workday CXS API scraper.

Run with: python -m pytest tests/test_workday_api.py -v
"""

from datetime import datetime

import pytest

from src.scrapers.workday_api import WorkdayApiScraper


def _scraper(base_url='https://kbr.wd5.myworkdayjobs.com/KBR_Careers', **extra):
    cfg = {'name': 'KBR', 'platform': 'workday_api', 'base_url': base_url,
           'rate_limit_delay': 0, 'sheet_name': 'KBR', **extra}
    return WorkdayApiScraper(cfg)


class TestWorkdayApiScraper:
    def test_tenant_site_and_api_base_from_base_url(self):
        s = _scraper()
        assert s.tenant == 'kbr'
        assert s.site == 'KBR_Careers'
        assert s.api_base == 'https://kbr.wd5.myworkdayjobs.com/wday/cxs/kbr/KBR_Careers'

    def test_job_url_matches_historical_browser_urls(self):
        """URL identity is what the dedup tracker and lifecycle key on."""
        s = _scraper('https://bakerhughes.wd5.myworkdayjobs.com/BakerHughes')
        path = '/job/IN-TG-HYDERABAD-SKYVIEW-BUILDING/Power-System-Engineer--Modeling-Engineer-_R162622'
        assert s._job_url(path) == (
            'https://bakerhughes.wd5.myworkdayjobs.com/en-US/BakerHughes'
            '/job/IN-TG-HYDERABAD-SKYVIEW-BUILDING/Power-System-Engineer--Modeling-Engineer-_R162622'
        )

    def test_config_overrides(self):
        s = _scraper(wd_tenant='acme', wd_site='External', url_locale='en-GB')
        assert s.api_base == 'https://kbr.wd5.myworkdayjobs.com/wday/cxs/acme/External'
        assert s._job_url('/job/x') == 'https://kbr.wd5.myworkdayjobs.com/en-GB/External/job/x'

    def test_posted_date_prefers_iso_start_date(self):
        assert WorkdayApiScraper._parse_posted('Posted Yesterday', '2026-09-11') == datetime(2026, 9, 11)

    def test_posted_date_relative_fallback_and_open_ended(self):
        d = WorkdayApiScraper._parse_posted('Posted Today', None)
        assert d is not None and d.date() == datetime.now().date()
        assert WorkdayApiScraper._parse_posted('Posted 30+ Days Ago', None) is None

    def test_html_to_text_strips_markup(self):
        text = WorkdayApiScraper._html_to_text(
            '<p>Hello <b>world</b>, see <a href="#">this</a>.</p><ul><li>one</li><li>two<br>three</li></ul>'
        )
        assert text == 'Hello world, see this.\none\ntwo\nthree'

    @pytest.mark.asyncio
    async def test_fetch_listing_pages_until_total_and_dedupes(self):
        s = _scraper()
        pages = [
            {'total': 22, 'jobPostings': [
                {'title': 'A', 'externalPath': '/job/x/A_R1', 'locationsText': 'US-TX-HOUSTON', 'postedOn': 'Posted Today', 'bulletFields': ['R1']},
                {'title': 'B', 'externalPath': '/job/x/B_R2', 'locationsText': 'GB-ENG-LONDON', 'postedOn': 'Posted Today', 'bulletFields': ['R2']},
            ]},
            {'total': 22, 'jobPostings': [
                {'title': 'B', 'externalPath': '/job/x/B_R2', 'locationsText': '', 'postedOn': '', 'bulletFields': []},
                {'title': 'C', 'externalPath': '/job/x/C_R3', 'locationsText': '', 'postedOn': '', 'bulletFields': []},
            ]},
        ]
        calls = []

        async def fake_request(client, method, url, json_body=None):
            calls.append(json_body['offset'])
            return pages[len(calls) - 1]

        s._request = fake_request
        cards = await s.fetch_listing(client=None)
        assert calls == [0, 20]
        assert [c['url'] for c in cards] == [
            'https://kbr.wd5.myworkdayjobs.com/en-US/KBR_Careers/job/x/A_R1',
            'https://kbr.wd5.myworkdayjobs.com/en-US/KBR_Careers/job/x/B_R2',
            'https://kbr.wd5.myworkdayjobs.com/en-US/KBR_Careers/job/x/C_R3',
        ]
        assert cards[0]['requisition_id'] == 'R1'
        assert cards[2]['requisition_id'] == 'R3'  # from the URL when bulletFields is empty

    @pytest.mark.asyncio
    async def test_known_urls_skip_detail_but_stay_in_result(self):
        s = _scraper()
        detail_calls = []

        async def fake_listing(client, max_jobs=None):
            return [
                {'title': 'Known', 'url': 'https://kbr.wd5.myworkdayjobs.com/en-US/KBR_Careers/job/x/K_R1',
                 'external_path': '/job/x/K_R1', 'company': 'KBR', 'requisition_id': 'R1',
                 'location_raw': 'US-TX-HOUSTON', 'posted_on': 'Posted Today'},
                {'title': 'New', 'url': 'https://kbr.wd5.myworkdayjobs.com/en-US/KBR_Careers/job/x/N_R2',
                 'external_path': '/job/x/N_R2', 'company': 'KBR', 'requisition_id': 'R2',
                 'location_raw': 'US-TX-HOUSTON', 'posted_on': 'Posted Today'},
            ]

        async def fake_detail(client, external_path):
            detail_calls.append(external_path)
            return {'description': 'A real description with enough words in it.',
                    'location': 'Houston, TX, US', 'posted_date': None,
                    'employment_type': 'Full-Time', 'requisition_id': 'R2', 'skills': [], 'salary': None}

        s.fetch_listing = fake_listing
        s.fetch_detail = fake_detail
        s.set_known_url_checker(lambda url: url.endswith('K_R1'))

        jobs = await s.extract_all_jobs()
        assert detail_calls == ['/job/x/N_R2']
        assert [str(j.url).rsplit('/', 1)[-1] for j in jobs] == ['K_R1', 'N_R2']
        assert jobs[0].location == 'Houston, TX, US'
        assert 'listing only' in jobs[0].description


    @pytest.mark.asyncio
    async def test_max_new_details_per_run_defers_unseen_jobs_only(self):
        s = _scraper(max_new_details_per_run=1)
        cards = []
        for name in ('K1', 'N1', 'N2'):
            cards.append({'title': name, 'url': f'https://kbr.wd5.myworkdayjobs.com/en-US/KBR_Careers/job/x/{name}',
                          'external_path': f'/job/x/{name}', 'company': 'KBR', 'requisition_id': name,
                          'location_raw': 'US-TX-HOUSTON', 'posted_on': 'Posted Today'})

        async def fake_listing(client, max_jobs=None):
            return cards

        async def fake_detail(client, external_path):
            return {'description': 'A real description with enough words in it.', 'location': 'Houston, TX, US',
                    'posted_date': None, 'employment_type': None, 'requisition_id': None, 'skills': [], 'salary': None}

        s.fetch_listing = fake_listing
        s.fetch_detail = fake_detail
        s.set_known_url_checker(lambda url: url.endswith('K1'))
        jobs = await s.extract_all_jobs()
        # known job kept (listing only), one new job fetched, the other deferred
        assert [str(j.url).rsplit('/', 1)[-1] for j in jobs] == ['K1', 'N1']
