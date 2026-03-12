"""Job lifecycle tracking module for detecting and managing job status changes.

This module provides the JobLifecycleManager class that coordinates job status
tracking between the deduplication tracker and Google Sheets exporter.
"""

import logging
from datetime import datetime
from typing import Optional

from src.exporters.sheets import SheetsExporter
from src.models.job import JobPosting
from src.utils.deduplication import DeduplicationTracker

logger = logging.getLogger(__name__)


class JobLifecycleManager:
    """
    Manage job lifecycle status changes across database and Google Sheets.

    Coordinates detection of removed jobs and updates both the SQLite tracker
    and Google Sheets to maintain consistent status across systems.
    """

    def __init__(
        self,
        tracker: DeduplicationTracker,
        exporter: Optional[SheetsExporter] = None
    ):
        """
        Initialize the lifecycle manager.

        Args:
            tracker: DeduplicationTracker for database operations
            exporter: Optional SheetsExporter for Google Sheets updates
        """
        self.tracker = tracker
        self.exporter = exporter

    def process_scrape_results(
        self,
        company: str,
        sheet_name: str,
        current_jobs: list[JobPosting]
    ) -> dict:
        """
        Process scraping results and update job statuses.

        Detects jobs that were active but are no longer in the current scrape,
        marks them as removed in both database and Google Sheets.

        Args:
            company: Company name
            sheet_name: Google Sheets worksheet name
            current_jobs: List of jobs from current scraping run

        Returns:
            Summary dict with counts of active, new, and removed jobs
        """
        # Extract URLs from current jobs
        current_urls = {str(job.url) for job in current_jobs}

        # Detect removed jobs
        removed_jobs = self.tracker.detect_removed_jobs(company, current_urls)

        # Mark jobs as removed in database
        removed_count = 0
        if removed_jobs:
            url_hashes = [job['url_hash'] for job in removed_jobs]
            removed_count = self.tracker.mark_jobs_removed(url_hashes)

            # Update Google Sheets if exporter is available
            # Use the current timestamp since we just marked them as removed
            if self.exporter and removed_count > 0:
                # Add status_changed_date to removed jobs (use current time since we just updated)
                now = datetime.utcnow().isoformat()
                for job in removed_jobs:
                    job['status_changed_date'] = now

                self._update_sheets_for_removed_jobs(
                    sheet_name=sheet_name,
                    removed_jobs=removed_jobs
                )

        logger.info(
            f"Job lifecycle update for {company}: "
            f"current={len(current_jobs)}, removed={removed_count}"
        )

        return {
            'company': company,
            'current_jobs': len(current_jobs),
            'removed_jobs': removed_count,
            'processed_at': datetime.utcnow().isoformat()
        }

    def _update_sheets_for_removed_jobs(
        self,
        sheet_name: str,
        removed_jobs: list[dict]
    ):
        """
        Update Google Sheets to mark jobs as removed.

        Args:
            sheet_name: Worksheet name
            removed_jobs: List of removed job dicts with 'url' and 'status_changed_date' keys
        """
        try:
            # Get existing job URLs and their row numbers
            url_to_row = self.exporter.get_existing_job_urls(sheet_name)

            # Build batch update list
            updates = []

            for job in removed_jobs:
                url = job['url']
                if url in url_to_row:
                    row_number = url_to_row[url]
                    # Use status_changed_date from database if available, otherwise use current time
                    status_date = job.get('status_changed_date')
                    if not status_date:
                        status_date = datetime.utcnow().isoformat()
                    updates.append((row_number, 'removed', status_date))

            # Execute batch update
            if updates:
                self.exporter.batch_update_statuses(sheet_name, updates)
                logger.info(f"Updated {len(updates)} removed jobs in sheet: {sheet_name}")
            else:
                logger.warning(
                    f"No matching URLs found in sheet {sheet_name} "
                    f"for {len(removed_jobs)} removed jobs"
                )

        except Exception as e:
            logger.error(
                f"Failed to update Google Sheets for removed jobs: {e}",
                exc_info=True
            )
            # Don't raise - lifecycle tracking in DB already succeeded

    def get_lifecycle_summary(self, company: Optional[str] = None) -> dict:
        """
        Get summary of job lifecycle status.

        Args:
            company: Optional company filter

        Returns:
            Dictionary with status counts and recent changes
        """
        stats = self.tracker.get_stats()

        summary = {
            'total_jobs': stats['total'],
            'by_status': stats['by_status'],
            'active_jobs': stats['by_status'].get('active', 0),
            'removed_jobs': stats['by_status'].get('removed', 0),
            'paused_jobs': stats['by_status'].get('paused', 0)
        }

        if company:
            # Filter to specific company
            active_jobs = self.tracker.get_active_jobs_by_company(company)
            summary['company'] = company
            summary['company_active_jobs'] = len(active_jobs)

        return summary
