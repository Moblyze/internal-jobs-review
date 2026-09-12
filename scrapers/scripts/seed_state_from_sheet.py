#!/usr/bin/env python3
"""Seed scraper_state.db with the rows a direct employer tab already holds.

WHY THIS EXISTS (2026-09-12)
----------------------------
The lifecycle manager retires a job by diffing the CURRENT scrape against the
jobs the state DB has as active for that company. It never looks at the sheet.
When a scraper is dead for months and the state DB is rebuilt in between (it
restarted on 2026-05-12), the tab keeps rows the DB has never heard of:

    tab           active rows   known to DB   orphaned
    KBR                 1,676             0      1,676
    Baker Hughes          332            60        272
    BP                    281            72        209
    Phillips 66           104            10         88

Those orphaned rows can never be retired by the daily run, and a live job that
is on the tab but not in the DB gets exported a second time (duplicate row).

This script reads a direct tab and inserts every row's URL into the state DB
with the status the sheet shows, first_seen/last_seen from the row's Scraped At,
and exported_to_sheets=1. Without --probe nothing is written to the sheet: the
next successful scrape retires the rows that are gone through the normal
lifecycle path (safety threshold included) and does not re-export the ones
that are still live.

Rows already in the DB are left untouched (INSERT OR IGNORE on url_hash).

--probe (2026-09-12): instead of trusting the next scrape's listing diff to
retire the orphaned rows, ask the source about EACH active orphaned URL:
  workday_api      GET {api_base}{externalPath}: 200 with posted=true -> live;
                   403 errorCode S22 or 404 -> gone (verified on old KBR and
                   Baker Hughes rows on 2026-09-12)
  successfactors   GET the job page: "Sorry, this position has been filled." or
                   404 -> gone; a validThrough meta in the future -> live
Gone rows are seeded as removed AND their Status / Status Changed Date cells
are set on the sheet (chunked writes, local CSV backup of the tab first, like
scripts/retire_gone_crewbase.py). Live rows are seeded active. Anything the
probe cannot decide is seeded active and left to the daily lifecycle diff.
A 726-URL probe run the same day found the dead scrapers' rows ~96% gone at
the source, so a per-URL verdict, not a single listing diff, is the evidence
each retired row rests on.

Usage (creds only exist in GitHub Actions; see seed-state-from-sheet.yml):
    python scripts/seed_state_from_sheet.py --company kbr,baker_hughes --dry-run
    python scripts/seed_state_from_sheet.py --company kbr --probe --dry-run
    python scripts/seed_state_from_sheet.py --company kbr --probe --state-db data/scraper_state.db

Environment:
    GOOGLE_SERVICE_ACCOUNT_PATH      path to service account JSON
    GOOGLE_SHEETS_SPREADSHEET_NAME   spreadsheet name (default "Job Scraping Results")
"""

import argparse
import csv
import hashlib
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from typing import Optional

import gspread
import httpx
import yaml
from google.oauth2.service_account import Credentials

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.exporters.sheets import _retry_429  # noqa: E402
from src.utils.deduplication import DeduplicationTracker  # noqa: E402

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]
DEAD_STATUSES = {"removed", "inactive", "expired", "closed"}
WRITE_CHUNK = 400
INTER_CHUNK_PAUSE = 2.0
PROBE_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_VALID_THROUGH_RE = re.compile(r'validThrough"\s+content="([^"]+)"')


