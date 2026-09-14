#!/usr/bin/env python3
"""Unit tests for the SmartRecruiters Posting API scraper.

Run with: python -m pytest tests/test_smartrecruiters.py -v
"""

from datetime import datetime

import pytest

from src.scrapers.smartrecruiters import SmartRecruitersScraper


def _scraper(**extra):
    cfg = {'name': 'Boskalis', 'platform': 'smartrecruiters', 'sheet_name': 'Boskalis',
           'base_url': 'https://jobs.smartrecruiters.com/Boskalis', 'rate_limit_delay': 0,
           'sr_config': {'company': 'boskalis'}, **extra}
    return SmartRecruitersScraper(cfg)


def _posting(pid, name, city='Aberdeen', country='gb', released='2026-09-11T16:19:02.552Z'):
    return {'id': pid, 'name': name, 'releasedDate': released, 'refNumber': f'REF{pid}',
            'company': {'name': 'Boskalis', 'identifier': 'Boskalis'},
            'location': {'city': city, 'region': 'Scotland', 'country': country,
                         'fullLocation': f'{city}, Scotland, United Kingdom'},
            'typeOfEmployment': {'id': 'permanent', 'label': 'Full-time'}}


class TestSmartRecruitersScraper:
    def test_company_from_config_or_url(self):
        assert _scraper().company_id == 'boskalis'
        s = SmartRecruitersScraper({'name': 'SGS', 'sheet_name': 'SGS', 'rate_limit_delay': 0,
                                    'base_url': 'https://jobs.smartrecruiters.com/SGS'})
        assert s.company_id == 'SGS'

    def test_job_url_is_public_page_without_slug(self):
        s = _scraper()
        assert s._job_url(_posting('744000149064569', 'Senior ROV Pilot Technician')) == (
            'https://jobs.smartrecruiters.com/Boskalis/744000149064569')

    def test_card_maps_listing_fields(self):
        card = _scraper()._card(_posting('1', 'ROV Pilot'))
        assert card['location'] == 'Aberdeen, Scotland, United Kingdom'
        assert card['posted_date'] == datetime(2026, 9, 11)
        assert card['employment_type'] == 'Full-Time'
        assert card['requisition_id'] == 'REF1'

    def test_description_joins_sections_in_order(self):
        ad = {'sections': {
            'companyDescription': {'title': 'Company Description', 'text': '<p>About us.</p>'},
            'jobDescription': {'title': 'Job Description', 'text': '<p>Pilot <b>ROVs</b>.</p><ul><li>one</li></ul>'},
            'qualifications': {'title': 'Qualifications', 'text': '<p>Five years.</p>'},
            'additionalInformation': {'title': 'Additional Information', 'text': ''},
        }}
        text = SmartRecruitersScraper._description_from_ad(ad)
        assert text == 'Pilot ROVs.\none\n\nQualifications\nFive years.\n\nCompany Description\nAbout us.'

    @pytest.mark.asyncio
    async def test_fetch_listing_pages_until_total_and_unions_queries(self):
        s = _scraper(sr_config={'company': 'sgs', 'queries': ['inspector', 'ndt']})
        calls = []
        # totalFound above PAGE_SIZE (100) forces a second page for 'inspector';
        # 'ndt' fits in one page and overlaps on posting 2.
        pages = {
            ('inspector', 0): {'totalFound': 101, 'content': [_posting('1', 'Inspector A'), _posting('2', 'Inspector B')]},
            ('inspector', 100): {'totalFound': 101, 'content': [_posting('3', 'Inspector C')]},
            ('ndt', 0): {'totalFound': 2, 'content': [_posting('2', 'Inspector B'), _posting('4', 'NDT Tech')]},
        }

        async def fake_request(client, url, params=None):
            calls.append((params.get('q'), params['offset']))
            return pages[(params.get('q'), params['offset'])]

        s._request = fake_request
        cards = await s.fetch_listing(client=None)
        assert calls == [('inspector', 0), ('inspector', 100), ('ndt', 0)]
        assert [c['id'] for c in cards] == ['1', '2', '3', '4']

    @pytest.mark.asyncio
    async def test_known_urls_skip_detail_and_budget_defers(self):
        s = _scraper(max_new_details_per_run=1)
        detail_calls = []

        async def fake_listing(client, max_jobs=None):
            return [s._card(_posting('K1', 'Known')), s._card(_posting('N1', 'New one')),
                    s._card(_posting('N2', 'New two'))]

        async def fake_detail(client, posting_id):
            detail_calls.append(posting_id)
            return {'description': 'A real description with enough words in it.',
                    'location': 'Papendrecht, ZH, Netherlands', 'posted_date': None,
                    'employment_type': 'Full-Time', 'requisition_id': 'REFN1'}

        s.fetch_listing = fake_listing
        s.fetch_detail = fake_detail
        s.set_known_url_checker(lambda url: url.endswith('/K1'))
        jobs = await s.extract_all_jobs()
        assert detail_calls == ['N1']
        assert [str(j.url).rsplit('/', 1)[-1] for j in jobs] == ['K1', 'N1']
        assert 'listing only' in jobs[0].description
        assert jobs[1].location == 'Papendrecht, ZH, Netherlands'
        assert jobs[1].requisition_id == 'REFN1'


class TestListingFailureReasonSurfaced:
    """2026-09-13 incident: listing_page_failed logged with no error text.
    _request() must record why in self._last_request_error, and
    fetch_listing must not swallow it."""

    @pytest.mark.asyncio
    async def test_listing_failure_carries_reason_forward(self):
        s = _scraper()

        async def failing_request(client, url, params=None):
            s._last_request_error = 'HTTP 429: rate limited'
            return None

        s._request = failing_request
        cards = await s.fetch_listing(client=None)

        assert cards == []
        assert s._last_request_error == 'HTTP 429: rate limited'
