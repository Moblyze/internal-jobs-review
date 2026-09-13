#!/usr/bin/env python3
"""Unit tests for the Rippling ATS scraper's empty-board handling.

Run with: python -m pytest tests/test_rippling.py -v

Context (2026-09-13): Forge's board returned zero __NEXT_DATA__ queries at
all (Rippling doesn't register the job-posts query server-side when a tenant
has no open roles), which the adapter previously raised as
"job-posts query not found", surfacing as extraction_failed. Confirmed live
against a healthy tenant (qesolar: 3 queries including job-posts) that the
empty-queries shape is specific to a board with nothing posted, not a parse
break -- so it should resolve to zero jobs cleanly instead of an exception.
"""

import pytest

from src.scrapers.rippling import RipplingScraper


def _scraper(**extra):
    cfg = {'name': 'Forge', 'platform': 'rippling', 'sheet_name': 'Forge',
           'base_url': 'https://ats.rippling.com/forge-careers-2/jobs', 'rate_limit_delay': 0,
           'rippling_slug': 'forge-careers-2', **extra}
    return RipplingScraper(cfg)


class TestRipplingEmptyBoard:
    def test_no_queries_at_all_resolves_to_empty_page_not_an_exception(self):
        s = _scraper()
        s._fetch_next_data = lambda url: {
            'props': {'pageProps': {'dehydratedState': {'queries': []}}}
        }
        page = s._fetch_listing_page(0)
        assert page == {'items': [], 'totalPages': 1, 'totalItems': 0}

    def test_job_posts_query_present_still_returns_its_data(self):
        s = _scraper()
        expected = {'items': [{'url': 'https://x/1'}], 'totalPages': 1, 'totalItems': 1}
        s._fetch_next_data = lambda url: {
            'props': {'pageProps': {'dehydratedState': {'queries': [
                {'queryKey': ['board', 'forge-careers-2', 'job-posts', False, {}],
                 'state': {'data': expected}},
            ]}}}
        }
        assert s._fetch_listing_page(0) == expected

    def test_queries_present_but_no_job_posts_entry_still_raises(self):
        """A genuine structural break (queries present, job-posts missing)
        must still surface as an error -- only the all-empty shape is treated
        as a legitimately empty board."""
        s = _scraper()
        s._fetch_next_data = lambda url: {
            'props': {'pageProps': {'dehydratedState': {'queries': [
                {'queryKey': ['board', 'forge-careers-2', 'locations']},
            ]}}}
        }
        with pytest.raises(RuntimeError, match='job-posts query not found'):
            s._fetch_listing_page(0)

    @pytest.mark.asyncio
    async def test_extract_all_jobs_returns_empty_list_for_empty_board(self):
        s = _scraper()
        s._fetch_listing_page = lambda page: {'items': [], 'totalPages': 1, 'totalItems': 0}
        jobs = await s.extract_all_jobs()
        assert jobs == []
