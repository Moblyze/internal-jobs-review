"""Tests for moving status=removed rows into the archive spreadsheet (Nov 9, 2026).

Run with: python -m pytest tests/test_sheet_archive.py -v
"""

import re
from collections import Counter

from src.exporters.sheets import SheetsExporter
from src.utils.sheet_archive import (
    ARCHIVE_HEADER, ARCHIVE_TAB, SheetArchiver, archive_key, descending_ranges, plan_tab, write_chunks,
)

HEADER = list(SheetsExporter.HEADER_ROW)
ARCH_HEADER = list(ARCHIVE_HEADER)


def row(i, status, changed='2026-11-01T00:00:00'):
    r = [''] * len(HEADER)
    r[HEADER.index('Title')] = f'Job {i}'
    r[HEADER.index('URL')] = f'https://x/{i}'
    r[HEADER.index('Status')] = status
    r[HEADER.index('Status Changed Date')] = changed if status == 'removed' else ''
    r[HEADER.index('Scraped At')] = '2026-10-01T00:00:00'
    return r


# ── fakes ────────────────────────────────────────────────────────────────────
def _col_idx(letters):
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


class FakeWS:
    def __init__(self, title, values, sheet_id):
        self.title, self.values, self.id = title, values, sheet_id

    @property
    def row_count(self):
        return max(len(self.values), 2)

    def get_all_values(self):
        w = max(len(r) for r in self.values)
        return [list(r) + [''] * (w - len(r)) for r in self.values]

    def row_values(self, n):
        return list(self.values[n - 1])

    def add_rows(self, n):
        self.values.extend([[] for _ in range(n)])

    def update(self, values, range_name, value_input_option=None):
        start = int(re.match(r'[A-Z]+(\d+)', range_name).group(1))
        for k, r in enumerate(values):
            while len(self.values) < start + k:
                self.values.append([])
            self.values[start + k - 1] = list(r)


class FakeSS:
    def __init__(self, tabs):
        self.tabs = {t.title: t for t in tabs}

    def worksheets(self):
        return list(self.tabs.values())

    def worksheet(self, title):
        return self.tabs[title]

    def values_batch_get(self, ranges):
        out = []
        for rng in ranges:
            m = re.match(r"'(.+)'!(.+)", rng)
            ws, spec = self.tabs[m.group(1)], m.group(2)
            if spec == '1:1':
                out.append({'values': [ws.values[0]]})
                continue
            mm = re.match(r'([A-Z]+)(\d+):([A-Z]+)$', spec)
            c, start = _col_idx(mm.group(1)), int(mm.group(2))
            col = [[r[c]] if c < len(r) and r[c] != '' else [] for r in ws.values[start - 1:]]
            while col and not col[-1]:
                col.pop()
            out.append({'values': col})
        return {'valueRanges': out}

    def batch_update(self, body):
        by_id = {t.id: t for t in self.tabs.values()}
        for req in body['requests']:
            r = req['deleteDimension']['range']
            ws = by_id[r['sheetId']]
            del ws.values[r['startIndex']:r['endIndex']]


def make(main_rows_by_tab, archive_rows=None):
    tabs = [FakeWS(t, [HEADER] + rows, i + 1) for i, (t, rows) in enumerate(main_rows_by_tab.items())]
    tabs.append(FakeWS('Overview', [['Employer', 'Source Type']], 99))
    main = FakeSS(tabs)
    archive = FakeSS([FakeWS(ARCHIVE_TAB, [ARCH_HEADER] + (archive_rows or []), 500)])
    return main, archive, SheetArchiver(main, archive, HEADER, sleep=lambda s: None)


# ── pure planning ────────────────────────────────────────────────────────────
class TestPlan:
    def test_only_removed_rows_are_planned(self):
        rows = [row(1, 'active'), row(2, 'removed'), row(3, 'Removed '), row(4, 'active')]
        app, dels = plan_tab('BP', HEADER, rows, Counter(), ARCH_HEADER, 'T')
        assert dels == [3, 4]
        assert [r[ARCH_HEADER.index('URL')] for r in app] == ['https://x/2', 'https://x/3']
        assert all(r[0] == 'BP' and r[1] == 'T' for r in app)

    def test_rows_already_archived_are_deleted_but_not_appended_again(self):
        rows = [row(2, 'removed'), row(2, 'removed'), row(5, 'removed')]
        k2 = archive_key('BP', 'https://x/2', '2026-11-01T00:00:00', '2026-10-01T00:00:00')
        app, dels = plan_tab('BP', HEADER, rows, Counter({k2: 1}), ARCH_HEADER, 'T')
        assert dels == [2, 3, 4]
        # one copy of x/2 already archived -> append the second copy and x/5 only
        assert sorted(r[ARCH_HEADER.index('URL')] for r in app) == ['https://x/2', 'https://x/5']

    def test_columns_resolved_by_header_title(self):
        shuffled = list(reversed(HEADER))
        r = list(reversed(row(7, 'removed')))
        app, dels = plan_tab('BP', shuffled, [r], Counter(), ARCH_HEADER, 'T')
        assert dels == [2] and app[0][ARCH_HEADER.index('URL')] == 'https://x/7'
        assert app[0][ARCH_HEADER.index('Title')] == 'Job 7'

    def test_descending_ranges(self):
        assert descending_ranges([2, 3, 4, 9, 11, 12]) == [(11, 12), (9, 9), (2, 4)]

    def test_write_chunks_split_by_rows(self):
        chunks = write_chunks([['a']] * 4500)
        assert [len(c) for c in chunks] == [2000, 2000, 500]


