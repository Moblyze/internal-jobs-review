"""Move "removed" rows out of the Job Scraping Results sheet into its archive.

Why (Jesse, Nov 9, 2026): the main sheet hit Google's size wall ("This
document is too large to continue editing", every Daily Job Scraping run
failed from Nov 5). 159,504 of its 233,837 job rows were status "removed",
i.e. jobs already gone at the source. They now live in a separate
spreadsheet, "<main name> - Archive", tab "Archived Jobs", and the daily
workflow moves every newly removed row there (archive-removed job in
daily-scrape.yml) instead of letting it pile up in the main sheet.

Safety and idempotency:
  * Columns are resolved by header TITLE on both sides, never by position.
  * A row is deleted from the main sheet only after its copy is in the
    archive. Archive keys are counted as a multiset (source tab, URL, Status
    Changed Date, Scraped At), so a rerun after a partial failure (rows
    appended but not yet deleted) appends nothing and just finishes the
    deletes. A rerun never duplicates.
  * Immediately before deleting, the tab's URL and Status columns are re-read
    and every target row must still carry the same URL with status removed;
    any mismatch skips that tab's deletes (nothing is lost, the next run
    retries).
  * Only tabs whose header is exactly the scraper schema are touched.
  * The run must not overlap other sheet writers (row numbers shift on
    delete), so the workflow runs it after both scrape jobs finish.
"""

from __future__ import annotations

import json
import logging
import random
import time
from collections import Counter, defaultdict
from datetime import datetime
from typing import Callable, Iterable, Optional

from gspread.exceptions import APIError

logger = logging.getLogger(__name__)

ARCHIVE_TAB = 'Archived Jobs'
ARCHIVE_PREFIX = ['Source Tab', 'Archived At']
# Slim archive rows (Jesse, Nov 10, 2026, decision D3): no Description, Skills,
# Certifications, Salary or Employment Type. Removed rows held 690 MB of text,
# mostly descriptions; archiving them whole would walk the archive into the same
# size wall. Full text stays in R2 (archive/jobs/*.jsonl.gz) and the Nov 9 backup.
ARCHIVE_HEADER = ARCHIVE_PREFIX + ['Title', 'Company', 'Location', 'URL', 'Requisition ID', 'Posted Date',
                                   'Status', 'Status Changed Date', 'Scraped At']
ARCHIVE_SUFFIX_NAME = ' - Archive'
ARCHIVABLE_STATUSES = {'removed'}

# Bytes per values.update request (Sheets rejects very large bodies; job rows
# carry long descriptions, so chunk by size, not just by row count).
MAX_WRITE_BYTES = 4_000_000
MAX_WRITE_ROWS = 2_000
# deleteDimension requests per spreadsheets.batchUpdate call.
DELETE_CHUNK = 500
PAUSE_SECONDS = 1.5


def archive_name_for(main_name: str) -> str:
    return f"{main_name}{ARCHIVE_SUFFIX_NAME}"


def _norm(h: str) -> str:
    return (h or '').strip().lower()


def col_letter(idx0: int) -> str:
    s = ''
    idx0 += 1
    while idx0:
        idx0, r = divmod(idx0 - 1, 26)
        s = chr(65 + r) + s
    return s


def archive_key(source_tab: str, url: str, status_changed: str, scraped_at: str) -> str:
    return '\x1f'.join([(source_tab or '').strip(), (url or '').strip(),
                        (status_changed or '').strip(), (scraped_at or '').strip()])


