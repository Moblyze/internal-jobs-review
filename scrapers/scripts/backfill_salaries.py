#!/usr/bin/env python3
"""Backfill pay that is sitting in a row's description but not in its Salary cell.

WHY THIS EXISTS (2026-09-16)
----------------------------
Two defects put unusable pay in the sheet:

1. The Workday API scraper matched salary with a regex whose number class was
   `[\\d,]+`, which excludes a decimal point. "$44.68/hour" was captured as
   "$44" -- the match stopped at the decimal. The period was also optional, so
   an amount with no unit at all counted as a hit. 2,991 active rows carry a
   salary with no period; "$44" is ambiguous between an hourly and a daily rate
   and cannot become a JobPosting baseSalary, which needs a unit.
2. Nothing ever re-read a description for pay the scraper's regex missed, so
   36,593 active rows have an empty Salary cell while plenty of them state the
   rate plainly in the body.

Both are fixed forward in src/utils/salary.py, but the export path only ever
APPENDS rows and updates status columns -- it never rewrites a field on a row
already in the sheet. So the existing rows stay wrong until they are removed and
re-added. This repairs them in place.

Measured against the feed before writing anything: 235 bare salaries become real
rates and 1,962 empty ones get filled, 2,197 rows in all.

DESIGN RULES (mirrors backfill_adzuna_descriptions.py)
-----------------------------------------------------
- No network. The description is already in the sheet, so this is a read,
  a computation and a write.
- Identity is the source URL. Row numbers are re-mapped from a fresh read of the
  URL column immediately before every write, so an append between read and write
  cannot misalign a cell.
- The parse is the scraper's own `extract_salary`, imported not copied, so the
  backfill and the live scraper can never drift.
- NEVER BLANKS AND NEVER DOWNGRADES. A cell is written only when the description
  yields a rate WITH a period and the stored value has none. A salary that
  already states its period is left alone, whatever it says.
- A full local CSV backup of each tab is written and verified before its first
  write.

Usage:
    python scripts/backfill_salaries.py --dry-run --max-rows 50 --tab "TRC Companies"
    python scripts/backfill_salaries.py --dry-run
    python scripts/backfill_salaries.py

Environment:
    GOOGLE_SERVICE_ACCOUNT_PATH      path to service account JSON
    GOOGLE_SHEETS_SPREADSHEET_NAME   spreadsheet name (default "Job Scraping Results")
"""

import argparse
import csv
import os
import re
import sys
import time
from datetime import datetime, timezone

import gspread
from google.oauth2.service_account import Credentials

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.exporters.sheets import _retry_429  # noqa: E402
from src.utils.salary import extract_salary  # noqa: E402

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# A stored salary counts as complete when it names a period. Anything else is a
# bare amount, which is what this repairs.
HAS_PERIOD = re.compile(r"hour|hr\b|day|week|wk\b|month|year|yr\b|annum|annual|/", re.IGNORECASE)

WRITE_CHUNK = 400
INTER_CHUNK_PAUSE = 2.0

# Tabs that are not job rows.
SKIP_TABS = {
    "Overview", "Target Companies", "Source Coverage Matrix", "Run History",
    "Jobs Weekly", "Trend Data", "Agency Blocklist", "_Client Org Lookup",
    "_Roles", "_Certs", "Aggregator Jobs", "Client Jobs - Aggregated",
}


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
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)
    with open(path, newline="", encoding="utf-8") as f:
        return sum(1 for _ in csv.reader(f)) - 1


