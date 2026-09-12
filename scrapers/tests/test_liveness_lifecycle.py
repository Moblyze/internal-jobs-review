#!/usr/bin/env python3
"""State DB + lifecycle behavior around source-page liveness verdicts.

Run with: python -m pytest tests/test_liveness_lifecycle.py -v
"""

import hashlib
import os
import tempfile
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest

from src.utils.deduplication import DeduplicationTracker
from src.utils.lifecycle import JobLifecycleManager


def _h(url):
    return hashlib.sha256(url.encode()).hexdigest()


def _insert(conn, url, status='active', company='Acme', **cols):
    fields = {'url_hash': _h(url), 'url': url, 'company': company, 'title': 'Rigger',
              'first_seen': '2026-01-01', 'last_seen': '2026-01-01', 'status': status,
              'exported_to_sheets': 1}
    fields.update(cols)
    conn.execute(
        f"INSERT INTO scraped_jobs ({', '.join(fields)}) VALUES ({', '.join('?' * len(fields))})",
        list(fields.values()),
    )
    conn.commit()


@pytest.fixture
def tracker():
    with tempfile.TemporaryDirectory() as d:
        t = DeduplicationTracker(db_path=os.path.join(d, 'state.db'))
        yield t
        t.close()


def _row(tracker, url):
    return dict(tracker.conn.execute("SELECT * FROM scraped_jobs WHERE url_hash = ?", (_h(url),)).fetchone())


class TestTrackerLiveness:
    def test_migration_adds_source_columns(self, tracker):
        cols = {r[1] for r in tracker.conn.execute("PRAGMA table_info(scraped_jobs)")}
        assert {'source_status', 'source_checked_at', 'source_valid_through', 'source_reason', 'removed_reason'} <= cols

    def test_record_source_status_touches_only_source_columns(self, tracker):
        _insert(tracker.conn, 'https://x/1')
        n = tracker.record_source_status([(_h('https://x/1'), 'LIVE', '2026-10-01', 'jsonld JobPosting')],
                                         checked_at='2026-09-12T03:00:00')
        row = _row(tracker, 'https://x/1')
        assert n == 1
        assert (row['source_status'], row['source_checked_at'], row['source_valid_through'], row['source_reason']) == \
               ('LIVE', '2026-09-12T03:00:00', '2026-10-01', 'jsonld JobPosting')
        assert row['status'] == 'active' and row['removed_reason'] is None

    def test_mark_removed_with_reason(self, tracker):
        _insert(tracker.conn, 'https://x/1')
        assert tracker.mark_jobs_removed([_h('https://x/1')], reason='source_gone') == 1
        row = _row(tracker, 'https://x/1')
        assert row['status'] == 'removed' and row['removed_reason'] == 'source_gone'
        # the listing-diff path keeps its NULL reason
        _insert(tracker.conn, 'https://x/2')
        tracker.mark_jobs_removed([_h('https://x/2')])
        assert _row(tracker, 'https://x/2')['removed_reason'] is None

    def test_get_active_jobs_carries_probe_fields(self, tracker):
        _insert(tracker.conn, 'https://x/1', source_status='DEAD', source_checked_at='2026-09-12T03:00:00')
        _insert(tracker.conn, 'https://x/2', company='Other')
        rows = tracker.get_active_jobs()
        assert {r['url'] for r in rows} == {'https://x/1', 'https://x/2'}
        one = tracker.get_active_jobs_by_company('Acme')
        assert len(one) == 1 and one[0]['source_status'] == 'DEAD' and one[0]['company'] == 'Acme'

    def test_reactivate_skips_rows_the_source_said_dead_recently(self, tracker):
        fresh = datetime.utcnow().isoformat()
        stale = (datetime.utcnow() - timedelta(days=10)).isoformat()
        _insert(tracker.conn, 'https://x/fresh-dead', status='removed', source_status='DEAD',
                source_checked_at=fresh, removed_reason='source_gone')
        _insert(tracker.conn, 'https://x/stale-dead', status='removed', source_status='DEAD',
                source_checked_at=stale, removed_reason='source_gone')
        _insert(tracker.conn, 'https://x/diff-removed', status='removed')
        n = tracker.reactivate_jobs('Acme', {'https://x/fresh-dead', 'https://x/stale-dead', 'https://x/diff-removed'})
        assert n == 2
        assert _row(tracker, 'https://x/fresh-dead')['status'] == 'removed'
        assert _row(tracker, 'https://x/stale-dead')['status'] == 'active'
        assert _row(tracker, 'https://x/stale-dead')['removed_reason'] is None
        assert _row(tracker, 'https://x/diff-removed')['status'] == 'active'


class TestLifecycleProbeGuard:
    def test_diff_cannot_retire_a_row_live_at_source(self, tracker):
        fresh = datetime.utcnow().isoformat()
        stale = (datetime.utcnow() - timedelta(days=10)).isoformat()
        for i in range(12):
            _insert(tracker.conn, f'https://x/{i}')
        _insert(tracker.conn, 'https://x/live-fresh', source_status='LIVE', source_checked_at=fresh)
        _insert(tracker.conn, 'https://x/live-stale', source_status='LIVE', source_checked_at=stale)
        _insert(tracker.conn, 'https://x/unprobed')
        exporter = MagicMock()
        exporter.get_existing_job_urls.return_value = {}
        mgr = JobLifecycleManager(tracker=tracker, exporter=exporter)

        # current scrape lists the 12 numbered rows only
        jobs = [MagicMock(url=f'https://x/{i}') for i in range(12)]
        summary = mgr.process_scrape_results('Acme', 'Acme', jobs)

        assert summary['removed_jobs'] == 2
        assert summary['kept_live_by_probe'] == 1
        assert _row(tracker, 'https://x/live-fresh')['status'] == 'active'
        assert _row(tracker, 'https://x/live-stale')['status'] == 'removed'
        assert _row(tracker, 'https://x/unprobed')['status'] == 'removed'
        assert _row(tracker, 'https://x/unprobed')['removed_reason'] is None
