#!/usr/bin/env python3
"""Sheet-active roster for the liveness probe (2026-09-24).

Run with: python -m pytest tests/test_sheet_roster.py -v
"""

import hashlib
import os
import tempfile

import pytest
from gspread.exceptions import APIError

from src.utils import liveness, sheet_roster
from src.utils.deduplication import DeduplicationTracker


def _h(u):
    return hashlib.sha256(u.encode()).hexdigest()


def _no_exclusions(_u):
    return False


class TestParsing:
    def test_header_columns_by_name_not_letter(self):
        cols = sheet_roster.header_columns(["Title", "Company", "URL", "Employment Type", "Status"])
        assert cols == {"url": 2, "status": 4, "title": 0}
        assert sheet_roster.header_columns(["Employer", "Active Jobs"]) is None   # Overview-style tab

    def test_rows_from_columns_pads_ragged_columns(self):
        rows = sheet_roster.rows_from_columns("T", [["https://a/1"], ["https://a/2"], ["not a url"]],
                                              [["active"]], [["Rigger"], ["Welder"]])
        assert [(r["row"], r["url"], r["status"], r["title"]) for r in rows] == \
               [(2, "https://a/1", "active", "Rigger"), (3, "https://a/2", "", "Welder")]

    def test_backup_tabs_skipped(self):
        assert sheet_roster.is_skipped_tab("TechnipFMC (backup 2026-09-01)")
        assert not sheet_roster.is_skipped_tab("TechnipFMC")

    def test_quote_tab(self):
        assert sheet_roster.quote_tab("O'Neil") == "'O''Neil'"


class TestIndexAndSelection:
    def _technip_rows(self):
        # 1,822 active rows but only 351 distinct URLs, the Sep 24 shape
        rows = []
        for i in range(1822):
            rows.append({"tab": "TechnipFMC", "row": i + 2, "url": f"https://careers.technipfmc.com/job/{i % 351}/",
                         "status": "active", "title": f"Job {i % 351}"})
        rows.append({"tab": "TechnipFMC", "row": 9999, "url": "https://careers.technipfmc.com/job/gone/",
                     "status": "removed", "title": "x"})
        return rows

    def test_dedupes_by_url_and_ignores_non_active(self):
        idx = sheet_roster.build_active_index(self._technip_rows())
        assert len(idx) == 351
        assert "https://careers.technipfmc.com/job/gone/" not in idx
        assert sum(e["rows"] for e in idx.values()) == 1822

    def test_same_url_in_two_tabs_keeps_both_tabs(self):
        idx = sheet_roster.build_active_index([
            {"tab": "Shell", "row": 2, "url": "https://x/1", "status": "active", "title": "A"},
            {"tab": "Aggregator - shell", "row": 7, "url": "https://x/1", "status": "Active", "title": ""},
        ])
        assert idx["https://x/1"]["tabs"] == {"Shell", "Aggregator - shell"}

    def test_select_skips_db_active_and_excluded_hosts(self):
        idx = sheet_roster.build_active_index([
            {"tab": "A", "row": 2, "url": "https://a.com/1", "status": "active", "title": "t"},
            {"tab": "A", "row": 3, "url": "https://a.com/2", "status": "active", "title": "t"},
            {"tab": "Agg", "row": 2, "url": "https://www.indeed.com/viewjob?jk=1", "status": "active", "title": "t"},
        ])
        rows, stats = sheet_roster.select_sheet_only(idx, {"https://a.com/1"}, {}, _h, liveness.is_excluded_host)
        assert [r["url"] for r in rows] == ["https://a.com/2"]
        assert stats["already_db_active"] == 1 and stats["excluded_host"] == 1 and stats["selected"] == 1
        assert rows[0]["sheet_only"] and rows[0]["tabs"] == {"A"} and rows[0]["url_hash"] == _h("https://a.com/2")

    def test_per_host_cap_rotates_least_recently_checked_first(self):
        idx = sheet_roster.build_active_index(self._technip_rows())
        checked = {_h(f"https://careers.technipfmc.com/job/{i}/"): "2026-09-20T00:00:00" for i in range(300)}
        rows, stats = sheet_roster.select_sheet_only(idx, set(), checked, _h, _no_exclusions, per_host_cap=100)
        assert len(rows) == 100 and stats["deferred"] == 251
        picked = {int(r["url"].rstrip("/").rsplit("/", 1)[1]) for r in rows}
        assert set(range(300, 351)) <= picked                               # the 51 never-checked come first

    def test_company_filter_matches_tab_or_company(self):
        idx = sheet_roster.build_active_index([
            {"tab": "TechnipFMC", "row": 2, "url": "https://t/1", "status": "active", "title": "a"},
            {"tab": "Worley", "row": 2, "url": "https://w/1", "status": "active", "title": "b"},
        ])
        rows, _ = sheet_roster.select_sheet_only(idx, set(), {}, _h, _no_exclusions, wanted={"TechnipFMC"})
        assert [r["url"] for r in rows] == ["https://t/1"]
        rows, _ = sheet_roster.select_sheet_only(idx, set(), {}, _h, _no_exclusions, wanted={"Worley Group"},
                                                 tab_company={"Worley": "Worley Group"})
        assert [r["url"] for r in rows] == ["https://w/1"] and rows[0]["company"] == "Worley Group"


