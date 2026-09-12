#!/usr/bin/env python3
"""Unit tests for seeding the state DB from a sheet tab and for chunked status writes.

Run with: python -m pytest tests/test_seed_state_from_sheet.py -v
"""

import os
import sys
import tempfile
from unittest.mock import MagicMock

from src.exporters.sheets import SheetsExporter
from src.utils.deduplication import DeduplicationTracker

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts'))
from seed_state_from_sheet import seed  # noqa: E402


class TestBatchStatusUpdateChunking:
    def test_updates_are_chunked(self, monkeypatch):
        exporter = SheetsExporter.__new__(SheetsExporter)
        ws = MagicMock()
        exporter.spreadsheet = MagicMock()
        exporter.spreadsheet.worksheet.return_value = ws
        monkeypatch.setattr(SheetsExporter, 'STATUS_UPDATE_CHUNK', 3)
        monkeypatch.setattr(SheetsExporter, 'INTER_BATCH_PAUSE_SECONDS', 0)

        updates = [(i, 'removed', '2026-09-12T00:00:00') for i in range(2, 9)]  # 7 rows
        exporter.batch_update_statuses('KBR', updates)

        # 7 rows in chunks of 3 -> 3 calls carrying 6, 6 and 2 single-cell ranges
        sent = [len(c.args[0]) for c in ws.batch_update.call_args_list]
        assert sent == [6, 6, 2]
        first = ws.batch_update.call_args_list[0].args[0]
        assert first[0] == {'range': 'L2', 'values': [['removed']]}
        assert first[1] == {'range': 'M2', 'values': [['2026-09-12T00:00:00']]}


class TestSeedStateFromSheet:
    def test_seed_inserts_only_unknown_rows_with_sheet_status(self):
        with tempfile.TemporaryDirectory() as d:
            db = os.path.join(d, 'state.db')
            tracker = DeduplicationTracker(db_path=db)
            conn = tracker.conn
            conn.execute(
                "INSERT INTO scraped_jobs (url_hash, url, company, title, first_seen, last_seen, status, exported_to_sheets) "
                "VALUES (?, ?, 'KBR', 'Existing', '2026-01-01', '2026-01-01', 'active', 1)",
                (__import__('hashlib').sha256(b'https://x/job/1').hexdigest(), 'https://x/job/1'),
            )
            conn.commit()
            rows = [
                {'url': 'https://x/job/1', 'title': 'Existing', 'status': 'active', 'status_changed_date': '', 'scraped_at': '2026-03-12T09:00:00'},
                {'url': 'https://x/job/2', 'title': 'Orphan active', 'status': 'active', 'status_changed_date': '', 'scraped_at': '2026-03-12T09:00:00'},
                {'url': 'https://x/job/3', 'title': 'Orphan removed', 'status': 'removed', 'status_changed_date': '2026-04-01T00:00:00', 'scraped_at': '2026-03-12T09:00:00'},
                {'url': 'https://x/job/2', 'title': 'Dup row', 'status': 'active', 'status_changed_date': '', 'scraped_at': ''},
            ]
            dry = seed(conn, 'KBR', rows, dry_run=True)
            assert dry['insert_active'] == 1 and dry['insert_removed'] == 1
            assert dry['already_in_db'] == 1 and dry['duplicate_urls_in_tab'] == 1
            assert conn.execute("SELECT COUNT(*) FROM scraped_jobs").fetchone()[0] == 1

            seed(conn, 'KBR', rows, dry_run=False)
            got = {r[0]: r[1:] for r in conn.execute(
                "SELECT url, status, exported_to_sheets, first_seen FROM scraped_jobs ORDER BY url")}
            assert got['https://x/job/2'] == ('active', 1, '2026-03-12T09:00:00')
            assert got['https://x/job/3'][0] == 'removed'
            assert tracker.is_duplicate('https://x/job/2')  # daily run will not re-export it
            assert [j['url'] for j in tracker.get_active_jobs_by_company('KBR')] == ['https://x/job/1', 'https://x/job/2']
            tracker.close()
