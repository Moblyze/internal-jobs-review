"""Unit tests for src/utils/contact_extractor.py.

Run from scrapers/ with: python -m pytest tests/test_contact_extractor.py -v
"""

import pytest

from src.utils.contact_extractor import extract_contacts, EMPTY_RESULT


class TestExtractContactsBasics:
    def test_empty_description_returns_empty_result(self):
        result = extract_contacts("", "Rovop")
        assert result == EMPTY_RESULT

    def test_result_has_all_six_keys(self):
        result = extract_contacts("anything", "Rovop")
        expected_keys = {
            "contact_name",
            "contact_title",
            "contact_email",
            "contact_phone",
            "contact_linkedin_url",
            "contact_source",
        }
        assert set(result.keys()) == expected_keys
