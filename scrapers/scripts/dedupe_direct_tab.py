#!/usr/bin/env python3
"""Dedupe a single DIRECT (non-aggregator) tab in "Job Scraping Results" by URL.

Built for the CrewBase cleanup (2026-07): an early pre-fix CrewBase export run
partially wrote rows before hitting a Sheets 429 quota error and aborting
without recording them in the dedup tracker, so a later fixed run re-wrote the
same jobs. Result: the tab accumulated ~2x duplicate rows for most job URLs.

Unlike scripts/dedupe_aggregator_tabs.py (which also re-applies the
company-relevance filter to `Aggregator - <profile>` tabs), this tool does
ONE thing: dedup a direct employer/board tab by the URL column, keeping the
LAST occurrence of each URL (the later write is assumed more complete/correct
-- see the CrewBase incident above). No relevance filtering. All columns of
the kept row are preserved as-is, whatever the tab's schema is.

Safety:
  - Refuses to run against a small hardcoded set of admin/reporting tabs, and
    against `Aggregator - *` / `Agency - *` tabs (use dedupe_aggregator_tabs.py
    for those instead).
  - Always writes a full local CSV backup of the tab's current contents
    (header + every row, every column) BEFORE any destructive write, and
    verifies the backup file's row count matches what was read before
    proceeding. This is a local-file backup, NOT a new spreadsheet / new tab
    -- Google Drive being over quota means those would fail.
  - --dry-run reports before/after counts and writes the backup, but performs
    no write to the sheet.
  - The real (non-dry-run) rewrite uses the same chunked-write + 429-backoff
    helpers as scrapers/src/exporters/sheets.py (mirrors _retry_429 there).

Usage:
    python scripts/dedupe_direct_tab.py --tab CrewBase --dry-run
    python scripts/dedupe_direct_tab.py --tab CrewBase

Environment:
    GOOGLE_SERVICE_ACCOUNT_PATH      path to service account JSON
    GOOGLE_SHEETS_SPREADSHEET_NAME   spreadsheet name (default "Job Scraping Results")
"""

import argparse
import csv
import os
import sys
import time
from datetime import datetime, timezone

import gspread
from google.oauth2.service_account import Credentials

# Make `src...` importable when run from the scrapers/ dir.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.exporters.sheets import _retry_429  # noqa: E402

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# Tabs this tool must never touch, even if named on the command line.
PROTECTED_TABS = {
    "Overview",
    "Target Companies",
    "Agency Blocklist",
    "Client Jobs - Aggregated",
    "Jobs Weekly",
    "Trend Data",
}

BATCH_SIZE = 500
INTER_BATCH_PAUSE_SECONDS = 2.0


def authenticate():
    cred_path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_PATH")
    if not cred_path or not os.path.exists(cred_path):
        sys.exit("GOOGLE_SERVICE_ACCOUNT_PATH not set or file missing.")
    creds = Credentials.from_service_account_file(cred_path, scopes=SCOPES)
    return gspread.authorize(creds)


def col_to_letter(col_idx: int) -> str:
    """Convert 0-indexed column number to A1 column letter (A, B, ..., Z, AA, ...)."""
    letter = ""
    while col_idx >= 0:
        letter = chr(col_idx % 26 + ord("A")) + letter
        col_idx = col_idx // 26 - 1
    return letter


def write_local_backup(path: str, header: list, rows: list) -> int:
    """Write header+rows to a local CSV. Returns the number of data rows written."""
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)
    # Re-read to verify what actually landed on disk before trusting it as a backup.
    with open(path, newline="", encoding="utf-8") as f:
        written_rows = sum(1 for _ in csv.reader(f)) - 1  # minus header
    return written_rows


def dedupe_rows(header: list, rows: list, url_col_name: str = "URL"):
    """Dedup rows by the URL column, keeping the LAST occurrence of each URL.

    Row order in the output preserves the order of each URL's FIRST
    appearance in the original tab, but the row CONTENT kept is from the
    LAST appearance (the later write is assumed the complete/correct one).

    Returns (kept_rows, stats_dict).
    """
    header_lower = [h.strip().lower() for h in header]
    try:
        url_idx = header_lower.index(url_col_name.lower())
    except ValueError:
        sys.exit(f"Could not find a '{url_col_name}' column in header: {header}")

    first_seen_order = []      # URLs in order of first appearance
    last_row_for_url = {}      # url -> most recently seen row for that url
    blank_url_rows = []        # rows with no URL at all -- can't dedupe these
    total = 0
    dropped_dup = 0

    for row in rows:
        if not any(c.strip() for c in row):
            continue  # fully blank row, skip entirely
        total += 1
        url = row[url_idx].strip() if len(row) > url_idx else ""
        if not url:
            blank_url_rows.append(row)
            continue
        if url in last_row_for_url:
            dropped_dup += 1
        else:
            first_seen_order.append(url)
        last_row_for_url[url] = row  # overwritten each time -> ends up as LAST occurrence

    kept = [last_row_for_url[u] for u in first_seen_order] + blank_url_rows

    stats = {
        "total": total,
        "unique_urls": len(first_seen_order),
        "blank_url_rows": len(blank_url_rows),
        "dropped_dup": dropped_dup,
        "kept": len(kept),
    }
    return kept, stats, set(first_seen_order)


