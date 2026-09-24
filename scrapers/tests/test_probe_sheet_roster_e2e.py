#!/usr/bin/env python3
"""probe_liveness.main() end to end with the sheet roster (fake sheet, fake prober).

Checks: sheet-only dead URLs retire in every tab they are active in, LIVE and
UNKNOWN rows are never touched, a status snapshot is written before writes.

Run with: python -m pytest tests/test_probe_sheet_roster_e2e.py -v
"""

import csv
import glob
import hashlib
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts'))

import probe_liveness  # noqa: E402
from src.utils import liveness, sheet_roster  # noqa: E402
from src.utils.deduplication import DeduplicationTracker  # noqa: E402

HDR = ["Title", "Company", "URL", "Status", "Status Changed Date"]


def _h(u):
    return hashlib.sha256(u.encode()).hexdigest()


class _WS:
    def __init__(self, title, grid):
        self.title, self.grid = title, grid

    @property
    def row_count(self):
        return len(self.grid[self.title])

    def row_values(self, n):
        return self.grid[self.title][n - 1]

    def col_values(self, c):
        return [r[c - 1] if c - 1 < len(r) else "" for r in self.grid[self.title]]

    def batch_update(self, updates, value_input_option=None):
        for u in updates:
            a1 = u["range"]
            col, row = ord(a1[0]) - ord("A"), int(a1[1:])
            r = self.grid[self.title][row - 1]
            while len(r) <= col:
                r.append("")
            r[col] = u["values"][0][0]


class _Sheet:
    def __init__(self, grid):
        self.grid = grid

    def worksheets(self):
        return [_WS(t, self.grid) for t in self.grid]

    def worksheet(self, title):
        return _WS(title, self.grid)

    def values_batch_get(self, ranges):
        out = []
        for r in ranges:
            tab, a1 = r.split("!")
            rows = self.grid[tab[1:-1].replace("''", "'")]
            if a1 == "1:1":
                out.append({"values": [rows[0]]})
            else:
                col = ord(a1[0]) - ord("A")
                out.append({"values": [[row[col]] if col < len(row) else [] for row in rows[1:]]})
        return {"valueRanges": out}


VERDICTS = {
    "https://careers.technipfmc.com/job/1/": liveness.Verdict(liveness.DEAD, "marker: position has been filled"),
    "https://careers.technipfmc.com/job/2/": liveness.Verdict(liveness.LIVE, "title on page"),
    "https://careers.technipfmc.com/job/3/": liveness.Verdict(liveness.UNKNOWN, "error: ReadTimeout"),
    "https://db.example.com/job/9/": liveness.Verdict(liveness.LIVE, "jsonld JobPosting"),
}


class _Prober:
    requests_made = 0

    def __init__(self, *a, **k):
        pass

    def probe(self, url, title=None, platform=None):
        return VERDICTS[url]


