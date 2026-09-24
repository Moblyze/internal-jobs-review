#!/usr/bin/env python3
"""Daily source-page liveness probe for every active row in the state DB.

WHY THIS EXISTS (2026-09-12)
----------------------------
Jesse's direction: a job's "still open" status must come from probing the
source page, not from scrape diffs (which have false positives), and the flat
120-day freshness rule is replaced by this signal. This script asks each
active row's source whether the job is still open (src/utils/liveness.py),
writes the verdict to the state DB (source_status, source_checked_at,
source_valid_through, source_reason), retires DEAD rows in the DB and on the
sheet with removed_reason='source_gone', and emits data/liveness-latest.json
for scripts/export-jobs.js so jobs.json carries sourceStatus /
sourceCheckedAt / sourceValidThrough on every row.

Safety
------
* One request per second per host, no retries, robots honored (liveness.py).
* Circuit breaker: 15 consecutive BLOCKED on a host stops requesting it.
* A host that comes back mostly BLOCKED in a run is recorded UNKNOWN, and
  nothing on it is removed.
* Every DEAD verdict is an individual confirmation at the source (404/410,
  a "has been filled" marker, an ATS status endpoint, or absence from a fully
  fetched and page-sample-confirmed CrewBase sitemap), so DEAD rows are
  retired regardless of what share of a tab they are (Jesse, 2026-09-24: "We
  never want to keep dead jobs on the site because it might harm us with
  Google"). Until then the 10% mass-removal hold kept 191 confirmed-dead
  TechnipFMC rows live for days. The protection against a broken probe lives
  where the uncertainty is: UNKNOWN / BLOCKED / fetch errors never retire, a
  mostly-blocked host is demoted to UNKNOWN, a partial CrewBase sitemap read
  yields UNKNOWN, and an unconfirmed sitemap diff is demoted to UNKNOWN.
  A tab retiring more than 25% of its probed rows posts a note to #monitoring
  (SLACK_MONITORING_WEBHOOK) instead of being held.
* Sheet writes touch only the Status / Status Changed Date cells of rows
  whose URL was verified DEAD, after a CSV backup of (tab, row, url, old
  status) that the workflow uploads as an artifact.
* The listing diff keeps running; JobLifecycleManager logs diff_vs_probe
  disagreements and never overrides a LIVE probe younger than 3 days.

Usage (creds only exist in GitHub Actions; see liveness-probe.yml):
    python scripts/probe_liveness.py --state-db data/scraper_state.db --dry-run
    python scripts/probe_liveness.py --state-db data/scraper_state.db --company "Worley,CrewBase"
    python scripts/probe_liveness.py --state-db data/scraper_state.db --limit-per-host 20 --no-sheet --dry-run

Environment:
    GOOGLE_SERVICE_ACCOUNT_PATH      path to service account JSON (sheet writes)
    GOOGLE_SHEETS_SPREADSHEET_NAME   spreadsheet name (default "Job Scraping Results")
"""

import argparse
import csv
import json
import logging
import os
import random
import sys
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import yaml

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.utils import liveness  # noqa: E402
from src.utils.deduplication import DeduplicationTracker  # noqa: E402
from src.utils import monitoring  # noqa: E402

logger = logging.getLogger("probe_liveness")

CREWBASE_TAB = "CrewBase"
DEAD_SHEET_STATUSES = {"removed", "inactive", "expired", "closed"}
CIRCUIT_BREAKER_BLOCKED = 15      # consecutive BLOCKED answers before a host is abandoned for the run
HOST_BLOCKED_SHARE = 0.5          # a host with more BLOCKED than this is UNKNOWN for the run
MIN_ROWS_FOR_THRESHOLD = 10       # same floor as JobLifecycleManager's safety threshold
WRITE_CHUNK = 400
INTER_CHUNK_PAUSE = 2.0
MAX_WORKERS = 48


