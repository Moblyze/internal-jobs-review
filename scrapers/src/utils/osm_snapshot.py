"""OSM Thome listing snapshot: fetched off-CI, read by the scraper and the liveness probe.

WHY THIS EXISTS (2026-09-24)
----------------------------
maritime.osmaportal.com/api/jobs answers 403 to GitHub Actions runners and to
our OVH cloud VPS (datacenter IP blocks) but 200 to the Mac Studio. On
2026-09-24 Jesse approved running ONLY the OSM fetch and the OSM liveness
check from a non-datacenter location at a polite rate (about 6 requests a day).

So the Mac Studio runs scripts/osm_snapshot_fetch.py once a day from a
launchd agent: it walks the paginated listing (5 pages of 100 as of
2026-09-24, one request per page), writes this snapshot, and uploads it to the
scraper-state-latest release as osm-snapshot.json. CI downloads it and:
  * the html_generic scraper builds OSM Thome's listings from it instead of
    calling the API (portal_snapshot_path in companies.yaml), so new jobs are
    exported and the lifecycle diff retires the ones that left the listing;
  * the liveness probe classifies every OSM row from it (in the listing =
    LIVE, absent from a complete listing = DEAD) with zero requests to OSM.

Only a COMPLETE and FRESH snapshot is used. "Complete" means every page came
back 200 and the job count equals the API's own meta.total. Anything else is
ignored and callers fall back to their old behavior, so a bad fetch can never
read as a mass closure.

The snapshot keeps only the fields the scraper maps onto a sheet row (the
same text the jobs site publishes); the release it lives on is public.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlparse

SCHEMA_VERSION = 1
ASSET_NAME = "osm-snapshot.json"
RELEASE_TAG = "scraper-state-latest"
DEFAULT_MAX_AGE_HOURS = 36

# Fields kept per job. Everything _portal_job_to_listing reads, nothing else.
KEEP_FIELDS = ("id", "slug", "name", "is_active", "is_expired", "locations", "employment_types",
               "description", "excerpt")


def trim_job(job: dict) -> dict:
    out = {k: job.get(k) for k in KEEP_FIELDS if k in job}
    out["locations"] = [{"label": loc.get("label")} for loc in (job.get("locations") or [])
                        if isinstance(loc, dict)]
    out["employment_types"] = [{"label": t.get("label")} for t in (job.get("employment_types") or [])
                               if isinstance(t, dict)]
    return out


def build_snapshot(jobs: list[dict], api_total: Optional[int], pages: int, requests: int,
                   complete: bool, host: str = "", now: Optional[datetime] = None) -> dict:
    now = now or datetime.now(timezone.utc)
    return {
        "schema": SCHEMA_VERSION,
        "generated_at": now.isoformat(),
        "source": "https://maritime.osmaportal.com/api/jobs",
        "fetched_from": host,
        "complete": bool(complete),
        "api_total": api_total,
        "pages": pages,
        "requests": requests,
        "jobs": [trim_job(j) for j in jobs],
    }


def validate(snapshot: dict, max_age_hours: float = DEFAULT_MAX_AGE_HOURS,
             now: Optional[datetime] = None) -> Optional[str]:
    """None when the snapshot is usable, else the reason it is not."""
    if not isinstance(snapshot, dict) or snapshot.get("schema") != SCHEMA_VERSION:
        return "wrong schema"
    if not snapshot.get("complete"):
        return "incomplete fetch"
    jobs = snapshot.get("jobs")
    if not isinstance(jobs, list) or not jobs:
        return "no jobs"
    if snapshot.get("api_total") != len(jobs):
        return f"job count {len(jobs)} != api total {snapshot.get('api_total')}"
    try:
        gen = datetime.fromisoformat(snapshot["generated_at"])
    except (KeyError, TypeError, ValueError):
        return "bad generated_at"
    if gen.tzinfo is None:
        gen = gen.replace(tzinfo=timezone.utc)
    age = (now or datetime.now(timezone.utc)) - gen
    if age > timedelta(hours=max_age_hours):
        return f"stale ({age.total_seconds() / 3600:.0f}h old, limit {max_age_hours:.0f}h)"
    if age < timedelta(hours=-1):
        return "generated_at is in the future"
    return None


def load(path: Optional[str], max_age_hours: float = DEFAULT_MAX_AGE_HOURS,
         now: Optional[datetime] = None) -> tuple[Optional[dict], str]:
    """(snapshot or None, reason). Never raises."""
    if not path or not os.path.exists(path):
        return None, f"no snapshot file at {path}"
    try:
        with open(path, encoding="utf-8") as f:
            snap = json.load(f)
    except (OSError, ValueError) as e:
        return None, f"unreadable snapshot: {type(e).__name__}"
    why = validate(snap, max_age_hours=max_age_hours, now=now)
    if why:
        return None, why
    return snap, f"ok ({len(snap['jobs'])} jobs, generated {snap['generated_at']})"


def is_open(job: dict) -> bool:
    return job.get("is_active", True) is not False and job.get("is_expired", False) is not True


def open_ids(snapshot: dict) -> set[str]:
    return {str(j.get("id")) for j in snapshot.get("jobs", []) if j.get("id") is not None and is_open(j)}


_JOB_ID_RE = re.compile(r"/jobs/(\d+)")


def job_id_from_url(url: str) -> Optional[str]:
    m = _JOB_ID_RE.search(urlparse(url or "").path)
    return m.group(1) if m else None
