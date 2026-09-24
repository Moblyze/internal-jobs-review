#!/usr/bin/env python3
"""OSM Thome off-CI listing snapshot: fetcher, validation, scraper and liveness use, sheet sweep.

Context (2026-09-24): OSM's API 403s every datacenter IP, so the Mac Studio
fetches the listing and CI reads the snapshot. See src/utils/osm_snapshot.py.

Run with: python -m pytest tests/test_osm_snapshot.py -v
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

from src.utils import liveness as lv  # noqa: E402
from src.utils import osm_snapshot  # noqa: E402

NOW = datetime(2026, 9, 24, 18, 0, tzinfo=timezone.utc)


def _job(i, **kw):
    return {"id": i, "slug": f"job-{i}", "name": f"Job {i}", "is_active": True, "is_expired": False,
            "locations": [{"label": "Worldwide", "value": 1}], "employment_types": [{"label": "Contractual"}],
            "description": "<p>" + "x" * 80 + "</p>", "recruiter_email": "someone@example.com", **kw}


def _snap(job_list, **kw):
    s = osm_snapshot.build_snapshot(job_list, api_total=len(job_list), pages=1, requests=1, complete=True, now=NOW)
    s.update(kw)
    return s


# -- snapshot module ------------------------------------------------------------

def test_trim_keeps_only_mapped_fields():
    t = osm_snapshot.trim_job(_job(1))
    assert "recruiter_email" not in t
    assert t["locations"] == [{"label": "Worldwide"}]
    assert t["name"] == "Job 1"


def test_validate_accepts_complete_fresh_snapshot():
    assert osm_snapshot.validate(_snap([_job(1), _job(2)]), now=NOW + timedelta(hours=5)) is None


@pytest.mark.parametrize("change, expect", [
    ({"complete": False}, "incomplete"),
    ({"api_total": 3}, "!= api total"),
    ({"jobs": []}, "no jobs"),
    ({"schema": 0}, "schema"),
])
def test_validate_rejects_partial_snapshots(change, expect):
    assert expect in osm_snapshot.validate(_snap([_job(1), _job(2)], **change), now=NOW)


def test_validate_rejects_stale_snapshot():
    assert "stale" in osm_snapshot.validate(_snap([_job(1)]), now=NOW + timedelta(hours=37))


def test_load_missing_file_is_none(tmp_path):
    snap, why = osm_snapshot.load(str(tmp_path / "nope.json"))
    assert snap is None and "no snapshot" in why


def test_open_ids_skip_expired_and_inactive():
    s = _snap([_job(1), _job(2, is_expired=True), _job(3, is_active=False)])
    assert osm_snapshot.open_ids(s) == {"1"}


# -- fetcher (runs on the Mac) ---------------------------------------------------

import osm_snapshot_fetch as fetcher  # noqa: E402


class _Resp:
    def __init__(self, payload, status=200):
        self.status = status
        self._b = json.dumps(payload).encode()

    def read(self):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _pager(total, per_page=100, fail_on=None):
    calls = []
    last = max(1, -(-total // per_page))

    def opener(req, timeout=None):
        calls.append(req.full_url)
        page = len(calls)
        assert req.get_header("User-agent").startswith("Mozilla/5.0")
        if fail_on == page:
            raise HTTPError(req.full_url, 403, "Forbidden", {}, None)
        start = (page - 1) * per_page
        data = [_job(i) for i in range(start, min(start + per_page, total))]
        return _Resp({"data": data, "meta": {"total": total, "last_page": last}})
    return opener, calls


def test_fetch_walks_every_page_once_with_delay_between():
    opener, calls = _pager(490)
    sleeps = []
    jobs, total, pages, requests, complete, note = fetcher.fetch_pages(opener=opener, sleep=sleeps.append)
    assert (len(jobs), total, pages, requests, complete) == (490, 490, 5, 5, True)
    assert len(calls) == 5 and sleeps == [fetcher.PAGE_DELAY] * 4


def test_fetch_stops_at_first_403_without_more_requests():
    opener, calls = _pager(490, fail_on=2)
    jobs, _t, _p, requests, complete, note = fetcher.fetch_pages(opener=opener, sleep=lambda s: None)
    assert not complete and requests == 2 and len(calls) == 2 and "403" in note


def test_fetch_never_exceeds_request_cap():
    opener, calls = _pager(100 * (fetcher.MAX_REQUESTS + 3))
    *_rest, requests, complete, note = fetcher.fetch_pages(opener=opener, sleep=lambda s: None)
    assert requests == fetcher.MAX_REQUESTS == len(calls) and not complete and "cap" in note


def test_backoff_doubles_and_blocks_runs():
    state = {}
    for n, days in [(1, 1), (2, 2), (3, 4), (4, 7), (5, 7)]:
        state = fetcher.record_failure(state, NOW, "HTTP 403")
        assert datetime.fromisoformat(state["next_allowed_at"]) == NOW + timedelta(days=days)
    assert "backing off" in fetcher.gate(state, NOW + timedelta(days=1), force=True)


def test_once_a_day_guard_and_force():
    state = {"last_success_at": (NOW - timedelta(hours=3)).isoformat()}
    assert "once a day" in fetcher.gate(state, NOW, force=False)
    assert fetcher.gate(state, NOW, force=True) is None
    assert fetcher.gate({"last_success_at": (NOW - timedelta(hours=21)).isoformat()}, NOW, force=False) is None


# -- liveness: no request to OSM, verdict from the snapshot ------------------------

class _NoNetwork:
    def get(self, *a, **k):
        raise AssertionError("OSM must not be requested from CI")


def test_probe_osm_uses_snapshot_without_a_request():
    p = lv.LivenessProber(client=_NoNetwork(), osm_open_ids={"10745"})
    live = p.probe("https://jobs.osmthome.com/jobs/10745/motorman", platform="html_generic")
    dead = p.probe("https://jobs.osmthome.com/jobs/526/wiper", platform="html_generic")
    assert (live.status, dead.status) == (lv.LIVE, lv.DEAD)
    assert p.requests_made == 0


def test_probe_osm_without_snapshot_is_unknown_and_makes_no_request():
    p = lv.LivenessProber(client=_NoNetwork(), osm_open_ids=None)
    v = p.probe("https://jobs.osmthome.com/jobs/526/wiper", platform="html_generic")
    assert v.status == lv.UNKNOWN and "snapshot unavailable" in v.reason and p.requests_made == 0


# -- sheet sweep -------------------------------------------------------------------

def test_plan_osm_sweep_retires_dead_and_revives_exact_live():
    from probe_liveness import plan_osm_sweep
    base = "https://jobs.osmthome.com/jobs/"
    urls = ["URL", base + "1/job-1", base + "2/old", base + "3/job-3", base + "3/job-3", base + "4/old-slug",
            base + "2/old"]
    status = ["Status", "active", "active", "removed", "active", "removed", "removed"]
    open_urls = {"1": base + "1/job-1", "3": base + "3/job-3", "4": base + "4/new-slug"}
    retire, revive = plan_osm_sweep(urls, status, open_urls)
    assert [(rn, u) for rn, u, _o in retire] == [(3, base + "2/old")]
    # row 4 is a removed duplicate of a live job with the exact URL; row 6's slug differs so it stays removed
    assert [(rn, u) for rn, u, _o in revive] == [(4, base + "3/job-3")]


# -- scraper: listings come from the snapshot, no API call -------------------------

def test_html_generic_builds_listings_from_fresh_snapshot(tmp_path, monkeypatch):
    from src.scrapers import html_generic
    from src.scrapers.html_generic import HtmlGenericScraper

    path = tmp_path / "osm-snapshot.json"
    snap = osm_snapshot.build_snapshot([_job(1), _job(2, is_expired=True)], api_total=2, pages=1, requests=1,
                                       complete=True)
    path.write_text(json.dumps(snap))
    monkeypatch.setattr(html_generic, "urlopen",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("API must not be called")))
    s = HtmlGenericScraper({
        "name": "OSM Thome", "platform": "html_generic", "sheet_name": "OSM Thome",
        "base_url": "https://jobs.osmthome.com/", "rate_limit_delay": 0,
        "html_config": {"portal_api_url": "https://maritime.osmaportal.com/api/jobs",
                        "portal_snapshot_path": str(path), "skip_detail_pages": True},
    })
    listings = s._extract_listings_from_portal_api()
    assert [l["url"] for l in listings] == ["https://jobs.osmthome.com/jobs/1/job-1"]
    assert listings[0]["location"] == "Worldwide" and len(listings[0]["description"]) >= 60


def test_html_generic_falls_back_to_api_when_snapshot_stale(tmp_path, monkeypatch):
    from src.scrapers import html_generic
    from src.scrapers.html_generic import HtmlGenericScraper

    path = tmp_path / "osm-snapshot.json"
    old = osm_snapshot.build_snapshot([_job(1)], api_total=1, pages=1, requests=1, complete=True,
                                      now=datetime.now(timezone.utc) - timedelta(days=3))
    path.write_text(json.dumps(old))
    called = []

    def fake_urlopen(req, timeout=None):
        called.append(req.full_url)
        return _Resp({"data": [_job(9)], "meta": {"last_page": 1, "total": 1}})
    monkeypatch.setattr(html_generic, "urlopen", fake_urlopen)
    s = HtmlGenericScraper({
        "name": "OSM Thome", "platform": "html_generic", "sheet_name": "OSM Thome",
        "base_url": "https://jobs.osmthome.com/", "rate_limit_delay": 0,
        "html_config": {"portal_api_url": "https://maritime.osmaportal.com/api/jobs",
                        "portal_snapshot_path": str(path)},
    })
    assert [l["url"] for l in s._extract_listings_from_portal_api()] == ["https://jobs.osmthome.com/jobs/9/job-9"]
    assert len(called) == 1


# -- description backfill (reads the snapshot, never OSM) ----------------------------

def test_backfill_plan_repairs_only_active_stub_rows():
    from backfill_osm_descriptions import plan
    from src.scrapers.html_generic import HtmlGenericScraper

    mapper = HtmlGenericScraper({"name": "OSM Thome", "platform": "html_generic", "sheet_name": "OSM Thome",
                                 "base_url": "https://jobs.osmthome.com/", "rate_limit_delay": 0,
                                 "html_config": {}})
    long_text = "<p>Keep the engine room running. First Aid certificate required.</p>" + "<p>" + "Duties include watchkeeping. " * 30 + "</p>"
    snap = _snap([_job(1, description=long_text), _job(2, description=long_text), _job(3, description=long_text)])
    header = ["Title", "Company", "Location", "Description", "URL", "Requisition ID", "Posted Date", "Skills",
              "Certifications", "Salary", "Employment Type", "Status", "Status Changed Date", "Scraped At"]
    base = "https://jobs.osmthome.com/jobs/"

    def row(i, desc, status="active", loc="Location Not Specified", certs=""):
        return [f"Job {i}", "OSM Thome", loc, desc, f"{base}{i}/job-{i}", "", "", "", certs, "", "", status, "", ""]
    rows = [row(1, "Job 1 position at OSM Thome."),          # stub, active -> repaired
            row(2, "x" * 700),                                # already long -> untouched
            row(3, "stub", status="removed"),                 # not active -> untouched
            row(4, "stub")]                                   # not in snapshot -> untouched
    edits = plan(rows, header, snap, mapper)
    assert [e["row"] for e in edits] == [2]
    e = edits[0]
    assert len(e["new"]["description"]) > 600 and "<p>" not in e["new"]["description"]
    assert e["new"]["location"] == "Worldwide"
    assert "First Aid" in e["new"]["certifications"]
    assert e["old"]["description"] == "Job 1 position at OSM Thome."


# -- missed-run daytime prompt (Mac Studio) -----------------------------------------

import osm_snapshot_nudge as nudge  # noqa: E402


def test_nudge_decide():
    fresh = {"last_success_at": (NOW - timedelta(hours=30)).isoformat()}
    stale = {"last_success_at": (NOW - timedelta(hours=40)).isoformat()}
    backoff = {**stale, "next_allowed_at": (NOW + timedelta(days=1)).isoformat()}
    assert nudge.decide(fresh, NOW) == "fresh"
    assert nudge.decide(stale, NOW) == "prompt"
    assert nudge.decide({}, NOW) == "prompt"
    assert nudge.decide(backoff, NOW) == "backoff"


class _Run:
    def __init__(self, rc=0, out=""):
        self.returncode, self.stdout, self.stderr = rc, out, ""


@pytest.mark.parametrize("rc, out, expect", [
    (0, "button returned:Run now, gave up:false", "run"),
    (0, "button returned:, gave up:true", "timeout"),
    (1, "", "no"),                     # "Not now" is the cancel button (error -128)
])
def test_nudge_ask_parses_dialog(monkeypatch, rc, out, expect):
    monkeypatch.setattr(nudge.subprocess, "run", lambda *a, **k: _Run(rc, out))
    assert nudge.ask("x", timeout=1) == expect


def _stale_state(tmp_path):
    d = tmp_path / "st"
    d.mkdir()
    (d / "state.json").write_text(json.dumps({"last_success_at": (datetime.now(timezone.utc)
                                                                  - timedelta(hours=50)).isoformat()}))
    return str(d)


@pytest.mark.parametrize("slot, answer, fetches, slacks", [
    ("morning", "timeout", 0, 0),
    ("afternoon", "timeout", 0, 1),
    ("afternoon", "no", 0, 1),
    ("morning", "run", 1, 0),
])
def test_nudge_flow_needs_a_click_to_fetch(monkeypatch, tmp_path, slot, answer, fetches, slacks):
    calls = {"fetch": 0, "slack": 0}
    monkeypatch.setattr(nudge, "ask", lambda msg, timeout=0: answer)
    monkeypatch.setattr(nudge, "notify", lambda text: None)
    monkeypatch.setattr(nudge, "run_fetch", lambda: (calls.__setitem__("fetch", calls["fetch"] + 1) or (0, "ok")))
    monkeypatch.setattr(nudge, "slack_backup",
                        lambda *a, **k: calls.__setitem__("slack", calls["slack"] + 1))
    monkeypatch.setattr(sys, "argv", ["nudge", "--slot", slot, "--state-dir", _stale_state(tmp_path)])
    nudge.main()
    assert (calls["fetch"], calls["slack"]) == (fetches, slacks)


def test_nudge_silent_when_fresh(monkeypatch, tmp_path):
    d = tmp_path / "st"
    d.mkdir()
    (d / "state.json").write_text(json.dumps({"last_success_at": datetime.now(timezone.utc).isoformat()}))
    monkeypatch.setattr(nudge, "ask", lambda *a, **k: pytest.fail("must not prompt when fresh"))
    monkeypatch.setattr(sys, "argv", ["nudge", "--slot", "afternoon", "--state-dir", str(d)])
    assert nudge.main() == 0


def test_slack_backup_once_per_day(monkeypatch, tmp_path):
    sent = []
    monkeypatch.setattr(nudge.subprocess, "run", lambda cmd, **k: sent.append(cmd) or _Run(0))
    state, path = {}, str(tmp_path / "state.json")
    nudge.slack_backup("m", state, path, "2026-09-25")
    nudge.slack_backup("m", state, path, "2026-09-25")
    assert len(sent) == 1 and "osm-refresh-missed.yml" in sent[0]
