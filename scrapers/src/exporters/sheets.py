"""Google Sheets exporter with batch write operations and service account authentication.

This module provides the SheetsExporter class for writing job data to Google Sheets
in batches to avoid rate limits.

IMPORTANT: The Google Sheet must be shared with the service account email address
(found in the credentials JSON file) with Editor permissions.
"""

import logging
import os
from datetime import datetime
from typing import Optional

import gspread
from google.oauth2.service_account import Credentials
from gspread.exceptions import APIError, WorksheetNotFound
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from src.models.job import JobPosting

logger = logging.getLogger(__name__)


class SheetsExporter:
    """
    Export job postings to Google Sheets with batch operations.

    Authenticates via service account and writes jobs to company-specific
    worksheets in batches of 100 to avoid API rate limits.
    """

    # Batch size for writing rows (SHEETS-02)
    BATCH_SIZE = 100

    # Header row matching JobPosting.to_sheet_row() order (SHEETS-03)
    HEADER_ROW = [
        'Title',
        'Company',
        'Location',
        'Description',
        'URL',
        'Requisition ID',
        'Posted Date',
        'Skills',
        'Certifications',
        'Salary',
        'Employment Type',
        'Status',
        'Status Changed Date',
        'Scraped At'
    ]

    # Google Sheets API scopes (Drive scope needed for opening spreadsheets by name)
    SCOPES = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ]

    def __init__(
        self,
        credentials_path: str,
        spreadsheet_name: Optional[str] = None
    ):
        """
        Initialize the Google Sheets exporter.

        Args:
            credentials_path: Path to Google service account JSON credentials file
            spreadsheet_name: Name of the Google Sheets spreadsheet
                            (defaults to GOOGLE_SHEETS_SPREADSHEET_NAME env var)

        Raises:
            FileNotFoundError: If credentials file doesn't exist
            ValueError: If spreadsheet_name is not provided and env var is not set
        """
        if not os.path.exists(credentials_path):
            raise FileNotFoundError(f"Credentials file not found: {credentials_path}")

        self.credentials_path = credentials_path
        self.spreadsheet_name = spreadsheet_name or os.getenv('GOOGLE_SHEETS_SPREADSHEET_NAME')

        if not self.spreadsheet_name:
            raise ValueError(
                "Spreadsheet name must be provided or set in GOOGLE_SHEETS_SPREADSHEET_NAME env var"
            )

        # Authenticate and open spreadsheet (SHEETS-01)
        self._authenticate()
        logger.info(f"Connected to Google Sheets: {self.spreadsheet_name}")

    def _authenticate(self):
        """Authenticate with Google Sheets API using service account credentials."""
        credentials = Credentials.from_service_account_file(
            self.credentials_path,
            scopes=self.SCOPES
        )
        self.client = gspread.authorize(credentials)
        self.spreadsheet = self.client.open(self.spreadsheet_name)

    def _get_or_create_worksheet(self, sheet_name: str):
        """
        Get existing worksheet or create new one.

        Args:
            sheet_name: Name of the worksheet (typically company name)

        Returns:
            Worksheet object
        """
        try:
            worksheet = self.spreadsheet.worksheet(sheet_name)
            logger.debug(f"Found existing worksheet: {sheet_name}")
        except WorksheetNotFound:
            logger.info(f"Creating new worksheet: {sheet_name}")
            worksheet = self.spreadsheet.add_worksheet(
                title=sheet_name,
                rows=1000,
                cols=14  # 14 columns including Employment Type
            )

        # Ensure header row exists and matches current schema
        current_header = worksheet.row_values(1) if worksheet.row_count > 0 else []
        if not current_header or current_header != self.HEADER_ROW:
            logger.info(f"Updating header row to match schema: {sheet_name}")
            worksheet.update(values=[self.HEADER_ROW], range_name='A1:N1', value_input_option='RAW')

        return worksheet

    @retry(
        retry=retry_if_exception_type(APIError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=4, max=60),
        reraise=True
    )
    def _batch_append(self, worksheet, rows: list[list], start_row: int):
        """
        Append rows to worksheet using explicit range notation to prevent column misalignment.

        Args:
            worksheet: Worksheet object
            rows: List of row data to append
            start_row: Starting row number (1-indexed)

        Raises:
            APIError: If API error persists after retries
        """
        # Use explicit range notation to ensure data goes to columns A-N
        # This prevents the gspread append_rows() bug that shifts data to the right
        end_row = start_row + len(rows) - 1
        range_notation = f'A{start_row}:N{end_row}'
        worksheet.update(values=rows, range_name=range_notation, value_input_option='RAW')

    def export_jobs(self, jobs: list[JobPosting], sheet_name: str) -> int:
        """
        Export jobs to a specific worksheet in batches.

        Args:
            jobs: List of JobPosting objects to export
            sheet_name: Name of the worksheet (typically company name)

        Returns:
            Number of jobs written

        Raises:
            APIError: If Google Sheets API errors persist after retries
        """
        if not jobs:
            logger.warning(f"No jobs to export to sheet: {sheet_name}")
            return 0

        worksheet = self._get_or_create_worksheet(sheet_name)

        # Find the next available row (after existing data)
        existing_data_rows = len(worksheet.get_all_values())
        next_row = existing_data_rows + 1

        # Convert jobs to rows
        rows = [job.to_sheet_row() for job in jobs]

        # Write in batches using explicit range notation (SHEETS-02)
        total_written = 0
        for i in range(0, len(rows), self.BATCH_SIZE):
            batch = rows[i:i + self.BATCH_SIZE]
            start_row = next_row + total_written
            self._batch_append(worksheet, batch, start_row)
            total_written += len(batch)
            logger.info(
                f"Wrote batch to {sheet_name}: {len(batch)} jobs "
                f"({total_written}/{len(rows)} total)"
            )

        logger.info(f"Successfully exported {total_written} jobs to {sheet_name}")
        return total_written

    def get_existing_job_urls(self, sheet_name: str) -> dict[str, int]:
        """
        Get all existing job URLs from a worksheet with their row numbers.

        Args:
            sheet_name: Name of the worksheet

        Returns:
            Dictionary mapping URL to row number (1-indexed)
        """
        try:
            worksheet = self.spreadsheet.worksheet(sheet_name)
        except WorksheetNotFound:
            logger.debug(f"Worksheet not found: {sheet_name}")
            return {}

        # Get all values from the worksheet
        all_values = worksheet.get_all_values()
        if len(all_values) <= 1:  # Only header or empty
            return {}

        # Find URL column index (should be column 4, index 4)
        url_col_index = self.HEADER_ROW.index('URL')

        # Build mapping of URL -> row number
        url_to_row = {}
        for row_idx, row in enumerate(all_values[1:], start=2):  # Skip header, start at row 2
            if len(row) > url_col_index and row[url_col_index]:
                url_to_row[row[url_col_index]] = row_idx

        logger.debug(f"Found {len(url_to_row)} existing jobs in {sheet_name}")
        return url_to_row

    @retry(
        retry=retry_if_exception_type(APIError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=4, max=60),
        reraise=True
    )
    def update_job_status(
        self,
        sheet_name: str,
        url: str,
        row_number: int,
        new_status: str,
        status_changed_date: str
    ):
        """
        Update the status of a specific job in a worksheet.

        Args:
            sheet_name: Name of the worksheet
            url: Job URL (for validation)
            row_number: Row number to update (1-indexed)
            new_status: New status value ("active", "removed", "paused")
            status_changed_date: ISO format timestamp of status change

        Raises:
            APIError: If Google Sheets API errors persist after retries
        """
        worksheet = self.spreadsheet.worksheet(sheet_name)

        # Get column indices for status fields
        status_col = self.HEADER_ROW.index('Status') + 1  # gspread uses 1-indexed columns
        status_date_col = self.HEADER_ROW.index('Status Changed Date') + 1

        # Update status and status_changed_date columns
        worksheet.update_cell(row_number, status_col, new_status)
        worksheet.update_cell(row_number, status_date_col, status_changed_date)

        logger.debug(f"Updated job status in {sheet_name} row {row_number}: {new_status}")

    @retry(
        retry=retry_if_exception_type(APIError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=4, max=60),
        reraise=True
    )
    def batch_update_statuses(
        self,
        sheet_name: str,
        updates: list[tuple[int, str, str]]
    ):
        """
        Update multiple job statuses in batch.

        Args:
            sheet_name: Name of the worksheet
            updates: List of (row_number, new_status, status_changed_date) tuples

        Raises:
            APIError: If Google Sheets API errors persist after retries
        """
        if not updates:
            return

        worksheet = self.spreadsheet.worksheet(sheet_name)

        # Get column indices (0-indexed for conversion to A1 notation)
        status_col_idx = self.HEADER_ROW.index('Status')
        status_date_col_idx = self.HEADER_ROW.index('Status Changed Date')

        # Convert column index to letter (A=0, B=1, ..., K=10, L=11)
        def col_to_letter(col_idx: int) -> str:
            """Convert 0-indexed column number to letter (A, B, C, ...)."""
            letter = ''
            while col_idx >= 0:
                letter = chr(col_idx % 26 + ord('A')) + letter
                col_idx = col_idx // 26 - 1
            return letter

        status_col_letter = col_to_letter(status_col_idx)
        status_date_col_letter = col_to_letter(status_date_col_idx)

        # Build batch update request with A1 notation
        batch_data = []
        for row_number, new_status, status_changed_date in updates:
            batch_data.extend([
                {
                    'range': f'{status_col_letter}{row_number}',
                    'values': [[new_status]]
                },
                {
                    'range': f'{status_date_col_letter}{row_number}',
                    'values': [[status_changed_date]]
                }
            ])

        # Execute batch update
        if batch_data:
            worksheet.batch_update(batch_data)
            logger.info(f"Batch updated {len(updates)} job statuses in {sheet_name}")

    @retry(
        retry=retry_if_exception_type(APIError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=4, max=60),
        reraise=True
    )
    def update_overview_sheet(
        self,
        company_configs: dict,
        scrape_results: list[dict],
        tracker_stats: dict
    ):
        """
        Update the Overview sheet with current counts and append a run report.

        The Overview sheet has two sections:
        1. Summary table (rows 1-N): Employer | Active Jobs | Inactive Jobs | Total Jobs
        2. Run reports (appended below): timestamped per-source stats from each scrape run

        Args:
            company_configs: Dict of company configs from companies.yaml (key -> config)
            scrape_results: List of per-company result dicts from scrape_company()
            tracker_stats: Stats dict from DeduplicationTracker.get_stats()
        """
        try:
            worksheet = self.spreadsheet.worksheet('Overview')
        except WorksheetNotFound:
            logger.warning("Overview worksheet not found, creating it")
            worksheet = self.spreadsheet.add_worksheet(
                title='Overview', rows=500, cols=8
            )

        # --- Section 1: Update the summary table ---

        # Build employer rows sorted by config order
        overview_header = ['Employer', 'Active Jobs', 'Inactive Jobs', 'Total Jobs']
        employer_rows = []

        by_company_active = tracker_stats.get('by_company_active', {})
        by_company = tracker_stats.get('by_company', {})

        total_active = 0
        total_inactive = 0
        total_all = 0

        for _key, config in company_configs.items():
            name = config['name']
            active = by_company_active.get(name, 0)
            all_jobs = by_company.get(name, 0)
            inactive = all_jobs - active

            total_active += active
            total_inactive += inactive
            total_all += all_jobs

            employer_rows.append([name, active, inactive, all_jobs])

        # Write header + employer rows + blank + TOTAL
        summary_data = [overview_header]
        summary_data.extend(employer_rows)
        summary_data.append([])  # blank row
        summary_data.append(['TOTAL', total_active, total_inactive, total_all])

        # Calculate the end of the summary section
        summary_end_row = len(summary_data)

        # Write the entire summary block (overwrite existing)
        range_notation = f'A1:D{summary_end_row}'
        worksheet.update(
            values=summary_data,
            range_name=range_notation,
            value_input_option='RAW'
        )

        logger.info(f"Updated Overview summary table: {len(employer_rows)} employers")

        # --- Section 2: Append run report below summary ---

        # Find the first empty row after the summary section.
        # Read all current values to find where run reports start.
        all_values = worksheet.get_all_values()
        next_row = len(all_values) + 1

        # Ensure at least 2 blank rows between summary and first run report
        min_report_start = summary_end_row + 3
        if next_row < min_report_start:
            next_row = min_report_start

        # Build run report
        now = datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')
        report_rows = []

        # Report header
        report_rows.append([f'--- Run Report: {now} ---', '', '', '', '', '', ''])
        report_rows.append([
            'Source', 'Jobs Added', 'Jobs Removed', 'Active',
            'Inactive', 'Total', 'Status'
        ])

        # Per-company stats
        run_total_added = 0
        run_total_removed = 0
        run_total_active = 0
        run_total_inactive = 0
        run_total_all = 0

        for result in scrape_results:
            company = result['company']
            added = result.get('new_jobs', 0)
            removed = result.get('removed_jobs', 0)
            active = by_company_active.get(company, 0)
            all_jobs = by_company.get(company, 0)
            inactive = all_jobs - active
            status = 'OK' if result.get('success') else f"FAIL: {result.get('error', 'Unknown')[:40]}"

            run_total_added += added
            run_total_removed += removed
            run_total_active += active
            run_total_inactive += inactive
            run_total_all += all_jobs

            report_rows.append([
                company, added, removed, active, inactive, all_jobs, status
            ])

        # Totals row
        report_rows.append([
            'TOTAL', run_total_added, run_total_removed,
            run_total_active, run_total_inactive, run_total_all, ''
        ])

        # Blank row after report
        report_rows.append([])

        # Write run report
        end_row = next_row + len(report_rows) - 1
        report_range = f'A{next_row}:G{end_row}'
        worksheet.update(
            values=report_rows,
            range_name=report_range,
            value_input_option='RAW'
        )

        logger.info(
            f"Appended run report to Overview sheet at row {next_row}: "
            f"{len(scrape_results)} sources, +{run_total_added}/-{run_total_removed} jobs"
        )