class SourceProbe:
    """Per-URL liveness check against the employer's own site. Verdicts: live, gone, unknown."""

    def __init__(self, cfg: dict, delay: float = 0.75):
        self.cfg = cfg
        self.platform = cfg.get("platform", "workday")
        self.delay = delay
        self.client = httpx.Client(headers={"User-Agent": PROBE_UA, "Accept-Language": "en-US,en;q=0.9"},
                                   timeout=30.0, follow_redirects=True)
        if self.platform in ("workday_api", "workday"):
            # Every Workday tenant exposes the CXS detail endpoint, so rows from
            # the browser-based scraper (BP) can be verified the same way.
            self.platform = "workday_api"
            from urllib.parse import urlparse
            parsed = urlparse(cfg["base_url"])
            self.host = parsed.netloc
            self.site = cfg.get("wd_site") or [p for p in parsed.path.split("/") if p][-1]
            self.tenant = cfg.get("wd_tenant") or self.host.split(".")[0]
            self.locale = cfg.get("url_locale", "en-US")
        elif self.platform != "successfactors":
            sys.exit(f"--probe supports workday_api and successfactors only, not '{self.platform}'")

    def _get(self, url: str, accept: str) -> Optional[httpx.Response]:
        for attempt in range(1, 4):
            try:
                resp = self.client.get(url, headers={"Accept": accept})
            except httpx.HTTPError:
                time.sleep(2 ** attempt)
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                time.sleep(min(60, 3 * 2 ** attempt))
                continue
            return resp
        return None

    def verdict(self, url: str) -> str:
        time.sleep(self.delay)
        if self.platform == "workday_api":
            prefix = f"https://{self.host}/{self.locale}/{self.site}"
            if not url.startswith(prefix):
                return "unknown"
            api_url = f"https://{self.host}/wday/cxs/{self.tenant}/{self.site}{url[len(prefix):]}"
            resp = self._get(api_url, "application/json")
            if resp is None:
                return "unknown"
            if resp.status_code == 404:
                return "gone"
            if resp.status_code == 403 and '"S22"' in resp.text:
                return "gone"
            if resp.status_code == 200:
                try:
                    info = resp.json().get("jobPostingInfo") or {}
                except ValueError:
                    return "unknown"
                return "live" if info.get("posted", True) else "gone"
            return "unknown"

        # successfactors (careers.<company>.com job pages)
        resp = self._get(url, "text/html")
        if resp is None:
            return "unknown"
        if resp.status_code == 404:
            return "gone"
        if resp.status_code != 200:
            return "unknown"
        text = resp.text
        if "position has been filled" in text or "no longer available" in text:
            return "gone"
        m = _VALID_THROUGH_RE.search(text)
        if m:
            try:
                # e.g. "Mon Sep 14 05:00:00 UTC 2026"
                through = datetime.strptime(m.group(1), "%a %b %d %H:%M:%S %Z %Y")
                return "live" if through >= datetime.utcnow() else "gone"
            except ValueError:
                return "live"
        return "unknown"


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


def retire_rows_on_sheet(ws, tab: str, row_numbers: list[int], header: list, raw_rows: list, now: str) -> None:
    """Set Status=removed and Status Changed Date on the given sheet rows, chunked, after a verified CSV backup."""
    hl = [h.strip().lower() for h in header]
    status_letter = col_to_letter(hl.index("status"))
    date_letter = col_to_letter(hl.index("status changed date"))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = f"data/{tab.replace(' ', '_')}-retire-backup-{stamp}.csv"
    n = write_local_backup(backup, header, raw_rows)
    if n != len(raw_rows):
        sys.exit(f"Backup verification FAILED for {tab}: {n} rows on disk, expected {len(raw_rows)}.")
    print(f"    backup verified: {backup} ({n:,} data rows)")
    updates = []
    for rn in row_numbers:
        updates.append({"range": f"{status_letter}{rn}", "values": [["removed"]]})
        updates.append({"range": f"{date_letter}{rn}", "values": [[now]]})
    for i in range(0, len(updates), WRITE_CHUNK):
        chunk = updates[i:i + WRITE_CHUNK]
        # fresh dicts per attempt: gspread mutates the payload (sheet-title prefix)
        _retry_429(lambda c=chunk: ws.batch_update([dict(u) for u in c], value_input_option="RAW"))
        if i + WRITE_CHUNK < len(updates):
            time.sleep(INTER_CHUNK_PAUSE)
    print(f"    sheet: {len(row_numbers):,} rows set to removed")


