"""Pinpoint adapter: field mapping against the shape the live API returns.

Payloads here are trimmed copies of real V.Group postings fetched 2026-09-16.
"""

import pytest

from src.scrapers.pinpoint import (
    build_description,
    build_location,
    build_salary,
    is_vacancy,
    postings_url,
)


POSTING = {
    "id": "334361",
    "title": "Motorman for cruise vessel Ultramarine",
    "url": "https://vgroup.pinpointhq.com/en/postings/2e635024-7f5a-43a9-b2e6-81a76d0e8bcc",
    "description": "<div><p>We are looking for a Motorman.</p></div>",
    "key_responsibilities": "<ol><li>Maintain engines</li><li>Stand watch</li></ol>",
    "key_responsibilities_header": "Key Responsibilities",
    "skills_knowledge_expertise": "",
    "benefits": "",
    "employment_type_text": "Contract",
    "compensation": "$4,308 - $5,738 / month",
    "compensation_visible": False,
    "location": {"city": "London", "province": "United Kingdom", "name": "Shipboard"},
}


class TestPostingsUrl:
    @pytest.mark.parametrize(
        "base",
        ["https://vgroup.pinpointhq.com", "https://vgroup.pinpointhq.com/"],
    )
    def test_trailing_slash_does_not_double_up(self, base):
        assert postings_url(base) == "https://vgroup.pinpointhq.com/postings.json"


class TestLocation:
    def test_city_and_country(self):
        assert build_location(POSTING) == "London, United Kingdom"

    def test_us_board_puts_a_state_in_province(self):
        # Verified live: 14 of V.Group's 377 rows do this. "Mobile, Alabama"
        # geocodes correctly, so the pair is passed through unaltered.
        posting = {"location": {"city": "Mobile", "province": "Alabama"}}
        assert build_location(posting) == "Mobile, Alabama"

    def test_city_state_is_not_repeated(self):
        posting = {"location": {"city": "Singapore", "province": "Singapore"}}
        assert build_location(posting) == "Singapore"

    @pytest.mark.parametrize(
        "location,expected",
        [
            ({"city": "Aberdeen", "province": ""}, "Aberdeen"),
            ({"city": "", "province": "Norway"}, "Norway"),
            ({}, "Location Not Specified"),
            (None, "Location Not Specified"),
        ],
    )
    def test_partials(self, location, expected):
        assert build_location({"location": location}) == expected


class TestDescription:
    def test_joins_the_body_fields_with_their_headings(self):
        text = build_description(POSTING)
        assert "We are looking for a Motorman." in text
        assert "Key Responsibilities" in text
        assert "Maintain engines" in text
        assert "Stand watch" in text

    def test_html_is_stripped(self):
        assert "<" not in build_description(POSTING)

    def test_joining_beats_the_description_alone(self):
        # The reason this function exists: description alone has a median of
        # 421 chars on V.Group's board, under the site's 600-char publish gate.
        description_only = len(POSTING["description"])
        assert len(build_description(POSTING)) > description_only

    def test_empty_sections_are_skipped(self):
        text = build_description({"description": "<p>Only this</p>", "benefits": ""})
        assert text == "Only this"

    def test_nothing_to_build(self):
        assert build_description({}) == ""


class TestSalary:
    def test_hidden_compensation_is_never_published(self):
        # compensation_visible is the employer's own decision.
        assert build_salary(POSTING) is None

    def test_visible_compensation_keeps_its_period(self):
        posting = {**POSTING, "compensation_visible": True}
        assert build_salary(posting) == "$4,308 - $5,738 / month"

    def test_visible_but_blank(self):
        posting = {"compensation_visible": True, "compensation": "  "}
        assert build_salary(posting) is None


class TestNonVacancies:
    """Talent-pool adverts are not jobs and must not become job pages."""

    def test_register_interest_is_not_a_vacancy(self):
        # V.Group files 14 of these: "V.Ships Manila (Officers)", "V.Ships India".
        posting = {"title": "V.Ships Manila (Officers)", "location": {"name": "Register Interest"}}
        assert is_vacancy(posting) is False

    @pytest.mark.parametrize("name", ["Talent Pool", "SPECULATIVE", "register interest"])
    def test_variants_and_casing(self, name):
        assert is_vacancy({"location": {"name": name}}) is False

    @pytest.mark.parametrize(
        "location",
        [{"name": "Shipboard"}, {"name": ""}, {}, None],
    )
    def test_real_postings_pass(self, location):
        assert is_vacancy({"location": location}) is True
