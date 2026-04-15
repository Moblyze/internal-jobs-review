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


class TestBodyTextEmail:
    def test_personal_email_captured_from_body(self):
        desc = "If interested, send your CV to jane.doe@rovop.com by Friday."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_email"] == "jane.doe@rovop.com"
        assert result["contact_source"] == "body_text"

    def test_generic_email_not_captured(self):
        desc = "If interested, apply via careers@rovop.com."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_email"] == ""
        assert result["contact_source"] == ""

    def test_multiple_emails_first_personal_wins(self):
        desc = "General enquiries: info@rovop.com. Direct: mark.smith@rovop.com."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_email"] == "mark.smith@rovop.com"

    def test_company_name_email_rejected(self):
        desc = "Contact us at rovop@rovop.com for more info."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_email"] == ""