@pytest.fixture
def env(tmp_path, monkeypatch):
    grid = {
        "TechnipFMC": [HDR,
                       ["A", "T", "https://careers.technipfmc.com/job/1/", "active", ""],
                       ["A", "T", "https://careers.technipfmc.com/job/1/", "active", ""],   # duplicate row
                       ["B", "T", "https://careers.technipfmc.com/job/2/", "active", ""],
                       ["C", "T", "https://careers.technipfmc.com/job/3/", "active", ""]],
        "Aggregator - subsea": [HDR, ["A", "TechnipFMC", "https://careers.technipfmc.com/job/1/", "active", ""]],
        "Acme": [HDR, ["Z", "Acme", "https://db.example.com/job/9/", "active", ""]],
    }
    db = str(tmp_path / "state.db")
    t = DeduplicationTracker(db_path=db)
    t.conn.execute(
        "INSERT INTO scraped_jobs (url_hash, url, company, title, first_seen, last_seen, status, exported_to_sheets) "
        "VALUES (?, ?, 'Acme', 'Z', '2026-01-01', '2026-01-01', 'active', 1)",
        (_h("https://db.example.com/job/9/"), "https://db.example.com/job/9/"))
    t.conn.commit()
    t.close()
    cfg = tmp_path / "companies.yaml"
    cfg.write_text("companies:\n  acme: {name: Acme, sheet_name: Acme}\n  tfmc: {name: TechnipFMC, sheet_name: TechnipFMC}\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(probe_liveness, "open_spreadsheet", lambda: _Sheet(grid))
    monkeypatch.setattr(liveness, "LivenessProber", _Prober)
    monkeypatch.setattr(sheet_roster, "CHUNK_PAUSE", 0)
    monkeypatch.setattr(probe_liveness.time, "sleep", lambda *_a: None)
    monkeypatch.delenv("SLACK_MONITORING_WEBHOOK", raising=False)
    return grid, db, str(cfg)


def _run(db, cfg, *extra):
    argv = ["probe_liveness.py", "--state-db", db, "--config", cfg, "--out", "data/out.json",
            "--osm-snapshot", "data/none.json", *extra]
    old = sys.argv
    sys.argv = argv
    try:
        return probe_liveness.main()
    finally:
        sys.argv = old


def test_sheet_only_dead_retires_everywhere_live_and_unknown_untouched(env):
    grid, db, cfg = env
    assert _run(db, cfg) == 0
    status = {(t, r[2]): r[3] for t, rows in grid.items() for r in rows[1:]}
    assert status[("TechnipFMC", "https://careers.technipfmc.com/job/1/")] == "removed"
    assert [r[3] for r in grid["TechnipFMC"][1:3]] == ["removed", "removed"]          # both duplicate rows
    assert status[("Aggregator - subsea", "https://careers.technipfmc.com/job/1/")] == "removed"
    assert status[("TechnipFMC", "https://careers.technipfmc.com/job/2/")] == "active"   # LIVE never retired
    assert status[("TechnipFMC", "https://careers.technipfmc.com/job/3/")] == "active"   # UNKNOWN never retired
    assert status[("Acme", "https://db.example.com/job/9/")] == "active"

    snap = glob.glob("data/sheet-status-snapshot-*.csv")
    assert len(snap) == 1
    with open(snap[0]) as f:
        recs = list(csv.DictReader(f))
    assert sum(1 for r in recs if r["status"] == "active") == 6                       # pre-write state
    out = json.load(open("data/out.json"))["rows"]
    assert out["https://careers.technipfmc.com/job/1/"].get("removed") is True
    assert "removed" not in out["https://careers.technipfmc.com/job/2/"]

    t = DeduplicationTracker(db_path=db)
    assert len(t.get_sheet_probe_checked()) == 3          # the 3 sheet-only URLs, deduped
    t.close()


def test_dry_run_writes_nothing_to_the_sheet(env):
    grid, db, cfg = env
    assert _run(db, cfg, "--dry-run") == 0
    assert all(r[3] == "active" for rows in grid.values() for r in rows[1:])


def test_no_sheet_roster_flag_probes_db_rows_only(env):
    grid, db, cfg = env
    assert _run(db, cfg, "--no-sheet-roster") == 0
    assert all(r[3] == "active" for rows in grid.values() for r in rows[1:])


def test_sheet_roster_only_skips_db_rows(env, monkeypatch):
    grid, db, cfg = env
    seen = []
    orig = _Prober.probe
    monkeypatch.setattr(_Prober, "probe", lambda self, url, **k: (seen.append(url), orig(self, url))[1])
    assert _run(db, cfg, "--sheet-roster-only") == 0
    assert "https://db.example.com/job/9/" not in seen
    assert grid["TechnipFMC"][1][3] == "removed"


def test_merge_out_keeps_previous_verdicts(env):
    grid, db, cfg = env
    os.makedirs("data", exist_ok=True)
    with open("data/prev.json", "w") as f:
        json.dump({"rows": {"https://other.example.com/1": {"s": "LIVE"},
                            "https://careers.technipfmc.com/job/2/": {"s": "UNKNOWN"}}}, f)
    assert _run(db, cfg, "--sheet-roster-only", "--merge-out", "data/prev.json") == 0
    rows = json.load(open("data/out.json"))["rows"]
    assert rows["https://other.example.com/1"]["s"] == "LIVE"                  # kept
    assert rows["https://careers.technipfmc.com/job/2/"]["s"] == "LIVE"        # this run wins
