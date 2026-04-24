"""Post-scrape health check.

Compares today's per-company active-job counts against the most recent
health snapshot stored in the scraper state DB. Fails loudly (exit 1) if
any employer that previously had a meaningful number of jobs has dropped
to zero or fallen off a cliff — the pattern that caused Oceaneering's
post-ATS-migration failure to go unnoticed for weeks.

Records a fresh snapshot on every run so the NEXT run has a baseline.

Usage:
    python scripts/check_scrape_health.py [--state-db PATH]

Exit codes:
    0 — no critical regressions
    1 — one or more CRITICAL alerts (employer lost all jobs)

Alert rules:
    CRITICAL: previous active_count >= CRITICAL_PREV_THRESHOLD AND current == 0
    WARNING : previous active_count >= WARN_PREV_THRESHOLD AND
              current < previous * WARN_DROP_RATIO

Only CRITICALs fail the workflow; WARNINGs print + carry on.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

# Allow running as a script from the scrapers dir
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.utils.deduplication import DeduplicationTracker  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

CRITICAL_PREV_THRESHOLD = 10
WARN_PREV_THRESHOLD = 20
WARN_DROP_RATIO = 0.5


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        '--state-db',
        default=os.environ.get('SCRAPER_STATE_DB', 'data/scraper_state.db'),
        help='Path to merged scraper_state.db (default: data/scraper_state.db)',
    )
    args = parser.parse_args()

    if not Path(args.state_db).exists():
        logger.error(f"State DB not found at {args.state_db}")
        return 1

    tracker = DeduplicationTracker(db_path=args.state_db)
    try:
        previous = tracker.get_latest_health_snapshot()
        stats = tracker.get_stats()
        current_active = stats.get('by_company_active', {})

        # Companies to consider = union of prev and current
        all_companies = set(previous.keys()) | set(current_active.keys())

        criticals = []
        warnings = []
        unchanged = 0
        new_sources = 0

        for company in sorted(all_companies):
            prev_active = previous.get(company, {}).get('active_count', 0)
            curr_active = current_active.get(company, 0)

            if company not in previous:
                new_sources += 1
                continue

            if prev_active >= CRITICAL_PREV_THRESHOLD and curr_active == 0:
                criticals.append((company, prev_active, curr_active))
            elif (
                prev_active >= WARN_PREV_THRESHOLD
                and curr_active < prev_active * WARN_DROP_RATIO
            ):
                warnings.append((company, prev_active, curr_active))
            else:
                unchanged += 1

        # Report
        print()
        print("=" * 72)
        print("SCRAPE HEALTH CHECK")
        print("=" * 72)
        if previous:
            prev_ts = next(iter(previous.values())).get('ts', 'unknown')
            print(f"Baseline snapshot: {prev_ts}")
        else:
            print("Baseline snapshot: NONE (first run — recording baseline only)")
        print(f"Companies compared: {len(all_companies) - new_sources}")
        print(f"New sources since last run: {new_sources}")
        print(f"Unchanged / healthy: {unchanged}")
        print(f"Warnings: {len(warnings)}")
        print(f"Criticals: {len(criticals)}")
        print()

        if criticals:
            print("CRITICAL — employers that lost ALL active jobs:")
            for company, prev, curr in criticals:
                print(f"  {company}: {prev} → {curr} active")
            print()

        if warnings:
            print("WARNING — employers that dropped > 50% of active jobs:")
            for company, prev, curr in warnings:
                pct = (1 - curr / prev) * 100 if prev else 0
                print(f"  {company}: {prev} → {curr} active ({pct:.0f}% drop)")
            print()

        # Always record a fresh snapshot for tomorrow's comparison
        tracker.record_health_snapshot()

        if criticals:
            print("Exiting 1: critical regressions detected")
            return 1
        return 0
    finally:
        tracker.close()


if __name__ == '__main__':
    sys.exit(main())
