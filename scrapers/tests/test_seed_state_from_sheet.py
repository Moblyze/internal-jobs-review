#!/usr/bin/env python3
"""Unit tests for seeding the state DB from a sheet tab and for chunked status writes.

Run with: python -m pytest tests/test_seed_state_from_sheet.py -v
"""

import hashlib
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


class _FakeProbe:
    def __init__(self, gone_urls):
        self.gone = set(gone_urls)
        self.asked = []

    def verdict(self, url, title=None):
        self.asked.append(url)
        return "gone" if url in self.gone else "live"


def _tracker(tmp):
    return DeduplicationTracker(db_path=os.path.join(tmp, 'state.db'))


def _insert(conn, url, status):
    conn.execute(
        "INSERT INTO scraped_jobs (url_hash, url, company, title, first_seen, last_seen, status, exported_to_sheets) "
        "VALUES (?, ?, 'KBR', 'Existing', '2026-01-01', '2026-01-01', ?, 1)",
        (hashlib.sha256(url.encode()).hexdigest(), url, status),
    )
    conn.commit()


def _row(n, url, status, scraped='2026-03-12T09:00:00', changed=''):
    return {'row_number': n, 'url': url, 'title': f'Row {n}', 'status': status,
            'status_changed_date': changed, 'scraped_at': scraped}


class TestSeedStateFromSheet:
    def test_seed_without_probe_inserts_unknown_urls_with_sheet_status(self):
        with tempfile.TemporaryDirectory() as d:
            tracker = _tracker(d)
            conn = tracker.conn
            _insert(conn, 'https://x/job/1', 'active')
            rows = [
                _row(2, 'https://x/job/1', 'active'),
                _row(3, 'https://x/job/2', 'active'),
                _row(4, 'https://x/job/3', 'removed', changed='2026-04-01T00:00:00'),
                _row(5, 'https://x/job/2', 'removed'),  # duplicate row; URL still counts as active
            ]
            dry = seed(conn, 'KBR', rows, dry_run=True)
            assert dry['unique_urls'] == 3 and dry['duplicate_rows'] == 1
            assert dry['insert_active'] == 1 and dry['insert_removed'] == 1 and dry['already_in_db'] == 1
            assert conn.execute("SELECT COUNT(*) FROM scraped_jobs").fetchone()[0] == 1

            seed(conn, 'KBR', rows, dry_run=False)
            got = {r[0]: r[1:] for r in conn.execute(
                "SELECT url, status, exported_to_sheets, first_seen FROM scraped_jobs ORDER BY url")}
            assert got['https://x/job/2'] == ('active', 1, '2026-03-12T09:00:00')
            assert got['https://x/job/3'][0] == 'removed'
            assert tracker.is_duplicate('https://x/job/2')  # daily run will not re-export it
            assert [j['url'] for j in tracker.get_active_jobs_by_company('KBR')] == ['https://x/job/1', 'https://x/job/2']
            tracker.close()

    def test_probe_retires_every_active_row_of_a_gone_url_and_fixes_db(self):
        with tempfile.TemporaryDirectory() as d:
            tracker = _tracker(d)
            conn = tracker.conn
            _insert(conn, 'https://x/job/db-active-gone', 'active')
            _insert(conn, 'https://x/job/db-removed-sheet-active', 'removed')
            rows = [
                _row(2, 'https://x/job/orphan-gone', 'active'),
                _row(3, 'https://x/job/orphan-gone', 'active'),          # duplicate, also active
                _row(4, 'https://x/job/orphan-gone', 'removed'),         # already retired row: untouched
                _row(5, 'https://x/job/orphan-live', 'active'),
                _row(6, 'https://x/job/db-active-gone', 'active'),
                _row(7, 'https://x/job/db-removed-sheet-active', 'active'),
                _row(8, 'https://x/job/orphan-removed', 'removed'),      # never probed
            ]
            probe = _FakeProbe(['https://x/job/orphan-gone', 'https://x/job/db-active-gone',
                                'https://x/job/db-removed-sheet-active'])
            s = seed(conn, 'KBR', rows, dry_run=False, probe=probe)

            assert sorted(probe.asked) == ['https://x/job/db-active-gone', 'https://x/job/db-removed-sheet-active',
                                           'https://x/job/orphan-gone', 'https://x/job/orphan-live']
            assert s['probe_gone'] == 3 and s['probe_live'] == 1
            assert sorted(s['retire_rows']) == [2, 3, 6, 7]
            assert s['insert_active'] == 1 and s['insert_removed'] == 2 and s['db_marked_removed'] == 1
            status = {r[0]: r[1] for r in conn.execute("SELECT url, status FROM scraped_jobs")}
            assert status['https://x/job/orphan-gone'] == 'removed'
            assert status['https://x/job/orphan-live'] == 'active'
            assert status['https://x/job/db-active-gone'] == 'removed'
            assert status['https://x/job/orphan-removed'] == 'removed'
            tracker.close()