def authenticate():
    cred_path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_PATH")
    if not cred_path or not os.path.exists(cred_path):
        sys.exit("GOOGLE_SERVICE_ACCOUNT_PATH not set or file missing.")
    creds = Credentials.from_service_account_file(cred_path, scopes=SCOPES)
    return gspread.authorize(creds)


def load_company(key: str, config_path: str) -> dict:
    with open(config_path, encoding="utf-8") as f:
        companies = yaml.safe_load(f)["companies"]
    if key not in companies:
        sys.exit(f"Unknown company key '{key}'. Known: {', '.join(sorted(companies))}")
    return companies[key]


def read_tab(ws) -> tuple[list[dict], list, list]:
    """Return (parsed rows, raw header, raw data rows)."""
    values = _retry_429(ws.get_all_values)
    if len(values) < 2:
        return [], values[0] if values else [], []
    header = [h.strip().lower() for h in values[0]]

    def col(name: str):
        return header.index(name) if name in header else None

    url_i, title_i = col("url"), col("title")
    status_i, date_i, scraped_i = col("status"), col("status changed date"), col("scraped at")
    if url_i is None or title_i is None:
        sys.exit(f"Tab is missing URL/Title columns. Header: {values[0]}")

    rows = []
    for row_number, row in enumerate(values[1:], start=2):
        def cell(i):
            return row[i].strip() if i is not None and len(row) > i else ""
        url = cell(url_i)
        if not url.startswith("http"):
            continue
        status_raw = cell(status_i).lower()
        rows.append({
            "row_number": row_number,
            "url": url,
            "title": cell(title_i) or "(untitled)",
            "status": "removed" if status_raw in DEAD_STATUSES else "active",
            "status_changed_date": cell(date_i),
            "scraped_at": cell(scraped_i),
        })
    return rows, values[0], values[1:]


