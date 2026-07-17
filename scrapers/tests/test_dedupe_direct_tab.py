"""Tests for scripts/dedupe_direct_tab.py -- the URL-only dedup tool used to
clean up the CrewBase tab (2026-07): a partial pre-fix export run left ~2x
duplicate rows per URL after a later fixed run re-wrote the same jobs."""

import os

from scripts.dedupe_direct_tab import col_to_letter, dedupe_rows, write_local_backup

HEADER = ["Title", "Company", "Location", "Description", "URL", "Requisition ID", "Posted Date", "Skills"]


def test_keeps_last_occurrence_of_duplicate_url():
    rows = [
        ["Job A v1", "Co", "Loc", "Desc old", "http://x/1", "R1", "2026-01-01", "skill1"],
        ["Job A v2", "Co", "Loc", "Desc new", "http://x/1", "R1", "2026-01-02", "skill1,skill2"],
    ]
    kept, stats, uniq = dedupe_rows(HEADER, rows)
    assert stats == {"total": 2, "unique_urls": 1, "blank_url_rows": 0, "dropped_dup": 1, "kept": 1}
    assert kept == [rows[1]]  # the later/most-complete row survives
    assert uniq == {"http://x/1"}


def test_preserves_first_appearance_order():
    rows = [
        ["Job A", "Co", "Loc", "Desc", "http://x/1", "R1", "2026-01-01", ""],
        ["Job B", "Co", "Loc", "Desc", "http://x/2", "R2", "2026-01-01", ""],
        ["Job A dup", "Co", "Loc", "Desc", "http://x/1", "R1", "2026-01-02", ""],
    ]
    kept, stats, uniq = dedupe_rows(rows=rows, header=HEADER)
    # Output order follows first-seen order of the URL (x/1 before x/2),
    # but the content kept for x/1 is the later occurrence.
    assert [r[4] for r in kept] == ["http://x/1", "http://x/2"]
    assert kept[0][0] == "Job A dup"


def test_blank_rows_skipped_and_no_url_rows_preserved():
    rows = [
        ["", "", "", "", "", "", "", ""],
        ["Job C", "Co", "Loc", "Desc", "", "R3", "2026-01-01", ""],
        ["Job D", "Co", "Loc", "Desc", "http://x/9", "R9", "2026-01-01", ""],
    ]
    kept, stats, uniq = dedupe_rows(HEADER, rows)
    assert stats["total"] == 2  # fully-blank row excluded from the count
    assert stats["blank_url_rows"] == 1
    assert stats["unique_urls"] == 1
    assert stats["kept"] == 2
    urls_kept = [r[4] for r in kept]
    assert "" in urls_kept and "http://x/9" in urls_kept


def test_no_duplicates_is_a_noop():
    rows = [
        ["Job A", "Co", "Loc", "Desc", "http://x/1", "R1", "2026-01-01", ""],
        ["Job B", "Co", "Loc", "Desc", "http://x/2", "R2", "2026-01-01", ""],
    ]
    kept, stats, uniq = dedupe_rows(HEADER, rows)
    assert stats["kept"] == stats["total"] == 2
    assert kept == rows


def test_col_to_letter():
    assert col_to_letter(0) == "A"
    assert col_to_letter(7) == "H"
    assert col_to_letter(25) == "Z"
    assert col_to_letter(26) == "AA"
    assert col_to_letter(27) == "AB"


def test_write_local_backup_round_trips_and_verifies_count(tmp_path):
    path = tmp_path / "nested" / "backup.csv"
    rows = [
        ["Job A", "Co", "Loc", "Desc", "http://x/1", "R1", "2026-01-01", ""],
        ["Job B", "Co", "Loc", "Desc", "http://x/2", "R2", "2026-01-01", ""],
    ]
    written = write_local_backup(str(path), HEADER, rows)
    assert written == len(rows)
    assert os.path.exists(path)
    with open(path, newline="", encoding="utf-8") as f:
        content = f.read()
    assert "Job A" in content and "Job B" in content
