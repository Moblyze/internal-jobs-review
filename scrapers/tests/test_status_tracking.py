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
        assert len(row) == 20  # 14 base + 6 contact columns
        assert row[11] == "active"  # Status at position 11
        assert row[12] == now.isoformat()  # Status changed date at position 12

    def test_contact_fields_default_to_none(self):
        job = JobPosting(
            title="ROV Pilot",
            company="Rovop",
            location="Aberdeen, UK",
            description="Test description for testing purposes",
            url="https://example.com/job/999",
        )
        assert job.contact_name is None
        assert job.contact_title is None
        assert job.contact_email is None
        assert job.contact_phone is None
        assert job.contact_linkedin_url is None
        assert job.contact_source is None

    def test_to_sheet_row_has_twenty_columns(self):
        job = JobPosting(
            title="ROV Pilot",
            company="Rovop",
            location="Aberdeen, UK",
            description="Test description for testing purposes",
            url="https://example.com/job/999",
        )
        row = job.to_sheet_row()
        assert len(row) == 20

    def test_to_sheet_row_writes_contact_fields(self):
        job = JobPosting(
            title="ROV Pilot",
            company="Rovop",
            location="Aberdeen, UK",
            description="Test description for testing purposes",
            url="https://example.com/job/999",
            contact_name="Jane Doe",
            contact_title="Recruiter",
            contact_email="jane.doe@rovop.com",
            contact_phone="+44 1224 555 7890",
            contact_linkedin_url="https://linkedin.com/in/jane-doe-rovop",
            contact_source="labeled_pattern",
        )
        row = job.to_sheet_row()
        assert row[-6:] == [
            "Jane Doe",
            "Recruiter",
            "jane.doe@rovop.com",
            "+44 1224 555 7890",
            "https://linkedin.com/in/jane-doe-rovop",
            "labeled_pattern",
        ]

    def test_to_sheet_row_writes_empty_strings_when_contacts_missing(self):
        job = JobPosting(
            title="ROV Pilot",
            company="Rovop",
            location="Aberdeen, UK",
            description="Test description for testing purposes",
            url="https://example.com/job/999",
        )
        row = job.to_sheet_row()
        assert row[-6:] == ["", "", "", "", "", ""]


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
        assert 'by_company_active' in stats
        assert stats['by_company_active']['Test Corp'] == 2


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
