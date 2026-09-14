#!/usr/bin/env python3
"""Unit tests for the iCIMS scraper (legacy HTML portal and new JSON portal).

Run with: python -m pytest tests/test_icims.py -v
"""

import json
from datetime import datetime

import pytest

from src.scrapers.icims import ICIMSScraper


def _legacy(**extra):
    return ICIMSScraper({'name': 'Acuren', 'platform': 'icims', 'sheet_name': 'Acuren',
                         'base_url': 'https://uscareers-acuren.icims.com/jobs/search?ss=1',
                         'rate_limit_delay': 0, **extra})


def _portal(**extra):
    return ICIMSScraper({'name': 'Danos', 'platform': 'icims', 'sheet_name': 'Danos',
                         'base_url': 'https://jobs.danos.com/careers-home/jobs', 'rate_limit_delay': 0, **extra})


LEGACY_LISTING = '''
<span class="iCIMS_Pagination">Page 1 of 5</span>
<div class="row"><div class="col-xs-12">Search Results</div></div>
<div class="row">
  <div class="col-xs-6 header left"><span class="sr-only field-label">Job Locations</span><span>
  US-UT-North Salt Lake</span></div>
  <div class="col-xs-12 title"><a class="iCIMS_Anchor" href="https://uscareers-acuren.icims.com/jobs/22245/full-time-nde-assistant---travel-80%25/job?in_iframe=1">
  <span class="sr-only field-label">Title</span><h3>Full Time NDE Assistant - Travel 80%</h3></a></div>
  <dl class="iCIMS_JobHeaderGroup">
   <div class="iCIMS_JobHeaderTag"><dt class="iCIMS_JobHeaderField">Requisition ID</dt><dd class="iCIMS_JobHeaderData"><span>2026-22245</span></dd></div>
   <div class="iCIMS_JobHeaderTag"><dt class="iCIMS_JobHeaderField">Position Type</dt><dd class="iCIMS_JobHeaderData"><span>Regular Full-Time</span></dd></div>
  </dl>
</div>
'''


def _legacy_detail_page():
    ld = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': 'Rope Access III',
          'description': '<p>Perform <b>NDE</b> inspections.</p><ul><li>IRATA L3</li></ul>',
          'datePosted': '2026-09-11T04:00:00.000Z', 'validThrough': '2027-09-11T04:00:00.000Z',
          'employmentType': 'FULL_TIME',
          'jobLocation': [{'@type': 'Place', 'address': {'@type': 'PostalAddress', 'addressLocality': 'Duluth',
                                                          'addressRegion': 'MN', 'addressCountry': 'US'}}]}
    return f'<html><head><script type="application/ld+json">{json.dumps(ld)}</script></head><body></body></html>'


class TestLegacyPortal:
    def test_mode_from_host(self):
        assert _legacy().mode == 'legacy'
        assert _portal().mode == 'portal'

    def test_canonical_url_strips_iframe_flag(self):
        assert ICIMSScraper.canonical_legacy_url(
            'https://x.icims.com/jobs/22245/full-time-nde/job?in_iframe=1') == 'https://x.icims.com/jobs/22245/full-time-nde/job'

    def test_parse_listing_rows_and_page_count(self):
        s = _legacy()
        assert ICIMSScraper.parse_legacy_page_count(LEGACY_LISTING) == 5
        cards = s.parse_legacy_listing(LEGACY_LISTING)
        assert len(cards) == 1
        c = cards[0]
        assert c['title'] == 'Full Time NDE Assistant - Travel 80%'
        assert c['url'] == 'https://uscareers-acuren.icims.com/jobs/22245/full-time-nde-assistant---travel-80%25/job'
        assert c['location'] == 'US-UT-North Salt Lake'
        assert c['requisition_id'] == '2026-22245'
        assert c['employment_type'] == 'Full-Time'  # base normalizer maps "Regular Full-Time"

    def test_parse_detail_json_ld(self):
        d = _legacy().parse_legacy_detail(_legacy_detail_page())
        assert d['description'] == 'Perform NDE inspections.\nIRATA L3'
        assert d['posted_date'] == datetime(2026, 9, 11)
        assert d['valid_through'] == datetime(2027, 9, 11)
        assert d['location'] == 'Duluth, MN, US'
        assert d['employment_type'] == 'FULL_TIME'

    @pytest.mark.asyncio
    async def test_known_urls_skip_detail_and_budget_defers(self):
        s = _legacy(max_new_details_per_run=1)
        calls = []

        async def fake_listing(client, max_jobs=None):
            return [{'title': t, 'url': f'https://uscareers-acuren.icims.com/jobs/{i}/{t.lower()}/job', 'company': 'Acuren',
                     'location': 'US-TX-Houston', 'requisition_id': str(i), 'employment_type': None, 'posted_date': None}
                    for i, t in ((1, 'Known'), (2, 'New'), (3, 'Later'))]

        async def fake_detail(client, url):
            calls.append(url)
            return {'description': 'A real description with enough words in it.', 'posted_date': datetime(2026, 9, 1),
                    'location': 'Houston, TX, US'}

        s.fetch_legacy_listing = fake_listing
        s.fetch_detail = fake_detail
        s.set_known_url_checker(lambda url: url.endswith('/1/known/job'))
        jobs = await s.extract_all_jobs()
        assert calls == ['https://uscareers-acuren.icims.com/jobs/2/new/job']
        assert [j.requisition_id for j in jobs] == ['1', '2']
        assert 'listing only' in jobs[0].description
        assert jobs[1].location == 'Houston, TX, US' and jobs[1].posted_date == datetime(2026, 9, 1)


