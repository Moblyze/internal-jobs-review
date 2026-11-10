#!/usr/bin/env python3
"""Move status=removed rows from "Job Scraping Results" into its archive spreadsheet.

Runs daily as the archive-removed job of daily-scrape.yml, after both scrape
jobs and before the matrix update and the Slack digest (it deletes rows, so
it must never overlap another sheet writer). See src/utils/sheet_archive.py
for the safety and idempotency rules. Added Nov 9, 2026, when the main sheet
hit Google's size limit.

Usage:
    python scripts/archive_removed_rows.py --dry-run
    python scripts/archive_removed_rows.py [--tab CrewBase --tab BP]

Both spreadsheets are opened by ID (src/utils/sheet_config.py). After the
move it measures both spreadsheets' stored characters (size guard, Nov 10,
2026): a #monitoring note at 2x the post-cutover size, a failed step at 3x.

Environment:
    GOOGLE_SERVICE_ACCOUNT_PATH              service account JSON
    GOOGLE_SHEETS_SPREADSHEET_ID             optional override of the main sheet ID
    GOOGLE_SHEETS_ARCHIVE_SPREADSHEET_ID     optional override of the archive ID
    SLACK_MONITORING_WEBHOOK                 size-guard notes

Local runs as a Google user (no service-account creds exist locally):
    --oauth-token PATH --main-id ID --archive-id ID
"""

import argparse
import json
import logging
import os
import sys

import gspread

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.exporters.sheets import SheetsExporter  # noqa: E402
from src.utils.monitoring import post_monitoring_note  # noqa: E402
from src.utils.sheet_archive import (  # noqa: E402
    SIZE_BASELINE_CHARS, SIZE_FAIL_FACTOR, SIZE_WARN_FACTOR, SheetArchiver, size_verdict, spreadsheet_chars, with_retry,
)
from src.utils.sheet_config import archive_spreadsheet_id, open_jobs_spreadsheet  # noqa: E402

SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]


def client_from_args(args):
    if args.oauth_token:
        from google.oauth2.credentials import Credentials as UserCredentials
        with open(args.oauth_token) as f:
            d = json.load(f)
        creds = UserCredentials(token=d.get("token"), refresh_token=d["refresh_token"], token_uri=d["token_uri"],
                                client_id=d["client_id"], client_secret=d["client_secret"], scopes=SCOPES)
        return gspread.authorize(creds)
    from google.oauth2.service_account import Credentials
    path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_PATH")
    if not path or not os.path.exists(path):
        sys.exit("GOOGLE_SERVICE_ACCOUNT_PATH not set or file missing.")
    return gspread.authorize(Credentials.from_service_account_file(path, scopes=SCOPES))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--tab", action="append", help="limit to this tab (repeatable)")
    ap.add_argument("--oauth-token")
    ap.add_argument("--main-id")
    ap.add_argument("--archive-id")
    ap.add_argument("--report", help="write the JSON report here")
    ap.add_argument("--skip-size-check", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    gc = client_from_args(args)
    main_ss = with_retry(gc.open_by_key, args.main_id) if args.main_id else open_jobs_spreadsheet(gc, with_retry)
    archive_ss = with_retry(gc.open_by_key, args.archive_id or archive_spreadsheet_id())

    archiver = SheetArchiver(main_ss, archive_ss, SheetsExporter.HEADER_ROW)
    report = archiver.run(only_tabs=set(args.tab) if args.tab else None, dry_run=args.dry_run)
    if args.report:
        with open(args.report, "w") as f:
            json.dump(report, f, indent=1)

    per_tab = report["tabs"]
    print(f"\nTabs scanned: {report['tabs_scanned']}; tabs with removed rows: {len(per_tab)}"
          f"{' (dry run)' if args.dry_run else ''}")
    for tab, t in sorted(per_tab.items(), key=lambda kv: -kv[1]["delete"]):
        print(f"  {tab:45s} rows {t['rows_before']:>7,}  archive +{t['append']:>6,}  delete {t['delete']:>6,}")
    print(f"Appended to archive: {report['appended']:,}; deleted from main: {report['deleted']:,}")
    if report["skipped_tabs"]:
        print(f"::warning::Deletes skipped (rows changed mid-run): {', '.join(report['skipped_tabs'])}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(f"### Removed-row archive\n\nArchived {report['appended']:,} rows, deleted "
                    f"{report['deleted']:,} from the main sheet across {len(per_tab)} tabs.\n")

    if args.skip_size_check:
        return
    failed = False
    lines = []
    for label, ss in (("main", main_ss), ("archive", archive_ss)):
        chars, rows = spreadsheet_chars(ss)
        base = SIZE_BASELINE_CHARS.get(label)
        verdict = size_verdict(chars, base)
        ratio = f"{chars / base:.2f}x" if base else "n/a"
        line = f"{label}: {chars:,} chars in {rows:,} rows ({ratio} of the Nov 10, 2026 baseline {base or 0:,})"
        print(f"Size {line} -> {verdict}")
        lines.append(f"- {line}: {verdict}")
        if verdict != "ok":
            post_monitoring_note(
                f":warning: Job Scraping Results size guard: {label} spreadsheet is {ratio} of its post-cutover size "
                f"({chars:,} chars, {rows:,} rows). Warn at {SIZE_WARN_FACTOR:g}x, fail at {SIZE_FAIL_FACTOR:g}x; "
                f"the old sheet hit Google's edit limit at about 3.3x. "
                f"Sheet: https://docs.google.com/spreadsheets/d/{ss.id}"
            )
        failed = failed or verdict == "fail"
    if summary:
        with open(summary, "a") as f:
            f.write("\n#### Size guard\n" + "\n".join(lines) + "\n")
    if failed:
        sys.exit("Size guard: a spreadsheet is at 3x its post-cutover size; archive or trim before it hits the wall.")


if __name__ == "__main__":
    main()
