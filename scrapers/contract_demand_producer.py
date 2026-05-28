#!/usr/bin/env python3
"""Demand-intelligence producer (Workstream 3) — v2.

Extracts the END-EMPLOYER named on live CONTRACT postings, counts postings per
operator across sources, matches each operator to a target-clients Companies
row, and writes the integer ``active_contract_demand`` column the BD pipeline's
Phase 2 reads. Operators that match no target row are written to a
"Contract Demand Leads" tab as candidate NEW BD leads.

Sources (v2):
  - Atlas Professionals  — wp-json ``client-name`` taxonomy (names the operator)
  - ROVPlanet            — subsea/ROV trade board (poster = employer)
  - UnderwaterJobs       — commercial-diving trade board (poster = employer)
  (Petroplan/TXM deferred — currently near-empty.)

Data contract (agreed with the BD session):
  - ``active_contract_demand`` is an INTEGER on each Companies row = count of
    live contract postings attributed to that operator. Phase 2 log-scales it.
  - Phase 2 reads it at weight 0, so the write is INERT until the BD session
    tunes the weight. We write ONLY this column (no schema change).

Usage:
  python3 contract_demand_producer.py            # dry-run: fetch + match + print, NO write
  python3 contract_demand_producer.py --commit    # write the column + the leads tab
"""

import argparse
import hashlib
import html
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials

from src.aggregators.base import AggregatorFilters
from src.aggregators.atlasprofessionals_adapter import (
    AtlasProfessionalsAggregator,
    _clean_client_name,
    _extract_embedded_terms,
)
from src.aggregators.rovplanet_adapter import ROVPlanetAggregator
from src.aggregators.underwaterjobs_adapter import UnderwaterJobsAggregator

TARGET_SHEET_ID = "1fIW4JxCNTQDT5J8g7bgPDK0lUYo0WF8Yfgras6GVem4"
COMPANIES_TAB = "Companies"
LEADS_TAB = "Contract Demand Leads"
JOB_MATCHES_TAB = "Contract Job Matches"
JOB_MATCHES_HEADERS = [
    "selected", "job_id", "company_id", "operator", "title", "country", "source",
    "scraped_at", "broad_count", "tight_count", "unknown_geo_count",
    "match_basis", "last_match_run_at",
]
SELECTED_COL_INDEX = JOB_MATCHES_HEADERS.index("selected")  # 0-based

# Sales-facing notes that appear when you hover the column header.
JOB_MATCHES_HEADER_NOTES = {
    "broad_count": (
        "Candidates matching this job's role AND region (tier1/tier2).\n\n"
        "• App users (selected role, country known via app profile or Bullhorn ATS)\n"
        "• External pool (PDL + Bullhorn, role + region match)\n"
        "• No certification required\n\n"
        "Use as the headline 'top of funnel' outreach number."
    ),
    "tight_count": (
        "Subset of broad_count.\n\n"
        "• Moblyze APP users only\n"
        "• Role match + region match + holds ≥1 of role's required certs\n"
        "• External pool excluded (no structured cert data)\n\n"
        "Use when the prospect asks 'how many are already certified?'"
    ),
    "unknown_geo_count": (
        "Additional app users who match the role but we don't know where "
        "they live.\n\n"
        "• Not counted in broad_count or tight_count (no country signal)\n"
        "• Could be anywhere — possibly in the right region\n\n"
        "Use as 'plus more we could reach out to' upside in outreach."
    ),
}
DEMAND_COLUMN = "active_contract_demand"
DEMAND_SOURCES_COLUMN = "contract_demand_sources"
DEMAND_ROLES_COLUMN = "contract_demand_sample_roles"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

SUBSEA_KEYWORDS = [
    "ROV", "subsea", "diver", "diving", "saturation", "inspection",
    "offshore", "marine", "IRM", "rope access", "IRATA", "survey",
]

# Operators to drop: the agency naming itself + junk/placeholder values.
_EXCLUDE_OPERATORS = {
    "atlas professionals", "atlas nextwave", "atlas next wave", "unknown",
    "n/a", "na", "tbc", "tba", "various", "confidential", "client", "-", "wind",
}

