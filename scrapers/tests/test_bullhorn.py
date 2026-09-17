"""Bullhorn OSCP adapter: URL building and field mapping.

Payloads are trimmed copies of real Peak Ocean Group rows fetched 2026-09-17.
"""

from datetime import timezone

import pytest

from src.scrapers.bullhorn import (
    build_description,
    build_location,
    build_posted_date,
    search_url,
)


class TestSearchUrl:
    def test_built_from_swimlane_and_corp_token(self):
        assert search_url('rest61', 'C5RJPS') == (
            'https://public-rest61.bullhornstaffing.com/rest-services/C5RJPS/search/JobOrder'
        )

    def test_a_second_employer_differs_only_in_those_two_values(self):
        # This is what made one adapter worth writing for both.
        assert search_url('rest23', '76FBES') == (
            'https://public-rest23.bullhornstaffing.com/rest-services/76FBES/search/JobOrder'
        )


class TestLocation:
    def test_city_state_and_country(self):
        job = {'address': {'city': 'Aberdeen', 'state': 'Scotland', 'countryName': 'United Kingdom'}}
        assert build_location(job) == 'Aberdeen, Scotland, United Kingdom'

    def test_null_state_is_skipped(self):
        # The real shape: Peak Ocean returns {"city": "District 9", "state": null}.
        job = {'address': {'city': 'District 9', 'state': None}}
        assert build_location(job) == 'District 9'

    def test_repeats_are_not_printed_twice(self):
        job = {'address': {'city': 'Singapore', 'countryName': 'Singapore'}}
        assert build_location(job) == 'Singapore'

    @pytest.mark.parametrize('job', [{}, {'address': None}, {'address': {}}])
    def test_nothing_usable(self, job):
        assert build_location(job) == 'Location Not Specified'


class TestDescription:
    def test_html_is_reduced_to_text(self):
        job = {'publicDescription': '<p>Lead the deck team.</p><ul><li>Valid STCW</li></ul>'}
        text = build_description(job)
        assert 'Lead the deck team.' in text
        assert 'Valid STCW' in text
        assert '<' not in text

    @pytest.mark.parametrize('job', [{}, {'publicDescription': ''}, {'publicDescription': '   '}])
    def test_nothing_to_build(self, job):
        assert build_description(job) == ''


class TestPostedDate:
    def test_date_last_published_is_milliseconds(self):
        dt = build_posted_date({'dateLastPublished': 1789444749853})
        assert dt is not None and dt.tzinfo == timezone.utc
        assert 2020 < dt.year < 2100

    @pytest.mark.parametrize('value', [None, 0, -1, 'today', {}])
    def test_unusable(self, value):
        assert build_posted_date({'dateLastPublished': value}) is None
