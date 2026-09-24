#!/usr/bin/env python3
"""Fetch OSM Thome's job listing from a non-datacenter machine and publish it for CI.

Runs on the Mac Studio from the launchd agent co.kedy.osm-snapshot (see
scrapers/launchd/). Jesse's go of 2026-09-24: ONLY the OSM fetch and OSM
liveness run off-CI, at a polite rate of about 6 requests a day, because the
OSM API 403s every datacenter IP we have (GitHub runners, the OVH VPS).

What one run does
-----------------
* At most one successful fetch per 20 hours (a second trigger is a no-op).
* Walks /api/jobs?page=N&per_page=100 with a real browser User-Agent, one
  request per page, PAGE_DELAY seconds apart, hard cap MAX_REQUESTS.
  As of 2026-09-24 that is 5 requests (490 jobs).
* Stops at the first non-200 and backs off: after the Nth consecutive failure
  it does not try again for 2^(N-1) days (capped at 7). Nothing is uploaded.
* Writes the snapshot (src/utils/osm_snapshot.py) and uploads it to the
  scraper-state-latest release as osm-snapshot.json. CI's daily scrape and
  liveness probe read it from there; every sheet/state write stays in CI.

Stdlib only, so the system or Homebrew python runs it without a venv.

Usage:
    python3 scripts/osm_snapshot_fetch.py              # scheduled run
    python3 scripts/osm_snapshot_fetch.py --no-upload  # fetch and write locally only
    python3 scripts/osm_snapshot_fetch.py --force      # ignore the once-a-day guard (not the backoff)
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.utils import osm_snapshot  # noqa: E402

API_URL = "https://maritime.osmaportal.com/api/jobs"
PER_PAGE = 100
PAGE_DELAY = 20.0            # seconds between page requests
MAX_REQUESTS = 6             # Jesse's ceiling (2026-09-24): about 6 requests a day
MIN_HOURS_BETWEEN = 20       # one successful fetch a day
MAX_BACKOFF_DAYS = 7
REPO = "Moblyze/internal-jobs-review"
USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://jobs.osmthome.com",
    "Referer": "https://jobs.osmthome.com/",
    "X-Job-Portal": "yes",
}
DEFAULT_STATE_DIR = os.path.expanduser("~/Library/Application Support/moblyze-osm-snapshot")


def log(msg: str) -> None:
    print(f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} {msg}", flush=True)


def read_state(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def write_state(path: str, state: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, path)


def gate(state: dict, now: datetime, force: bool) -> str | None:
    """Reason to skip this run, or None to go ahead."""
    nxt = state.get("next_allowed_at")
    if nxt and now < datetime.fromisoformat(nxt):
        return f"backing off after {state.get('consecutive_failures')} failure(s) until {nxt}"
    last = state.get("last_success_at")
    if not force and last and now - datetime.fromisoformat(last) < timedelta(hours=MIN_HOURS_BETWEEN):
        return f"already fetched at {last} (once a day)"
    return None


def record_failure(state: dict, now: datetime, reason: str) -> dict:
    n = int(state.get("consecutive_failures", 0)) + 1
    days = min(2 ** (n - 1), MAX_BACKOFF_DAYS)
    state.update(consecutive_failures=n, last_failure_at=now.isoformat(), last_failure=reason,
                 next_allowed_at=(now + timedelta(days=days)).isoformat())
    return state


def fetch_pages(opener=urlopen, sleep=time.sleep) -> tuple[list[dict], int | None, int, int, bool, str]:
    """(jobs, api_total, pages, requests, complete, note). Stops at the first non-200."""
    jobs: list[dict] = []
    api_total = None
    last_page = 1
    page = 1
    requests = 0
    while page <= last_page:
        if requests >= MAX_REQUESTS:
            return jobs, api_total, page - 1, requests, False, (
                f"listing needs {last_page} pages, above the {MAX_REQUESTS}-request cap; raise with Jesse")
        if requests:
            sleep(PAGE_DELAY)
        url = f"{API_URL}?page={page}&per_page={PER_PAGE}"
        requests += 1
        try:
            with opener(Request(url, headers=HEADERS), timeout=45) as resp:
                code = resp.status
                body = resp.read()
        except HTTPError as e:
            return jobs, api_total, page - 1, requests, False, f"page {page}: HTTP {e.code}"
        except (URLError, socket.timeout, OSError) as e:
            return jobs, api_total, page - 1, requests, False, f"page {page}: {type(e).__name__}: {e}"
        if code != 200:
            return jobs, api_total, page - 1, requests, False, f"page {page}: HTTP {code}"
        try:
            data = json.loads(body.decode("utf-8"))
        except ValueError:
            return jobs, api_total, page - 1, requests, False, f"page {page}: not JSON"
        meta = data.get("meta") or {}
        api_total = meta.get("total", api_total)
        last_page = int(meta.get("last_page") or 1)
        jobs.extend(data.get("data") or [])
        page += 1
    complete = api_total is not None and len(jobs) == api_total
    note = "ok" if complete else f"got {len(jobs)} jobs, api says {api_total}"
    return jobs, api_total, page - 1, requests, complete, note


def upload(path: str) -> None:
    subprocess.run(["gh", "release", "upload", osm_snapshot.RELEASE_TAG, path, "--clobber", "-R", REPO],
                   check=True, capture_output=True, text=True, timeout=180)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--state-dir", default=DEFAULT_STATE_DIR)
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--force", action="store_true", help="ignore the once-a-day guard (never the backoff)")
    args = ap.parse_args()

    state_path = os.path.join(args.state_dir, "state.json")
    out_path = os.path.join(args.state_dir, osm_snapshot.ASSET_NAME)
    state = read_state(state_path)
    now = datetime.now(timezone.utc)
    why = gate(state, now, args.force)
    if why:
        log(f"skip: {why}")
        return 0

    jobs, api_total, pages, requests, complete, note = fetch_pages()
    log(f"fetch: {requests} request(s), {pages} page(s), {len(jobs)} jobs, api total {api_total}: {note}")
    if not complete:
        write_state(state_path, record_failure(state, now, note))
        log(f"FAILED; next attempt not before {state['next_allowed_at']}")
        return 1

    snap = osm_snapshot.build_snapshot(jobs, api_total, pages, requests, complete=True,
                                       host=socket.gethostname(), now=now)
    problem = osm_snapshot.validate(snap, now=now)
    if problem:
        write_state(state_path, record_failure(state, now, f"snapshot invalid: {problem}"))
        log(f"FAILED: snapshot invalid: {problem}")
        return 1
    os.makedirs(args.state_dir, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, separators=(",", ":"))
    log(f"wrote {out_path} ({os.path.getsize(out_path)} bytes, {len(osm_snapshot.open_ids(snap))} open jobs)")

    if not args.no_upload:
        try:
            upload(out_path)
        except (subprocess.SubprocessError, OSError) as e:
            detail = getattr(e, "stderr", "") or str(e)
            log(f"FAILED to upload to release {osm_snapshot.RELEASE_TAG}: {detail.strip()[:300]}")
            return 1   # not an OSM failure: no backoff, the next scheduled run retries
        log(f"uploaded to {REPO} release {osm_snapshot.RELEASE_TAG} as {osm_snapshot.ASSET_NAME}")

    state.update(consecutive_failures=0, next_allowed_at=None, last_success_at=now.isoformat(),
                 last_jobs=len(jobs), last_requests=requests)
    write_state(state_path, state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
