#!/usr/bin/env python3
"""Backfill CrewBase descriptions stored before the About-paragraph fix.

WHY THIS EXISTS (2026-08-18)
----------------------------
Commit 27076f4 fixed the CrewBase scraper: it only appended the page's
"About This Opportunity" paragraph when the stored description was under 40
characters, and CrewBase's JSON-LD descriptions (the Requirements line alone)
run 100-200, so it almost never fired. That paragraph carries vessel type,
sector, operating area, contract type and boarding date -- the facts that made
marine and the UK look like markets we could not describe.

The fix only applies to NEWLY scraped postings, because the sheets exporter
appends new rows and updates status; it never rewrites an existing row's
description. Verified 2026-08-18: rows scraped on/after 2026-08-18 have a
median description of 372 characters; the 10,341 rows scraped before it sit at
135. This script re-fetches those rows and patches ONLY the Description cell.

DESIGN RULES
------------
- Identity is the source URL (the corpus-wide rule). Row numbers are re-mapped
  from a fresh read of the URL column immediately before every write wave, so
  an append or a dedupe between read and write cannot misalign a single cell.
- The parse is the scraper's own `_parse_description` (imported, not copied),
  minus the validThrough skip: an expired posting's description is still
  corpus evidence, so we recover it when the page still serves.
- Never shrinks a description. If the re-fetched text is not strictly longer
  than what is stored, the row is recorded and left alone.
- Resumable. Outcomes are kept in a JSON state file keyed by requisition id;
  a re-run skips everything already resolved. Pages that 410 are recorded as
  gone and never re-fetched. Transient failures (429/5xx/timeouts) are NOT
  recorded, so the next run retries exactly those.
- Paced. Small thread pool + per-request stagger, exponential backoff
  honouring Retry-After on 429/5xx. Catches (TimeoutError, ConnectionError)
  explicitly -- socket timeouts are not URLError and famously escape narrow
  retry wrappers (moblyze-ops, 2026-08-07).
- A full local CSV backup of the tab is written and verified before the first
  write wave, same as dedupe_direct_tab.py.

Usage:
    python scripts/backfill_crewbase_descriptions.py --dry-run --max-jobs 50
    python scripts/backfill_crewbase_descriptions.py

Environment:
    GOOGLE_SERVICE_ACCOUNT_PATH      path to service account JSON
    GOOGLE_SHEETS_SPREADSHEET_NAME   spreadsheet name (default "Job Scraping Results")
"""

import argparse
import csv
import html
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import gspread
import requests
from google.oauth2.service_account import Credentials

# Make `src...` importable when run from the scrapers/ dir.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.exporters.sheets import _retry_429  # noqa: E402
from src.scrapers.crewbase import CrewBaseScraper, _JSONLD_RE  # noqa: E402

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

TAB_NAME = "CrewBase"
# Rows first scraped on/after this date were written by the fixed parser and
# need no backfill. The fix merged 2026-08-18 00:36 UTC; the daily scrape runs
# at 09:00 UTC, so the date alone is a clean cutoff.
DEFAULT_CUTOFF = "2026-08-18"
DEFAULT_STATE_PATH = "data/crewbase_backfill_state.json"
DEFAULT_WORKERS = 4
DEFAULT_DELAY = 0.25
WAVE_SIZE = 1000          # fetch+write+save-state in waves so progress is durable
WRITE_CHUNK = 400         # description cells per Sheets batch_update call
INTER_CHUNK_PAUSE = 2.0
FETCH_MAX_RETRIES = 5

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

RETRYABLE_STATUSES = {408, 429, 500, 502, 503, 504}


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


def load_state(path: str) -> dict:
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_state(path: str, state: dict):
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=0, sort_keys=True)
    os.replace(tmp, path)


def write_local_backup(path: str, header: list, rows: list) -> int:
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)
    with open(path, newline="", encoding="utf-8") as f:
        return sum(1 for _ in csv.reader(f)) - 1


