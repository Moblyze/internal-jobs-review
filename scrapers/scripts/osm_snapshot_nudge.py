#!/usr/bin/env python3
"""Daytime prompt when the nightly OSM Thome fetch was missed (Mac Studio only).

WHY (2026-09-24, Jesse approved)
--------------------------------
The OSM listing is fetched by the launchd agent co.kedy.osm-snapshot at 21:30
ET. If the Studio was asleep or off, the snapshot ages out after 36 h and OSM
quietly stops updating. Instead, this runs at 10:00 and 14:00 ET (launchd
co.kedy.osm-snapshot-nudge), when the Mac is surely on, and asks first.
Nothing reaches OSM without a click.

Each run:
  * snapshot fresh (last successful fetch under STALE_HOURS)  -> exit quietly;
  * OSM in backoff after a refusal -> no prompt (a click could not fetch); the
    14:00 run posts one #monitoring note that day saying so;
  * otherwise a native dialog "OSM jobs refresh missed, run now?". "Run now"
    runs osm_snapshot_fetch.py exactly as the nightly job does (same 5
    requests, same cap, same once-a-day guard and backoff) and shows the result
    as a notification. "Not now" or no answer within DIALOG_TIMEOUT leaves it;
    at 14:00 that also sends the backup nudge to #monitoring via the
    osm-refresh-missed.yml workflow (the webhook lives only in GitHub secrets).

Usage:
    python3 scripts/osm_snapshot_nudge.py --slot morning     # launchd, 10:00
    python3 scripts/osm_snapshot_nudge.py --slot afternoon   # launchd, 14:00
    python3 scripts/osm_snapshot_nudge.py --test             # show the dialog now, whatever the state
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import osm_snapshot_fetch as fetcher  # noqa: E402

STALE_HOURS = 36
DIALOG_TIMEOUT = 3 * 3600      # seconds before an unanswered dialog closes itself
TITLE = "Moblyze: OSM Thome jobs"
WORKFLOW = "osm-refresh-missed.yml"


def log(msg: str) -> None:
    fetcher.log(f"[nudge] {msg}")


def age_hours(state: dict, now: datetime) -> float | None:
    last = state.get("last_success_at")
    return None if not last else (now - datetime.fromisoformat(last)).total_seconds() / 3600


def decide(state: dict, now: datetime) -> str:
    """'fresh' | 'backoff' | 'prompt'."""
    age = age_hours(state, now)
    if age is not None and age < STALE_HOURS:
        return "fresh"
    nxt = state.get("next_allowed_at")
    if nxt and now < datetime.fromisoformat(nxt):
        return "backoff"
    return "prompt"


def _osa_quote(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def ask(message: str, timeout: int = DIALOG_TIMEOUT) -> str:
    """'run' | 'no' | 'timeout' from a native dialog."""
    script = (f"display dialog {_osa_quote(message)} with title {_osa_quote(TITLE)} "
              f'buttons {{"Not now", "Run now"}} default button "Run now" cancel button "Not now" '
              f"with icon caution giving up after {timeout}")
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if r.returncode != 0:          # "Not now" is the cancel button -> error -128
        return "no"
    if "gave up:true" in r.stdout:
        return "timeout"
    return "run" if "Run now" in r.stdout else "no"


def notify(text: str) -> None:
    subprocess.run(["osascript", "-e", f"display notification {_osa_quote(text)} with title {_osa_quote(TITLE)}"],
                   capture_output=True)


def run_fetch() -> tuple[int, str]:
    r = subprocess.run([sys.executable, os.path.join(HERE, "osm_snapshot_fetch.py")],
                       capture_output=True, text=True, timeout=900)
    out = (r.stdout + r.stderr).strip()
    print(out, flush=True)
    return r.returncode, (out.splitlines() or [""])[-1]


def slack_backup(message: str, state: dict, state_path: str, today: str) -> None:
    """One #monitoring note per day, through the repo workflow that holds the webhook."""
    if state.get("last_slack_nudge") == today:
        return
    r = subprocess.run(["gh", "workflow", "run", WORKFLOW, "-R", fetcher.REPO, "-f", f"message={message}"],
                       capture_output=True, text=True, timeout=120)
    if r.returncode == 0:
        state["last_slack_nudge"] = today
        fetcher.write_state(state_path, state)
        log("backup nudge sent to #monitoring")
    else:
        log(f"backup nudge FAILED: {(r.stderr or r.stdout).strip()[:300]}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--slot", choices=["morning", "afternoon"], default="morning")
    ap.add_argument("--state-dir", default=fetcher.DEFAULT_STATE_DIR)
    ap.add_argument("--test", action="store_true", help="show the dialog now regardless of state")
    args = ap.parse_args()

    state_path = os.path.join(args.state_dir, "state.json")
    state = fetcher.read_state(state_path)
    now = datetime.now(timezone.utc)
    today = datetime.now().strftime("%Y-%m-%d")
    age = age_hours(state, now)
    age_txt = "never" if age is None else f"{age:.0f} hours ago"
    what = "prompt" if args.test else decide(state, now)
    log(f"slot {args.slot}: last fetch {age_txt}: {what}{' (test)' if args.test else ''}")

    if what == "fresh":
        return 0
    if what == "backoff":
        if args.slot == "afternoon":
            slack_backup(f"OSM Thome refresh is backing off: OSM refused the Mac Studio fetch "
                         f"({state.get('last_failure')}); next try {state.get('next_allowed_at')}. "
                         f"Last good fetch {age_txt}.", state, state_path, today)
        return 0

    msg = (("TEST of the missed-run prompt. " if args.test else "") +
           f"OSM jobs refresh missed: the last successful fetch was {age_txt}, so OSM Thome jobs on the "
           f"site are going stale.\n\nRun it now? This makes the usual 5 requests to OSM from this Mac.")
    answer = ask(msg)
    log(f"answer: {answer}")
    if answer == "run":
        code, last = run_fetch()
        notify("OSM refresh done." if code == 0 else f"OSM refresh failed: {last[-120:]}")
        return code
    if args.slot == "afternoon" and not args.test:
        slack_backup(f"OSM Thome refresh missed: last good fetch {age_txt}. The Mac Studio prompt at 10:00 and "
                     f"14:00 ET went unanswered. Approve it on the Studio, or run "
                     f"`python3 ~/development/moblyze/internal-jobs-review/scrapers/scripts/osm_snapshot_fetch.py`.",
                     state, state_path, today)
    return 0


if __name__ == "__main__":
    sys.exit(main())
