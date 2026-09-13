"""SQLite-based job URL deduplication tracker for persistent state across scraping runs.

This module provides the DeduplicationTracker class that prevents duplicate job entries
by tracking previously seen job URLs in a SQLite database.
"""

import hashlib
import logging
import os
import sqlite3
from datetime import datetime, timedelta
from typing import Optional

from src.models.job import JobPosting

logger = logging.getLogger(__name__)


class DeduplicationTracker:
    """
    Track scraped job URLs in SQLite to prevent duplicates.

    Uses URL-based deduplication with SHA-256 hashing for efficient lookups.
    Persists state across scraping runs in a local SQLite database.
    """

    def __init__(self, db_path: str = 'data/scraper_state.db'):
        """
        Initialize the deduplication tracker.

        Args:
            db_path: Path to SQLite database file (creates parent dirs if needed)
        """
        self.db_path = db_path

        # Create data directory if it doesn't exist
        db_dir = os.path.dirname(db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)

        # Connect to database
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row

        # Initialize schema
        self._init_db()

        logger.info(f"Initialized deduplication tracker at {db_path}")

    def _init_db(self):
        """Create scraped_jobs table if it doesn't exist."""
        cursor = self.conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS scraped_jobs (
                url_hash TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                company TEXT NOT NULL,
                title TEXT NOT NULL,
                first_seen TIMESTAMP NOT NULL,
                last_seen TIMESTAMP NOT NULL,
                status TEXT DEFAULT 'active',
                status_changed_date TIMESTAMP,
                exported_to_sheets BOOLEAN DEFAULT 0
            )
        """)
        self.conn.commit()

        # Migrate existing tables to add status columns if they don't exist
        cursor.execute("PRAGMA table_info(scraped_jobs)")
        columns = {row[1] for row in cursor.fetchall()}

        if 'status' not in columns:
            logger.info("Migrating database: adding status column")
            cursor.execute("ALTER TABLE scraped_jobs ADD COLUMN status TEXT DEFAULT 'active'")
            self.conn.commit()

        if 'status_changed_date' not in columns:
            logger.info("Migrating database: adding status_changed_date column")
            cursor.execute("ALTER TABLE scraped_jobs ADD COLUMN status_changed_date TIMESTAMP")
            self.conn.commit()

        if 'exported_to_sheets' not in columns:
            logger.info("Migrating database: adding exported_to_sheets column")
            cursor.execute("ALTER TABLE scraped_jobs ADD COLUMN exported_to_sheets BOOLEAN DEFAULT 0")
            self.conn.commit()

        # Source-page liveness (scripts/probe_liveness.py, 2026-09-12): the
        # last verdict from asking the source itself whether the job is still
        # open. removed_reason says which signal retired a row ('source_gone'
        # for the probe, NULL for the listing diff).
        for col, decl in (
            ('source_status', 'TEXT'),
            ('source_checked_at', 'TIMESTAMP'),
            ('source_valid_through', 'TEXT'),
            ('source_reason', 'TEXT'),
            ('removed_reason', 'TEXT'),
        ):
            if col not in columns:
                logger.info(f"Migrating database: adding {col} column")
                cursor.execute(f"ALTER TABLE scraped_jobs ADD COLUMN {col} {decl}")
        self.conn.commit()

        # Per-run snapshots of per-company counts, used by the health check to
        # detect silent regressions (e.g. an employer dropping from 200 jobs
        # to 0 because their ATS migrated).
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS health_snapshots (
                ts TIMESTAMP NOT NULL,
                company TEXT NOT NULL,
                active_count INTEGER NOT NULL,
                total_count INTEGER NOT NULL,
                PRIMARY KEY (ts, company)
            )
        """)
        self.conn.commit()

        logger.debug("Database schema initialized")

    def record_health_snapshot(self) -> str:
        """Persist current per-company active + total counts with a timestamp.

        Returns the snapshot timestamp (ISO-8601).
        """
        ts = datetime.utcnow().isoformat()
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT
                company,
                SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active_count,
                COUNT(*) AS total_count
            FROM scraped_jobs
            GROUP BY company
        """)
        rows = [
            (ts, row['company'], row['active_count'], row['total_count'])
            for row in cursor.fetchall()
        ]
        if rows:
            cursor.executemany(
                "INSERT OR REPLACE INTO health_snapshots "
                "(ts, company, active_count, total_count) VALUES (?, ?, ?, ?)",
                rows
            )
            self.conn.commit()
        logger.info(f"Recorded health snapshot at {ts} for {len(rows)} companies")
        return ts

    def get_latest_health_snapshot(self, before: Optional[str] = None) -> dict:
        """Return the most recent per-company snapshot before `before` (or ever).

        Returns: {company: {'active_count': int, 'total_count': int, 'ts': str}}
        Empty dict if no snapshot exists.
        """
        cursor = self.conn.cursor()
        if before:
            cursor.execute(
                "SELECT MAX(ts) AS ts FROM health_snapshots WHERE ts < ?",
                (before,)
            )
        else:
            cursor.execute("SELECT MAX(ts) AS ts FROM health_snapshots")
        row = cursor.fetchone()
        if not row or not row['ts']:
            return {}
        target_ts = row['ts']
        cursor.execute(
            "SELECT company, active_count, total_count FROM health_snapshots WHERE ts = ?",
            (target_ts,)
        )
        return {
            r['company']: {
                'active_count': r['active_count'],
                'total_count': r['total_count'],
                'ts': target_ts,
            }
            for r in cursor.fetchall()
        }

    def get_source_gone_counts(self, since: Optional[str] = None) -> dict[str, int]:
        """Per-company count of rows retired by the liveness probe
        (removed_reason='source_gone'), optionally only those retired at or
        after `since` (an ISO timestamp -- typically the prior health
        snapshot's ts).

        Used by check_scrape_health.py (2026-09-13 fix) to tell a company's
        active count falling to 0 because of a deliberate mass retirement
        (CrewBase Liveness Probe run 34758491427: 19,279 rows legitimately
        retired) apart from a silent scrape failure. Scoped to `since` the
        baseline snapshot rather than all-time, because a source_gone
        removal from BEFORE the baseline was taken is already reflected in
        that baseline's (lower) active_count -- counting it again here would
        double-subtract and could mask a real regression.
        """
        cursor = self.conn.cursor()
        if since:
            cursor.execute(
                "SELECT company, COUNT(*) as count FROM scraped_jobs "
                "WHERE removed_reason = 'source_gone' AND status_changed_date >= ? "
                "GROUP BY company",
                (since,),
            )
        else:
            cursor.execute(
                "SELECT company, COUNT(*) as count FROM scraped_jobs "
                "WHERE removed_reason = 'source_gone' GROUP BY company"
            )
        return {row['company']: row['count'] for row in cursor.fetchall()}

    def _hash_url(self, url: str) -> str:
        """
        Generate SHA-256 hash of URL for efficient lookups.

        Args:
            url: Job posting URL

        Returns:
            Hex digest of SHA-256 hash
        """
        return hashlib.sha256(url.encode('utf-8')).hexdigest()

    def is_duplicate(self, url: str) -> bool:
        """
        Check if a job URL has been seen before AND successfully exported.

        Args:
            url: Job posting URL to check

        Returns:
            True if URL exists in database AND has been exported, False otherwise
        """
        url_hash = self._hash_url(url)
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT 1 FROM scraped_jobs WHERE url_hash = ? AND exported_to_sheets = 1 LIMIT 1",
            (url_hash,)
        )
        return cursor.fetchone() is not None

    def mark_scraped(self, job: JobPosting):
        """
        Mark a job as scraped (insert new or update last_seen and status).

        Args:
            job: JobPosting object to mark as scraped
        """
        url_hash = self._hash_url(str(job.url))
        now = datetime.utcnow().isoformat()

        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO scraped_jobs (
                url_hash, url, company, title, first_seen, last_seen,
                status, status_changed_date
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(url_hash) DO UPDATE SET
                last_seen = ?,
                status = ?,
                status_changed_date = CASE
                    WHEN status != ? THEN ?
                    ELSE status_changed_date
                END
        """, (
            url_hash,
            str(job.url),
            job.company,
            job.title,
            now,
            now,
            job.status,
            job.status_changed_date.isoformat() if job.status_changed_date else now,
            now,  # UPDATE last_seen
            job.status,  # UPDATE status
            job.status,  # CASE comparison
            now  # CASE THEN value (new status_changed_date)
        ))
        self.conn.commit()

    def filter_new(self, jobs: list[JobPosting]) -> list[JobPosting]:
        """
        Filter a list of jobs to only new (non-duplicate) jobs.

        Args:
            jobs: List of JobPosting objects to filter

        Returns:
            List of jobs that haven't been seen before
        """
        new_jobs = [job for job in jobs if not self.is_duplicate(str(job.url))]

        logger.info(
            f"deduplication_complete, total={len(jobs)}, "
            f"new={len(new_jobs)}, duplicates={len(jobs) - len(new_jobs)}"
        )

        return new_jobs

    def mark_batch(self, jobs: list[JobPosting]):
        """
        Mark multiple jobs as scraped in one transaction.

        Args:
            jobs: List of JobPosting objects to mark as scraped
        """
        now = datetime.utcnow().isoformat()

        cursor = self.conn.cursor()
        data = [
            (
                self._hash_url(str(job.url)),
                str(job.url),
                job.company,
                job.title,
                now,
                now,
                job.status,
                job.status_changed_date.isoformat() if job.status_changed_date else now,
                now,  # UPDATE last_seen
                job.status,  # UPDATE status
                job.status,  # CASE comparison
                now  # CASE THEN value
            )
            for job in jobs
        ]

        cursor.executemany("""
            INSERT INTO scraped_jobs (
                url_hash, url, company, title, first_seen, last_seen,
                status, status_changed_date
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(url_hash) DO UPDATE SET
                last_seen = ?,
                status = ?,
                status_changed_date = CASE
                    WHEN status != ? THEN ?
                    ELSE status_changed_date
                END
        """, data)

        self.conn.commit()
        logger.info(f"Marked {len(jobs)} jobs as scraped in batch")

    def mark_exported(self, jobs: list[JobPosting]):
        """
        Mark multiple jobs as successfully exported to Sheets.

        This should be called AFTER successful Sheets export to ensure atomicity.
        Jobs marked as exported will be filtered out in subsequent scraping runs.

        Args:
            jobs: List of JobPosting objects that were successfully exported
        """
        if not jobs:
            return

        url_hashes = [self._hash_url(str(job.url)) for job in jobs]
        cursor = self.conn.cursor()

        placeholders = ','.join('?' * len(url_hashes))
        cursor.execute(f"""
            UPDATE scraped_jobs
            SET exported_to_sheets = 1
            WHERE url_hash IN ({placeholders})
        """, url_hashes)

        self.conn.commit()
        logger.info(f"Marked {len(jobs)} jobs as exported to Sheets")

    def get_active_jobs_by_company(self, company: str) -> list[dict]:
        """
        Get all currently active jobs for a company.

        Args:
            company: Company name to filter by

        Returns:
            List of dicts with job data (url, url_hash, title, last_seen)
        """
        return self.get_active_jobs(company)

    def get_active_jobs(self, company: Optional[str] = None) -> list[dict]:
        """Active rows (all companies unless one is given) with their last source-probe verdict."""
        cursor = self.conn.cursor()
        sql = """
            SELECT url_hash, url, company, title, last_seen, status,
                   source_status, source_checked_at, source_valid_through
            FROM scraped_jobs
            WHERE status = 'active'
        """
        params: tuple = ()
        if company is not None:
            sql += " AND company = ?"
            params = (company,)
        cursor.execute(sql, params)
        return [
            {
                'url_hash': row['url_hash'],
                'url': row['url'],
                'company': row['company'],
                'title': row['title'],
                'last_seen': row['last_seen'],
                'status': row['status'],
                'source_status': row['source_status'],
                'source_checked_at': row['source_checked_at'],
                'source_valid_through': row['source_valid_through'],
            }
            for row in cursor.fetchall()
        ]

    def record_source_status(self, verdicts: list[tuple], checked_at: Optional[str] = None) -> int:
        """Store probe verdicts: (url_hash, status, valid_through, reason) per row.

        Only the source_* columns change; retiring a DEAD row is a separate,
        threshold-guarded call to mark_jobs_removed(reason='source_gone').
        """
        if not verdicts:
            return 0
        checked_at = checked_at or datetime.utcnow().isoformat()
        cursor = self.conn.cursor()
        cursor.executemany("""
            UPDATE scraped_jobs
            SET source_status = ?, source_checked_at = ?, source_valid_through = ?, source_reason = ?
            WHERE url_hash = ?
        """, [(status, checked_at, valid_through, reason, url_hash)
              for url_hash, status, valid_through, reason in verdicts])
        self.conn.commit()
        return len(verdicts)

    def mark_jobs_removed(self, url_hashes: list[str], reason: Optional[str] = None) -> int:
        """
        Mark jobs as removed by URL hash.

        Args:
            url_hashes: List of URL hashes to mark as removed
            reason: Which signal retired them ('source_gone' for the liveness
                    probe; None for the listing diff)

        Returns:
            Number of jobs updated
        """
        if not url_hashes:
            return 0

        now = datetime.utcnow().isoformat()
        cursor = self.conn.cursor()

        # Use executemany for batch update
        placeholders = ','.join('?' * len(url_hashes))
        cursor.execute(f"""
            UPDATE scraped_jobs
            SET status = 'removed',
                status_changed_date = ?,
                removed_reason = ?
            WHERE url_hash IN ({placeholders})
                AND status = 'active'
        """, [now, reason] + url_hashes)

        self.conn.commit()
        updated_count = cursor.rowcount

        if updated_count > 0:
            logger.info(f"Marked {updated_count} jobs as removed" + (f" ({reason})" if reason else ""))

        return updated_count

    # A source-page verdict younger than this outranks the listing diff.
    PROBE_TRUST_DAYS = 3

    def _probe_cutoff(self) -> str:
        return (datetime.utcnow() - timedelta(days=self.PROBE_TRUST_DAYS)).isoformat()

    def reactivate_jobs(self, company: str, current_job_urls: set[str]) -> int:
        """
        Re-activate jobs that were marked removed but appear in current scrape.

        A row the source itself reported DEAD within PROBE_TRUST_DAYS stays
        removed even if the listing still shows it (listings lag the detail
        page); the disagreement is logged instead.

        Args:
            company: Company name
            current_job_urls: Set of URLs from current scraping run

        Returns:
            Number of jobs re-activated
        """
        if not current_job_urls:
            return 0

        now = datetime.utcnow().isoformat()
        cursor = self.conn.cursor()

        # Find removed jobs whose URLs are in the current scrape
        url_hashes = [self._hash_url(url) for url in current_job_urls]
        placeholders = ','.join('?' * len(url_hashes))
        cutoff = self._probe_cutoff()
        cursor.execute(f"""
            SELECT url FROM scraped_jobs
            WHERE company = ? AND status = 'removed'
                AND source_status = 'DEAD' AND source_checked_at >= ?
                AND url_hash IN ({placeholders})
        """, [company, cutoff] + url_hashes)
        held = [row['url'] for row in cursor.fetchall()]
        if held:
            logger.warning(
                f"diff_vs_probe {company}: {len(held)} rows are back in the listing but the source "
                f"page said DEAD within {self.PROBE_TRUST_DAYS} days; kept removed (first: {held[0]})"
            )
        cursor.execute(f"""
            UPDATE scraped_jobs
            SET status = 'active',
                status_changed_date = ?,
                last_seen = ?,
                removed_reason = NULL
            WHERE company = ?
                AND status = 'removed'
                AND NOT (COALESCE(source_status, '') = 'DEAD' AND COALESCE(source_checked_at, '') >= ?)
                AND url_hash IN ({placeholders})
        """, [now, now, company, cutoff] + url_hashes)

        self.conn.commit()
        count = cursor.rowcount
        if count > 0:
            logger.info(f"Re-activated {count} previously removed jobs for {company}")
        return count

    def update_last_seen_batch(self, company: str, current_job_urls: set[str]):
        """
        Update last_seen timestamp for all jobs in current scrape.

        Args:
            company: Company name
            current_job_urls: Set of URLs from current scraping run
        """
        if not current_job_urls:
            return

        now = datetime.utcnow().isoformat()
        cursor = self.conn.cursor()

        url_hashes = [self._hash_url(url) for url in current_job_urls]
        placeholders = ','.join('?' * len(url_hashes))
        cursor.execute(f"""
            UPDATE scraped_jobs
            SET last_seen = ?
            WHERE company = ?
                AND url_hash IN ({placeholders})
        """, [now, company] + url_hashes)

        self.conn.commit()
        logger.debug(f"Updated last_seen for {cursor.rowcount} jobs for {company}")

    def detect_removed_jobs(self, company: str, current_job_urls: set[str]) -> list[dict]:
        """
        Detect jobs that were active but are no longer in current scrape.

        Args:
            company: Company name
            current_job_urls: Set of URLs from current scraping run

        Returns:
            List of dicts with removed job data (url, url_hash, title)
        """
        # Get all active jobs for this company
        active_jobs = self.get_active_jobs_by_company(company)

        # Find jobs not in current scrape
        current_url_set = {str(url) for url in current_job_urls}
        removed_jobs = [
            job for job in active_jobs
            if job['url'] not in current_url_set
        ]

        logger.info(
            f"Detected removed jobs for {company}: "
            f"active={len(active_jobs)}, current={len(current_job_urls)}, "
            f"removed={len(removed_jobs)}"
        )

        return removed_jobs

    def get_stats(self) -> dict:
        """
        Get statistics about tracked jobs.

        Returns:
            Dictionary with total count, status breakdown, per-company counts, export status, and date ranges
        """
        cursor = self.conn.cursor()

        # Total count
        cursor.execute("SELECT COUNT(*) as count FROM scraped_jobs")
        total = cursor.fetchone()['count']

        # Status breakdown
        cursor.execute("""
            SELECT status, COUNT(*) as count
            FROM scraped_jobs
            GROUP BY status
        """)
        by_status = {row['status']: row['count'] for row in cursor.fetchall()}

        # Export status breakdown
        cursor.execute("""
            SELECT
                SUM(CASE WHEN exported_to_sheets = 1 THEN 1 ELSE 0 END) as exported,
                SUM(CASE WHEN exported_to_sheets = 0 THEN 1 ELSE 0 END) as not_exported
            FROM scraped_jobs
        """)
        export_stats = cursor.fetchone()

        # Per-company counts
        cursor.execute("""
            SELECT company, COUNT(*) as count
            FROM scraped_jobs
            GROUP BY company
            ORDER BY count DESC
        """)
        by_company = {row['company']: row['count'] for row in cursor.fetchall()}

        # Per-company active counts
        cursor.execute("""
            SELECT company, COUNT(*) as count
            FROM scraped_jobs
            WHERE status = 'active'
            GROUP BY company
            ORDER BY count DESC
        """)
        by_company_active = {row['company']: row['count'] for row in cursor.fetchall()}

        # Per-company export status
        cursor.execute("""
            SELECT
                company,
                SUM(CASE WHEN exported_to_sheets = 1 THEN 1 ELSE 0 END) as exported,
                SUM(CASE WHEN exported_to_sheets = 0 THEN 1 ELSE 0 END) as not_exported
            FROM scraped_jobs
            GROUP BY company
            ORDER BY company
        """)
        by_company_export = {
            row['company']: {
                'exported': row['exported'],
                'not_exported': row['not_exported']
            }
            for row in cursor.fetchall()
        }

        # Date range
        cursor.execute("""
            SELECT
                MIN(first_seen) as oldest,
                MAX(first_seen) as newest
            FROM scraped_jobs
        """)
        date_range = cursor.fetchone()

        return {
            'total': total,
            'by_status': by_status,
            'exported': export_stats['exported'],
            'not_exported': export_stats['not_exported'],
            'by_company': by_company,
            'by_company_active': by_company_active,
            'by_company_export': by_company_export,
            'oldest_first_seen': date_range['oldest'],
            'newest_first_seen': date_range['newest']
        }

    def close(self):
        """Close the SQLite database connection."""
        if self.conn:
            self.conn.close()
            logger.debug("Database connection closed")

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit (closes connection)."""
        self.close()
        return False
