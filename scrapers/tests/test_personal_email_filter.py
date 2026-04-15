"""Tests for is_personal_email() — rejects generic mailboxes, accepts real names.

Run from scrapers/ with: python -m pytest tests/test_personal_email_filter.py -v
"""

import pytest

from src.utils.contact_extractor import is_personal_email


class TestBlocklistRejections:
    @pytest.mark.parametrize("email", [
        "info@company.com",
        "careers@company.com",
        "career@company.com",
        "jobs@company.com",
        "hr@company.com",
        "recruiting@company.com",
        "recruitment@company.com",
        "recruiter@company.com",
        "talent@company.com",
        "talentacquisition@company.com",
        "ta@company.com",
        "apply@company.com",
        "hiring@company.com",
        "contact@company.com",
        "enquiries@company.com",
        "inquiries@company.com",
        "hello@company.com",
        "support@company.com",
        "admin@company.com",
        "office@company.com",
        "mail@company.com",
        "no-reply@company.com",
        "noreply@company.com",
        "donotreply@company.com",
        "postmaster@company.com",
        "webmaster@company.com",
    ])
    def test_generic_mailboxes_rejected(self, email):
        assert is_personal_email(email, employer_name="Any Company") is False


class TestTeamPatterns:
    def test_dash_team_rejected(self):
        assert is_personal_email("sales-team@company.com", "Any Company") is False

    def test_underscore_team_rejected(self):
        assert is_personal_email("ops_team@company.com", "Any Company") is False


class TestPilotFalsePositives:
    """Addresses found in real scrape data that should have been rejected.

    Each of these slipped through an earlier filter iteration and produced
    junk contacts in the pilot output. Keeping them as regression guards.
    """

    @pytest.mark.parametrize("email", [
        "import@slb.com",           # Schlumberger — internal import queue
        "import@worley.com",        # Worley — internal import queue
        "emplymnt@chevron.com",     # Chevron — abbreviated employment queue
        "employment@acme.com",      # standard employment queue
        "TA.AMERICAS@worley.com",   # generic-first-token + region
        "hr.uk@company.com",        # generic-first-token + region
        "recruiting.na@company.com",
        "jobs.apac@company.com",
        "careers.eu@company.com",
    ])
    def test_pilot_false_positives_now_rejected(self, email):
        assert is_personal_email(email, "Company") is False


class TestGenericPrefixesWithSuffix:
    """Catch generic mailboxes with country/region/team suffixes — e.g.
    RecruitmentUK@, careersUS@, hrteam@ — that pass exact-match blocklist."""

    @pytest.mark.parametrize("email", [
        "recruitmentuk@company.com",
        "RecruitmentUK@company.com",
        "recruitmentus@company.com",
        "recruitingteam@company.com",
        "recruiterna@company.com",
        "careersuk@company.com",
        "careersteam@company.com",
        "jobsus@company.com",
        "hiringteam@company.com",
        "talentacquisition-na@company.com",
        "hruk@company.com",
        "hrteam@company.com",
        "infouk@company.com",
    ])
    def test_generic_prefix_variants_rejected(self, email):
        assert is_personal_email(email, "Any Company") is False


class TestCompanyNameRejection:
    def test_local_part_equals_employer_name_rejected(self):
        assert is_personal_email("rovop@rovop.com", "Rovop") is False

    def test_local_part_contains_employer_name_rejected(self):
        assert is_personal_email("baker-hughes@baker-hughes.com", "Baker Hughes") is False


class TestShapeHeuristic:
    @pytest.mark.parametrize("email", [
        "jane.doe@company.com",
        "j_doe@company.com",
        "jane.doe.recruiter@company.com",
    ])
    def test_dotted_localpart_accepted(self, email):
        assert is_personal_email(email, "Company") is True

    def test_single_token_localpart_accepted_if_long_enough(self):
        assert is_personal_email("janedoe@company.com", "Company") is True
        assert is_personal_email("jdoe@company.com", "Company") is True

    def test_too_short_localpart_rejected(self):
        assert is_personal_email("jd@company.com", "Company") is False


class TestCaseInsensitivity:
    def test_uppercase_blocklist_match_rejected(self):
        assert is_personal_email("INFO@Company.com", "Company") is False

    def test_uppercase_personal_accepted(self):
        assert is_personal_email("Jane.Doe@Company.com", "Company") is True