class _WS:
    def __init__(self, title, rows):
        self.title, self.row_count = title, rows


class _FakeSpreadsheet:
    """values_batch_get over an in-memory {tab: [[cells]]} grid; can fail a batch once."""

    def __init__(self, grid, fail_multi_tab_batch=False):
        self.grid, self.fail = grid, fail_multi_tab_batch
        self.calls = []

    def worksheets(self):
        return [_WS(t, len(rows)) for t, rows in self.grid.items()]

    def values_batch_get(self, ranges):
        self.calls.append(list(ranges))
        tabs = {r.split("!")[0] for r in ranges}
        if self.fail and len(tabs) > 1 and not all(r.endswith("!1:1") for r in ranges):
            raise APIError(_Resp())
        out = []
        for r in ranges:
            tab, a1 = r.split("!")
            tab = tab[1:-1].replace("''", "'")
            rows = self.grid[tab]
            if a1 == "1:1":
                out.append({"values": [rows[0]]})
                continue
            col = ord(a1[0]) - ord("A")
            out.append({"values": [[row[col]] if col < len(row) else [] for row in rows[1:]]})
        return {"valueRanges": out}


class _Resp:
    status_code = 400
    text = '{"error": {"code": 400, "message": "Range exceeds grid limits", "status": "INVALID_ARGUMENT"}}'

    def json(self):
        return {"error": {"code": 400, "message": "Range exceeds grid limits", "status": "INVALID_ARGUMENT"}}


@pytest.fixture(autouse=False)
def fast(monkeypatch):
    monkeypatch.setattr(sheet_roster, "CHUNK_PAUSE", 0)


class TestReadSheetRows:
    GRID = {
        "TechnipFMC": [["Title", "Company", "URL", "Status"],
                       ["A", "T", "https://t/1", "active"], ["B", "T", "https://t/2", "removed"]],
        "Overview": [["Employer", "Active Jobs"], ["T", "1"]],
        "Aggregator - finnco": [["Title", "Company", "URL", "Status"]],                # header-only
        "TechnipFMC (backup 2026-09-01)": [["Title", "Company", "URL", "Status"], ["A", "T", "https://t/1", "active"]],
        "Worley": [["Title", "URL", "Employment Type", "Status"], ["W", "https://w/1", "Full-Time", "active"]],
    }

    def test_reads_only_job_tabs(self, fast):
        rows = sheet_roster.read_sheet_rows(_FakeSpreadsheet(self.GRID))
        assert {(r["tab"], r["url"], r["status"]) for r in rows} == {
            ("TechnipFMC", "https://t/1", "active"), ("TechnipFMC", "https://t/2", "removed"),
            ("Worley", "https://w/1", "active")}

    def test_batch_failure_falls_back_per_tab(self, fast):
        ss = _FakeSpreadsheet(self.GRID, fail_multi_tab_batch=True)
        rows = sheet_roster.read_sheet_rows(ss)
        assert {r["url"] for r in rows} == {"https://t/1", "https://t/2", "https://w/1"}


class TestTrackerSheetProbeLog:
    def test_upsert_and_read(self):
        with tempfile.TemporaryDirectory() as d:
            t = DeduplicationTracker(db_path=os.path.join(d, "s.db"))
            t.record_sheet_probe([(_h("https://a/1"), "https://a/1", "DEAD", "marker: has been filled")],
                                 checked_at="2026-09-24T19:00:00")
            t.record_sheet_probe([(_h("https://a/1"), "https://a/1", "LIVE", "jsonld")], checked_at="2026-09-25T03:00:00")
            assert t.get_sheet_probe_checked() == {_h("https://a/1"): "2026-09-25T03:00:00"}
            row = t.conn.execute("SELECT status FROM sheet_probe_log").fetchone()
            assert row["status"] == "LIVE"
            t.close()
