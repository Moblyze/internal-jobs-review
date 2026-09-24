#!/usr/bin/env python3
"""Dead-job removal policy (2026-09-24).

Rule: rows individually confirmed DEAD at their source are retired regardless
of share; only UNKNOWN / fetch errors / partial board reads hold rows back;
a large batch posts a #monitoring note instead of blocking.

Run with: python -m pytest tests/test_removal_policy.py -v
"""

import hashlib
import os
import sys
import tempfile
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts'))

import probe_liveness  # noqa: E402
from src.utils import liveness, monitoring  # noqa: E402
from src.utils.deduplication import DeduplicationTracker  # noqa: E402
from src.utils.lifecycle import JobLifecycleManager  # noqa: E402


def _h(url):
    return hashlib.sha256(url.encode()).hexdigest()


def _rows(n, host="careers.technipfmc.com", company="TechnipFMC"):
    return [{"url_hash": _h(f"https://{host}/job/{i}"), "url": f"https://{host}/job/{i}", "company": company}
            for i in range(n)]


def _tabs(rows, tab):
    return {r["url_hash"]: tab for r in rows}


class TestProbeDecideRemovals:
    def test_technipfmc_all_confirmed_dead_retire_despite_share(self):
        """The Sep 2026 case: 191 of 191 DEAD at source were held by the 10% guard. Now all retire."""
        rows = _rows(191)
        results = [(r, liveness.Verdict(liveness.DEAD, "http 404" if i % 2 else "marker: has been filled", http=404))
                   for i, r in enumerate(rows)]
        to_remove, report = probe_liveness.decide_removals(results, _tabs(rows, "TechnipFMC"))
        assert len(to_remove) == 191
        assert report["TechnipFMC"]["dead"] == 191
        assert report["TechnipFMC"]["large"] is True      # noted in #monitoring, not held
        assert "held" not in report["TechnipFMC"]

    def test_small_dead_share_is_not_flagged_large(self):
        rows = _rows(100)
        results = [(r, liveness.Verdict(liveness.DEAD if i < 10 else liveness.LIVE, "http 410"))
                   for i, r in enumerate(rows)]
        to_remove, report = probe_liveness.decide_removals(results, _tabs(rows, "TechnipFMC"))
        assert len(to_remove) == 10 and report["TechnipFMC"]["large"] is False

    def test_broken_fetch_does_not_retire(self):
        """A host that fails (transport errors / blocked) must not wipe a company."""
        rows = _rows(60, host="jobs.example.com", company="Acme")
        results = []
        for i, r in enumerate(rows):
            if i < 40:
                v = liveness.Verdict(liveness.BLOCKED, "http 403", http=403)
            elif i < 55:
                v = liveness.Verdict(liveness.UNKNOWN, "error: ConnectTimeout")
            else:
                v = liveness.Verdict(liveness.DEAD, "http 404", http=404)
            results.append((r, v))
        demoted = probe_liveness.apply_host_blocked_rule(results)
        assert "jobs.example.com" in demoted
        to_remove, report = probe_liveness.decide_removals(results, _tabs(rows, "Acme"))
        assert to_remove == []
        assert report["Acme"]["dead"] == 0

    def test_unknown_only_never_retires(self):
        rows = _rows(30, host="jobs.example.com", company="Acme")
        results = [(r, liveness.Verdict(liveness.UNKNOWN, "error: ReadTimeout")) for r in rows]
        to_remove, _ = probe_liveness.decide_removals(results, _tabs(rows, "Acme"))
        assert to_remove == []

    def test_partial_crewbase_sitemap_read_never_retires(self):
        """A failed sitemap shard makes crewbase_live_urls() None, which is UNKNOWN, not DEAD."""
        v = liveness.classify_crewbase("https://crewbase.pro/job/1", None)
        assert v.status == liveness.UNKNOWN
        rows = _rows(50, host="crewbase.pro", company="CrewBase")
        to_remove, _ = probe_liveness.decide_removals([(r, v) for r in rows], _tabs(rows, "CrewBase"))
        assert to_remove == []


def _insert(conn, url, company="Acme", **cols):
    fields = {"url_hash": _h(url), "url": url, "company": company, "title": "Rigger",
              "first_seen": "2026-01-01", "last_seen": "2026-01-01", "status": "active", "exported_to_sheets": 1}
    fields.update(cols)
    conn.execute(f"INSERT INTO scraped_jobs ({', '.join(fields)}) VALUES ({', '.join('?' * len(fields))})",
                 list(fields.values()))
    conn.commit()


