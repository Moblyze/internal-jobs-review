#!/usr/bin/env python3
"""Backfill Adzuna descriptions that the API truncated at 500 characters.

WHY THIS EXISTS (2026-09-16)
----------------------------
Adzuna's search API does not return a job's full description. It returns a
500-character snippet with a trailing horizontal ellipsis (U+2026). Nothing in
this repo truncates it -- the cap is API-side. Verified 2026-09-16 against
public/data/jobs.json: 966 active rows sat at exactly 500 characters and 951 of
them were Adzuna rows ending in that ellipsis.

That matters beyond tidiness. The public jobs site rejects any listing under
600 characters (MIN_DESCRIPTION_CHARS in jobs-moblyze-me), so every one of
those rows is silently unpublishable.

The adapter fix (src/aggregators/adzuna_adapter.py) re-fetches the full text
from the schema.org JobPosting JSON-LD on the Adzuna details page, but it only
helps NEWLY exported rows: the aggregator export path appends jobs whose URL is
not already in the tab and never rewrites an existing row. This script patches
the rows already in the sheet.

DESIGN RULES (mirrors backfill_crewbase_descriptions.py)
-------------------------------------------------------
- Identity is the source URL. Row numbers are re-mapped from a fresh read of
  the URL column immediately before every write wave, so an append or a dedupe
  between read and write cannot misalign a single cell.
- The parse is the adapter's own `_extract_jsonld_description` (imported, not
  copied), so the backfill and the live scraper can never drift apart.
- Never shrinks a description. If the re-fetched text is not strictly longer
  than what is stored, the row is recorded and left alone.
- Resumable. Outcomes live in a JSON state file keyed by URL; a re-run skips
  everything already resolved. Pages that 410 (Adzuna's response for an expired
  posting) are recorded as gone and never re-fetched. Transient failures
  (429/5xx/timeouts) are NOT recorded, so the next run retries exactly those.
- Paced. Small thread pool + per-request stagger, exponential backoff honouring
  Retry-After. Catches (TimeoutError, ConnectionError) explicitly -- socket
  timeouts are not URLError and famously escape narrow retry wrappers.
- A full local CSV backup of each tab is written and verified before that tab's
  first write wave.

Usage:
    python scripts/backfill_adzuna_descriptions.py --dry-run --max-jobs 20
    python scripts/backfill_adzuna_descriptions.py --tab "Aggregator - subsea_oil_gas"
    python scripts/backfill_adzuna_descriptions.py

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
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import gspread
import requests
from google.oauth2.service_account import Credentials

# Make `src...` importable when run from the scrapers/ dir.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.exporters.sheets import _retry_429  # noqa: E402
from src.aggregators.adzuna_adapter import (  # noqa: E402
    ADZUNA_SNIPPET_LEN,
    DESCRIPTION_MAX_LEN,
    _extract_jsonld_description,
    _looks_truncated,
    detail_url,
)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# Adzuna rows only ever land in aggregator tabs (aggregator_cli writes
# "Aggregator - <profile>"). Direct employer tabs are never touched.
TAB_PREFIX = "Aggregator - "
DEFAULT_STATE_PATH = "data/adzuna_backfill_state.json"
DEFAULT_WORKERS = 4
DEFAULT_DELAY = 0.25
WAVE_SIZE = 500           # fetch+write+save-state in waves so progress is durable
WRITE_CHUNK = 400         # description cells per Sheets batch_update call
INTER_CHUNK_PAUSE = 2.0
FETCH_MAX_RETRIES = 5

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
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


def is_adzuna(url: str) -> bool:
    return "adzuna." in url.lower()


def fetch_page(session: requests.Session, url: str):
    """Fetch one Adzuna details page. Returns (status_string, html_or_None).

    status_string: 'ok', 'gone' (410/404 -- Adzuna serves 410 for an expired
    posting), or 'transient' (retries exhausted -- NOT recorded in state, so
    the next run retries it).
    """
    delay = 2.0
    for _ in range(FETCH_MAX_RETRIES):
        try:
            resp = session.get(detail_url(url), timeout=20, allow_redirects=True)
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
        if resp.status_code == 403:
            # A 403 means the URL shape was wrong, not that the job is dead
            # (see detail_url). Never record it as resolved.
            return "transient", None
        # Unexpected 4xx: permanent enough to record, but keep it distinct.
        return "gone", None
    return "transient", None


def process_tab(ws, args, session, state, totals):
    """Backfill one worksheet. Returns the number of cells written."""
    print(f"\n=== Tab: {ws.title} ===")
    values = _retry_429(ws.get_all_values)
    if len(values) <= 1:
        print("  no data rows; skipping")
        return 0
    header, rows = values[0], values[1:]
    header_lower = [h.strip().lower() for h in header]

    def col(name_):
        try:
            return header_lower.index(name_)
        except ValueError:
            return None

    desc_idx = col("description")
    url_idx = col("url")
    if desc_idx is None or url_idx is None:
        print(f"  missing Description/URL column in header {header}; skipping")
        return 0
    desc_letter = col_to_letter(desc_idx)

    def cell(row, idx):
        return row[idx].strip() if len(row) > idx else ""

    targets = []  # (url, old_desc)
    for row in rows:
        url = cell(row, url_idx)
        if not url or not is_adzuna(url):
            continue
        old_desc = row[desc_idx] if len(row) > desc_idx else ""
        if not _looks_truncated(old_desc):
            continue
        if url in state:
            continue
        targets.append((url, old_desc))

    print(f"  {len(rows)} data rows, {len(targets)} truncated Adzuna rows to fix "
          f"(>= {ADZUNA_SNIPPET_LEN} chars or ellipsis-ended, unresolved)")
    if args.max_jobs:
        targets = targets[: args.max_jobs]
        print(f"  capped to {len(targets)} by --max-jobs")
    if not targets:
        return 0

    if not args.dry_run:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        safe = ws.title.replace("/", "-").replace(" ", "_")
        backup_path = f"data/{safe}-adzuna-backfill-backup-{stamp}.csv"
        print(f"  writing local backup to {backup_path} ...")
        written = write_local_backup(backup_path, header, rows)
        if written != len(rows):
            sys.exit(f"Backup verification FAILED: {written} rows on disk, "
                     f"expected {len(rows)}.")
        print(f"  backup verified: {written} data rows")

    def process(target):
        url, old_desc = target
        time.sleep(args.delay)
        status, page_html = fetch_page(session, url)
        if status != "ok":
            return url, status, None
        new_desc = _extract_jsonld_description(page_html)
        if not new_desc:
            return url, "no_jsonld", None
        if len(new_desc) > len(old_desc):
            return url, "updated", new_desc[:DESCRIPTION_MAX_LEN]
        return url, "no_change", None

    written_cells = 0
    for wave_start in range(0, len(targets), WAVE_SIZE):
        wave = targets[wave_start : wave_start + WAVE_SIZE]
        print(f"  wave {wave_start // WAVE_SIZE + 1}: fetching {len(wave)} pages "
              f"({args.workers} workers, {args.delay}s stagger)...")

        pending_writes = {}  # url -> new_desc
        wave_outcomes = {}   # url -> outcome
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = [ex.submit(process, t) for t in wave]
            for fut in as_completed(futures):
                url, outcome, new_desc = fut.result()
                totals[outcome] = totals.get(outcome, 0) + 1
                if outcome == "updated":
                    pending_writes[url] = new_desc
                if outcome != "transient":
                    wave_outcomes[url] = outcome

        print(f"    fetched. updated={len(pending_writes)} "
              f"resolved={len(wave_outcomes)} transient={len(wave) - len(wave_outcomes)}")

        if args.dry_run:
            for url, d in list(pending_writes.items())[:3]:
                print(f"    would update {url}: -> {len(d)} chars: {d[:120]!r}...")
            continue

        if pending_writes:
            # Fresh row map by URL immediately before writing: appends since our
            # read only add rows below, but a dedupe would shift them, and a
            # description cell landing on the wrong row is corpus corruption.
            url_col = _retry_429(ws.col_values, url_idx + 1)
            row_for_url = {}
            for i, u in enumerate(url_col[1:], start=2):  # 1-indexed, skip header
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
                print(f"    {skipped_missing} updated URLs no longer in the tab; skipped")

            # Captured before the write: gspread's batch_update mutates the
            # passed dicts, prefixing each range with the sheet title.
            probe_range = updates[0]["range"] if updates else None
            probe_value = updates[0]["values"][0][0] if updates else None

            for i in range(0, len(updates), WRITE_CHUNK):
                chunk = updates[i : i + WRITE_CHUNK]
                # Fresh dict copies on EVERY attempt: gspread's batch_update
                # mutates the passed dicts (prefixes the sheet title onto each
                # range), so a 429-retry re-sending the same dicts produces
                # "'Tab'!'Tab'!D..." and a 400.
                _retry_429(
                    lambda c=chunk: ws.batch_update(
                        [dict(u) for u in c], value_input_option="RAW"
                    )
                )
                written_cells += len(chunk)
                print(f"    wrote {min(i + WRITE_CHUNK, len(updates))}/{len(updates)} cells")
                if i + WRITE_CHUNK < len(updates):
                    time.sleep(INTER_CHUNK_PAUSE)

            if probe_range:
                # Independent read-back of the first written cell: proves the
                # write landed where the re-map said it would.
                got = _retry_429(ws.acell, probe_range).value or ""
                if got.strip() != probe_value.strip():
                    sys.exit(f"VERIFICATION FAILED at {probe_range}: read back "
                             f"{len(got)} chars, expected {len(probe_value)}. "
                             f"Stopping before further waves.")
                print(f"    verified read-back of {probe_range} ({len(probe_value)} chars)")

        for url, outcome in wave_outcomes.items():
            state[url] = outcome
        save_state(args.state_path, state)

    return written_cells


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="Fetch and report; write nothing to the sheet")
    ap.add_argument("--tab", action="append", default=None,
                    help="Tab to process (repeatable). Default: every 'Aggregator - *' tab")
    ap.add_argument("--max-jobs", type=int, default=None,
                    help="Cap on rows processed per tab (smoke tests)")
    ap.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    ap.add_argument("--delay", type=float, default=DEFAULT_DELAY,
                    help="Per-request stagger in seconds")
    ap.add_argument("--state-path", default=DEFAULT_STATE_PATH)
    args = ap.parse_args()

    client = authenticate()
    name = os.environ.get("GOOGLE_SHEETS_SPREADSHEET_NAME", "Job Scraping Results")
    ss = client.open(name)

    if args.tab:
        worksheets = [ss.worksheet(t) for t in args.tab]
    else:
        worksheets = [w for w in ss.worksheets() if w.title.startswith(TAB_PREFIX)]
    print(f"Tabs to scan: {len(worksheets)}")

    state = load_state(args.state_path)
    print(f"State file: {args.state_path} ({len(state)} rows already resolved)")

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    totals = {}
    total_written = 0

    for ws in worksheets:
        total_written += process_tab(ws, args, session, state, totals)

    print("\n==== Adzuna description backfill complete ====")
    for k, v in sorted(totals.items()):
        print(f"  {k}: {v}")
    print(f"  cells written: {total_written}")
    print(f"  unresolved (will retry next run): {totals.get('transient', 0)}")
    if args.dry_run:
        print("(dry run -- no cells were written, no state was saved)")


if __name__ == "__main__":
    main()
