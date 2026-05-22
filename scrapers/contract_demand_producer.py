#!/usr/bin/env python3
"""Demand-intelligence producer (Workstream 3).

Extracts the END-EMPLOYER named on live CONTRACT postings, counts live contract
postings per operator, matches each operator to a target-clients Companies row,
and writes the integer ``active_contract_demand`` column that the BD pipeline's
Phase 2 reads. v1 source = Atlas Professionals (wp-json with a ``client-name``
taxonomy — the one agency board that names the operator structurally).

Data contract (agreed with the BD session):
  - ``active_contract_demand`` is an INTEGER on each Companies row = count of
    live contract postings attributed to that operator. Phase 2's
    ``contract_demand_signal()`` log-scales it (saturates at 30).
  - Phase 2 currently reads it at weight 0, so writing it is INERT until the BD
    session tunes the weight. This just populates the contract.

A valuable byproduct: operators with live contract demand that do NOT match any
target-clients row are surfaced as candidate NEW BD leads.

Usage:
  python3 contract_demand_producer.py            # dry-run: fetch + match + print, NO write
  python3 contract_demand_producer.py --commit    # write active_contract_demand to the Sheet
"""

import argparse
import html
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials

from src.aggregators.atlasprofessionals_adapter import (
    AtlasProfessionalsAggregator,
    _clean_client_name,
    _extract_embedded_terms,
)

TARGET_SHEET_ID = "1fIW4JxCNTQDT5J8g7bgPDK0lUYo0WF8Yfgras6GVem4"
COMPANIES_TAB = "Companies"
DEMAND_COLUMN = "active_contract_demand"

# Operators to drop: the agency naming itself (Atlas variants) + junk/placeholder
# client-name values that aren't real operators.
_EXCLUDE_OPERATORS = {
    "atlas professionals", "atlas nextwave", "atlas next wave",
    "n/a", "na", "tbc", "tba", "various", "confidential", "client", "-", "wind",
}


def _clean_operator(raw: str) -> str:
    name = html.unescape(_clean_client_name(raw or "")).strip().strip("-").strip()
    return name


def _is_excludable(name: str) -> bool:
    n = name.lower().strip()
    return (
        not n
        or n in _EXCLUDE_OPERATORS
        or n.startswith("atlas next")
        or n.startswith("atlas professional")
    )
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def _normalize(s) -> str:
    return " ".join((s or "").lower().split())


def _name_identifies(a_norm: str, b_norm: str) -> bool:
    """Conservative match: exact, or one name is a leading whole-token prefix of
    the other (so "Saipem" ↔ "Saipem S.p.A."). Boundary-guarded to avoid
    "BP" matching "BPX"."""
    if not a_norm or not b_norm:
        return False
    if a_norm == b_norm:
        return True
    for x, y in ((a_norm, b_norm), (b_norm, a_norm)):
        if x.startswith(y + " ") or x.startswith(y + ","):
            return True
    return False


def _job_title(job: dict) -> str:
    t = job.get("title")
    if isinstance(t, dict):
        return (t.get("rendered") or "").strip()
    return str(t or "").strip()


def fetch_atlas_demand(max_pages: int = 10) -> dict:
    """Return {operator: {count, titles, countries}} for live contract postings
    that name an end-client."""
    agg = AtlasProfessionalsAggregator()
    demand: dict = defaultdict(lambda: {"count": 0, "titles": [], "countries": set()})
    page, total, seen = 1, None, 0
    while page <= max_pages:
        jobs, total = agg._fetch_page(page=page, use_category_filter=True)
        if not jobs:
            break
        for job in jobs:
            terms = _extract_embedded_terms(job)
            clients = terms.get("client-name") or []
            if not clients:
                continue  # blind posting — no operator to attribute
            operator = _clean_operator(clients[0])
            if _is_excludable(operator):
                continue
            d = demand[operator]
            d["count"] += 1
            title = _job_title(job)
            if title and len(d["titles"]) < 3:
                d["titles"].append(title)
            for c in terms.get("country") or []:
                d["countries"].add(c)
        seen += len(jobs)
        if total is not None and seen >= total:
            break
        page += 1
    return demand


