#!/usr/bin/env python3
"""Unit tests for the browser-based Workday scraper's location handling.

Run with: python -m pytest tests/test_workday.py -v
"""

import httpx
import pytest

from src.scrapers.workday import (
    _wday_api_detail_url,
    fetch_additional_workday_locations,
    parse_workday_location,
)


class TestWdayApiDetailUrl:
    def test_derives_cxs_endpoint_from_public_job_url(self):
        job_url = (
            'https://bakerhughes.wd5.myworkdayjobs.com/en-US/BakerHughes'
            '/job/VN-HO-CHI-MINH/Engineer-2_R167556'
        )
        assert _wday_api_detail_url(job_url) == (
            'https://bakerhughes.wd5.myworkdayjobs.com/wday/cxs/bakerhughes/BakerHughes'
            '/job/VN-HO-CHI-MINH/Engineer-2_R167556'
        )

    def test_returns_none_for_a_url_with_no_job_segment(self):
        assert _wday_api_detail_url('https://bakerhughes.wd5.myworkdayjobs.com/en-US/BakerHughes') is None


class TestFetchAdditionalWorkdayLocations:
    @pytest.mark.asyncio
    async def test_returns_parsed_additional_locations(self, monkeypatch):
        job_url = 'https://mpc.wd1.myworkdayjobs.com/en-US/MPCCareers/job/Findlay-Ohio/Analyst_00024029'

        class FakeResponse:
            status_code = 200

            def json(self):
                return {'jobPostingInfo': {'additionalLocations': ['US-TX-SAN ANTONIO', 'US-TX-HOUSTON']}}

        async def fake_get(self, url, headers=None, timeout=None):
            assert url == (
                'https://mpc.wd1.myworkdayjobs.com/wday/cxs/mpc/MPCCareers'
                '/job/Findlay-Ohio/Analyst_00024029'
            )
            return FakeResponse()

        monkeypatch.setattr(httpx.AsyncClient, 'get', fake_get)
        locations = await fetch_additional_workday_locations(job_url)
        assert locations == [
            parse_workday_location('US-TX-SAN ANTONIO'),
            parse_workday_location('US-TX-HOUSTON'),
        ]

    @pytest.mark.asyncio
    async def test_returns_empty_list_on_non_200(self, monkeypatch):
        class FakeResponse:
            status_code = 404

        async def fake_get(self, url, headers=None, timeout=None):
            return FakeResponse()

        monkeypatch.setattr(httpx.AsyncClient, 'get', fake_get)
        job_url = 'https://mpc.wd1.myworkdayjobs.com/en-US/MPCCareers/job/x/y_R1'
        assert await fetch_additional_workday_locations(job_url) == []

    @pytest.mark.asyncio
    async def test_returns_empty_list_on_network_error(self, monkeypatch):
        async def fake_get(self, url, headers=None, timeout=None):
            raise httpx.ConnectError('boom')

        monkeypatch.setattr(httpx.AsyncClient, 'get', fake_get)
        job_url = 'https://mpc.wd1.myworkdayjobs.com/en-US/MPCCareers/job/x/y_R1'
        assert await fetch_additional_workday_locations(job_url) == []

    @pytest.mark.asyncio
    async def test_returns_empty_list_for_url_with_no_job_segment(self):
        assert await fetch_additional_workday_locations('https://mpc.wd1.myworkdayjobs.com/en-US/MPCCareers') == []