# ── end to end against fakes ─────────────────────────────────────────────────
class TestArchiver:
    def test_moves_removed_rows_and_keeps_active(self):
        main, archive, arch = make({
            'BP': [row(1, 'active'), row(2, 'removed'), row(3, 'removed'), row(4, 'active'), row(5, 'removed')],
            'KBR': [row(10, 'active')],
        })
        rep = arch.run()
        assert rep['appended'] == 3 and rep['deleted'] == 3
        bp = main.tabs['BP'].values
        assert [r[HEADER.index('URL')] for r in bp[1:]] == ['https://x/1', 'https://x/4']
        assert len(main.tabs['KBR'].values) == 2
        arch_urls = [r[ARCH_HEADER.index('URL')] for r in archive.tabs[ARCHIVE_TAB].values[1:] if r]
        assert arch_urls == ['https://x/2', 'https://x/3', 'https://x/5']

    def test_rerun_is_idempotent(self):
        main, archive, arch = make({'BP': [row(1, 'active'), row(2, 'removed')]})
        arch.run()
        rep = SheetArchiver(main, archive, HEADER, sleep=lambda s: None).run()
        assert rep['appended'] == 0 and rep['deleted'] == 0
        assert len([r for r in archive.tabs[ARCHIVE_TAB].values[1:] if r]) == 1

    def test_resume_after_append_without_delete_does_not_duplicate(self):
        # a crash after the append left the row in both places
        r2 = row(2, 'removed')
        prior = ['BP', 'earlier'] + [r2[HEADER.index(h)] for h in ARCH_HEADER[2:]]
        main, archive, arch = make({'BP': [row(1, 'active'), r2]}, archive_rows=[prior])
        rep = arch.run()
        assert rep['appended'] == 0 and rep['deleted'] == 1
        assert len(main.tabs['BP'].values) == 2
        assert len([r for r in archive.tabs[ARCHIVE_TAB].values[1:] if r]) == 1

    def test_dry_run_writes_nothing(self):
        main, archive, arch = make({'BP': [row(1, 'active'), row(2, 'removed')]})
        rep = arch.run(dry_run=True)
        assert rep['tabs']['BP'] == {'rows_before': 2, 'append': 1, 'delete': 1}
        assert len(main.tabs['BP'].values) == 3
        assert len(archive.tabs[ARCHIVE_TAB].values) == 1

    def test_row_changed_before_delete_skips_that_tab(self):
        main, archive, arch = make({'BP': [row(1, 'active'), row(2, 'removed')]})
        real = arch.append_to_archive

        def append_then_reactivate(rows, next_row):
            out = real(rows, next_row)
            main.tabs['BP'].values[2][HEADER.index('Status')] = 'active'   # writer raced us
            return out
        arch.append_to_archive = append_then_reactivate
        rep = arch.run()
        assert rep['skipped_tabs'] == ['BP'] and rep['deleted'] == 0
        assert len(main.tabs['BP'].values) == 3

    def test_non_schema_tabs_are_ignored(self):
        main, archive, arch = make({'BP': [row(2, 'removed')]})
        main.tabs['Overview'].values.append(['removed', 'removed'])
        rep = arch.run()
        assert set(rep['tabs']) == {'BP'}


class TestSlimArchiveAndSizeGuard:
    def test_archive_rows_carry_no_description(self):
        r = row(1, 'removed')
        r[HEADER.index('Description')] = 'x' * 5000
        app, _ = plan_tab('BP', HEADER, [r], Counter(), ARCH_HEADER, 'T')
        assert 'Description' not in ARCH_HEADER and len(app[0]) == len(ARCH_HEADER)
        assert 'x' * 5000 not in app[0]

    def test_full_width_archive_header_is_rejected(self):
        import pytest
        archive = FakeSS([FakeWS(ARCHIVE_TAB, [['Source Tab', 'Archived At'] + HEADER], 500)])
        with pytest.raises(RuntimeError):
            SheetArchiver(FakeSS([]), archive, HEADER, sleep=lambda s: None)

    def test_size_verdict_levels(self):
        from src.utils.sheet_archive import size_verdict
        assert size_verdict(199, 100) == 'ok'
        assert size_verdict(200, 100) == 'warn'
        assert size_verdict(300, 100) == 'fail'
        assert size_verdict(10 ** 9, None) == 'ok'
