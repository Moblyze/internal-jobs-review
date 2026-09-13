#!/usr/bin/env python3
"""
Unit tests for job status tracking functionality.

Run with: python -m pytest tests/test_status_tracking.py -v
"""

import os
import tempfile
from datetime import datetime

import pytest

from src.models.job import JobPosting
from src.utils.deduplication import DeduplicationTracker


class TestJobPostingModel:
    """Test JobPosting model with status fields."""

    def test_default_status(self):
        """New jobs should default to active status."""
        job = JobPosting(
            title="Test Engineer",
            company="Test Corp",
            location="Houston, TX",
            description="Test description for testing purposes",
            url="https://example.com/job/123"
        )

        assert job.status == "active"
        assert job.status_changed_date is None

    def test_status_values(self):
        """Status should accept valid values."""
        for status in ["active", "removed", "paused"]:
            job = JobPosting(
                title="Test",
                company="Test",
                location="Test",
                description="Test description",
                url="https://example.com/job/1",
                status=status
            )
            assert job.status == status

    def test_to_sheet_row_includes_status(self):
        """to_sheet_row should include status fields."""
        now = datetime.utcnow()
        job = JobPosting(
            title="Test",
            company="Test",
            location="Test",
            description="Test description",
            url="https://example.com/job/1",
            status="active",
            status_changed_date=now
        )

        row = job.to_sheet_row()
        assert len(row) == 11  # Updated count
        assert row[8] == "active"  # Status at position 8
        assert row[9] == now.isoformat()  # Status changed date at position 9


