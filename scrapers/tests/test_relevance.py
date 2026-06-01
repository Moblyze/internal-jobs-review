"""Tests for the aggregator relevance filter, focused on the company-name
`relevance_require` gate that prevents keyword-bleed on company-specific
profiles (e.g. a "Finnco" profile keeping generic "Energy Jobline" postings)."""

from src.aggregators.relevance import RelevanceFilter


class _Job:
    def __init__(self, title="", company="", description=""):
        self.title = title
        self.company = company
        self.description = description


def test_require_keeps_job_naming_company_in_company_field():
    rf = RelevanceFilter(
        include_keywords=["finnco", "energy", "engineering", "services"],
        require_keywords=["finnco"],
    )
    ok, _ = rf.is_relevant(_Job(title="Project Engineer", company="Finnco Service"))
    assert ok is True


def test_require_keeps_job_naming_company_in_title():
    rf = RelevanceFilter(require_keywords=["rig integrity"])
    ok, _ = rf.is_relevant(_Job(title="Rig Integrity Inspector", company="Some Agency"))
    assert ok is True


def test_require_rejects_generic_industry_bleed():
    # This is the exact bug: an unrelated job passes the permissive include
    # list via the word "energy" but must be rejected because it never names
    # the target company.
    rf = RelevanceFilter(
        include_keywords=["finnco", "energy", "engineering", "services"],
        require_keywords=["finnco"],
    )
    ok, reason = rf.is_relevant(
        _Job(title="Lineman / Line Worker", company="Vistra Energy")
    )
    assert ok is False
    assert "required keyword" in reason


def test_require_does_not_match_company_mention_in_description_only():
    # A tangential mention in a long description is not evidence the job
    # belongs to the company.
    rf = RelevanceFilter(require_keywords=["finnco"])
    ok, _ = rf.is_relevant(
        _Job(title="Welder", company="ACME", description="worked alongside Finnco once")
    )
    assert ok is False


def test_exclude_still_takes_priority():
    rf = RelevanceFilter(
        exclude_keywords=["nurse"],
        require_keywords=["finnco"],
    )
    ok, reason = rf.is_relevant(_Job(title="Finnco Nurse", company="Finnco"))
    assert ok is False
    assert "exclude" in reason


def test_no_require_falls_back_to_include_behaviour():
    # Broad category profiles (no require) keep the original loose-include match.
    rf = RelevanceFilter(include_keywords=["subsea", "rov"])
    assert rf.is_relevant(_Job(title="ROV Pilot", company="X"))[0] is True
    assert rf.is_relevant(_Job(title="Barista", company="Cafe"))[0] is False