# Tokens stripped when computing a company's "core" identity for matching.
_CORE_STOPWORDS = {
    "ltd", "limited", "inc", "llc", "plc", "corp", "corporation", "company", "co",
    "group", "holdings", "holding", "international", "intl", "services", "service",
    "offshore", "marine", "subsea", "energy", "oil", "gas", "drilling", "technologies",
    "technology", "solutions", "systems", "do", "brasil", "internacional", "of", "the",
    "and", "sa", "spa", "bv", "nv", "as", "asa", "gmbh", "pte", "eireli", "member",
}


def _normalize(s) -> str:
    return " ".join((s or "").lower().split())


def _core(name: str) -> frozenset:
    """Identity tokens after stripping parentheticals + legal/industry stopwords.
    'Noble Drilling' and 'Noble Corporation' both reduce to {'noble'}."""
    n = re.sub(r"\(.*?\)", " ", (name or "").lower())
    n = re.sub(r"[^a-z0-9 ]+", " ", n)
    return frozenset(t for t in n.split() if t and t not in _CORE_STOPWORDS)


def _name_identifies(a_norm: str, b_norm: str) -> bool:
    """Exact, or one name is a leading whole-token prefix of the other."""
    if not a_norm or not b_norm:
        return False
    if a_norm == b_norm:
        return True
    for x, y in ((a_norm, b_norm), (b_norm, a_norm)):
        if x.startswith(y + " ") or x.startswith(y + ","):
            return True
    return False


def _clean_operator(raw: str) -> str:
    return html.unescape(_clean_client_name(raw or "")).strip().strip("-").strip()


def _is_excludable(name: str) -> bool:
    n = name.lower().strip()
    return (
        not n
        or n in _EXCLUDE_OPERATORS
        or n.startswith("atlas next")
        or n.startswith("atlas professional")
    )


def _new_demand_entry():
    return {"count": 0, "titles": [], "countries": set(), "sources": set(), "jobs": []}


def _add(demand, operator, title, country, source):
    d = demand[operator]
    d["count"] += 1
    if title and len(d["titles"]) < 3:
        d["titles"].append(title)
    if country:
        d["countries"].add(country)
    d["sources"].add(source)
    d["jobs"].append({"title": title or "", "country": country or "", "source": source})


def _job_id(source: str, operator: str, title: str, country: str) -> str:
    raw = f"{source}|{operator}|{title}|{country}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def fetch_atlas_demand(demand, max_pages=10):
    agg = AtlasProfessionalsAggregator()
    page, total, seen = 1, None, 0
    while page <= max_pages:
        jobs = None
        for attempt in range(3):  # tolerate transient server disconnects
            try:
                jobs, total = agg._fetch_page(page=page, use_category_filter=True)
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    print(f"  [atlas] page {page} failed 3x ({e}); stopping with {seen} jobs collected.")
        if not jobs:
            break
        for job in jobs:
            terms = _extract_embedded_terms(job)
            clients = terms.get("client-name") or []
            if not clients:
                continue
            operator = _clean_operator(clients[0])
            if _is_excludable(operator):
                continue
            title = job.get("title")
            title = title.get("rendered", "") if isinstance(title, dict) else str(title or "")
            countries = terms.get("country") or [""]
            _add(demand, operator, title, countries[0], "atlas")
        seen += len(jobs)
        if total is not None and seen >= total:
            break
        page += 1


def _result_field(r, key):
    if isinstance(r, dict):
        return r.get(key, "")
    return getattr(r, key, "") or ""


def fetch_tradeboard_demand(demand, adapter_cls, source):
    """Trade boards: poster = employer. Use the result's company as the operator."""
    filters = AggregatorFilters(
        keywords=SUBSEA_KEYWORDS, job_types=["contract", "temporary"],
        countries=["us", "gb", "no"], max_results=200,
    )
    try:
        results = adapter_cls().search(filters) or []
    except Exception as e:  # noqa: BLE001 - one bad board shouldn't sink the run
        print(f"  [{source}] failed: {e}")
        return
    for r in results:
        operator = _clean_operator(str(_result_field(r, "company")))
        if _is_excludable(operator):
            continue
        _add(demand, operator, str(_result_field(r, "title")),
             str(_result_field(r, "location")), source)