def load_company_meta(config_path: str) -> dict:
    """company name -> {'sheet_name', 'platform'} from companies.yaml."""
    with open(config_path, encoding="utf-8") as f:
        companies = yaml.safe_load(f)["companies"]
    return {c["name"]: {"sheet_name": c.get("sheet_name", c["name"]), "platform": c.get("platform")}
            for c in companies.values() if c.get("name")}


def tab_for(row: dict, meta: dict) -> str:
    if urlparse(row["url"]).netloc.lower().endswith("crewbase.pro"):
        return CREWBASE_TAB
    return meta.get(row["company"], {}).get("sheet_name", row["company"])


def platform_for(row: dict, meta: dict) -> Optional[str]:
    if urlparse(row["url"]).netloc.lower().endswith("crewbase.pro"):
        return "crewbase"
    return meta.get(row["company"], {}).get("platform")


def probe_host(host: str, rows: list[dict], prober: liveness.LivenessProber, meta: dict,
               limit: Optional[int], progress: Counter, lock: threading.Lock) -> list[tuple[dict, liveness.Verdict]]:
    """Probe one host's rows sequentially (the prober enforces 1 req/s/host)."""
    out = []
    blocked_run = 0
    tripped = False
    for i, row in enumerate(rows):
        if limit is not None and i >= limit:
            break
        if tripped:
            v = liveness.Verdict(liveness.UNKNOWN,
                                 f"circuit breaker: host answered BLOCKED {CIRCUIT_BREAKER_BLOCKED}x in a row")
        else:
            try:
                v = prober.probe(row["url"], title=row.get("title"), platform=platform_for(row, meta))
            except Exception as e:  # never let one URL kill a host's run
                logger.exception("probe crashed for %s", row["url"])
                v = liveness.Verdict(liveness.UNKNOWN, f"error: {type(e).__name__}: {str(e)[:60]}")
            blocked_run = blocked_run + 1 if v.status == liveness.BLOCKED else 0
            if blocked_run >= CIRCUIT_BREAKER_BLOCKED:
                tripped = True
                logger.warning("%s: circuit breaker tripped after %d consecutive BLOCKED", host, blocked_run)
        out.append((row, v))
        with lock:
            progress["done"] += 1
            if progress["done"] % 500 == 0:
                logger.info("progress: %d rows probed, %d requests", progress["done"], prober.requests_made)
    return out


def apply_host_blocked_rule(results: list[tuple[dict, liveness.Verdict]]) -> dict:
    """Hosts that were mostly BLOCKED this run are UNKNOWN for the run (nothing removed)."""
    by_host = defaultdict(list)
    for row, v in results:
        by_host[urlparse(row["url"]).netloc.lower()].append(v)
    demoted = {}
    for host, verdicts in by_host.items():
        requested = [v for v in verdicts if not v.reason.startswith("circuit breaker")]
        blocked = sum(1 for v in requested if v.status == liveness.BLOCKED)
        if requested and blocked / len(requested) > HOST_BLOCKED_SHARE:
            for v in verdicts:
                v.status = liveness.UNKNOWN
                v.reason = f"host mostly blocked this run ({blocked}/{len(requested)}); was: " + v.reason[:50]
            demoted[host] = (blocked, len(requested))
    return demoted