def seed(conn: sqlite3.Connection, company_name: str, rows: list[dict], dry_run: bool,
         probe: Optional["SourceProbe"] = None) -> dict:
    """Bring the DB and (with a probe) the sheet in line with the source for one tab.

    Rows are grouped by URL because direct tabs carry duplicate rows and the
    lifecycle manager only ever updates the last row of a URL, so one URL can
    be "removed" on one row and "active" on another. A URL counts as active on
    the sheet if ANY of its rows is active.

    Without a probe: URLs unknown to the DB are inserted with the sheet status.
    With a probe: every URL that has an active row is asked at the source.
      gone  -> DB row removed (inserted or updated), every active sheet row of
               that URL listed in summary['retire_rows']
      live  -> DB row active if it was unknown; nothing else
      unknown -> treated like live (the daily diff keeps checking it)
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    db_status = {r[0]: r[1] for r in conn.execute(
        "SELECT url_hash, status FROM scraped_jobs WHERE company = ?", (company_name,)
    )}
    known_any = {r[0] for r in conn.execute("SELECT url_hash FROM scraped_jobs")}

    groups: dict[str, dict] = {}
    for r in rows:
        h = hashlib.sha256(r["url"].encode("utf-8")).hexdigest()
        g = groups.setdefault(h, {"url": r["url"], "title": r["title"], "scraped_at": r["scraped_at"],
                                  "status_changed_date": r["status_changed_date"], "active_rows": [], "rows": 0})
        g["rows"] += 1
        if r["status"] == "active" and r.get("row_number"):
            g["active_rows"].append(r["row_number"])
        if r["status_changed_date"] > g["status_changed_date"]:
            g["status_changed_date"] = r["status_changed_date"]

    summary = {"rows": len(rows), "unique_urls": len(groups), "duplicate_rows": len(rows) - len(groups),
               "already_in_db": 0, "in_db_under_other_company": 0,
               "insert_active": 0, "insert_removed": 0, "db_marked_removed": 0,
               "probe_live": 0, "probe_gone": 0, "probe_unknown": 0, "retire_rows": []}
    to_insert, to_mark_removed = [], []
    for h, g in groups.items():
        sheet_status = "active" if g["active_rows"] else "removed"
        in_db = h in db_status
        if in_db:
            summary["already_in_db"] += 1
        elif h in known_any:
            summary["in_db_under_other_company"] += 1
            continue

        status = sheet_status
        changed = g["status_changed_date"] or g["scraped_at"] or now
        if probe is not None and sheet_status == "active":
            verdict = probe.verdict(g["url"])
            summary[f"probe_{verdict}"] += 1
            if verdict == "gone":
                status, changed = "removed", now
                summary["retire_rows"].extend(g["active_rows"])
                if in_db and db_status[h] == "active":
                    to_mark_removed.append(h)

        if not in_db:
            ts = g["scraped_at"] or now
            to_insert.append((h, g["url"], company_name, g["title"], ts, ts, status, changed, 1))
            summary["insert_active" if status == "active" else "insert_removed"] += 1

    summary["db_marked_removed"] = len(to_mark_removed)
    if not dry_run:
        if to_insert:
            conn.executemany(
                "INSERT OR IGNORE INTO scraped_jobs (url_hash, url, company, title, first_seen, "
                "last_seen, status, status_changed_date, exported_to_sheets) VALUES (?,?,?,?,?,?,?,?,?)",
                to_insert,
            )
        if to_mark_removed:
            conn.executemany(
                "UPDATE scraped_jobs SET status = 'removed', status_changed_date = ? "
                "WHERE url_hash = ? AND status = 'active'",
                [(now, h) for h in to_mark_removed],
            )
        conn.commit()
    return summary


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--company", required=True,
                    help="companies.yaml key, or a comma-separated list of keys")
    ap.add_argument("--state-db", default="data/scraper_state.db")
    ap.add_argument("--config", default="config/companies.yaml")
    ap.add_argument("--probe", action="store_true",
                    help="check each active orphaned URL at the source; gone rows are retired on the sheet too")
    ap.add_argument("--probe-delay", type=float, default=0.75, help="seconds between probe requests")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.state_db):
        sys.exit(f"State DB not found: {args.state_db} (download it from release scraper-state-latest first)")

    keys = [k.strip() for k in args.company.split(",") if k.strip()]
    client = authenticate()
    spreadsheet = client.open(os.environ.get("GOOGLE_SHEETS_SPREADSHEET_NAME", "Job Scraping Results"))

    # Opening through the tracker guarantees the schema (and its migrations) match production.
    tracker = DeduplicationTracker(db_path=args.state_db)
    conn = tracker.conn

    for key in keys:
        cfg = load_company(key, args.config)
        company_name, tab = cfg["name"], cfg["sheet_name"]
        ws = spreadsheet.worksheet(tab)
        rows, header, raw_rows = read_tab(ws)
        probe = SourceProbe(cfg, delay=args.probe_delay) if args.probe else None
        before = conn.execute(
            "SELECT status, COUNT(*) FROM scraped_jobs WHERE company = ? GROUP BY status", (company_name,)
        ).fetchall()
        t0 = time.time()
        summary = seed(conn, company_name, rows, args.dry_run, probe=probe)
        after = conn.execute(
            "SELECT status, COUNT(*) FROM scraped_jobs WHERE company = ? GROUP BY status", (company_name,)
        ).fetchall()
        retire = summary.pop("retire_rows")
        mode = "DRY RUN" if args.dry_run else "SEEDED"
        print(f"[{mode}] {company_name} (tab '{tab}', {time.time() - t0:.0f}s): {summary}")
        print(f"    DB before: {dict(before)}  after: {dict(after)}")
        if retire:
            print(f"    rows verified gone at source, to retire on the sheet: {len(retire):,}"
                  f" (first rows: {retire[:5]})")
            if not args.dry_run:
                now_iso = datetime.now(timezone.utc).isoformat()
                retire_rows_on_sheet(ws, tab, retire, header, raw_rows, now_iso)

    tracker.close()


if __name__ == "__main__":
    main()