def plan_tab(tab: str, header: list[str], rows: list[list[str]], archived: Counter,
             archive_header: list[str], archived_at: str) -> tuple[list[list[str]], list[int]]:
    """Plan one tab: (rows to append to the archive, sheet row numbers to delete).

    rows are the tab's data rows (row 2 onward). Every row whose Status is in
    ARCHIVABLE_STATUSES is deleted; it is appended unless the archive already
    holds as many copies of its key as this tab has (multiset idempotency).
    `archived` is updated in place with what this plan appends.
    """
    col = {_norm(h): i for i, h in enumerate(header)}
    for need in ('url', 'status', 'status changed date', 'scraped at'):
        if need not in col:
            raise ValueError(f"{tab}: header has no {need!r} column")

    def cell(row, name):
        i = col[name]
        return row[i] if i < len(row) else ''

    by_key: dict[str, list[tuple[int, list[str]]]] = defaultdict(list)
    for offset, row in enumerate(rows):
        if _norm(cell(row, 'status')) not in ARCHIVABLE_STATUSES:
            continue
        key = archive_key(tab, cell(row, 'url'), cell(row, 'status changed date'), cell(row, 'scraped at'))
        by_key[key].append((offset + 2, row))

    to_append: list[list[str]] = []
    to_delete: list[int] = []
    for key, hits in by_key.items():
        missing = len(hits) - archived.get(key, 0)
        for n, (row_number, row) in enumerate(hits):
            to_delete.append(row_number)
            if n < missing:
                out = []
                for h in archive_header:
                    hn = _norm(h)
                    if hn == 'source tab':
                        out.append(tab)
                    elif hn == 'archived at':
                        out.append(archived_at)
                    else:
                        out.append(cell(row, hn) if hn in col else '')
                to_append.append(out)
        if missing > 0:
            archived[key] = archived.get(key, 0) + missing
    to_delete.sort()
    return to_append, to_delete


def descending_ranges(row_numbers: Iterable[int]) -> list[tuple[int, int]]:
    """Contiguous 1-based inclusive (start, end) runs, highest first."""
    runs: list[tuple[int, int]] = []
    for r in sorted(set(row_numbers)):
        if runs and r == runs[-1][1] + 1:
            runs[-1] = (runs[-1][0], r)
        else:
            runs.append((r, r))
    return list(reversed(runs))


def write_chunks(rows: list[list[str]]) -> list[list[list[str]]]:
    chunks, cur, size = [], [], 0
    for row in rows:
        b = len(json.dumps(row))
        if cur and (size + b > MAX_WRITE_BYTES or len(cur) >= MAX_WRITE_ROWS):
            chunks.append(cur)
            cur, size = [], 0
        cur.append(row)
        size += b
    if cur:
        chunks.append(cur)
    return chunks


def _transient(err: Exception) -> bool:
    status = getattr(getattr(err, 'response', None), 'status_code', None)
    text = str(err)
    return status in (429, 500, 502, 503) or 'Quota exceeded' in text or 'RATE_LIMIT_EXCEEDED' in text


def with_retry(fn: Callable, *args, tries: int = 7, sleep: Callable = time.sleep, **kwargs):
    for attempt in range(tries):
        try:
            return fn(*args, **kwargs)
        except APIError as e:
            if not _transient(e) or attempt == tries - 1:
                raise
            delay = min(15 * (2 ** attempt), 120) + random.uniform(0, 5)
            logger.warning(f"Sheets transient error ({e}); retry {attempt + 1}/{tries} in {delay:.0f}s")
            sleep(delay)