def confirm_crewbase_dead(results, prober: liveness.LivenessProber, sample: int = 20,
                          min_confirm: float = 0.8) -> Optional[tuple[int, int]]:
    """Spot-check the sitemap diff: a sample of "not in sitemap" rows must really answer 404/410.

    A truncated or stale sitemap would otherwise read as a mass closure. If
    fewer than `min_confirm` of the sampled pages are gone, every sitemap-diff
    DEAD verdict in this run is demoted to UNKNOWN.
    """
    dead = [(row, v) for row, v in results if v.reason == "not in crewbase sitemap"]
    if not dead:
        return None
    picks = random.Random(datetime.utcnow().strftime("%Y-%m-%d")).sample(dead, min(sample, len(dead)))
    gone = checked = 0
    for row, _v in picks:
        allowed, _why = prober.robots_allows(row["url"])
        if not allowed:
            continue
        resp = prober.fetch(row["url"])
        checked += 1
        if resp.status_code in (404, 410):
            gone += 1
    if checked and gone / checked < min_confirm:
        for _row, v in dead:
            v.status = liveness.UNKNOWN
            v.reason = f"sitemap diff unconfirmed by page sample ({gone}/{checked} gone)"
        logger.warning("crewbase: sitemap diff NOT confirmed (%d/%d sampled pages gone); DEAD demoted to UNKNOWN",
                       gone, checked)
    else:
        logger.info("crewbase: sitemap diff confirmed by page sample (%d/%d gone)", gone, checked)
    return gone, checked


def decide_removals(results, tabs: dict, notify_share: float = monitoring.LARGE_RETIRE_SHARE) -> tuple[list, dict]:
    """(rows to retire, {tab: report}).

    Every DEAD row is retired: a DEAD verdict is a per-row confirmation at the
    source, never an inference from a failed or partial read (those come back
    UNKNOWN / BLOCKED and are never retired). A tab whose DEAD share is above
    `notify_share` is marked `large` so the run posts a #monitoring note; it is
    NOT held.
    """
    per_tab = defaultdict(lambda: {"probed": 0, "dead": 0, "dead_rows": [], "reasons": Counter()})
    for row, v in results:
        t = per_tab[tabs[row["url_hash"]]]
        t["probed"] += 1
        if v.status == liveness.DEAD:
            t["dead"] += 1
            t["dead_rows"].append(row)
            t["reasons"][v.reason.split(" (")[0][:40]] += 1
    to_remove, report = [], {}
    for tab, t in per_tab.items():
        share = t["dead"] / t["probed"] if t["probed"] else 0.0
        report[tab] = {"probed": t["probed"], "dead": t["dead"], "dead_share": round(share, 3),
                       "large": monitoring.is_large_retire(t["dead"], t["probed"], notify_share),
                       "top_reasons": t["reasons"].most_common(3)}
        to_remove.extend(t["dead_rows"])
    return to_remove, report


# ---------------------------------------------------------------------------
# sheet side
# ---------------------------------------------------------------------------

def col_to_letter(col_idx: int) -> str:
    letter = ""
    while col_idx >= 0:
        letter = chr(col_idx % 26 + ord("A")) + letter
        col_idx = col_idx // 26 - 1
    return letter


