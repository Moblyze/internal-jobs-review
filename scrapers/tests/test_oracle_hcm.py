#!/usr/bin/env python3
"""Unit tests for the Oracle HCM scraper (multi-site, known-URL skip, budget).

Run with: python -m pytest tests/test_oracle_hcm.py -v
"""

import pytest

from src.scrapers.oracle_hcm import OracleHCMScraper


def _scraper(**hcm):
    cfg = {
        'name': 'Intertek', 'platform': 'oracle_hcm', 'sheet_name': 'Intertek',
        'base_url': 'https://hcog.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1',
        'rate_limit_delay': 0,
        'oracle_hcm_config': {
            'api_base': 'https://hcog.fa.em2.oraclecloud.com/hcmRestApi/resources/latest',
            'job_url_template': 'https://hcog.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/{site}/job/{req_id}',
            **hcm,
        },
    }
    return OracleHCMScraper(cfg)


def _page(reqs, total):
    return {'items': [{'TotalJobsCount': total, 'requisitionList': reqs}]}


def _req(rid, title='Inspector', desc=''):
    return {'Id': rid, 'Title': title, 'PrimaryLocation': 'Aberdeen, UK',
            'PostedDate': '2026-09-10', 'ExternalDescriptionStr': desc}


class TestOracleHCMScraper:
    def test_single_site_config_still_works(self):
        s = _scraper(site_number='jobs')
        assert s.site_numbers == ['jobs']
        assert 'siteNumber=jobs,' in s._build_search_url()

    def test_site_numbers_walks_every_site_and_dedupes_by_id(self):
        s = _scraper(site_numbers=['CX_1', 'CX_1003'])
        calls = []

        def fake_fetch_page(offset=0, site=None):
            calls.append((site, offset))
            if site == 'CX_1':
                return _page([_req('1', desc='x' * 60), _req('2', desc='x' * 60)], 2)
            return _page([_req('2', desc='x' * 60), _req('3', desc='x' * 60)], 2)

        s._fetch_page = fake_fetch_page
        jobs = s._fetch_all_requisitions()
        assert calls == [('CX_1', 0), ('CX_1003', 0)]
        assert [j['requisition_id'] for j in jobs] == ['1', '2', '3']
        assert jobs[0]['url'].endswith('/sites/CX_1/job/1')
        assert jobs[2]['url'].endswith('/sites/CX_1003/job/3')

    def test_known_urls_skip_detail_and_budget_defers_unseen(self):
        s = _scraper(site_number='CX_1')
        s.max_new_details = 1
        detail_calls = []

        def fake_detail(req_id):
            detail_calls.append(req_id)
            return {'ExternalDescriptionStr': '<p>Full description text for the job.</p>'}

        s._fetch_requisition_detail = fake_detail
        s._fetch_page = lambda offset=0, site=None: _page(
            [_req('K1'), _req('N1'), _req('N2')], 3)
        s.set_known_url_checker(lambda url: url.endswith('/job/K1'))

        jobs = s._fetch_all_requisitions()
        assert detail_calls == ['N1']
        assert [j['requisition_id'] for j in jobs] == ['K1', 'N1']
        assert 'listing only' in jobs[0]['description']
        assert jobs[1]['description'] == 'Full description text for the job.'
        assert s._deferred == 1 and s._skipped_known == 1

    @pytest.mark.asyncio
    async def test_extract_all_jobs_builds_postings(self):
        s = _scraper(site_number='CX_1')
        s._fetch_page = lambda offset=0, site=None: _page([_req('7', desc='<p>' + 'y' * 80 + '</p>')], 1)
        jobs = await s.extract_all_jobs()
        assert len(jobs) == 1
        assert str(jobs[0].url) == 'https://hcog.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/7'
        assert jobs[0].location == 'Aberdeen, UK'
