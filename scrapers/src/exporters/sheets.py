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

        # Auto-resize worksheet if needed to fit new rows
        rows_needed = next_row + len(rows)
        if rows_needed > worksheet.row_count:
            new_size = rows_needed + 500  # Add buffer
            logger.info(
                f"Resizing worksheet {sheet_name}: "
                f"{worksheet.row_count} → {new_size} rows"
            )
            worksheet.resize(rows=new_size)

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

    # Tabs that are reporting/reference artifacts, not data sources.
    OVERVIEW_ADMIN_TABS = {
        'Overview',
        'Target Companies',
        'Agency Blocklist',
        'Client Jobs - Aggregated',
        'Jobs Weekly',
        'Trend Data',
    }

    def _classify_tab(self, title: str):
        """Return (display_name, source_type) or None to skip.

        source_type is one of 'employer', 'agency', 'aggregator'.
        """
        if title.startswith('_') or title in self.OVERVIEW_ADMIN_TABS:
            return None
        if title.startswith('Agency - '):
            return title[len('Agency - '):], 'agency'
        if title.startswith('Aggregator - '):
            return title[len('Aggregator - '):], 'aggregator'
        return title, 'employer'

    @staticmethod
    def _stats_from_values(values):
        """Compute {active,inactive,total,last_scraped} from a tab's raw rows.

        Defensive to schema variation: finds Status and Scraped At columns
        by header name. If no recognizable header, returns zeros.
        """
        if not values or len(values) < 2:
            return {'active': 0, 'inactive': 0, 'total': 0, 'last_scraped': ''}
        header = [h.strip().lower() for h in values[0]]
        data_rows = [r for r in values[1:] if any(c.strip() for c in r)]

        def find_col(*candidates):
            for cand in candidates:
                if cand in header:
                    return header.index(cand)
            return None

        status_idx = find_col('status')
        scraped_idx = find_col('scraped at', 'scraped_at', 'last seen', 'last_seen')

        total = len(data_rows)
        if status_idx is not None:
            active = sum(
                1 for r in data_rows
                if status_idx < len(r) and r[status_idx].strip().lower() == 'active'
            )
            inactive = total - active
        else:
            active, inactive = total, 0

        last_scraped = ''
        if scraped_idx is not None:
            vals = [
                r[scraped_idx].strip()
                for r in data_rows
                if scraped_idx < len(r) and r[scraped_idx].strip()
            ]
            if vals:
                last_scraped = max(vals)

        return {'active': active, 'inactive': inactive,
                'total': total, 'last_scraped': last_scraped}

    @retry(
        retry=retry_if_exception_type(APIError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=4, max=60),
        reraise=True
    )
    def update_overview_sheet(
        self,
        company_configs: dict,  # kept for signature compatibility; unused
        scrape_results: list[dict],
        tracker_stats: dict,  # kept for signature compatibility; unused
    ):
        """Rewrite the Overview sheet as a single snapshot of every data tab.

        Columns: Employer | Source Type | Active Jobs | Inactive Jobs |
                 Total Jobs | Last Scraped

        Enumerates every worksheet, categorises by name, and reads all tabs
        in a SINGLE values_batch_get call to stay under the Sheets
        60-reads/min quota. Full overwrite on every run; nothing appended.
        """
        now_iso = datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
        scraped_this_run = {r['company'] for r in scrape_results if r.get('success')}

        try:
            overview_ws = self.spreadsheet.worksheet('Overview')
        except WorksheetNotFound:
            logger.warning("Overview worksheet not found, creating it")
            overview_ws = self.spreadsheet.add_worksheet(
                title='Overview', rows=200, cols=10
            )

        all_worksheets = self.spreadsheet.worksheets()
        classified = []  # (ws, display, source_type)
        for ws in all_worksheets:
            c = self._classify_tab(ws.title)
            if c is None:
                continue
            display, source_type = c
            classified.append((ws, display, source_type))

        # Single batched read for every source tab (A:N covers the 14-column schema
        # and is safe for wider-schema tabs — we only read what we need).
        ranges = [f"'{ws.title}'!A:N" for ws, _, _ in classified]
        values_per_tab = {}
        if ranges:
            try:
                batch = self.spreadsheet.values_batch_get(ranges)
                for rng, result in zip(ranges, batch.get('valueRanges', [])):
                    values_per_tab[rng] = result.get('values', [])
            except Exception as e:
                logger.warning(f"values_batch_get failed, falling back to per-tab: {e}")
                for ws, _, _ in classified:
                    try:
                        values_per_tab[f"'{ws.title}'!A:N"] = ws.get_all_values()
                    except Exception as e2:
                        logger.warning(f"Failed to read '{ws.title}': {e2}")
                        values_per_tab[f"'{ws.title}'!A:N"] = []

        # Build rows
        sources = []  # (display, source_type, stats)
        for ws, display, source_type in classified:
            values = values_per_tab.get(f"'{ws.title}'!A:N", [])
            stats = self._stats_from_values(values)
            if display in scraped_this_run:
                stats['last_scraped'] = now_iso
            sources.append((display, source_type, stats))

        # Sort: employer → agency → aggregator, then by name
        type_order = {'employer': 0, 'agency': 1, 'aggregator': 2}
        sources.sort(key=lambda s: (type_order.get(s[1], 3), s[0].lower()))

        header = ['Employer', 'Source Type', 'Active Jobs', 'Inactive Jobs',
                 'Total Jobs', 'Last Scraped']
        rows = [header]
        total_active = 0
        total_inactive = 0
        total_all = 0
        for display, source_type, st in sources:
            total_active += st['active']
            total_inactive += st['inactive']
            total_all += st['total']
            rows.append([
                display, source_type, st['active'], st['inactive'],
                st['total'], st['last_scraped'],
            ])
        rows.append([])
        rows.append(['TOTAL', '', total_active, total_inactive, total_all, ''])

        end_row = len(rows)
        if overview_ws.row_count < end_row:
            overview_ws.resize(rows=max(end_row + 10, 200))
        overview_ws.clear()
        overview_ws.update(
            values=rows,
            range_name=f'A1:F{end_row}',
            value_input_option='RAW'
        )

        logger.info(
            f"Overview sheet rewritten: {len(sources)} sources "
            f"({total_active} active / {total_inactive} inactive / {total_all} total)"
        )