def retire_on_sheet(spreadsheet, tab: str, urls: set[str], now_iso: str, backup_writer, dry_run: bool) -> int:
    """Set Status=removed on every still-active row of the given URLs in one tab."""
    from gspread.exceptions import WorksheetNotFound
    from src.exporters.sheets import _retry_429

    try:
        # Wrapped, like every other Sheets call in this function. gspread's
        # Spreadsheet.worksheet() is not a local lookup: it re-fetches the whole
        # spreadsheet's metadata over the API on every call, and this function
        # is called once per tab. That unretried read is what exhausted the
        # per-minute read quota and killed the whole probe run on 2026-09-16 and
        # 2026-09-19 -- after the DEAD verdicts were computed but before most
        # tabs had been written, so a day of retirements was thrown away each
        # time. WorksheetNotFound is not an APIError, so it still propagates to
        # the handler below.
        ws = _retry_429(spreadsheet.worksheet, tab)
    except WorksheetNotFound:
        logger.warning("tab %r not found on the sheet; %d DEAD urls not retired there", tab, len(urls))
        return 0
    header = [h.strip().lower() for h in _retry_429(ws.row_values, 1)]
    try:
        url_i, status_i, date_i = header.index("url"), header.index("status"), header.index("status changed date")
    except ValueError as e:
        logger.warning("tab %r is missing a column (%s); skipped", tab, e)
        return 0
    url_col = _retry_429(ws.col_values, url_i + 1)
    time.sleep(1.0)
    status_col = _retry_429(ws.col_values, status_i + 1)
    targets = []
    for idx in range(1, len(url_col)):          # skip header
        u = url_col[idx].strip()
        if u not in urls:
            continue
        old = status_col[idx].strip() if idx < len(status_col) else ""
        if old.lower() in DEAD_SHEET_STATUSES:
            continue
        targets.append((idx + 1, u, old))
    for rn, u, old in targets:
        backup_writer.writerow([tab, rn, u, old])
    if dry_run or not targets:
        logger.info("%s: %d rows would be set removed on the sheet%s", tab, len(targets), " (dry run)" if dry_run else "")
        return len(targets)
    updates = []
    s_letter, d_letter = col_to_letter(status_i), col_to_letter(date_i)
    for rn, _u, _old in targets:
        updates.append({"range": f"{s_letter}{rn}", "values": [["removed"]]})
        updates.append({"range": f"{d_letter}{rn}", "values": [[now_iso]]})
    for i in range(0, len(updates), WRITE_CHUNK * 2):
        chunk = updates[i:i + WRITE_CHUNK * 2]
        # fresh dicts per attempt: gspread mutates the payload (sheet-title prefix)
        _retry_429(lambda c=chunk: ws.batch_update([dict(u) for u in c], value_input_option="RAW"))
        if i + WRITE_CHUNK * 2 < len(updates):
            time.sleep(INTER_CHUNK_PAUSE)
    logger.info("%s: %d rows set removed on the sheet", tab, len(targets))
    return len(targets)


