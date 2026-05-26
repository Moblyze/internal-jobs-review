"""Tests for contract-demand producer — matched-company detail persistence.

Run from scrapers/:  python3 -m pytest test_contract_demand_producer.py -q
"""
from unittest.mock import MagicMock


def _demand(count, titles, sources, countries=("GB",)):
    return {
        "count": count,
        "titles": list(titles),
        "countries": set(countries),
        "sources": set(sources),
    }


def test_match_aggregates_count_sources_and_titles_for_matched():
    import contract_demand_producer as m
    demand = {
        "Boskalis": _demand(40, ["ROV Pilot", "Diver"], ["atlas"]),
        "Boskalis Subsea": _demand(5, ["Surveyor"], ["rovplanet"]),  # prefix → same company
    }
    companies = [{"company_id": "boskalis-com", "legal_name": "Boskalis",
                  "common_name": "Boskalis"}]
    matches, detail, unmatched, log = m.match_demand_to_companies(demand, companies)
    assert matches["boskalis-com"] == 45                      # 40 + 5 aggregated
    d = detail["boskalis-com"]
    assert {"atlas", "rovplanet"} <= d["sources"]
    assert "ROV Pilot" in d["titles"]
    assert len(d["titles"]) <= 3


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
