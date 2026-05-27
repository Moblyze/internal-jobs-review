"""Tests for the GulfTalent aggregator adapter.

GulfTalent is behind Akamai (headless requests are 403'd), so the live fetch
runs a headed Chromium. These tests exercise the pure HTML parsing logic
against a saved fixture of a real category page — no network required.
"""

import os
from src.aggregators.gulftalent_adapter import GulfTalentAggregator

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "gulftalent_category.html")


def _fixture_html() -> str:
    with open(FIXTURE, encoding="utf-8") as f:
        return f.read()


def test_parse_total_count_reads_jobs_found_banner():
    agg = GulfTalentAggregator()
    assert agg._parse_total_count(_fixture_html()) == 233


def test_parse_listings_extracts_all_table_rows():
    # The fixture category page has 25 job rows (tr.content-visibility-auto).
    agg = GulfTalentAggregator()
    jobs = agg._parse_listings(_fixture_html())
    assert len(jobs) == 25


def test_parse_listings_maps_card_fields_correctly():
    agg = GulfTalentAggregator()
    jobs = agg._parse_listings(_fixture_html())
    first = jobs[0]
    assert first.title == "Driver"
    assert first.company == "Hilton Luxor Resort & Spa"
    assert first.location == "Doha, Qatar"
    assert str(first.url) == "https://www.gulftalent.com/qatar/jobs/driver-587922"
    assert first.source_aggregator == "gulftalent"
    # No description on the listing card -> synthesized, must satisfy the model.
    assert len(first.description) >= 10


def test_parse_listings_skips_cta_and_sidebar_links():
    # a.list-group-item CTAs (/register/jobalert, localized category links)
    # must NOT be parsed as jobs.
    agg = GulfTalentAggregator()
    jobs = agg._parse_listings(_fixture_html())
    urls = [str(j.url) for j in jobs]
    assert not any("/register/" in u for u in urls)
    assert not any("/jobs/category/" in u for u in urls)


def test_detect_employment_type_flags_contract_and_temporary_titles():
    agg = GulfTalentAggregator()
    assert agg._detect_employment_type("Subsea Engineer (Contract)") == "Contract"
    assert agg._detect_employment_type("Welder - Contractor") == "Contract"
    assert agg._detect_employment_type("Rotational Drilling Supervisor") == "Contract"
    assert agg._detect_employment_type("Temporary Site Clerk") == "Temporary"
    # A plain permanent-looking title yields no inferred type.
    assert agg._detect_employment_type("Driver") is None
