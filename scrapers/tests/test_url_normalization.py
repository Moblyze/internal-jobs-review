"""Tests for normalize_url — the dedup-key URL canonicalizer that collapses
Adzuna's per-fetch session tokens so the same posting isn't counted twice."""

from src.aggregators.dedup import normalize_url


def test_adzuna_session_token_collapses():
    a = "https://www.adzuna.co.uk/jobs/details/123456?se=AbCdEf123&v=1"
    b = "https://www.adzuna.co.uk/jobs/details/123456?se=ZzZzZz999&v=2"
    assert normalize_url(a) == normalize_url(b)


def test_distinct_jobs_stay_distinct():
    a = "https://www.adzuna.co.uk/jobs/details/123456?se=x"
    b = "https://www.adzuna.co.uk/jobs/details/999999?se=x"
    assert normalize_url(a) != normalize_url(b)


def test_real_query_param_preserved():
    # A genuine identifier in the query must survive (only volatile params drop).
    a = "https://boards.example.com/job?id=42&se=token"
    assert "id=42" in normalize_url(a)
    assert "token" not in normalize_url(a)


def test_utm_and_fragment_and_trailing_slash_stripped():
    a = "https://x.com/job/7/?utm_source=adzuna&utm_medium=cpc#apply"
    b = "https://x.com/job/7"
    assert normalize_url(a) == normalize_url(b)


def test_host_scheme_case_insensitive():
    assert normalize_url("HTTPS://Example.COM/Job/1") == normalize_url("https://example.com/Job/1")


def test_empty_and_garbage_safe():
    assert normalize_url("") == ""
    assert normalize_url("not a url") == "not a url"
