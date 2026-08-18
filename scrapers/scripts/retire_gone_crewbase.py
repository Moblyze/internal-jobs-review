#!/usr/bin/env python3
"""Retire CrewBase rows whose pages are verified gone at source.

WHY THIS EXISTS (2026-08-18)
----------------------------
The description backfill (backfill_crewbase_descriptions.py) fetched every
pre-fix CrewBase URL and recorded 11,564 of 20,509 as gone: the page returns
410/404 at crewbase.pro. Yet the tab carried only 2 rows with
status=removed, because the lifecycle manager has never retired a CrewBase
row. Every consumer of the tab (Slack digests, the review site, the SEO
corpus) was counting postings whose pages no longer exist as open.

This sets Status=removed and Status Changed Date on exactly the rows whose
requisition id the backfill state file records as `gone` -- each one
individually fetched and confirmed 410/404 on the state file's run dates.
It touches ONLY those two columns, only on those rows, maps rows by URL
immediately before writing, and writes a verified CSV backup first.

Usage:
    python scripts/retire_gone_crewbase.py --state-path data/crewbase-backfill-state.json --dry-run
    python scripts/retire_gone_crewbase.py --state-path data/crewbase-backfill-state.json

Environment:
    GOOGLE_SERVICE_ACCOUNT_PATH      path to service account JSON
    GOOGLE_SHEETS_SPREADSHEET_NAME   spreadsheet name (default "Job Scraping Results")
"""

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timezone

import gspread
from google.oauth2.service_account import Credentials

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.exporters.sheets import _retry_429  # noqa: E402

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

TAB_NAME = "CrewBase"
WRITE_CHUNK = 400
INTER_CHUNK_PAUSE = 2.0


def authenticate():
    cred_path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_PATH")
    if not cred_path or not os.path.exists(cred_path):
        sys.exit("GOOGLE_SERVICE_ACCOUNT_PATH not set or file missing.")
    creds = Credentials.from_service_account_file(cred_path, scopes=SCOPES)
    return gspread.authorize(creds)


def col_to_letter(col_idx: int) -> str:
    letter = ""
    while col_idx >= 0:
        letter = chr(col_idx % 26 + ord("A")) + letter
        col_idx = col_idx // 26 - 1
    return letter


def write_local_backup(path: str, header: list, rows: list) -> int:
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    with open(path, newline="", encoding="utf-8") as f:
        return sum(1 for _ in csv.reader(f)) - 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state-path", required=True,
                    help="crewbase-backfill-state.json with the gone verdicts")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(args.state_path, encoding="utf-8") as f:
        state = json.load(f)
    gone_ids = {rid for rid, outcome in state.items() if outcome == "gone"}
    if not gone_ids:
        sys.exit("State file holds no gone rows -- nothing to do.")
    print(f"State file: {len(state):,} resolved rows, {len(gone_ids):,} gone")

    client = authenticate()
    name = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_NAME", "Job Scraping Results")
    ws = client.open(name).worksheet(TAB_NAME)

    values = _retry_429(ws.get_all_values)
    header, rows = values[0], values[1:]
    hl = [h.strip().lower() for h in header]
    try:
        url_i = hl.index("url")
        req_i = hl.index("requisition id")
        status_i = hl.index("status")
        date_i = hl.index("status changed date")
    except ValueError as e:
        sys.exit(f"Column missing: {e}. Header: {header}")
    status_letter, date_letter = col_to_letter(status_i), col_to_letter(date_i)

    targets = []  # (row_number, url)
    already = 0
    for rn, row in enumerate(rows, start=2):
        req = row[req_i].strip() if len(row) > req_i else ""
        if req not in gone_ids:
            continue
        status = (row[status_i].strip().lower() if len(row) > status_i else "")
        if status == "removed":
            already += 1
            continue
        targets.append((rn, row[url_i].strip() if len(row) > url_i else ""))

    print(f"Rows to retire: {len(targets):,} (already removed: {already:,})")
    if args.dry_run:
        for rn, url in targets[:5]:
            print(f"  would retire row {rn}: {url}")
        print("(dry run -- nothing written)")
        return
    if not targets:
        print("Nothing to do.")
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = f"data/{TAB_NAME}-retire-backup-{stamp}.csv"
    print(f"Writing local backup to {backup} ...")
    n = write_local_backup(backup, header, rows)
    if n != len(rows):
        sys.exit(f"Backup verification FAILED: {n} rows on disk, expected {len(rows)}.")
    print(f"  Backup verified: {n:,} data rows")

    now = datetime.now(timezone.utc).isoformat()
    updates = []
    for rn, _url in targets:
        updates.append({"range": f"{status_letter}{rn}", "values": [["removed"]]})
        updates.append({"range": f"{date_letter}{rn}", "values": [[now]]})

    probe_range = updates[0]["range"]
    for i in range(0, len(updates), WRITE_CHUNK):
        chunk = updates[i : i + WRITE_CHUNK]
        # Fresh dicts per attempt: gspread's batch_update mutates the passed
        # dicts (sheet-title prefix), which poisons a 429 retry.
        _retry_429(lambda c=chunk: ws.batch_update(
            [dict(u) for u in c], value_input_option="RAW"))
        print(f"  wrote {min(i + WRITE_CHUNK, len(updates)):,}/{len(updates):,} cells")
        if i + WRITE_CHUNK < len(updates):
            time.sleep(INTER_CHUNK_PAUSE)

    got = (_retry_429(ws.acell, probe_range).value or "").strip().lower()
    if got != "removed":
        sys.exit(f"VERIFICATION FAILED at {probe_range}: read back {got!r}")
    print(f"Verified read-back of {probe_range} = removed")
    print(f"Retired {len(targets):,} rows.")


if __name__ == "__main__":
    main()
