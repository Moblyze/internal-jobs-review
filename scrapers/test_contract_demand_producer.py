"""Tests for contract-demand producer — matched-company detail persistence.

Run from scrapers/:  python3 -m pytest test_contract_demand_producer.py -q
"""
from collections import defaultdict
from unittest.mock import MagicMock


def _demand(count, titles, sources, countries=("GB",), jobs=None):
    return {
        "count": count,
        "titles": list(titles),
        "countries": set(countries),
        "sources": set(sources),
        "jobs": list(jobs) if jobs is not None else [],
    }


def test_match_aggregates_count_sources_and_titles_for_matched():
    import contract_demand_producer as m
    demand = {
        "Boskalis": _demand(40, ["ROV Pilot", "Diver"], ["atlas"]),
        "Boskalis Subsea": _demand(5, ["Surveyor"], ["rovplanet"]),  # prefix → same company
    }
    companies = [{"company_id": "boskalis-com", "legal_name": "Boskalis",
                  "common_name": "Boskalis"}]
    matches, detail, unmatched, log, operator_to_company = m.match_demand_to_companies(
        demand, companies)
    assert matches["boskalis-com"] == 45                      # 40 + 5 aggregated
    d = detail["boskalis-com"]
    assert {"atlas", "rovplanet"} <= d["sources"]
    assert "ROV Pilot" in d["titles"]
    assert len(d["titles"]) <= 3
    assert operator_to_company == {"Boskalis": "boskalis-com",
                                   "Boskalis Subsea": "boskalis-com"}


def test_write_demand_detail_writes_source_and_roles_columns():
    import contract_demand_producer as m
    ws = MagicMock()
    ws.get_all_values.return_value = [
        ["company_id", "active_contract_demand",
         "contract_demand_sources", "contract_demand_sample_roles"],
        ["boskalis-com", "45", "", ""],
        ["other-com", "0", "", ""],
    ]
    detail = {"boskalis-com": {"sources": {"atlas", "rovplanet"},
                               "titles": ["ROV Pilot", "Diver"]}}
    n = m.write_demand_detail(ws, detail)
    assert n == 2                       # two cells for the one matched row
    ws.update_cells.assert_called_once()


def test_write_demand_detail_noop_when_columns_absent():
    import contract_demand_producer as m
    ws = MagicMock()
    ws.get_all_values.return_value = [["company_id", "active_contract_demand"],
                                      ["boskalis-com", "45"]]
    out = m.write_demand_detail(ws, {"boskalis-com": {"sources": {"atlas"},
                                                      "titles": ["ROV"]}})
    assert out == 0
    ws.update_cells.assert_not_called()


def test_add_appends_per_job_entries():
    import contract_demand_producer as m
    demand = defaultdict(m._new_demand_entry)
    m._add(demand, "Boskalis", "ROV Pilot", "GB", "atlas")
    m._add(demand, "Boskalis", "Diver", "NO", "rovplanet")
    jobs = demand["Boskalis"]["jobs"]
    assert jobs == [
        {"title": "ROV Pilot", "country": "GB", "source": "atlas"},
        {"title": "Diver", "country": "NO", "source": "rovplanet"},
    ]
    # aggregate fields still populated
    assert demand["Boskalis"]["count"] == 2
    assert demand["Boskalis"]["sources"] == {"atlas", "rovplanet"}


def _make_ss_mock(existing_tabs=()):
    """Build a fake gspread Spreadsheet with optional pre-existing tabs."""
    ss = MagicMock()
    worksheets = []
    by_title = {}
    for title in existing_tabs:
        ws = MagicMock()
        ws.title = title
        worksheets.append(ws)
        by_title[title] = ws
    ss.worksheets.return_value = worksheets
    ss.worksheet.side_effect = lambda t: by_title[t]
    # add_worksheet returns a new mock ws and registers it
    def _add_ws(title, rows, cols):
        ws = MagicMock()
        ws.title = title
        worksheets.append(ws)
        by_title[title] = ws
        return ws
    ss.add_worksheet.side_effect = _add_ws
    return ss, by_title


def test_write_job_matches_tab_creates_tab_and_writes_matched_rows_only():
    import contract_demand_producer as m
    demand = {
        "Boskalis": _demand(2, ["ROV Pilot", "Diver"], ["atlas", "rovplanet"],
                            jobs=[{"title": "ROV Pilot", "country": "GB", "source": "atlas"},
                                  {"title": "Diver", "country": "NO", "source": "rovplanet"}]),
        "Unmatched Operator": _demand(1, ["Welder"], ["underwaterjobs"],
                                      jobs=[{"title": "Welder", "country": "US",
                                             "source": "underwaterjobs"}]),
    }
    operator_to_company = {"Boskalis": "boskalis-com"}
    ss, by_title = _make_ss_mock(existing_tabs=())  # tab doesn't exist yet
    n = m.write_job_matches_tab(ss, demand, operator_to_company)
    assert n == 2  # only matched operator's two jobs
    ss.add_worksheet.assert_called_once()
    ws = by_title[m.JOB_MATCHES_TAB]
    # Header written
    ws.update.assert_called_once()
    header_call = ws.update.call_args
    assert header_call.kwargs["values"] == [m.JOB_MATCHES_HEADERS]
    # Rows appended
    ws.append_rows.assert_called_once()
    rows = ws.append_rows.call_args.args[0]
    assert len(rows) == 2
    # Column order + content (look up by header to survive future reordering)
    idx = {h: i for i, h in enumerate(m.JOB_MATCHES_HEADERS)}
    titles_seen = [r[idx["title"]] for r in rows]
    operators_seen = {r[idx["operator"]] for r in rows}
    sources_seen = [r[idx["source"]] for r in rows]
    assert operators_seen == {"Boskalis"}
    assert "ROV Pilot" in titles_seen and "Diver" in titles_seen
    assert "atlas" in sources_seen and "rovplanet" in sources_seen
    assert all(r[idx["company_id"]] == "boskalis-com" for r in rows)
    # selected checkbox defaults FALSE
    assert all(r[idx["selected"]] is False for r in rows)
    # count/match_basis cols left blank
    blank_cols = ("broad_count", "tight_count", "match_basis", "last_match_run_at")
    for r in rows:
        for c in blank_cols:
            assert r[idx[c]] == ""
    # job_id is 16 hex chars and stable per (source,operator,title,country)
    for r in rows:
        j = r[idx["job_id"]]
        assert len(j) == 16 and all(c in "0123456789abcdef" for c in j)


