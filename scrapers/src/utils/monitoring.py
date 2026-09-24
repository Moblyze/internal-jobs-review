"""Removal policy constants and the #monitoring note for large retire batches.

Rule (Jesse, 2026-09-24): "We never want to keep dead jobs on the site because
it might harm us with Google." So a row individually confirmed DEAD at its
source (404/410, "position has been filled", absent from a fully fetched
board) is retired no matter how many of a company's rows that is. Size alone
never blocks a retirement; it only posts a note to #monitoring so a person
can eyeball it. Only UNKNOWN verdicts, fetch errors and partial board reads
hold rows back, because those are where a broken scraper could wrongly wipe a
company.
"""

import json
import logging
import os
import urllib.request
from typing import Iterable

logger = logging.getLogger(__name__)

# A retire batch above this share of a company's active rows gets a note in
# #monitoring (never a block).
LARGE_RETIRE_SHARE = 0.25
# Below this many active rows a share is noise (same floor as the partial-read guard).
MIN_ROWS_FOR_SHARE = 10

WEBHOOK_ENV = "SLACK_MONITORING_WEBHOOK"


def is_large_retire(retired: int, base: int, share: float = LARGE_RETIRE_SHARE) -> bool:
    """True when `retired` of `base` rows is a batch worth a #monitoring note."""
    return retired > 0 and base > MIN_ROWS_FOR_SHARE and retired / base > share


def format_large_retire_note(source: str, batches: Iterable[tuple[str, int, int, str]]) -> str:
    """One Slack message for (company, retired, base, why) batches."""
    lines = [f":broom: *{source}: large dead-job retirement* (retired, not held; "
             f"flagged because it is over {LARGE_RETIRE_SHARE:.0%} of a company)"]
    for company, retired, base, why in batches:
        lines.append(f"- {company}: {retired} of {base} rows ({retired / base:.0%}) retired, {why}")
    lines.append("If a company looks wrongly wiped, the run's backup artifact has the previous statuses.")
    return "\n".join(lines)


def post_monitoring_note(text: str) -> bool:
    """Post to #monitoring via the incoming webhook; never raises, no-op without the secret."""
    url = os.environ.get(WEBHOOK_ENV, "").strip()
    if not url:
        logger.info("%s not set; #monitoring note not posted:\n%s", WEBHOOK_ENV, text)
        return False
    try:
        req = urllib.request.Request(url, data=json.dumps({"text": text}).encode("utf-8"),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            ok = 200 <= resp.status < 300
        if not ok:
            logger.warning("#monitoring note got http %s", resp.status)
        return ok
    except Exception as e:  # a Slack hiccup must never fail a retirement run
        logger.warning("#monitoring note failed: %s", e)
        return False
