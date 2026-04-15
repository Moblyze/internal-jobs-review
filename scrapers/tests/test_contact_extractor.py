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
        desc = "If interested, send your CV to jdoe@rovop.com by Friday."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_email"] == "jdoe@rovop.com"
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


class TestEmailDerivedName:
    def test_dotted_email_derives_name(self):
        desc = "Apply via jane.doe@rovop.com."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_email"] == "jane.doe@rovop.com"
        assert result["contact_name"] == "Jane Doe"
        assert result["contact_source"] == "email_derived"

    def test_underscore_email_derives_name(self):
        desc = "Apply via mark_smith@rovop.com."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_name"] == "Mark Smith"
        assert result["contact_source"] == "email_derived"

    def test_single_token_email_does_not_derive_name(self):
        desc = "Apply via jdoe@rovop.com."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_email"] == "jdoe@rovop.com"
        assert result["contact_name"] == ""
        assert result["contact_source"] == "body_text"

    def test_three_token_email_derives_three_name_parts(self):
        desc = "Apply via jane.doe.recruiter@rovop.com."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_name"] == "Jane Doe Recruiter"


class TestLabeledPatterns:
    def test_contact_label_captures_name(self):
        desc = "Contact: Jane Doe for details about this role."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_name"] == "Jane Doe"
        assert result["contact_source"] == "labeled_pattern"

    def test_recruiter_label_captures_name(self):
        desc = "Recruiter: Mark Smith"
        result = extract_contacts(desc, "Rovop")
        assert result["contact_name"] == "Mark Smith"
        assert result["contact_source"] == "labeled_pattern"

    def test_hiring_manager_label_captures_name(self):
        desc = "Hiring Manager: Dr. Amy Chen leads the ROV team."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_name"].startswith("Amy Chen") or result["contact_name"] == "Dr. Amy Chen"
        assert result["contact_source"] == "labeled_pattern"

    def test_posted_by_captures_name(self):
        desc = "Posted by John Taylor, Subsea Operations."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_name"] == "John Taylor"

    def test_action_verb_name_rejected(self):
        desc = "Contact: Apply Now via our career site."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_name"] == ""
        assert result["contact_source"] == ""

    def test_single_capitalized_word_rejected(self):
        desc = "Contact: HR"
        result = extract_contacts(desc, "Rovop")
        assert result["contact_name"] == ""


class TestProximityLinking:
    def test_name_and_email_within_150_chars_link_as_labeled(self):
        desc = "For more information contact: Jane Doe at jane.doe@rovop.com."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_name"] == "Jane Doe"
        assert result["contact_email"] == "jane.doe@rovop.com"
        assert result["contact_source"] == "labeled_pattern"

    def test_name_far_from_email_is_still_used_but_flagged(self):
        far_filler = "x" * 300
        desc = f"Contact: Jane Doe reports in Aberdeen. {far_filler} Apply via careers@rovop.com, no details."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_name"] == "Jane Doe"
        assert result["contact_source"] == "labeled_pattern"
        assert result["contact_email"] == ""


class TestLinkedInUrl:
    def test_linkedin_profile_url_captured(self):
        desc = "Reach out to Jane Doe — https://linkedin.com/in/jane-doe-rovop for more."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_linkedin_url"] == "https://linkedin.com/in/jane-doe-rovop"

    def test_linkedin_url_with_www_captured(self):
        desc = "www.linkedin.com/in/mark-smith-sub"
        result = extract_contacts(desc, "Rovop")
        assert "linkedin.com/in/mark-smith-sub" in result["contact_linkedin_url"]

    def test_linkedin_company_url_not_captured(self):
        desc = "Visit our company page at linkedin.com/company/rovop."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_linkedin_url"] == ""

    def test_linkedin_present_without_person_still_populates(self):
        desc = "Profile: https://linkedin.com/in/amy-chen/"
        result = extract_contacts(desc, "Rovop")
        assert "linkedin.com/in/amy-chen" in result["contact_linkedin_url"]
        assert result["contact_name"] == ""


class TestPhoneExtraction:
    def test_phone_captured_near_personal_email(self):
        desc = "For info contact jane.doe@rovop.com or call +44 1224 555 7890."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_phone"] == "+44 1224 555 7890"

    def test_phone_captured_near_labeled_name(self):
        desc = "Contact: Jane Doe — (713) 555-0199."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_phone"] == "(713) 555-0199"

    def test_phone_without_context_not_captured(self):
        # Phone appears far from any labeled name or personal email.
        desc = "The Rovop switchboard is +44 1224 300 300. " + ("x" * 400) + " Apply online only."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_phone"] == ""

    def test_phone_in_standalone_description_not_captured(self):
        desc = "The office number is (713) 555-1234. Please apply via our website."
        result = extract_contacts(desc, "Rovop")
        assert result["contact_phone"] == ""
