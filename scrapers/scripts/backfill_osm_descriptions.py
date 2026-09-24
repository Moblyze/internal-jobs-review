#!/usr/bin/env python3
"""Backfill full descriptions onto OSM Thome rows that carry stub text, from the off-CI snapshot.

WHY (2026-09-24, Jesse approved)
--------------------------------
While OSM's API 403'd CI, OSM rows were written from the sitemap fallback
with stub descriptions ("<title> position at OSM Thome.", median 68 chars on
the 374 rows live that day). Known URLs are never re-exported, so the daily
scrape will never fix them, and they fail the jobs site's 600-char gate and
the app-ready certification rule (certifications are extracted from the
description). The listing snapshot the Mac Studio publishes daily
(src/utils/osm_snapshot.py) already carries every open job's full text, so
this repairs the rows with ZERO requests to OSM.

What it writes, per ACTIVE row on the "OSM Thome" tab whose job id is open in
the snapshot and whose Description is under 600 chars:
  * Description: the snapshot text, mapped exactly as the scraper maps it
    (HtmlGenericScraper._portal_job_to_listing), only when it is longer
    than what is there;
  * Location / Employment Type: only when blank or "Location Not Specified";
  * Certifications: re-extracted from the new text (certification_extractor),
    only when the cell is blank.
Nothing else is touched: no status, no URL, no rows added or removed. Old
values go to data/OSM-desc-backfill-backup-<stamp>.csv first (workflow
artifact). Idempotent: a second run finds nothing short to fix.

Publish rules are unchanged by this: the site's 600-char gate, relevance and
app-ready rules still decide, and OSM Thome remains a held client employer
on jobs.moblyze.me (employer-policy.ts) until BD opts it in.

Usage (creds exist only in GitHub Actions; see backfill-osm-descriptions.yml):
    python scripts/backfill_osm_descriptions.py --dry-run
    python scripts/backfill_osm_descriptions.py
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import sys
import time
from datetime import datetime, timezone

import yaml

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from certification_extractor import extract_job_certifications  # noqa: E402
from src.utils import osm_snapshot  # noqa: E402

logger = logging.getLogger("backfill_osm_descriptions")

TAB = "OSM Thome"
MIN_GOOD = 600                 # the site's MIN_DESCRIPTION_CHARS (build-market-store.ts)
ACTIVE = "active"
NO_LOCATION = {"", "location not specified"}
WRITE_CHUNK = 400


def build_mapper(config_path: str):
    from src.scrapers.html_generic import HtmlGenericScraper
    with open(config_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)["companies"]["osm_thome"]
    return HtmlGenericScraper(cfg)


def plan(rows: list[list[str]], header: list[str], snapshot: dict, mapper) -> list[dict]:
    """Cell edits for stub rows. rows excludes the header; sheet row = index + 2."""
    col = {h.strip().lower(): i for i, h in enumerate(header)}
    need = ["description", "url", "status", "location", "certifications", "employment type", "title"]
    missing = [c for c in need if c not in col]
    if missing:
        raise SystemExit(f"{TAB} tab is missing columns: {missing}")
    by_id = {str(j["id"]): j for j in snapshot["jobs"] if osm_snapshot.is_open(j) and j.get("id") is not None}

    def cell(r, name):
        i = col[name]
        return r[i] if i < len(r) else ""

    edits = []
    for n, r in enumerate(rows):
        if cell(r, "status").strip().lower() != ACTIVE:
            continue
        jid = osm_snapshot.job_id_from_url(cell(r, "url"))
        job = by_id.get(jid or "")
        if not job:
            continue
        old_desc = cell(r, "description")
        if len(old_desc.strip()) >= MIN_GOOD:
            continue
        listing = mapper._portal_job_to_listing(job)
        if not listing:
            continue
        new_desc = (listing.get("description") or "").strip()
        if len(new_desc) <= len(old_desc.strip()):
            continue
        change = {"row": n + 2, "url": cell(r, "url"), "title": cell(r, "title"),
                  "old": {"description": old_desc}, "new": {"description": new_desc}}
        if cell(r, "location").strip().lower() in NO_LOCATION and listing.get("location", "").lower() not in NO_LOCATION:
            change["old"]["location"] = cell(r, "location")
            change["new"]["location"] = listing["location"]
        if not cell(r, "employment type").strip() and listing.get("employment_type"):
            change["old"]["employment type"] = ""
            change["new"]["employment type"] = listing["employment_type"]
        if not cell(r, "certifications").strip():
            certs = extract_job_certifications({"description": new_desc, "title": cell(r, "title")})
            if certs:
                change["old"]["certifications"] = ""
                change["new"]["certifications"] = "; ".join(certs)
        edits.append(change)
    return edits


def col_letter(i: int) -> str:
    s = ""
    while i >= 0:
        s = chr(i % 26 + ord("A")) + s
        i = i // 26 - 1
    return s


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--snapshot", default="data/" + osm_snapshot.ASSET_NAME)
    ap.add_argument("--max-age-hours", type=float, default=osm_snapshot.DEFAULT_MAX_AGE_HOURS)
    ap.add_argument("--config", default="config/companies.yaml")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    snap, why = osm_snapshot.load(args.snapshot, max_age_hours=args.max_age_hours)
    if snap is None:
        sys.exit(f"No usable OSM snapshot: {why}")
    logger.info("snapshot %s", why)

    import gspread
    from google.oauth2.service_account import Credentials
    from src.exporters.sheets import _retry_429

    creds = Credentials.from_service_account_file(os.environ["GOOGLE_SERVICE_ACCOUNT_PATH"], scopes=[
        "https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"])
    book = gspread.authorize(creds).open(os.environ.get("GOOGLE_SHEETS_SPREADSHEET_NAME", "Job Scraping Results"))
    ws = _retry_429(book.worksheet, TAB)
    values = _retry_429(ws.get_all_values)
    header, rows = values[0], values[1:]
    edits = plan(rows, header, snap, build_mapper(args.config))

    si = [h.strip().lower() for h in header].index("status")
    active = sum(1 for r in rows if si < len(r) and r[si].strip().lower() == ACTIVE)
    lens = sorted(len(e["new"]["description"]) for e in edits)
    print(f"active rows on tab: {active}   rows to repair: {len(edits)}")
    if edits:
        print(f"new description length: min {lens[0]}  median {lens[len(lens) // 2]}  max {lens[-1]}  "
              f"under {MIN_GOOD}: {sum(1 for x in lens if x < MIN_GOOD)}")
        print(f"also filling: location {sum('location' in e['new'] for e in edits)}, "
              f"employment type {sum('employment type' in e['new'] for e in edits)}, "
              f"certifications {sum('certifications' in e['new'] for e in edits)}")
        for e in edits[:3]:
            print(f"  row {e['row']} {e['title'][:60]!r}: {len(e['old']['description'])} -> "
                  f"{len(e['new']['description'])} chars: {e['new']['description'][:120]!r}")
    if args.dry_run or not edits:
        return 0

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    os.makedirs("data", exist_ok=True)
    backup = f"data/OSM-desc-backfill-backup-{stamp}.csv"
    with open(backup, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["row", "url", "field", "old_value"])
        for e in edits:
            for field, old in e["old"].items():
                w.writerow([e["row"], e["url"], field, old])
    logger.info("backup of old values: %s", backup)

    idx = {h.strip().lower(): i for i, h in enumerate(header)}
    updates = [{"range": f"{col_letter(idx[field])}{e['row']}", "values": [[val]]}
               for e in edits for field, val in e["new"].items()]
    for i in range(0, len(updates), WRITE_CHUNK):
        chunk = updates[i:i + WRITE_CHUNK]
        # fresh dicts per attempt: gspread mutates the payload (sheet-title prefix)
        _retry_429(lambda c=chunk: ws.batch_update([dict(u) for u in c], value_input_option="RAW"))
        time.sleep(2.0)
    print(f"wrote {len(updates)} cells across {len(edits)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