class SheetArchiver:
    """Moves status=removed rows from the main spreadsheet into the archive's 'Archived Jobs' tab."""

    def __init__(self, main, archive, schema_header: list[str], sleep: Callable = time.sleep):
        self.main = main
        self.archive = archive
        self.schema = [_norm(h) for h in schema_header]
        self.sleep = sleep
        self.archive_ws = with_retry(archive.worksheet, ARCHIVE_TAB, sleep=sleep)
        self.archive_header = with_retry(self.archive_ws.row_values, 1, sleep=sleep)
        expected = [_norm(h) for h in ARCHIVE_HEADER]
        if [_norm(h) for h in self.archive_header] != expected:
            raise RuntimeError(f"archive header {self.archive_header!r} is not the slim archive header {ARCHIVE_HEADER!r}")

    # ── reads ───────────────────────────────────────────────────────────────
    def archived_counts(self) -> tuple[Counter, int]:
        """(multiset of archive keys, number of archive data rows)."""
        hcol = {_norm(h): i for i, h in enumerate(self.archive_header)}
        names = ['source tab', 'url', 'status changed date', 'scraped at']
        ranges = [f"'{ARCHIVE_TAB}'!{col_letter(hcol[n])}2:{col_letter(hcol[n])}" for n in names]
        res = with_retry(self.archive.values_batch_get, ranges, sleep=self.sleep)
        cols = [[(v[0] if v else '') for v in vr.get('values', [])] for vr in res.get('valueRanges', [])]
        n = max((len(c) for c in cols), default=0)
        counts: Counter = Counter()
        for i in range(n):
            vals = [c[i] if i < len(c) else '' for c in cols]
            if any(vals):
                counts[archive_key(*vals)] += 1
        return counts, n

    def job_tabs(self, only: Optional[set[str]] = None) -> list:
        out = []
        worksheets = with_retry(self.main.worksheets, sleep=self.sleep)
        cands = [ws for ws in worksheets if ws.row_count >= 2 and (not only or ws.title in only)]
        for i in range(0, len(cands), 40):
            chunk = cands[i:i + 40]
            res = with_retry(self.main.values_batch_get, [f"'{ws.title}'!1:1" for ws in chunk], sleep=self.sleep)
            for ws, vr in zip(chunk, res.get('valueRanges', [])):
                header = (vr.get('values') or [[]])[0]
                if [_norm(h) for h in header] == self.schema:
                    out.append((ws, header))
        return out

    def removed_counts(self, tabs: list) -> dict[str, int]:
        """Status-column-only scan: how many archivable rows each tab has."""
        out = {}
        for i in range(0, len(tabs), 15):
            chunk = tabs[i:i + 15]
            ranges = []
            for ws, header in chunk:
                L = col_letter([_norm(h) for h in header].index('status'))
                ranges.append(f"'{ws.title}'!{L}2:{L}")
            res = with_retry(self.main.values_batch_get, ranges, sleep=self.sleep)
            for (ws, _h), vr in zip(chunk, res.get('valueRanges', [])):
                out[ws.title] = sum(1 for v in vr.get('values', []) if v and _norm(v[0]) in ARCHIVABLE_STATUSES)
        return out

    # ── writes ──────────────────────────────────────────────────────────────
    def append_to_archive(self, rows: list[list[str]], next_row: int) -> int:
        if not rows:
            return next_row
        needed = next_row + len(rows) - 1
        if needed > self.archive_ws.row_count:
            with_retry(self.archive_ws.add_rows, needed - self.archive_ws.row_count + 1000, sleep=self.sleep)
        last = col_letter(len(self.archive_header) - 1)
        for chunk in write_chunks(rows):
            rng = f"A{next_row}:{last}{next_row + len(chunk) - 1}"
            with_retry(self.archive_ws.update, values=chunk, range_name=rng,
                       value_input_option='RAW', sleep=self.sleep)
            next_row += len(chunk)
            self.sleep(PAUSE_SECONDS)
        return next_row

    def verify_targets(self, ws, header: list[str], targets: dict[int, str]) -> bool:
        """Re-read URL/Status and confirm every target row is unchanged."""
        hl = [_norm(h) for h in header]
        U, S = col_letter(hl.index('url')), col_letter(hl.index('status'))
        res = with_retry(self.main.values_batch_get,
                         [f"'{ws.title}'!{U}1:{U}", f"'{ws.title}'!{S}1:{S}"], sleep=self.sleep)
        urls, stats = [[(v[0] if v else '') for v in vr.get('values', [])] for vr in res['valueRanges']]
        for rn, url in targets.items():
            u = urls[rn - 1] if rn - 1 < len(urls) else ''
            s = stats[rn - 1] if rn - 1 < len(stats) else ''
            if u != url or _norm(s) not in ARCHIVABLE_STATUSES:
                logger.error(f"{ws.title}: row {rn} changed since it was read ({u!r}, {s!r}); deletes skipped")
                return False
        return True

    def delete_rows(self, ws, row_numbers: list[int]) -> None:
        reqs = [{'deleteDimension': {'range': {'sheetId': ws.id, 'dimension': 'ROWS',
                                               'startIndex': start - 1, 'endIndex': end}}}
                for start, end in descending_ranges(row_numbers)]
        for i in range(0, len(reqs), DELETE_CHUNK):
            with_retry(self.main.batch_update, {'requests': reqs[i:i + DELETE_CHUNK]}, sleep=self.sleep)
            self.sleep(PAUSE_SECONDS)

    # ── orchestration ───────────────────────────────────────────────────────
    def run(self, only_tabs: Optional[set[str]] = None, dry_run: bool = False) -> dict:
        archived_at = datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
        archived, archive_rows = self.archived_counts()
        next_row = archive_rows + 2
        tabs = self.job_tabs(only_tabs)
        pending = self.removed_counts(tabs)
        report = {'archived_at': archived_at, 'archive_rows_before': archive_rows,
                  'tabs_scanned': len(tabs), 'tabs': {}, 'appended': 0, 'deleted': 0, 'skipped_tabs': []}
        for ws, header in tabs:
            if not pending.get(ws.title):
                continue
            values = with_retry(ws.get_all_values, sleep=self.sleep)
            appended, deletes = plan_tab(ws.title, header, values[1:], archived, self.archive_header, archived_at)
            hl = [_norm(h) for h in header]
            url_i = hl.index('url')
            targets = {rn: (values[rn - 1][url_i] if url_i < len(values[rn - 1]) else '') for rn in deletes}
            report['tabs'][ws.title] = {'rows_before': len(values) - 1, 'append': len(appended),
                                        'delete': len(deletes)}
            if dry_run:
                continue
            next_row = self.append_to_archive(appended, next_row)
            report['appended'] += len(appended)
            if not self.verify_targets(ws, header, targets):
                report['skipped_tabs'].append(ws.title)
                continue
            self.delete_rows(ws, deletes)
            report['deleted'] += len(deletes)
            logger.info(f"{ws.title}: archived {len(appended)} rows, deleted {len(deletes)} from the main sheet")
        return report