def test_write_job_matches_tab_replaces_existing_tab_on_subsequent_run():
    import contract_demand_producer as m
    demand = {
        "Boskalis": _demand(1, ["ROV Pilot"], ["atlas"],
                            jobs=[{"title": "ROV Pilot", "country": "GB", "source": "atlas"}]),
    }
    ss, by_title = _make_ss_mock(existing_tabs=(m.JOB_MATCHES_TAB,))
    n = m.write_job_matches_tab(ss, demand, {"Boskalis": "boskalis-com"})
    assert n == 1
    ws = by_title[m.JOB_MATCHES_TAB]
    ws.clear.assert_called_once()
    ss.add_worksheet.assert_not_called()
    ws.update.assert_called_once()  # header re-written
    ws.append_rows.assert_called_once()


def test_write_job_matches_tab_empty_when_no_matches():
    import contract_demand_producer as m
    demand = {"Unmatched": _demand(1, ["X"], ["atlas"],
                                   jobs=[{"title": "X", "country": "", "source": "atlas"}])}
    ss, by_title = _make_ss_mock(existing_tabs=())
    n = m.write_job_matches_tab(ss, demand, operator_to_company={})
    assert n == 0
    ws = by_title[m.JOB_MATCHES_TAB]
    ws.update.assert_called_once()  # headers still written
    ws.append_rows.assert_not_called()
    # Header notes still attached (they describe the schema, independent of data).
    # No data rows → no checkbox validation request.
    requests = ss.batch_update.call_args.args[0]["requests"]
    assert not any("setDataValidation" in r for r in requests)


def test_write_job_matches_tab_applies_checkbox_validation_to_selected_column():
    import contract_demand_producer as m
    demand = {
        "Boskalis": _demand(1, ["ROV Pilot"], ["atlas"],
                            jobs=[{"title": "ROV Pilot", "country": "GB", "source": "atlas"}]),
    }
    ss, _ = _make_ss_mock(existing_tabs=())
    n = m.write_job_matches_tab(ss, demand, {"Boskalis": "boskalis-com"})
    assert n == 1
    ss.batch_update.assert_called_once()
    requests = ss.batch_update.call_args.args[0]["requests"]
    # Find the checkbox validation request (regardless of position).
    dv = next(r["setDataValidation"] for r in requests if "setDataValidation" in r)
    assert dv["rule"]["condition"]["type"] == "BOOLEAN"
    assert dv["range"]["startColumnIndex"] == m.SELECTED_COL_INDEX
    assert dv["range"]["endColumnIndex"] == m.SELECTED_COL_INDEX + 1
    assert dv["range"]["startRowIndex"] == 1  # skip header
    assert dv["range"]["endRowIndex"] == 2    # one data row


def test_write_job_matches_tab_attaches_header_notes_for_count_columns():
    import contract_demand_producer as m
    demand = {
        "Boskalis": _demand(1, ["ROV Pilot"], ["atlas"],
                            jobs=[{"title": "ROV Pilot", "country": "GB", "source": "atlas"}]),
    }
    ss, _ = _make_ss_mock(existing_tabs=())
    m.write_job_matches_tab(ss, demand, {"Boskalis": "boskalis-com"})
    requests = ss.batch_update.call_args.args[0]["requests"]
    note_reqs = [r["repeatCell"] for r in requests if "repeatCell" in r]
    # One note per documented column (broad_count + tight_count).
    notes_by_col = {r["range"]["startColumnIndex"]: r["cell"]["note"] for r in note_reqs}
    broad_col = m.JOB_MATCHES_HEADERS.index("broad_count")
    tight_col = m.JOB_MATCHES_HEADERS.index("tight_count")
    assert broad_col in notes_by_col
    assert tight_col in notes_by_col
    # Notes are non-trivial English (≥ 50 chars).
    assert len(notes_by_col[broad_col]) > 50
    assert len(notes_by_col[tight_col]) > 50


def test_header_notes_always_written_even_with_no_matched_rows():
    """Notes describe the schema, so they should land on every producer run —
    even when no operators matched (the tab is created/cleared with headers
    but no data rows)."""
    import contract_demand_producer as m
    demand = {"Unmatched": _demand(1, ["X"], ["atlas"],
                                   jobs=[{"title": "X", "country": "", "source": "atlas"}])}
    ss, _ = _make_ss_mock(existing_tabs=())
    n = m.write_job_matches_tab(ss, demand, operator_to_company={})
    assert n == 0
    # batch_update is called for the header notes even though no data rows.
    ss.batch_update.assert_called_once()
    requests = ss.batch_update.call_args.args[0]["requests"]
    assert any("repeatCell" in r for r in requests)
    assert not any("setDataValidation" in r for r in requests)  # no rows → no checkbox range