def fetch_page(session: requests.Session, url: str):
    """Fetch one job page. Returns (status_string, page_html_or_None).

    status_string: 'ok', 'gone' (410/404 -- permanent), or 'transient'
    (retries exhausted -- NOT recorded in state, so the next run retries it).
    """
    delay = 2.0
    for attempt in range(FETCH_MAX_RETRIES):
        try:
            resp = session.get(url, timeout=20)
        except (requests.RequestException, TimeoutError, ConnectionError):
            time.sleep(delay)
            delay = min(delay * 2, 60)
            continue
        if resp.status_code == 200:
            return "ok", resp.text
        if resp.status_code in (410, 404):
            return "gone", None
        if resp.status_code in RETRYABLE_STATUSES:
            retry_after = resp.headers.get("Retry-After")
            try:
                wait = max(float(retry_after), delay) if retry_after else delay
            except ValueError:
                wait = delay
            time.sleep(wait)
            delay = min(delay * 2, 60)
            continue
        # Unexpected 4xx: permanent enough to record, but keep it distinct.
        return "gone", None
    return "transient", None


def new_description_for(page_html: str):
    """Run the scraper's own description parse over a fetched page.

    Deliberately skips the scraper's validThrough check: an expired posting's
    description is still evidence for the corpus, and this script never
    touches the Status column (the lifecycle manager owns it).
    """
    m = _JSONLD_RE.search(page_html)
    if not m:
        return None
    try:
        jsonld = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    # `_parse_description` reads no instance state; calling it unbound keeps
    # the parse single-sourced in the scraper instead of copied here.
    return CrewBaseScraper._parse_description(None, jsonld, page_html)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Fetch and report; write nothing to the sheet")
    ap.add_argument("--max-jobs", type=int, default=None, help="Cap on rows to process this run (smoke tests)")
    ap.add_argument("--cutoff", default=DEFAULT_CUTOFF, help="Only rows with Scraped At before this date are targets")
    ap.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    ap.add_argument("--delay", type=float, default=DEFAULT_DELAY, help="Per-request stagger in seconds")
    ap.add_argument("--state-path", default=DEFAULT_STATE_PATH)
    ap.add_argument("--backup-path", default=None)
    args = ap.parse_args()

    client = authenticate()
    name = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_NAME", "Job Scraping Results")
    ss = client.open(name)
    ws = ss.worksheet(TAB_NAME)

    print(f"Reading tab '{TAB_NAME}'...")
    values = _retry_429(ws.get_all_values)
    if len(values) <= 1:
        sys.exit(f"Tab '{TAB_NAME}' has no data rows.")
    header, rows = values[0], values[1:]
    header_lower = [h.strip().lower() for h in header]

    def col(name_):
        try:
            return header_lower.index(name_)
        except ValueError:
            sys.exit(f"Column '{name_}' not found in header: {header}")

    desc_idx = col("description")
    url_idx = col("url")
    req_idx = col("requisition id")
    scraped_idx = col("scraped at")
    desc_letter = col_to_letter(desc_idx)
    print(f"  {len(rows)} data rows. Description column = {desc_letter}")

    state = load_state(args.state_path)
    print(f"  State file: {args.state_path} ({len(state)} rows already resolved)")

    def cell(row, idx):
        return row[idx].strip() if len(row) > idx else ""

    targets = []  # (req_id, url, old_desc)
    for row in rows:
        url = cell(row, url_idx)
        req_id = cell(row, req_idx) or url
        scraped_at = cell(row, scraped_idx)
        if not url or "crewbase.pro" not in url:
            continue
        if scraped_at >= args.cutoff:
            continue  # written by the fixed parser already
        if req_id in state:
            continue  # resolved on a previous run
        targets.append((req_id, url, row[desc_idx] if len(row) > desc_idx else ""))

    print(f"  Targets this run: {len(targets)} (pre-{args.cutoff}, unresolved)")
    if args.max_jobs:
        targets = targets[: args.max_jobs]
        print(f"  Capped to {len(targets)} by --max-jobs")
    if not targets:
        print("Nothing to do.")
        return

    if not args.dry_run:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = args.backup_path or f"data/{TAB_NAME}-backfill-backup-{stamp}.csv"
        print(f"Writing local backup to {backup_path} ...")
        written = write_local_backup(backup_path, header, rows)
        if written != len(rows):
            sys.exit(f"Backup verification FAILED: {written} rows on disk, expected {len(rows)}.")
        print(f"  Backup verified: {written} data rows")

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    totals = {"updated": 0, "no_change": 0, "gone": 0, "no_jsonld": 0, "transient": 0}

    def process(target):
        req_id, url, old_desc = target
        time.sleep(args.delay)
        status, page_html = fetch_page(session, url)
        if status != "ok":
            return req_id, url, status, None
        new_desc = new_description_for(page_html)
        if new_desc is None:
            return req_id, url, "no_jsonld", None
        if new_desc != old_desc and len(new_desc) > len(old_desc):
            return req_id, url, "updated", new_desc
        return req_id, url, "no_change", None

    for wave_start in range(0, len(targets), WAVE_SIZE):
        wave = targets[wave_start : wave_start + WAVE_SIZE]
        wave_num = wave_start // WAVE_SIZE + 1
        print(f"\nWave {wave_num}: fetching {len(wave)} pages "
              f"({args.workers} workers, {args.delay}s stagger)...")

        pending_writes = {}  # url -> new_desc
        wave_outcomes = {}   # req_id -> (outcome, url)
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = [ex.submit(process, t) for t in wave]
            done = 0
            for fut in as_completed(futures):
                req_id, url, outcome, new_desc = fut.result()
                done += 1
                totals[outcome] = totals.get(outcome, 0) + 1
                if outcome == "updated":
                    pending_writes[url] = new_desc
                if outcome != "transient":
                    wave_outcomes[req_id] = (outcome, url)
                if done % 250 == 0:
                    print(f"  {done}/{len(wave)} fetched "
                          f"(updated so far this wave: {len(pending_writes)})")

        print(f"  Wave fetched. updated={len(pending_writes)} "
              f"resolved={len(wave_outcomes)} transient={len(wave) - len(wave_outcomes)}")

        if args.dry_run:
            for url, d in list(pending_writes.items())[:3]:
                print(f"    would update {url}: -> {len(d)} chars: {d[:120]!r}...")
            continue

        if pending_writes:
            # Fresh row map by URL immediately before writing: appends since our
            # read only add rows below, but a dedupe would shift them, and a
            # description cell landing on the wrong row is corpus corruption.
            print(f"  Re-mapping {len(pending_writes)} rows by URL and writing...")
            url_col = _retry_429(ws.col_values, url_idx + 1)
            row_for_url = {}
            for i, u in enumerate(url_col[1:], start=2):  # 1-indexed rows, skip header
                u = u.strip()
                if u and u not in row_for_url:
                    row_for_url[u] = i

            updates = []
            skipped_missing = 0
            for url, new_desc in pending_writes.items():
                r = row_for_url.get(url)
                if r is None:
                    skipped_missing += 1
                    continue
                updates.append({"range": f"{desc_letter}{r}", "values": [[new_desc]]})
            if skipped_missing:
                print(f"  {skipped_missing} updated URLs no longer in the tab; skipped")

            for i in range(0, len(updates), WRITE_CHUNK):
                chunk = updates[i : i + WRITE_CHUNK]
                _retry_429(ws.batch_update, chunk, value_input_option="RAW")
                print(f"  wrote {min(i + WRITE_CHUNK, len(updates))}/{len(updates)} cells")
                if i + WRITE_CHUNK < len(updates):
                    time.sleep(INTER_CHUNK_PAUSE)

            if updates:
                # Independent read-back of the first written cell: proves the
                # write landed where the re-map said it would.
                probe = updates[0]
                got = _retry_429(ws.acell, probe["range"]).value or ""
                want = probe["values"][0][0]
                if got.strip() != want.strip():
                    sys.exit(f"VERIFICATION FAILED at {probe['range']}: "
                             f"read back {len(got)} chars, expected {len(want)}. "
                             f"Stopping before further waves.")
                print(f"  Verified read-back of {probe['range']} ({len(want)} chars)")

        for req_id, (outcome, url) in wave_outcomes.items():
            state[req_id] = outcome
        save_state(args.state_path, state)
        print(f"  State saved ({len(state)} rows resolved total)")

    print("\n==== Backfill run complete ====")
    for k, v in sorted(totals.items()):
        print(f"  {k}: {v}")
    print(f"  unresolved after this run (will retry next run): "
          f"{totals.get('transient', 0)}")
    if args.dry_run:
        print("(dry run -- no cells were written, no state was saved)")


if __name__ == "__main__":
    main()