# ── size guard (Jesse, Nov 10, 2026, decision D5) ────────────────────────────
# The old sheet hit Google's "too large to edit" wall on Nov 5, 2026 at about
# 3.3x the size of its live rows. Measure total stored characters every night:
# warn in #monitoring above 2x the post-cutover size, fail the step above 3x.
# Baselines were measured right after the Nov 10, 2026 cutover.
SIZE_BASELINE_CHARS = {'main': 202_267_149, 'archive': 42_943_174}  # measured Nov 10, 2026
SIZE_WARN_FACTOR = 2.0
SIZE_FAIL_FACTOR = 3.0


def spreadsheet_chars(ss, sleep: Callable = time.sleep, rows_per_read: int = 5000) -> tuple[int, int]:
    """(total characters across every tab's values, number of non-empty rows)."""
    total = rows = 0
    for ws in with_retry(ss.worksheets, sleep=sleep):
        n = ws.row_count
        for start in range(1, n + 1, rows_per_read):
            end = min(n, start + rows_per_read - 1)
            res = with_retry(ss.values_batch_get, [f"'{ws.title}'!A{start}:ZZ{end}"], sleep=sleep)
            for vr in res.get('valueRanges', []):
                for r in vr.get('values', []):
                    if any(r):
                        rows += 1
                        total += sum(len(str(c)) for c in r)
    return total, rows


def size_verdict(chars: int, baseline: int) -> str:
    """'ok', 'warn' (>= 2x baseline) or 'fail' (>= 3x baseline)."""
    if not baseline:
        return 'ok'
    ratio = chars / baseline
    if ratio >= SIZE_FAIL_FACTOR:
        return 'fail'
    if ratio >= SIZE_WARN_FACTOR:
        return 'warn'
    return 'ok'