def batched_write(worksheet, header: list, rows: list):
    """Clear the worksheet and rewrite header+rows in quota-safe batches.

    Mirrors SheetsExporter._batch_append / export_jobs in
    src/exporters/sheets.py: explicit A1 range notation (no append_rows,
    which can misalign columns), batches of BATCH_SIZE rows, each retried
    with exponential backoff on 429s, paced apart so a large rewrite doesn't
    burst the per-minute write quota.
    """
    num_cols = len(header)
    end_col_letter = col_to_letter(num_cols - 1)

    _retry_429(worksheet.clear)

    all_rows = [header] + rows
    total_rows_needed = len(all_rows)
    if worksheet.row_count < total_rows_needed:
        _retry_429(worksheet.resize, rows=total_rows_needed + 100)

    total_written = 0
    num_batches = (len(all_rows) + BATCH_SIZE - 1) // BATCH_SIZE
    for batch_num, i in enumerate(range(0, len(all_rows), BATCH_SIZE), start=1):
        batch = all_rows[i:i + BATCH_SIZE]
        start_row = i + 1  # 1-indexed
        end_row = start_row + len(batch) - 1
        range_notation = f"A{start_row}:{end_col_letter}{end_row}"
        _retry_429(worksheet.update, values=batch, range_name=range_notation, value_input_option="RAW")
        total_written += len(batch)
        print(f"  Wrote batch {batch_num}/{num_batches}: {len(batch)} rows ({total_written}/{len(all_rows)} total)")
        if batch_num < num_batches:
            time.sleep(INTER_BATCH_PAUSE_SECONDS)

    return total_written - 1  # minus header


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tab", required=True, help="Exact worksheet/tab name to dedupe (e.g. CrewBase)")
    ap.add_argument("--dry-run", action="store_true", help="Report only, no writes to the sheet")
    ap.add_argument(
        "--backup-path",
        help="Local CSV path for the pre-write backup "
             "(default: data/<tab>-backup-<UTC timestamp>.csv)",
    )
    args = ap.parse_args()

    if args.tab in PROTECTED_TABS:
        sys.exit(f"Refusing to run against protected tab '{args.tab}'.")
    if args.tab.startswith("Aggregator - ") or args.tab.startswith("Agency - "):
        sys.exit(
            f"'{args.tab}' looks like an aggregator/agency tab -- use "
            f"scripts/dedupe_aggregator_tabs.py for those instead."
        )

    client = authenticate()
    name = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_NAME", "Job Scraping Results")
    ss = client.open(name)

    try:
        ws = ss.worksheet(args.tab)
    except gspread.exceptions.WorksheetNotFound:
        sys.exit(f"Tab '{args.tab}' not found in '{name}'.")

    print(f"Reading tab '{args.tab}'...")
    values = ws.get_all_values()
    if len(values) <= 1:
        sys.exit(f"Tab '{args.tab}' has no data rows -- nothing to do.")
    header, rows = values[0], values[1:]
    print(f"  Header: {header}")
    print(f"  Data rows read: {len(rows)}")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = args.backup_path or f"data/{args.tab}-backup-{stamp}.csv"
    print(f"Writing local backup to {backup_path} ...")
    backup_rows_written = write_local_backup(backup_path, header, rows)
    if backup_rows_written != len(rows):
        sys.exit(
            f"Backup verification FAILED: wrote/read back {backup_rows_written} data rows "
            f"but expected {len(rows)}. Aborting before any destructive action."
        )
    print(f"  Backup verified: {backup_rows_written} data rows on disk at {backup_path}")

    kept, stats, unique_urls_before = dedupe_rows(header, rows)
    print()
    print(f"  Total rows read:        {stats['total']}")
    print(f"  Unique URLs:            {stats['unique_urls']}")
    print(f"  Rows with no URL:       {stats['blank_url_rows']}")
    print(f"  Duplicate rows dropped: {stats['dropped_dup']}")
    print(f"  Rows to keep:           {stats['kept']}")
    print()

    if args.dry_run:
        print("(dry run -- no changes written to the sheet)")
        print(f"BACKUP_PATH={os.path.abspath(backup_path)}")
        print(f"ROWS_BEFORE={stats['total']}")
        print(f"ROWS_AFTER={stats['kept']}")
        print(f"UNIQUE_URLS={stats['unique_urls']}")
        return

    if stats["kept"] == stats["total"]:
        print("No duplicates found -- nothing to rewrite.")
        return

    print(f"Rewriting '{args.tab}' with {stats['kept']} deduped rows (was {stats['total']})...")
    written = batched_write(ws, header, kept)
    print(f"Rewrite complete: {written} data rows now in '{args.tab}'.")

    # Independent re-read to confirm the write landed and no unique URL was lost.
    reread = ws.get_all_values()
    reread_rows = reread[1:] if len(reread) > 1 else []
    url_idx = [h.strip().lower() for h in header].index("url")
    urls_after = {r[url_idx].strip() for r in reread_rows if len(r) > url_idx and r[url_idx].strip()}
    missing = unique_urls_before - urls_after
    print()
    print(f"Post-write re-read: {len(reread_rows)} data rows, {len(urls_after)} unique URLs.")
    if missing:
        print(f"  WARNING: {len(missing)} unique URLs from before the write are MISSING after the write!")
        for u in list(missing)[:10]:
            print(f"    missing: {u}")
        sys.exit(1)
    else:
        print("  Confirmed: every unique URL present before the rewrite is still present.")

    print(f"BACKUP_PATH={os.path.abspath(backup_path)}")
    print(f"ROWS_BEFORE={stats['total']}")
    print(f"ROWS_AFTER={len(reread_rows)}")
    print(f"UNIQUE_URLS={len(urls_after)}")


if __name__ == "__main__":
    main()
