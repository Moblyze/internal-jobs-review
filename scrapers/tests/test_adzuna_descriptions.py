#!/usr/bin/env python3
"""Unit tests for the Adzuna full-description recovery.

2026-09-16 defect: 966 active rows in the feed carried a description of exactly
500 characters, cut mid-word, and the public jobs site rejects anything under
600 characters. The cap is Adzuna's: its search API returns a 500-char snippet
ending in a horizontal ellipsis. The adapter now re-fetches the full text from
the schema.org JobPosting JSON-LD on the details page.

These tests cover the two things that actually broke:
 - the URL shapes Adzuna hands back (`/land/ad/<id>?se=…` and a bare
   `/details/<id>` both 403; only `/details/<id>` WITH the API attribution
   params serves the page), and
 - the never-shrink rule, so a bad fetch can never replace good stored text.

Run with: python -m pytest tests/test_adzuna_descriptions.py -v
"""

import httpx
import pytest

from src.aggregators.adzuna_adapter import (
    AdzunaAggregator,
    _extract_jsonld_description,
    _looks_truncated,
    detail_url,
)
from src.models.job import JobPosting

SNIPPET = "x" * 499 + "…"

# A real recovered description runs 1,400-12,500 chars (measured over 17 live
# Adzuna pages, 2026-09-16), so the fixture has to be longer than the snippet
# for the never-shrink rule to accept it.
_FULL_BODY = "Maintain the BOP and associated subsea equipment. " * 30

JSONLD_PAGE = (
    '<html><head>'
    '<script type="application/ld+json">{"@context":"http://schema.org",'
    '"itemListElement":[{"position":1}]}</script>'
    '<script type="application/ld+json">{"@context":"http://schema.org",'
    '"@type":"JobPosting","title":"Subsea Engineer",'
    '"description":"<p>The Role</p><ul><li>' + _FULL_BODY + '</li></ul>"}</script>'
    '</head><body></body></html>'
)


def _job(description=SNIPPET, url="https://www.adzuna.com/details/123"):
    return JobPosting(
        title="Subsea Engineer",
        company="Intec Sea",
        location="Houston, TX",
        description=description,
        url=url,
        source_aggregator="adzuna",
    )


class TestLooksTruncated:
    def test_ellipsis_ended_snippet_is_truncated(self):
        assert _looks_truncated(SNIPPET)

    def test_full_length_snippet_is_truncated_even_without_ellipsis(self):
        assert _looks_truncated("y" * 500)

    def test_short_real_description_is_not_truncated(self):
        assert not _looks_truncated("A genuinely short description.")

    def test_empty_is_not_truncated(self):
        assert not _looks_truncated("")


class TestDetailUrl:
    def test_land_ad_wrapper_is_rewritten_to_details(self):
        out = detail_url(
            "https://www.adzuna.com/land/ad/5810364240?se=WCTlXLmF8RGw8bj", "abc123"
        )
        assert out == (
            "https://www.adzuna.com/details/5810364240"
            "?utm_medium=api&utm_source=abc123"
        )

    def test_bare_details_url_gains_the_api_params(self):
        # A bare /details/<id> 403s; the params are what make it serve.
        assert detail_url("https://www.adzuna.com/details/999", "abc123").endswith(
            "/details/999?utm_medium=api&utm_source=abc123"
        )

    def test_existing_query_string_is_replaced_not_appended(self):
        out = detail_url(
            "https://www.adzuna.com/details/999?utm_medium=api&utm_source=old", "new"
        )
        assert out.count("?") == 1
        assert out.endswith("utm_source=new")

    def test_country_host_is_preserved(self):
        assert detail_url(
            "https://www.adzuna.co.uk/land/ad/42?se=tok", "k"
        ).startswith("https://www.adzuna.co.uk/details/42?")


class TestExtractJsonLd:
    def test_picks_the_jobposting_block_and_strips_html(self):
        text = _extract_jsonld_description(JSONLD_PAGE)
        assert text is not None
        assert "The Role" in text
        assert "Maintain the BOP" in text
        assert "<p>" not in text

    def test_page_without_jobposting_returns_none(self):
        assert _extract_jsonld_description("<html><body>gone</body></html>") is None

    def test_malformed_jsonld_does_not_raise(self):
        page = '<script type="application/ld+json">{not json</script>'
        assert _extract_jsonld_description(page) is None


class TestEnrichDescriptions:
    def _agg_with_transport(self, handler):
        agg = AdzunaAggregator()
        transport = httpx.MockTransport(handler)
        original = httpx.Client

        def _client(*args, **kwargs):
            kwargs["transport"] = transport
            return original(*args, **kwargs)

        return agg, _client

    def test_snippet_is_replaced_with_full_text(self, monkeypatch):
        def handler(request):
            assert "/details/123" in str(request.url)
            assert "utm_medium=api" in str(request.url)
            return httpx.Response(200, text=JSONLD_PAGE)

        agg, client_factory = self._agg_with_transport(handler)
        monkeypatch.setattr(httpx, "Client", client_factory)
        jobs = [_job()]
        agg._enrich_descriptions(jobs)
        assert "Maintain the BOP" in jobs[0].description
        assert not jobs[0].description.endswith("…")

    def test_expired_posting_keeps_the_snippet(self, monkeypatch):
        # Adzuna serves 410 once a posting expires. Keeping the snippet leaves
        # the row under the 600-char gate, which is the correct outcome: the
        # gate doubles as a staleness filter.
        agg, client_factory = self._agg_with_transport(
            lambda request: httpx.Response(410, text="gone")
        )
        monkeypatch.setattr(httpx, "Client", client_factory)
        jobs = [_job()]
        agg._enrich_descriptions(jobs)
        assert jobs[0].description == SNIPPET

    def test_shorter_fetched_text_is_discarded(self, monkeypatch):
        short_page = (
            '<script type="application/ld+json">{"@type":"JobPosting",'
            '"description":"too short"}</script>'
        )
        agg, client_factory = self._agg_with_transport(
            lambda request: httpx.Response(200, text=short_page)
        )
        monkeypatch.setattr(httpx, "Client", client_factory)
        jobs = [_job()]
        agg._enrich_descriptions(jobs)
        assert jobs[0].description == SNIPPET

    def test_untruncated_jobs_are_never_fetched(self, monkeypatch):
        calls = []

        def handler(request):
            calls.append(str(request.url))
            return httpx.Response(200, text=JSONLD_PAGE)

        agg, client_factory = self._agg_with_transport(handler)
        monkeypatch.setattr(httpx, "Client", client_factory)
        jobs = [_job(description="A short but complete description of the role.")]
        agg._enrich_descriptions(jobs)
        assert calls == []

    def test_toggle_off_skips_enrichment(self, monkeypatch):
        monkeypatch.setenv("ADZUNA_FETCH_FULL_DESCRIPTIONS", "0")
        assert AdzunaAggregator().fetch_full_descriptions is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