def process_tab(ws, args, totals):
    """Repair one worksheet. Returns the number of cells written."""
    values = _retry_429(ws.get_all_values)
    if len(values) <= 1:
        return 0
    header, rows = values[0], values[1:]
    header_lower = [h.strip().lower() for h in header]

    def col(name_):
        try:
            return header_lower.index(name_)
        except ValueError:
            return None

    desc_idx, sal_idx, url_idx = col("description"), col("salary"), col("url")
    if desc_idx is None or sal_idx is None or url_idx is None:
        return 0
    sal_letter = col_to_letter(sal_idx)

    def cell(row, idx):
        return row[idx].strip() if len(row) > idx else ""

    planned = []  # (url, old, new)
    for row in rows:
        url = cell(row, url_idx)
        if not url:
            continue
        stored = cell(row, sal_idx)
        # Never touch a salary that already states its period.
        if stored and stored != "None" and HAS_PERIOD.search(stored):
            totals["already_complete"] = totals.get("already_complete", 0) + 1
            continue
        found = extract_salary(cell(row, desc_idx))
        if not found:
            continue
        if found == stored:
            continue
        planned.append((url, stored, found))

    if not planned:
        return 0
    print(f"\n=== Tab: {ws.title} ===")
    print(f"  {len(rows)} data rows, {len(planned)} salaries to repair")
    if args.max_rows:
        planned = planned[: args.max_rows]
        print(f"  capped to {len(planned)} by --max-rows")

    for url, old, new in planned[:5]:
        print(f"    {old or '(empty)':>22}  ->  {new}")
    totals["planned"] = totals.get("planned", 0) + len(planned)
    totals["filled_empty"] = totals.get("filled_empty", 0) + sum(1 for _, o, _ in planned if not o or o == "None")
    totals["fixed_bare"] = totals.get("fixed_bare", 0) + sum(1 for _, o, _ in planned if o and o != "None")

    if args.dry_run:
        return 0

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe = ws.title.replace("/", "-").replace(" ", "_")
    backup_path = f"data/{safe}-salary-backfill-backup-{stamp}.csv"
    written = write_local_backup(backup_path, header, rows)
    if written != len(rows):
        sys.exit(f"Backup verification FAILED: {written} rows on disk, expected {len(rows)}.")
    print(f"  backup verified: {written} data rows -> {backup_path}")

    # Fresh row map by URL immediately before writing: a salary landing on the
    # wrong row is corpus corruption.
    url_col = _retry_429(ws.col_values, url_idx + 1)
    row_for_url = {}
    for i, u in enumerate(url_col[1:], start=2):
        u = u.strip()
        if u and u not in row_for_url:
            row_for_url[u] = i

    updates, missing = [], 0
    for url, _old, new in planned:
        r = row_for_url.get(url)
        if r is None:
            missing += 1
            continue
        updates.append({"range": f"{sal_letter}{r}", "values": [[new]]})
    if missing:
        print(f"    {missing} URLs no longer in the tab; skipped")
    if not updates:
        return 0

    probe_range = updates[0]["range"]
    probe_value = updates[0]["values"][0][0]

    written_cells = 0
    for i in range(0, len(updates), WRITE_CHUNK):
        chunk = updates[i : i + WRITE_CHUNK]
        # Fresh dict copies on EVERY attempt: gspread's batch_update mutates the
        # dicts it is passed, prefixing the sheet title onto each range, so a
        # 429-retry resending them produces "'Tab'!'Tab'!F..." and a 400.
        _retry_429(lambda c=chunk: ws.batch_update([dict(u) for u in c], value_input_option="RAW"))
        written_cells += len(chunk)
        print(f"    wrote {min(i + WRITE_CHUNK, len(updates))}/{len(updates)} cells")
        if i + WRITE_CHUNK < len(updates):
            time.sleep(INTER_CHUNK_PAUSE)

    got = _retry_429(ws.acell, probe_range).value or ""
    if got.strip() != probe_value.strip():
        sys.exit(f"VERIFICATION FAILED at {probe_range}: read back {got!r}, expected {probe_value!r}.")
    print(f"    verified read-back of {probe_range} ({probe_value})")
    return written_cells


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Report only; write nothing")
    ap.add_argument("--tab", action="append", default=None, help="Tab to process (repeatable)")
    ap.add_argument("--max-rows", type=int, default=None, help="Cap rows repaired per tab")
    args = ap.parse_args()

    client = authenticate()
    name = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_NAME", "Job Scraping Results")
    ss = client.open(name)

    if args.tab:
        worksheets = [ss.worksheet(t) for t in args.tab]
    else:
        worksheets = [w for w in ss.worksheets() if w.title not in SKIP_TABS]
    print(f"Tabs to scan: {len(worksheets)}")

    totals, total_written = {}, 0
    for ws in worksheets:
        try:
            total_written += process_tab(ws, args, totals)
        except Exception as exc:  # one bad tab must not lose the rest of the run
            print(f"  !! {ws.title}: {type(exc).__name__}: {exc}")

    print("\n==== Salary backfill complete ====")
    print(f"  already complete (left alone): {totals.get('already_complete', 0)}")
    print(f"  bare amounts repaired:         {totals.get('fixed_bare', 0)}")
    print(f"  empty cells filled:            {totals.get('filled_empty', 0)}")
    print(f"  cells written:                 {total_written}")
    if args.dry_run:
        print("(dry run -- nothing was written)")


if __name__ == "__main__":
    main()