@pytest.fixture
def tracker():
    with tempfile.TemporaryDirectory() as d:
        t = DeduplicationTracker(db_path=os.path.join(d, "state.db"))
        yield t
        t.close()


def _status(tracker, url):
    row = tracker.conn.execute("SELECT status, removed_reason FROM scraped_jobs WHERE url_hash = ?",
                               (_h(url),)).fetchone()
    return row["status"], row["removed_reason"]


def _mgr(tracker):
    exporter = MagicMock()
    exporter.get_existing_job_urls.return_value = {}
    return JobLifecycleManager(tracker=tracker, exporter=exporter)


class TestLifecycleConsistency:
    def test_broken_scrape_holds_the_diff_but_retires_probe_confirmed_dead(self, tracker):
        fresh = datetime.utcnow().isoformat()
        stale = (datetime.utcnow() - timedelta(days=10)).isoformat()
        for i in range(40):
            _insert(tracker.conn, f"https://x/{i}")
        for i in range(5):
            _insert(tracker.conn, f"https://x/dead-{i}", source_status="DEAD", source_checked_at=fresh)
        _insert(tracker.conn, "https://x/dead-stale", source_status="DEAD", source_checked_at=stale)

        summary = _mgr(tracker).process_scrape_results("Acme", "Acme", [])   # scraper returned nothing

        assert summary["diff_skipped"] is True
        assert summary["removed_jobs"] == 5
        for i in range(5):
            assert _status(tracker, f"https://x/dead-{i}") == ("removed", "source_gone")
        for i in range(40):
            assert _status(tracker, f"https://x/{i}")[0] == "active"
        assert _status(tracker, "https://x/dead-stale")[0] == "active"   # too old to trust alone

    def test_healthy_scrape_retires_large_batch_and_flags_it(self, tracker):
        for i in range(100):
            _insert(tracker.conn, f"https://x/{i}")
        jobs = [MagicMock(url=f"https://x/{i}") for i in range(60)]   # 40 gone from a full listing
        summary = _mgr(tracker).process_scrape_results("Acme", "Acme", jobs)
        assert summary["removed_jobs"] == 40
        assert summary["large_retire"] is True
        assert summary["diff_skipped"] is False

    def test_small_batch_not_flagged(self, tracker):
        for i in range(100):
            _insert(tracker.conn, f"https://x/{i}")
        jobs = [MagicMock(url=f"https://x/{i}") for i in range(95)]
        summary = _mgr(tracker).process_scrape_results("Acme", "Acme", jobs)
        assert summary["removed_jobs"] == 5 and summary["large_retire"] is False


class TestMonitoringNote:
    def test_threshold(self):
        assert monitoring.is_large_retire(191, 191)
        assert not monitoring.is_large_retire(25, 100)
        assert monitoring.is_large_retire(26, 100)
        assert not monitoring.is_large_retire(5, 8)       # tiny tabs are noise

    def test_no_webhook_is_a_noop(self, monkeypatch):
        monkeypatch.delenv(monitoring.WEBHOOK_ENV, raising=False)
        assert monitoring.post_monitoring_note("x") is False

    def test_posts_json_text(self, monkeypatch):
        monkeypatch.setenv(monitoring.WEBHOOK_ENV, "https://hooks.slack.test/abc")
        resp = MagicMock(status=200)
        resp.__enter__.return_value = resp
        with patch("urllib.request.urlopen", return_value=resp) as u:
            assert monitoring.post_monitoring_note("hello") is True
        req = u.call_args[0][0]
        assert req.full_url == "https://hooks.slack.test/abc" and b'"text": "hello"' in req.data

    def test_slack_failure_never_raises(self, monkeypatch):
        monkeypatch.setenv(monitoring.WEBHOOK_ENV, "https://hooks.slack.test/abc")
        with patch("urllib.request.urlopen", side_effect=OSError("boom")):
            assert monitoring.post_monitoring_note("hello") is False

    def test_note_text(self):
        text = monitoring.format_large_retire_note("Liveness probe", [("TechnipFMC", 191, 191, "http 404 x191")])
        assert "TechnipFMC: 191 of 191 rows (100%) retired" in text
        assert "\u2014" not in text