def collect_demand() -> dict:
    demand = defaultdict(_new_demand_entry)
    fetch_atlas_demand(demand)
    fetch_tradeboard_demand(demand, ROVPlanetAggregator, "rovplanet")
    fetch_tradeboard_demand(demand, UnderwaterJobsAggregator, "underwaterjobs")
    return demand


def _gspread_client() -> gspread.Client:
    sa = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
    if sa:
        info = json.loads(sa) if sa.lstrip().startswith("{") else json.load(open(os.path.expanduser(sa)))
        return gspread.authorize(Credentials.from_service_account_info(info, scopes=SCOPES))
    for p in (os.environ.get("GOOGLE_SERVICE_ACCOUNT_PATH"), str(Path.home() / ".config" / "gspread" / "service_account.json")):
        if p and Path(os.path.expanduser(p)).exists():
            return gspread.authorize(Credentials.from_service_account_file(os.path.expanduser(p), scopes=SCOPES))
    raise RuntimeError("No Google service-account credentials with target-clients access")


def match_demand_to_companies(demand: dict, companies: list[dict]):
    """Return (matches {company_id: count}, detail {company_id: {sources, titles}},
    unmatched [(operator, info)], log).

    Match order (precision-first): exact normalized name → whole-token prefix →
    core-token-set equality (catches 'Noble Drilling' ↔ 'Noble Corporation').
    `detail` aggregates the source boards + up to 3 sample role titles across every
    operator that maps to a company — the sales-facing verification trail."""
    idx = []  # (norm_name, core, company_id, display)
    for row in companies:
        cid = row.get("company_id")
        if not cid:
            continue
        for key in (row.get("legal_name"), row.get("common_name")):
            if key and key.strip():
                idx.append((_normalize(key), _core(key), cid, row.get("legal_name") or row.get("common_name")))

    matches, detail, log, unmatched, operator_to_company = {}, {}, [], [], {}
    for operator, info in sorted(demand.items(), key=lambda kv: -kv[1]["count"]):
        op_norm, op_core = _normalize(operator), _core(operator)
        hit = next(((c, d) for n, _co, c, d in idx if n == op_norm), None)
        method = "exact"
        if hit is None:
            hit = next(((c, d) for n, _co, c, d in idx if _name_identifies(n, op_norm)), None)
            method = "prefix"
        if hit is None and op_core:
            hit = next(((c, d) for _n, co, c, d in idx if co and co == op_core), None)
            method = "core"
        if hit:
            cid, disp = hit
            matches[cid] = matches.get(cid, 0) + info["count"]
            operator_to_company[operator] = cid
            d = detail.setdefault(cid, {"sources": set(), "titles": []})
            d["sources"].update(info["sources"])
            for t in info["titles"]:
                if t and t not in d["titles"] and len(d["titles"]) < 3:
                    d["titles"].append(t)
            log.append((operator, info["count"], disp, method))
        else:
            unmatched.append((operator, info))
    return matches, detail, unmatched, log, operator_to_company


def write_demand(ws, matches: dict) -> int:
    all_values = ws.get_all_values()
    headers = all_values[0] if all_values else []
    if DEMAND_COLUMN not in headers or "company_id" not in headers:
        raise RuntimeError(f"Companies tab missing 'company_id'/'{DEMAND_COLUMN}'. Has BD run its schema migration?")
    acd_col, id_col = headers.index(DEMAND_COLUMN), headers.index("company_id")
    cells = [
        gspread.Cell(row=r, col=acd_col + 1, value=matches[row[id_col]])
        for r, row in enumerate(all_values[1:], start=2)
        if id_col < len(row) and row[id_col] in matches
    ]
    if cells:
        ws.update_cells(cells, value_input_option="RAW")
    return len(cells)


