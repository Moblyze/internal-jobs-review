"""Lever adapter: URL derivation and field mapping.

Payloads are trimmed copies of real Columbia Shipmanagement postings fetched
2026-09-16 from api.eu.lever.co.
"""

from datetime import timezone

import pytest

from src.scrapers.lever import (
    build_description,
    build_posted_date,
    postings_api_url,
    region_from_base_url,
    slug_from_base_url,
)


class TestUrlDerivation:
    """Lever runs separate US and EU deployments and a board exists on only one.
    api.lever.co/v0/postings/csmcy 404s; api.eu.lever.co returns 217."""

    def test_eu_board(self):
        assert postings_api_url('csmcy', 'eu') == 'https://api.eu.lever.co/v0/postings/csmcy?mode=json'

    @pytest.mark.parametrize('region', ['', None, 'us', 'US'])
    def test_us_is_the_default(self, region):
        assert postings_api_url('acme', region or '') == 'https://api.lever.co/v0/postings/acme?mode=json'

    def test_region_is_case_insensitive(self):
        assert 'api.eu.lever.co' in postings_api_url('csmcy', 'EU')

    @pytest.mark.parametrize(
        'base_url,slug,region',
        [
            ('https://jobs.eu.lever.co/csmcy', 'csmcy', 'eu'),
            ('https://jobs.eu.lever.co/csmcy/', 'csmcy', 'eu'),
            ('https://jobs.lever.co/acme', 'acme', ''),
        ],
    )
    def test_derived_from_the_public_board_url(self, base_url, slug, region):
        assert slug_from_base_url(base_url) == slug
        assert region_from_base_url(base_url) == region


class TestDescription:
    def test_description_and_additional_are_joined(self):
        posting = {'descriptionPlain': 'The role.', 'additionalPlain': 'Equal opportunity.'}
        assert build_description(posting) == 'The role.\n\nEqual opportunity.'

    def test_description_alone(self):
        assert build_description({'descriptionPlain': 'The role.'}) == 'The role.'

    @pytest.mark.parametrize('posting', [{}, {'descriptionPlain': '   '}])
    def test_nothing_to_build(self, posting):
        assert build_description(posting) == ''


class TestPostedDate:
    def test_created_at_is_milliseconds_not_seconds(self):
        # Read as seconds this lands in the year 58,000 and every freshness
        # rule downstream breaks quietly.
        dt = build_posted_date({'createdAt': 1788777158267})
        assert dt is not None
        assert dt.tzinfo == timezone.utc
        assert 2020 < dt.year < 2100

    @pytest.mark.parametrize('value', [None, 0, -1, 'yesterday', {}])
    def test_unusable_values(self, value):
        assert build_posted_date({'createdAt': value}) is None