class TestDeduplicationTracker:
    """Test deduplication tracker with status tracking."""

    @pytest.fixture
    def tracker(self):
        """Create temporary tracker for testing."""
        with tempfile.NamedTemporaryFile(delete=False, suffix='.db') as f:
            db_path = f.name

        tracker = DeduplicationTracker(db_path=db_path)
        yield tracker
        tracker.close()

        # Cleanup
        if os.path.exists(db_path):
            os.unlink(db_path)

    def test_database_migration(self, tracker):
        """Database should have status columns after initialization."""
        cursor = tracker.conn.cursor()
        cursor.execute("PRAGMA table_info(scraped_jobs)")
        columns = {row[1] for row in cursor.fetchall()}

        assert 'status' in columns
        assert 'status_changed_date' in columns

    def test_mark_scraped_sets_active_status(self, tracker):
        """Newly scraped jobs should be marked as active."""
        job = JobPosting(
            title="Test",
            company="Test Corp",
            location="Test",
            description="Test description",
            url="https://example.com/job/1"
        )

        tracker.mark_scraped(job)

        cursor = tracker.conn.cursor()
        cursor.execute("SELECT status FROM scraped_jobs WHERE url = ?", (str(job.url),))
        result = cursor.fetchone()

        assert result is not None
        assert result['status'] == 'active'

    def test_get_active_jobs_by_company(self, tracker):
        """Should return only active jobs for company."""
        # Create test jobs
        jobs = [
            JobPosting(
                title=f"Job {i}",
                company="Test Corp",
                location="Test",
                description="Test description",
                url=f"https://example.com/job/{i}",
                status="active"
            )
            for i in range(3)
        ]

        # Mark as scraped
        tracker.mark_batch(jobs)

        # Mark one as removed manually
        cursor = tracker.conn.cursor()
        cursor.execute("""
            UPDATE scraped_jobs
            SET status = 'removed'
            WHERE url = ?
        """, (str(jobs[0].url),))
        tracker.conn.commit()

        # Get active jobs
        active = tracker.get_active_jobs_by_company("Test Corp")

        assert len(active) == 2
        urls = {job['url'] for job in active}
        assert str(jobs[1].url) in urls
        assert str(jobs[2].url) in urls
        assert str(jobs[0].url) not in urls

    def test_detect_removed_jobs(self, tracker):
        """Should detect jobs that are no longer in current scrape."""
        # Setup: Mark 3 jobs as scraped
        old_jobs = [
            JobPosting(
                title=f"Job {i}",
                company="Test Corp",
                location="Test",
                description="Test description",
                url=f"https://example.com/job/{i}"
            )
            for i in range(1, 4)
        ]
        tracker.mark_batch(old_jobs)

        # Current scrape only has 2 of the 3 jobs
        current_urls = {
            str(old_jobs[0].url),
            str(old_jobs[1].url)
        }

        # Detect removed
        removed = tracker.detect_removed_jobs("Test Corp", current_urls)

        assert len(removed) == 1
        assert removed[0]['url'] == str(old_jobs[2].url)

    def test_mark_jobs_removed(self, tracker):
        """Should mark jobs as removed by URL hash."""
        # Setup jobs
        jobs = [
            JobPosting(
                title=f"Job {i}",
                company="Test Corp",
                location="Test",
                description="Test description",
                url=f"https://example.com/job/{i}"
            )
            for i in range(3)
        ]
        tracker.mark_batch(jobs)

        # Get URL hashes
        url_hashes = [tracker._hash_url(str(job.url)) for job in jobs[:2]]

        # Mark as removed
        count = tracker.mark_jobs_removed(url_hashes)

        assert count == 2

        # Verify status changed
        cursor = tracker.conn.cursor()
        cursor.execute("""
            SELECT COUNT(*) as count
            FROM scraped_jobs
            WHERE status = 'removed'
        """)
        result = cursor.fetchone()
        assert result['count'] == 2

    def test_get_stats_includes_status(self, tracker):
        """Stats should include status breakdown."""
        # Create mix of active and removed jobs
        jobs = [
            JobPosting(
                title=f"Job {i}",
                company="Test Corp",
                location="Test",
                description="Test description",
                url=f"https://example.com/job/{i}",
                status="active" if i < 2 else "removed"
            )
            for i in range(4)
        ]
        tracker.mark_batch(jobs)

        stats = tracker.get_stats()

        assert 'by_status' in stats
        assert stats['by_status']['active'] == 2
        assert stats['by_status']['removed'] == 2

    def test_get_source_gone_counts(self, tracker):
        """2026-09-13: check_scrape_health.py's deliberate-retirement
        carve-out needs a per-company count of rows the liveness probe
        retired (removed_reason='source_gone'), distinct from ordinary
        listing-diff removals (reason=None)."""
        source_gone_jobs = [
            JobPosting(title=f"Job {i}", company="AZS", location="Test",
                       description="Test description", url=f"https://example.com/azs/{i}")
            for i in range(3)
        ]
        listing_diff_job = JobPosting(title="Other", company="AZS", location="Test",
                                       description="Test description", url="https://example.com/azs/other")
        tracker.mark_batch(source_gone_jobs + [listing_diff_job])

        source_gone_hashes = [tracker._hash_url(str(j.url)) for j in source_gone_jobs]
        tracker.mark_jobs_removed(source_gone_hashes, reason='source_gone')
        tracker.mark_jobs_removed([tracker._hash_url(str(listing_diff_job.url))], reason=None)

        counts = tracker.get_source_gone_counts()
        assert counts == {'AZS': 3}

    def test_get_source_gone_counts_since_excludes_older_removals(self, tracker):
        """A source_gone removal from before the baseline snapshot is
        already reflected in that snapshot's (lower) active_count, so it
        must not be double-counted when scoped with `since`."""
        job = JobPosting(title="Old", company="AZS", location="Test",
                          description="Test description", url="https://example.com/azs/old")
        tracker.mark_batch([job])
        tracker.mark_jobs_removed([tracker._hash_url(str(job.url))], reason='source_gone')

        # Backdate the removal so it predates our `since` cutoff.
        cursor = tracker.conn.cursor()
        cursor.execute(
            "UPDATE scraped_jobs SET status_changed_date = ? WHERE company = 'AZS'",
            ('2020-01-01T00:00:00',),
        )
        tracker.conn.commit()

        assert tracker.get_source_gone_counts(since='2026-01-01T00:00:00') == {}
        assert tracker.get_source_gone_counts() == {'AZS': 1}
        assert 'by_company_active' in stats
        assert stats['by_company_active']['Test Corp'] == 2


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
