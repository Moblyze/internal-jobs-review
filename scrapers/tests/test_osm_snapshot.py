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
