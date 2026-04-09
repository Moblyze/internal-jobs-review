"""Merge two scraper_state.db SQLite databases.

Used by the persist-state workflow job to combine dedup state from the
employer-scrapers and aggregator-searches jobs which run in parallel.
"""

import os
import shutil
import sqlite3
import sys


def merge_dbs(primary_path: str, secondary_path: str, output_path: str):
    """Merge secondary DB into a copy of primary, writing result to output_path.

    For rows that exist in both, keeps the newer last_seen timestamp and
    preserves exported_to_sheets if either DB has it marked.
    """
    has_primary = os.path.exists(primary_path)
    has_secondary = os.path.exists(secondary_path)

    if not has_primary and not has_secondary:
        print("No state databases found — nothing to merge")
        sys.exit(1)

    if has_primary and not has_secondary:
        shutil.copy2(primary_path, output_path)
        _report(output_path)
        return

    if has_secondary and not has_primary:
        shutil.copy2(secondary_path, output_path)
        _report(output_path)
        return

    # Both exist — merge
    shutil.copy2(primary_path, output_path)
    conn = sqlite3.connect(output_path)

    conn.execute(f"ATTACH DATABASE '{secondary_path}' AS sec")

    # Insert rows that only exist in secondary
    conn.execute("""
        INSERT OR IGNORE INTO main.scraped_jobs
        SELECT * FROM sec.scraped_jobs
    """)

    # For rows in both, take the newer last_seen and preserve export flag
    conn.execute("""
        UPDATE main.scraped_jobs
        SET last_seen = sec.last_seen,
            status = sec.status,
            status_changed_date = sec.status_changed_date,
            exported_to_sheets = MAX(main.scraped_jobs.exported_to_sheets, sec.exported_to_sheets)
        FROM sec.scraped_jobs AS sec
        WHERE main.scraped_jobs.url_hash = sec.url_hash
          AND sec.last_seen > main.scraped_jobs.last_seen
    """)

    conn.commit()
    conn.execute("DETACH DATABASE sec")
    conn.close()
    _report(output_path)


def _report(db_path: str):
    conn = sqlite3.connect(db_path)
    total = conn.execute("SELECT COUNT(*) FROM scraped_jobs").fetchone()[0]
    exported = conn.execute(
        "SELECT COUNT(*) FROM scraped_jobs WHERE exported_to_sheets = 1"
    ).fetchone()[0]
    conn.close()
    print(f"Merged state: {total} entries ({exported} exported)")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: merge_state_dbs.py <primary_db> <secondary_db> <output_db>")
        sys.exit(1)

    merge_dbs(sys.argv[1], sys.argv[2], sys.argv[3])
