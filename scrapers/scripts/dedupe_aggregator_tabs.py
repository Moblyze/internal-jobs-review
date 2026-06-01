#!/usr/bin/env python3
"""One-time cleanup for the aggregator worksheets in "Job Scraping Results".

Two defects accumulated noise in the `Aggregator - <profile>` tabs:

  1. Company-specific profiles (finnco, rig_integrity, io_consulting, ...) used
     a permissive relevance filter whose include list held generic industry
     terms ("energy", "engineering", "services"). Every job board posting that
     merely contained one of those words passed, so the tabs filled with jobs
     that never named the target company. Fixed by the `relevance_require`
     gate in config/aggregators.yaml + src/aggregators/relevance.py.

  2. The aggregator export path appended results every run without checking
     existing sheet URLs, so each job was duplicated once per scrape run
     (~78x). Fixed by the upsert guard in aggregator_cli.py.

This script retroactively applies BOTH fixes to existing rows: it re-runs the
current production RelevanceFilter for each tab's profile and dedups the
survivors by (title|url), then rewrites the tab in place. Each modified tab is
duplicated to "<tab> (backup <date>)" first.

Run AFTER the relevance + write-path fixes are deployed. Needs the same
Google service account as the scrapers.

Usage:
    python scripts/dedupe_aggregator_tabs.py --dry-run        # report only
    python scripts/dedupe_aggregator_tabs.py                  # rewrite in place
    python scripts/dedupe_aggregator_tabs.py --profile finnco # one tab only
    python scripts/dedupe_aggregator_tabs.py --no-backup      # skip backup tabs

Environment:
    GOOGLE_SERVICE_ACCOUNT_PATH      path to service account JSON
    GOOGLE_SHEETS_SPREADSHEET_NAME   spreadsheet name (default "Job Scraping Results")
"""

import argparse
import os
import sys
from datetime import datetime, timezone

import gspread
import yaml
from google.oauth2.service_account import Credentials

# Make `src...` importable when run from the scrapers/ dir.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.aggregators.relevance import RelevanceFilter  # noqa: E402
from src.aggregators.dedup import normalize_url  # noqa: E402

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]
AGG_PREFIX = "Aggregator - "
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "aggregators.yaml")


def authenticate():
    cred_path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_PATH")
    if not cred_path or not os.path.exists(cred_path):
        sys.exit("GOOGLE_SERVICE_ACCOUNT_PATH not set or file missing.")
    creds = Credentials.from_service_account_file(cred_path, scopes=SCOPES)
    return gspread.authorize(creds)


def load_profiles():
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f).get("search_profiles", {})


def clean_rows(rows, profile_cfg):
    """Return (kept_rows, stats) after relevance + (title|url) dedup.

    rows: list of row lists, NOT including the header.
    Header order is the standard 14-col schema; Title=0, URL=4, Status=11.
    """
    rf = RelevanceFilter(
        include_keywords=profile_cfg.get("relevance_include", []),
        exclude_keywords=profile_cfg.get("relevance_exclude", []),
        require_keywords=profile_cfg.get("relevance_require", []),
    )

    seen = set()
    kept = []
    dropped_relevance = 0
    dropped_dup = 0

    for row in rows:
        title = row[0] if len(row) > 0 else ""
        url = row[4] if len(row) > 4 else ""
        company = row[1] if len(row) > 1 else ""
        description = row[3] if len(row) > 3 else ""
        if not title or not url:
            continue

        job = {"title": title, "company": company, "description": description}
        relevant, _ = rf.is_relevant(job)
        if not relevant:
            dropped_relevance += 1
            continue

        key = f"{title}|||{normalize_url(url)}"
        if key in seen:
            dropped_dup += 1
            continue
        seen.add(key)
        kept.append(row)

    return kept, {
        "total": len(rows),
        "dropped_relevance": dropped_relevance,
        "dropped_dup": dropped_dup,
        "kept": len(kept),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Report only, no writes")
    ap.add_argument("--profile", help="Only process this profile (e.g. finnco)")
    ap.add_argument("--no-backup", action="store_true", help="Skip backup tabs")
    args = ap.parse_args()

    client = authenticate()
    name = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_NAME", "Job Scraping Results")
    ss = client.open(name)
    profiles = load_profiles()
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    grand_before = grand_after = 0
    for ws in ss.worksheets():
        if not ws.title.startswith(AGG_PREFIX):
            continue
        profile_key = ws.title[len(AGG_PREFIX):].strip()
        if args.profile and profile_key != args.profile:
            continue
        cfg = profiles.get(profile_key)
        if cfg is None:
            print(f"  SKIP '{ws.title}': no matching profile in aggregators.yaml")
            continue

        values = ws.get_all_values()
        if len(values) <= 1:
            continue
        header, rows = values[0], values[1:]
        kept, stats = clean_rows(rows, cfg)
        grand_before += stats["total"]
        grand_after += stats["kept"]

        print(
            f"  {ws.title}: {stats['total']} -> {stats['kept']} "
            f"(dropped {stats['dropped_relevance']} irrelevant, "
            f"{stats['dropped_dup']} duplicate)"
        )

        if args.dry_run or stats["kept"] == stats["total"]:
            continue

        if not args.no_backup:
            backup_title = f"{ws.title} (backup {stamp})"
            try:
                ss.duplicate_sheet(source_sheet_id=ws.id, new_sheet_name=backup_title)
            except Exception as e:  # noqa: BLE001
                print(f"    WARNING: backup failed ({e}); skipping rewrite to stay safe")
                continue

        ws.clear()
        ws.update(values=[header] + kept, range_name="A1", value_input_option="RAW")

    print(f"\nTotal across aggregator tabs: {grand_before} -> {grand_after}")
    if args.dry_run:
        print("(dry run — no changes written)")


if __name__ == "__main__":
    main()