def _gspread_client() -> gspread.Client:
    sa = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
    if sa:
        info = json.loads(sa) if sa.lstrip().startswith("{") else json.load(
            open(os.path.expanduser(sa))
        )
        return gspread.authorize(Credentials.from_service_account_info(info, scopes=SCOPES))
    candidates = [
        os.environ.get("GOOGLE_SERVICE_ACCOUNT_PATH"),
        str(Path.home() / ".config" / "gspread" / "service_account.json"),
    ]
    for p in candidates:
        if p and Path(os.path.expanduser(p)).exists():
            return gspread.authorize(
                Credentials.from_service_account_file(os.path.expanduser(p), scopes=SCOPES)
            )
    raise RuntimeError("No Google service-account credentials with target-clients access")


def match_demand_to_companies(demand: dict, companies: list[dict]):
    """Return (matches {company_id: count}, unmatched [(operator, count)], log)."""
    idx = []  # (normalized_name, company_id, display_name)
    for row in companies:
        cid = row.get("company_id")
        if not cid:
            continue
        for key in (row.get("legal_name"), row.get("common_name")):
            n = _normalize(key)
            if n:
                idx.append((n, cid, row.get("legal_name") or row.get("common_name")))

    matches: dict = {}
    log = []
    unmatched = []
    for operator, info in sorted(demand.items(), key=lambda kv: -kv[1]["count"]):
        op_norm = _normalize(operator)
        hit = next(((cid, disp) for n, cid, disp in idx if n == op_norm), None)
        if hit is None:
            hit = next(
                ((cid, disp) for n, cid, disp in idx if _name_identifies(n, op_norm)), None
            )
        if hit:
            cid, disp = hit
            matches[cid] = matches.get(cid, 0) + info["count"]
            log.append((operator, info["count"], disp))
        else:
            unmatched.append((operator, info["count"]))
    return matches, unmatched, log


def write_demand(ws, matches: dict) -> int:
    all_values = ws.get_all_values()
    headers = all_values[0] if all_values else []
    if DEMAND_COLUMN not in headers or "company_id" not in headers:
        raise RuntimeError(
            f"Companies tab missing required column(s); need 'company_id' and "
            f"'{DEMAND_COLUMN}'. Has the BD session run its schema migration?"
        )
    acd_col = headers.index(DEMAND_COLUMN)
    id_col = headers.index("company_id")
    cells = []
    for r, row in enumerate(all_values[1:], start=2):
        if id_col < len(row) and row[id_col] in matches:
            cells.append(gspread.Cell(row=r, col=acd_col + 1, value=matches[row[id_col]]))
    if cells:
        ws.update_cells(cells, value_input_option="RAW")
    return len(cells)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--commit", action="store_true", help="Write active_contract_demand to the Sheet (default: dry-run).")
    ap.add_argument("--max-pages", type=int, default=10)
    args = ap.parse_args()

    print("Fetching Atlas Professionals contract demand (named operators)...")
    demand = fetch_atlas_demand(max_pages=args.max_pages)
    total_postings = sum(d["count"] for d in demand.values())
    print(f"  {len(demand)} distinct operators across {total_postings} attributed contract postings.\n")

    ws = _gspread_client().open_by_key(TARGET_SHEET_ID).worksheet(COMPANIES_TAB)
    companies = ws.get_all_records()
    matches, unmatched, log = match_demand_to_companies(demand, companies)

    print(f"MATCHED to target-clients rows: {len(matches)} companies")
    for operator, count, disp in sorted(log, key=lambda x: -x[1])[:20]:
        print(f"  {count:>3}  {operator:<28} -> {disp}")
    print(f"\nUNMATCHED operators (live contract demand NOT in target DB = NEW LEAD candidates): {len(unmatched)}")
    for operator, count in unmatched[:20]:
        print(f"  {count:>3}  {operator}")

    if args.commit:
        n = write_demand(ws, matches)
        print(f"\nWROTE active_contract_demand to {n} Companies rows.")
    else:
        print("\n(dry-run — no write. Re-run with --commit to write active_contract_demand.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