class TestNewPortal:
    def test_parse_portal_job(self):
        job = {'data': {'slug': '5504', 'req_id': '5504', 'title': 'Roustabout',
                        'description': '<p>Offshore <b>work</b>.</p>', 'qualifications': '<ul><li>TWIC</li></ul>',
                        'full_location': 'Carlsbad, New Mexico', 'posted_date': '2026-09-11T14:11:00+0000',
                        'employment_type': 'FULL_TIME', 'salary_value': 0}}
        c = _portal().parse_portal_job(job)
        assert c['url'] == 'https://jobs.danos.com/jobs/5504'
        assert c['description'] == 'Offshore work.\n\nTWIC'
        assert c['location'] == 'Carlsbad, New Mexico'
        assert c['posted_date'] == datetime(2026, 9, 11)
        assert c['employment_type'] == 'Full-Time'
        assert c['salary'] is None

    @pytest.mark.asyncio
    async def test_portal_listing_pages_until_total(self):
        s = _portal()
        pages = {1: {'totalCount': 3, 'jobs': [{'data': {'slug': 'a', 'req_id': 'a', 'title': 'A', 'description': 'x' * 30}},
                                              {'data': {'slug': 'b', 'req_id': 'b', 'title': 'B', 'description': 'x' * 30}}]},
                 2: {'totalCount': 3, 'jobs': [{'data': {'slug': 'c', 'req_id': 'c', 'title': 'C', 'description': 'x' * 30}}]}}
        calls = []

        class Resp:
            def __init__(self, d):
                self._d = d
                self.text = json.dumps(d)

            def json(self):
                return self._d

        async def fake_get(client, url):
            page = int(url.split('page=')[1].split('&')[0])
            calls.append(page)
            return Resp(pages[page])

        s._get = fake_get
        jobs = await s.extract_all_jobs()
        assert calls == [1, 2]
        assert [j.requisition_id for j in jobs] == ['a', 'b', 'c']
        assert str(jobs[0].url) == 'https://jobs.danos.com/jobs/a'


class TestListingFailureReasonSurfaced:
    """2026-09-13 incident: listing_page_failed logged with no error text.
    _get() must record why in self._last_request_error, for both portal
    flavors, and fetch_*_listing must not swallow it."""

    @pytest.mark.asyncio
    async def test_legacy_listing_failure_carries_reason_forward(self):
        s = _legacy()

        async def failing_get(client, url):
            s._last_request_error = 'HTTP 500'
            return None

        s._get = failing_get
        cards = await s.fetch_legacy_listing(client=None)

        assert cards == []
        assert s._last_request_error == 'HTTP 500'

    @pytest.mark.asyncio
    async def test_portal_listing_failure_carries_reason_forward(self):
        s = _portal()

        async def failing_get(client, url):
            s._last_request_error = 'ConnectError: Connection refused'
            return None

        s._get = failing_get
        cards = await s.fetch_portal_listing(client=None)

        assert cards == []
        assert s._last_request_error == 'ConnectError: Connection refused'