def open_spreadsheet():
    import gspread
    from google.oauth2.service_account import Credentials

    cred_path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_PATH")
    if not cred_path or not os.path.exists(cred_path):
        return None
    creds = Credentials.from_service_account_file(cred_path, scopes=[
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ])
    return gspread.authorize(creds).open(os.environ.get("GOOGLE_SHEETS_SPREADSHEET_NAME", "Job Scraping Results"))


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--state-db", default="data/scraper_state.db")
    ap.add_argument("--config", default="config/companies.yaml")
    ap.add_argument("--out", default="data/liveness-latest.json", help="verdicts keyed by URL, read by scripts/export-jobs.js")
    ap.add_argument("--company", default="", help="comma-separated tab or company names to limit the run to")
    ap.add_argument("--limit-per-host", type=int, default=None, help="probe at most N rows per host (testing)")
    ap.add_argument("--notify-dead-share", type=float, default=monitoring.LARGE_RETIRE_SHARE,
                    help="post a #monitoring note for a tab retiring more than this share (default 0.25); never holds")
    # Retired 2026-09-24: DEAD rows are no longer held by share. Both flags are
    # accepted and ignored so older dispatches and scripts do not break.
    ap.add_argument("--max-dead-share", type=float, default=None, help=argparse.SUPPRESS)
    ap.add_argument("--allow-mass-removal", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--min-interval", type=float, default=1.0, help="seconds between requests to one host")
    ap.add_argument("--no-sheet", action="store_true", help="write the DB and JSON only; leave the sheet alone")
    ap.add_argument("--dry-run", action="store_true", help="probe and report; write nothing but the JSON")
    ap.add_argument("--today", default=None, help="YYYY-MM-DD for validThrough comparisons (testing)")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)   # one line per request is too much for CI logs
    if not os.path.exists(args.state_db):
        sys.exit(f"State DB not found: {args.state_db} (download it from release scraper-state-latest first)")

    t0 = time.time()
    meta = load_company_meta(args.config)
    tracker = DeduplicationTracker(db_path=args.state_db)
    rows = tracker.get_active_jobs()
    wanted = {s.strip() for s in args.company.split(",") if s.strip()}
    if wanted:
        rows = [r for r in rows if tab_for(r, meta) in wanted or r["company"] in wanted]
    tabs = {r["url_hash"]: tab_for(r, meta) for r in rows}

    excluded = [r for r in rows if liveness.is_excluded_host(r["url"])]
    probe_rows = [r for r in rows if not liveness.is_excluded_host(r["url"])]
    by_host = defaultdict(list)
    for r in probe_rows:
        by_host[urlparse(r["url"]).netloc.lower()].append(r)
    logger.info("roster: %d active rows, %d on excluded hosts, %d to probe across %d hosts",
                len(rows), len(excluded), len(probe_rows), len(by_host))

    today = date.fromisoformat(args.today) if args.today else None
    prober = liveness.LivenessProber(min_interval=args.min_interval, today=today)
    progress, lock = Counter(), threading.Lock()
    results: list[tuple[dict, liveness.Verdict]] = []
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, max(1, len(by_host)))) as pool:
        futures = [pool.submit(probe_host, host, hrows, prober, meta, args.limit_per_host, progress, lock)
                   for host, hrows in sorted(by_host.items(), key=lambda kv: -len(kv[1]))]
        for f in futures:
            results.extend(f.result())
    crewbase_check = confirm_crewbase_dead(results, prober)
    probe_seconds = time.time() - t0
    demoted = apply_host_blocked_rule(results)

    # ---- report per host ----
    per_host = defaultdict(Counter)
    for row, v in results:
        per_host[urlparse(row["url"]).netloc.lower()][v.status] += 1
    print("\n=== liveness probe: per host ===")
    print(f"{'host':44} {'probed':>6} {'live':>6} {'dead':>6} {'blocked':>7} {'unknown':>7}")
    for host, c in sorted(per_host.items(), key=lambda kv: -sum(kv[1].values())):
        print(f"{host:44} {sum(c.values()):6} {c['LIVE']:6} {c['DEAD']:6} {c['BLOCKED']:7} {c['UNKNOWN']:7}")
    unknown_reasons = Counter(v.reason.split(" (")[0][:60] for _r, v in results if v.status == liveness.UNKNOWN)
    if unknown_reasons:
        print("\nUNKNOWN reasons:", dict(unknown_reasons.most_common(12)))
    if demoted:
        print("\nhosts demoted to UNKNOWN (mostly blocked):", demoted)

    # A host whose rule is systematically not matching what its pages return
    # (2026-09-13: Worley/Schlumberger came back ~100% UNKNOWN, 0% DEAD) is
    # invisible in the global top-12 above when its individual reason
    # strings carry per-request detail (a transport error message, an
    # "ambiguous"/"title missing" variant) that fragments into many small
    # buckets instead of one dominant one. Call those hosts out explicitly
    # with their own reason breakdown so the next incident is diagnosable
    # from this report alone, without re-running with extra flags.
    HIGH_UNKNOWN_SHARE = 0.9
    for host, c in per_host.items():
        probed = sum(c.values())
        if probed >= MIN_ROWS_FOR_THRESHOLD and c["UNKNOWN"] / probed >= HIGH_UNKNOWN_SHARE:
            host_reasons = Counter(
                v.reason[:80] for r, v in results
                if v.status == liveness.UNKNOWN and urlparse(r["url"]).netloc.lower() == host
            )
            print(f"\n{host}: {c['UNKNOWN']}/{probed} UNKNOWN ({c['UNKNOWN']/probed:.0%}) -- "
                  f"rule likely not matching this host's pages. Top reasons:")
            for reason, count in host_reasons.most_common(8):
                print(f"    {count:5}  {reason}")
    if crewbase_check:
        print(f"\ncrewbase sitemap-diff page sample: {crewbase_check[0]}/{crewbase_check[1]} gone")

    # ---- decide and apply removals ----
    if args.max_dead_share is not None or args.allow_mass_removal:
        logger.info("--max-dead-share / --allow-mass-removal are retired: confirmed-DEAD rows always retire")
    to_remove, tab_report = decide_removals(results, tabs, args.notify_dead_share)
    print("\n=== per tab ===")
    for tab, rep in sorted(tab_report.items(), key=lambda kv: -kv[1]["dead"]):
        flag = "  LARGE (retired; #monitoring note)" if rep["large"] else ""
        print(f"{tab:34} probed {rep['probed']:6}  dead {rep['dead']:6}  share {rep['dead_share']:.1%}{flag}")

    checked_at = datetime.utcnow().isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()
    removed_db = 0
    if not args.dry_run:
        tracker.record_source_status(
            [(row["url_hash"], v.status, v.valid_through, v.reason[:120]) for row, v in results],
            checked_at=checked_at,
        )
        removed_db = tracker.mark_jobs_removed([r["url_hash"] for r in to_remove], reason="source_gone")
    tracker.close()

    # ---- sheet ----
    sheet_rows = 0
    if to_remove and not args.no_sheet:
        spreadsheet = open_spreadsheet()
        if spreadsheet is None:
            if args.dry_run:
                logger.info("no sheet credentials; sheet step skipped (dry run)")
            else:
                sys.exit("GOOGLE_SERVICE_ACCOUNT_PATH not set: the DB was updated but the sheet could not be. "
                         "Pass --no-sheet to accept that, or provide credentials.")
        else:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            backup_path = f"data/liveness-retire-backup-{stamp}.csv"
            os.makedirs("data", exist_ok=True)
            by_tab = defaultdict(set)
            for r in to_remove:
                by_tab[tabs[r["url_hash"]]].add(r["url"])
            with open(backup_path, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow(["tab", "row", "url", "previous_status"])
                for tab, urls in sorted(by_tab.items()):
                    sheet_rows += retire_on_sheet(spreadsheet, tab, urls, now_iso, w, args.dry_run)
                    time.sleep(1.5)
            logger.info("sheet backup of changed rows: %s", backup_path)

    # ---- JSON for export-jobs.js ----
    removed_hashes = {r["url_hash"] for r in to_remove}
    out = {
        "generated_at": now_iso,
        "dry_run": args.dry_run,
        "rows": {
            row["url"]: {
                "s": v.status, "t": checked_at, "v": v.valid_through, "r": v.reason[:80],
                **({"removed": True} if row["url_hash"] in removed_hashes and not args.dry_run else {}),
            }
            for row, v in results
        },
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))

    totals = Counter(v.status for _r, v in results)
    large_tabs = [t for t, rep in tab_report.items() if rep["large"]]
    if large_tabs and not args.dry_run and removed_db:
        batches = []
        for t in sorted(large_tabs, key=lambda t: -tab_report[t]["dead"]):
            rep = tab_report[t]
            why = "confirmed dead at source: " + ", ".join(f"{r} x{n}" for r, n in rep["top_reasons"])
            batches.append((t, rep["dead"], rep["probed"], why))
        monitoring.post_monitoring_note(monitoring.format_large_retire_note("Liveness probe", batches))
    print("\n=== summary ===")
    print(f"mode: {'DRY RUN' if args.dry_run else 'LIVE'}   rows probed: {len(results)}   excluded-host rows: {len(excluded)}")
    print(f"live {totals['LIVE']}  dead {totals['DEAD']}  blocked {totals['BLOCKED']}  unknown {totals['UNKNOWN']}")
    print(f"removed: db {removed_db}, sheet rows {sheet_rows}   large tabs (noted, not held): {large_tabs or 'none'}")
    print(f"requests: {prober.requests_made}   probe runtime: {probe_seconds/60:.1f} min   total: {(time.time()-t0)/60:.1f} min")
    print(f"json: {args.out} ({len(out['rows'])} urls)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