def write_demand_detail(ws, detail: dict) -> int:
    """Write source + sample-role columns for MATCHED companies (sales verification trail).

    Back-compatible: silently no-ops on either column missing from the Companies
    header, so it runs safely before the BD schema migration adds them. Returns the
    number of cells written."""
    all_values = ws.get_all_values()
    headers = all_values[0] if all_values else []
    if "company_id" not in headers:
        return 0
    id_col = headers.index("company_id")
    targets = {name: headers.index(name) for name in
               (DEMAND_SOURCES_COLUMN, DEMAND_ROLES_COLUMN) if name in headers}
    if not targets:
        return 0  # columns not added to the sheet yet — no-op
    cells = []
    for r, row in enumerate(all_values[1:], start=2):
        if id_col >= len(row):
            continue
        d = detail.get(row[id_col])
        if not d:
            continue
        if DEMAND_SOURCES_COLUMN in targets:
            cells.append(gspread.Cell(row=r, col=targets[DEMAND_SOURCES_COLUMN] + 1,
                                      value=", ".join(sorted(d["sources"]))))
        if DEMAND_ROLES_COLUMN in targets:
            cells.append(gspread.Cell(row=r, col=targets[DEMAND_ROLES_COLUMN] + 1,
                                      value="; ".join(d["titles"])))
    if cells:
        ws.update_cells(cells, value_input_option="RAW")
    return len(cells)


def write_leads_tab(ss, unmatched: list) -> int:
    headers = ["operator", "contract_postings", "sample_roles", "countries", "sources"]
    rows = [[
        op, info["count"], "; ".join(info["titles"]),
        ", ".join(sorted(info["countries"])), ", ".join(sorted(info["sources"])),
    ] for op, info in sorted(unmatched, key=lambda x: -x[1]["count"])]
    titles = {ws.title for ws in ss.worksheets()}
    if LEADS_TAB in titles:
        ws = ss.worksheet(LEADS_TAB)
        ws.clear()
    else:
        ws = ss.add_worksheet(LEADS_TAB, rows=max(len(rows) + 10, 50), cols=len(headers))
    ws.update(range_name="A1", values=[headers])
    if rows:
        ws.append_rows(rows, value_input_option="RAW")
    return len(rows)


PRESERVED_COUNT_COLUMNS = (
    "broad_count", "tight_count", "unknown_geo_count",
    "match_basis", "last_match_run_at",
)


