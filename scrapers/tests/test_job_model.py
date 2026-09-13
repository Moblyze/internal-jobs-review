#!/usr/bin/env python3
"""Unit tests for the JobPosting model's `locations` field (multi-location capture).

Run with: python -m pytest tests/test_job_model.py -v
"""

from src.models.job import JobPosting


def _job(**overrides):
    fields = {
        'title': 'Field Engineer',
        'company': 'Acme Energy',
        'location': 'Houston, TX, US',
        'description': 'A real description with enough words in it.',
        'url': 'https://example.com/jobs/1',
    }
    fields.update(overrides)
    return JobPosting(**fields)


class TestLocationsDefault:
    def test_defaults_to_a_single_item_list_matching_location(self):
        """Scrapers that haven't been extended to capture multiple locations
        (the vast majority) never set `locations` explicitly. Every
        validated JobPosting must still carry a non-empty list so downstream
        consumers can rely on it without a None/empty check."""
        job = _job()
        assert job.locations == ['Houston, TX, US']

    def test_explicit_locations_are_kept_as_is(self):
        job = _job(locations=['Houston, TX, US', 'Dubai, AE'])
        assert job.locations == ['Houston, TX, US', 'Dubai, AE']

    def test_first_location_field_is_unchanged_by_this_feature(self):
        """`location` must always stay exactly the first/primary value, same
        as before multi-location capture existed."""
        job = _job(location='Houston, TX, US', locations=['Houston, TX, US', 'Dubai, AE'])
        assert job.location == 'Houston, TX, US'
        assert job.locations[0] == job.location

    def test_sanitized_company_name_location_is_reflected_in_locations_too(self):
        """sanitize_company_in_location replaces a company-name-looking
        `location` with 'Unknown'; when locations wasn't set explicitly it
        should default from the *sanitized* value, not the original."""
        job = _job(location='Acme Energy', company='Acme Energy')
        assert job.location == 'Unknown'
        assert job.locations == ['Unknown']


class TestToSheetRow:
    def test_locations_column_blank_for_a_single_location(self):
        row = _job().to_sheet_row()
        assert row[-1] == ''

    def test_locations_column_semicolon_joined_for_multiple(self):
        row = _job(locations=['Houston, TX, US', 'Dubai, AE']).to_sheet_row()
        assert row[-1] == 'Houston, TX, US; Dubai, AE'

    def test_row_length_matches_header_row(self):
        from src.exporters.sheets import SheetsExporter
        assert len(_job().to_sheet_row()) == len(SheetsExporter.HEADER_ROW)
