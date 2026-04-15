"""Unit tests for sheets.py column-letter helper.

Run from scrapers/ with: python -m pytest tests/test_sheets_column_helpers.py -v
"""

import pytest

from src.exporters.sheets import SheetsExporter


class TestColumnLetterHelper:
    @pytest.mark.parametrize("n,letter", [
        (1, "A"),
        (2, "B"),
        (14, "N"),
        (20, "T"),
        (26, "Z"),
        (27, "AA"),
        (52, "AZ"),
        (53, "BA"),
    ])
    def test_column_letter_for(self, n, letter):
        assert SheetsExporter._column_letter_for(n) == letter

    def test_header_row_has_twenty_columns(self):
        assert len(SheetsExporter.HEADER_ROW) == 20

    def test_header_row_contains_contact_columns(self):
        expected_tail = [
            "Contact Name",
            "Contact Title",
            "Contact Email",
            "Contact Phone",
            "Contact LinkedIn URL",
            "Contact Source",
        ]
        assert SheetsExporter.HEADER_ROW[-6:] == expected_tail