def write_job_matches_tab(ss, demand: dict, operator_to_company: dict) -> int:
    """Write one row per job for each matched operator to the 'Contract Job Matches' tab.

    Counts persist across runs: if a job_id (sha1 of source+operator+title+country)
    appears in both the existing tab AND the current scrape, the existing
    broad_count/tight_count/match_basis/last_match_run_at are preserved so sales'
    work isn't lost. New jobs get blank counts (need a match-workflow run). Jobs
    that drop out of the current scrape are removed. The `selected` checkbox is
    always reset to FALSE — it's a transient trigger, not persistent state."""
    # 'YYYY-MM-DD HH:MM:SS' (UTC) is auto-parsed as a datetime by Google Sheets
    # when written with USER_ENTERED, so cells can be re-formatted in the UI.
    scraped_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    # Read existing counts (keyed by job_id) before we clear the tab.
    titles = {ws.title for ws in ss.worksheets()}
    existing_counts: dict[str, dict] = {}
    if JOB_MATCHES_TAB in titles:
        ws = ss.worksheet(JOB_MATCHES_TAB)
        for rec in ws.get_all_records():
            jid = str(rec.get("job_id") or "").strip()
            if jid:
                existing_counts[jid] = {
                    col: rec.get(col, "") for col in PRESERVED_COUNT_COLUMNS
                }
        ws.clear()
    else:
        ws = None  # created below once we know the row count

    rows = []
    for operator, info in demand.items():
        cid = operator_to_company.get(operator)
        if not cid:
            continue
        for job in info.get("jobs", []):
            title = job.get("title", "")
            country = job.get("country", "")
            source = job.get("source", "")
            jid = _job_id(source, operator, title, country)
            prev = existing_counts.get(jid, {})
            rows.append([
                False,  # 'selected' checkbox — always reset; transient trigger
                jid, cid, operator, title, country, source, scraped_at,
                prev.get("broad_count", ""),
                prev.get("tight_count", ""),
                prev.get("unknown_geo_count", ""),
                prev.get("match_basis", ""),
                prev.get("last_match_run_at", ""),
            ])

    if ws is None:
        ws = ss.add_worksheet(JOB_MATCHES_TAB, rows=max(len(rows) + 10, 50),
                              cols=len(JOB_MATCHES_HEADERS))
    ws.update(range_name="A1", values=[JOB_MATCHES_HEADERS])
    if rows:
        ws.append_rows(rows, value_input_option="USER_ENTERED")
    # Render the 'selected' column as a checkbox via a BOOLEAN data-validation
    # rule on data rows (row 2 onwards). Sales ticks the boxes, the moblyze-ops
    # workflow gathers job_id values from checked rows.
    # Also attach plain-English notes to the broad_count and tight_count header
    # cells so sales can hover for definitions.
    requests = list(_header_note_requests(ws.id))
    if rows:
        requests.append({
            "setDataValidation": {
                "range": {
                    "sheetId": ws.id,
                    "startRowIndex": 1,
                    "endRowIndex": 1 + len(rows),
                    "startColumnIndex": SELECTED_COL_INDEX,
                    "endColumnIndex": SELECTED_COL_INDEX + 1,
                },
                "rule": {"condition": {"type": "BOOLEAN"}, "showCustomUi": True},
            }
        })
    if requests:
        ss.batch_update({"requests": requests})
    return len(rows)


def _header_note_requests(sheet_id: int) -> list[dict]:
    """Yield repeatCell requests that set hover-notes on each documented header."""
    out = []
    for col_name, note in JOB_MATCHES_HEADER_NOTES.items():
        col = JOB_MATCHES_HEADERS.index(col_name)
        out.append({
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0, "endRowIndex": 1,
                    "startColumnIndex": col, "endColumnIndex": col + 1,
                },
                "cell": {"note": note},
                "fields": "note",
            }
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--commit", action="store_true", help="Write the column + leads tab (default: dry-run).")
    args = ap.parse_args()

    print("Collecting contract demand (Atlas + ROVPlanet + UnderwaterJobs)...")
    demand = collect_demand()
    print(f"  {len(demand)} operators / {sum(d['count'] for d in demand.values())} attributed postings.\n")

    ss = _gspread_client().open_by_key(TARGET_SHEET_ID)
    ws = ss.worksheet(COMPANIES_TAB)
    matches, detail, unmatched, log, operator_to_company = match_demand_to_companies(
        demand, ws.get_all_records())

    print(f"MATCHED to target-clients rows: {len(matches)} companies")
    for operator, count, disp, method in sorted(log, key=lambda x: -x[1])[:25]:
        print(f"  {count:>3}  {operator:<26} -> {disp:<34} [{method}]")
    print(f"\nUNMATCHED (NEW LEAD candidates): {len(unmatched)}")
    for operator, info in sorted(unmatched, key=lambda x: -x[1]['count'])[:20]:
        print(f"  {info['count']:>3}  {operator}")

    if args.commit:
        n = write_demand(ws, matches)
        detail_cells = write_demand_detail(ws, detail)
        leads = write_leads_tab(ss, unmatched)
        job_rows = write_job_matches_tab(ss, demand, operator_to_company)
        print(f"\nWROTE active_contract_demand to {n} Companies rows ({detail_cells} source/role "
              f"detail cells); wrote {leads} rows to '{LEADS_TAB}'; "
              f"wrote {job_rows} rows to '{JOB_MATCHES_TAB}'.")
    else:
        print("\n(dry-run — no write. Re-run with --commit.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
