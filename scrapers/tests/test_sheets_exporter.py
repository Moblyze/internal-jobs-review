#!/usr/bin/env python3
"""
Unit tests for the Google Sheets exporter's large-write batching and 429
retry/backoff behavior.

Background: a full ~10,471-row CrewBase export burst past the Sheets
"Write requests per minute per user" quota because export_jobs() fired one
batch-write API call per 100 rows back-to-back with no pacing. The fix
raises BATCH_SIZE (fewer total calls), paces successive batches apart, and
retries any residual 429 with exponential backoff that respects Retry-After.
A capped run under BATCH_SIZE must still produce exactly one batch call, and
must NOT sleep after the (only/last) batch.

Run with: python -m pytest tests/test_sheets_exporter.py -v
"""

from unittest.mock import MagicMock, patch

import pytest
from gspread.exceptions import APIError

from src.exporters.sheets import SheetsExporter, _is_rate_limit, _retry_429, _retry_after_seconds
from src.models.job import JobPosting


def make_job(i: int) -> JobPosting:
    return JobPosting(
        title=f"Deckhand {i}",
        company="CrewBase",
        location="Gulf of Mexico",
        description="Offshore crewing role requiring valid seaman's book.",
        url=f"https://crewbase.pro/jobs/{i}",
    )


def make_api_error(status_code: int = 429, message: str = "Quota exceeded for quota metric 'Write requests'",
                    retry_after=None) -> APIError:
    """Build a realistic gspread APIError backed by a fake HTTP response."""
    response = MagicMock()
    response.status_code = status_code
    response.headers = {"Retry-After": str(retry_after)} if retry_after is not None else {}
    response.json.return_value = {"error": {"code": status_code, "message": message, "status": "RESOURCE_EXHAUSTED"}}
    return APIError(response)


def make_exporter() -> SheetsExporter:
    """Build a SheetsExporter without touching real credentials/network."""
    exporter = SheetsExporter.__new__(SheetsExporter)
    exporter.spreadsheet = MagicMock()
    exporter.credentials_path = "unused"
    exporter.spreadsheet_name = "Job Scraping Results"
    return exporter


class TestRateLimitDetection:
    def test_detects_by_status_code(self):
        assert _is_rate_limit(make_api_error(status_code=429, message="anything")) is True

    def test_detects_by_message_text(self):
        err = make_api_error(status_code=-1, message="Quota exceeded for quota metric 'Write requests'")
        assert _is_rate_limit(err) is True

    def test_non_rate_limit_error_not_flagged(self):
        err = make_api_error(status_code=404, message="Requested entity was not found.")
        assert _is_rate_limit(err) is False

    def test_retry_after_header_parsed(self):
        err = make_api_error(retry_after=17)
        assert _retry_after_seconds(err) == 17.0

    def test_missing_retry_after_returns_none(self):
        err = make_api_error()
        assert _retry_after_seconds(err) is None


class TestRetry429:
    def test_succeeds_without_retry_when_no_error(self):
        fn = MagicMock(return_value="ok")
        assert _retry_429(fn, "a", b=1) == "ok"
        fn.assert_called_once_with("a", b=1)

    @patch("src.exporters.sheets.time.sleep")
    def test_retries_on_429_then_succeeds(self, mock_sleep):
        fn = MagicMock(side_effect=[make_api_error(), make_api_error(), "ok"])
        result = _retry_429(fn, max_retries=5, initial_delay=1.0)
        assert result == "ok"
        assert fn.call_count == 3
        assert mock_sleep.call_count == 2

    @patch("src.exporters.sheets.time.sleep")
    def test_respects_retry_after_header(self, mock_sleep):
        fn = MagicMock(side_effect=[make_api_error(retry_after=42), "ok"])
        _retry_429(fn, max_retries=3, initial_delay=1.0)
        # Retry-After should be used verbatim as the base delay (plus jitter).
        slept_for = mock_sleep.call_args[0][0]
        assert 42 <= slept_for < 47

    @patch("src.exporters.sheets.time.sleep")
    def test_non_rate_limit_error_reraises_immediately(self, mock_sleep):
        fn = MagicMock(side_effect=make_api_error(status_code=404, message="not found"))
        with pytest.raises(APIError):
            _retry_429(fn, max_retries=5)
        fn.assert_called_once()
        mock_sleep.assert_not_called()

    @patch("src.exporters.sheets.time.sleep")
    def test_exhausts_retries_and_reraises(self, mock_sleep):
        fn = MagicMock(side_effect=make_api_error())
        with pytest.raises(APIError):
            _retry_429(fn, max_retries=2, initial_delay=0.01)
        assert fn.call_count == 3  # initial attempt + 2 retries


class TestExportJobsBatching:
    """export_jobs() chunking + pacing, with the Sheets API itself mocked out."""

    def _setup_worksheet(self, exporter, existing_rows=1, row_count=2000):
        worksheet = MagicMock()
        worksheet.get_all_values.return_value = [["Title"]] * existing_rows
        worksheet.row_count = row_count
        worksheet.row_values.return_value = SheetsExporter.HEADER_ROW
        exporter.spreadsheet.worksheet.return_value = worksheet
        return worksheet

    @patch("src.exporters.sheets.time.sleep")
    def test_capped_small_export_is_a_single_batch_with_no_pause(self, mock_sleep):
        """A 500-row (<= BATCH_SIZE) export must fire exactly one write call
        and must not sleep afterward -- this is the behavior the previously
        successful capped run relied on, and must stay unchanged."""
        exporter = make_exporter()
        self._setup_worksheet(exporter)
        jobs = [make_job(i) for i in range(500)]

        with patch.object(exporter, "_batch_append") as mock_append:
            written = exporter.export_jobs(jobs, "CrewBase")

        assert written == 500
        assert mock_append.call_count == 1
        mock_sleep.assert_not_called()

    @patch("src.exporters.sheets.time.sleep")
    def test_large_export_is_chunked_and_paced(self, mock_sleep):
        """A ~10,471-row export must be split into multiple batches, each
        paced apart, with no pause after the final batch."""
        exporter = make_exporter()
        self._setup_worksheet(exporter, row_count=20000)
        jobs = [make_job(i) for i in range(10471)]

        with patch.object(exporter, "_batch_append") as mock_append:
            written = exporter.export_jobs(jobs, "CrewBase")

        expected_batches = -(-10471 // SheetsExporter.BATCH_SIZE)  # ceil division
        assert written == 10471
        assert mock_append.call_count == expected_batches
        # Paced between every batch except the last.
        assert mock_sleep.call_count == expected_batches - 1
        for call in mock_sleep.call_args_list:
            assert call.args[0] == SheetsExporter.INTER_BATCH_PAUSE_SECONDS

    @patch("src.exporters.sheets.time.sleep")
    def test_batch_write_retries_through_a_429_burst(self, mock_sleep):
        """If the write quota is exhausted mid-export, the batch retries
        with backoff instead of aborting the whole export."""
        exporter = make_exporter()
        self._setup_worksheet(exporter)
        jobs = [make_job(i) for i in range(50)]

        with patch.object(
            exporter, "_batch_append", side_effect=[make_api_error(), make_api_error(), None]
        ) as mock_append:
            written = exporter.export_jobs(jobs, "CrewBase")

        assert written == 50
        assert mock_append.call_count == 3
        assert mock_sleep.call_count == 2
