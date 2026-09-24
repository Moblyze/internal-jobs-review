"""Rows marked active on the sheet that the state DB does not hold as active.

WHY (2026-09-24)
----------------
The liveness probe's roster was DB-active rows only. The TechnipFMC tab still
had 1,822 rows marked active (351 distinct URLs, scraped Feb to Jul) that the
DB no longer held as active, so nothing ever re-checked them; 12 of 12 sampled
were "position has been filled". Jesse approved extending the daily check to
every row marked active on the sheet, every tab, deduped by URL, spread across
runs so no employer gets hammered.

Reading follows references/reading-the-scraped-jobs-sheet.md: one metadata
read, only the URL / Status / Title columns, several tabs per batchGet, tabs
with fewer than 2 rows skipped (a header-only tab 400s the whole batch), and a
per-tab fallback for anything that still fails. Status is located by header
name, never by column letter.
"""

import logging
import time
from collections import defaultdict
from typing import Callable, Iterable, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

HEADER_CHUNK = 40
COLUMN_CHUNK_TABS = 8
CHUNK_PAUSE = 1.2
SKIP_TAB_MARKERS = ("(backup", "backup ")
DEFAULT_PER_HOST_CAP = 600


def col_letter(idx: int) -> str:
    s = ""
    while idx >= 0:
        s = chr(idx % 26 + ord("A")) + s
        idx = idx // 26 - 1
    return s


def quote_tab(title: str) -> str:
    return "'" + title.replace("'", "''") + "'"


def is_skipped_tab(title: str) -> bool:
    t = title.lower()
    return any(m in t for m in SKIP_TAB_MARKERS)


def header_columns(header: list) -> Optional[dict]:
    """{'url': i, 'status': i, 'title': i or None} or None if the tab is not a job tab."""
    h = [str(x).strip().lower() for x in header]
    if "url" not in h or "status" not in h:
        return None
    return {"url": h.index("url"), "status": h.index("status"), "title": h.index("title") if "title" in h else None}


def rows_from_columns(tab: str, urls: list, statuses: list, titles: Optional[list]) -> list[dict]:
    """One dict per data row (row numbers are 1-based sheet rows, header is row 1)."""
    out = []
    for i, u in enumerate(urls):
        url = (u[0] if isinstance(u, list) and u else u if isinstance(u, str) else "").strip()
        if not url.startswith("http"):
            continue
        st = statuses[i] if i < len(statuses) else []
        status = (st[0] if isinstance(st, list) and st else st if isinstance(st, str) else "").strip()
        title = ""
        if titles is not None and i < len(titles):
            t = titles[i]
            title = (t[0] if isinstance(t, list) and t else t if isinstance(t, str) else "").strip()
        out.append({"tab": tab, "row": i + 2, "url": url, "status": status, "title": title})
    return out


def build_active_index(rows: Iterable[dict]) -> dict:
    """url -> {'tabs': set, 'title': str, 'rows': int} for rows whose Status is exactly 'active'."""
    idx: dict = {}
    for r in rows:
        if r["status"].strip().lower() != "active":
            continue
        e = idx.setdefault(r["url"], {"tabs": set(), "title": "", "rows": 0})
        e["tabs"].add(r["tab"])
        e["rows"] += 1
        if not e["title"] and r["title"]:
            e["title"] = r["title"]
    return idx


def select_sheet_only(index: dict, db_active_urls: set, last_checked: dict, hash_url: Callable[[str], str],
                      is_excluded: Callable[[str], bool], per_host_cap: int = DEFAULT_PER_HOST_CAP,
                      wanted: Optional[set] = None, tab_company: Optional[dict] = None) -> tuple[list[dict], dict]:
    """Sheet-active URLs the DB does not hold as active, capped per host, least recently checked first.

    Returns (roster rows shaped like DB rows plus 'tabs', stats).
    """
    tab_company = tab_company or {}
    by_host = defaultdict(list)
    stats = {"sheet_active_urls": len(index), "already_db_active": 0, "excluded_host": 0,
             "filtered_out": 0, "candidates": 0, "selected": 0, "deferred": 0}
    for url, e in index.items():
        if url in db_active_urls:
            stats["already_db_active"] += 1
            continue
        if is_excluded(url):
            stats["excluded_host"] += 1
            continue
        tabs = sorted(e["tabs"])
        companies = {tab_company.get(t, t) for t in tabs}
        if wanted and not (set(tabs) & wanted or companies & wanted):
            stats["filtered_out"] += 1
            continue
        h = hash_url(url)
        by_host[urlparse(url).netloc.lower()].append({
            "url_hash": h, "url": url, "company": tab_company.get(tabs[0], tabs[0]), "title": e["title"] or None,
            "tabs": set(tabs), "sheet_only": True, "_last": last_checked.get(h) or "",
        })
        stats["candidates"] += 1
    out = []
    for host, rows in by_host.items():
        rows.sort(key=lambda r: (r["_last"], r["url"]))   # never-checked ("") first
        keep = rows[:per_host_cap] if per_host_cap and per_host_cap > 0 else rows
        stats["deferred"] += len(rows) - len(keep)
        for r in keep:
            r.pop("_last", None)
            out.append(r)
    stats["selected"] = len(out)
    return out, stats


def _retry(fn, *args, **kwargs):
    from src.exporters.sheets import _retry_429
    return _retry_429(fn, *args, **kwargs)


def read_sheet_rows(spreadsheet) -> list[dict]:
    """Every data row (tab, row, url, status, title) on every job tab. Reads only three columns."""
    from gspread.exceptions import APIError

    worksheets = _retry(spreadsheet.worksheets)
    tabs = [(ws.title, ws.row_count) for ws in worksheets if ws.row_count >= 2 and not is_skipped_tab(ws.title)]
    headers: dict = {}
    for i in range(0, len(tabs), HEADER_CHUNK):
        chunk = tabs[i:i + HEADER_CHUNK]
        resp = _retry(spreadsheet.values_batch_get, [f"{quote_tab(t)}!1:1" for t, _n in chunk])
        for (t, n), vr in zip(chunk, resp.get("valueRanges", [])):
            cols = header_columns((vr.get("values") or [[]])[0])
            if cols:
                headers[t] = (cols, n)
        time.sleep(CHUNK_PAUSE)

    def ranges_for(t):
        cols, n = headers[t]
        rs = [f"{quote_tab(t)}!{col_letter(cols['url'])}2:{col_letter(cols['url'])}{n}",
              f"{quote_tab(t)}!{col_letter(cols['status'])}2:{col_letter(cols['status'])}{n}"]
        if cols["title"] is not None:
            rs.append(f"{quote_tab(t)}!{col_letter(cols['title'])}2:{col_letter(cols['title'])}{n}")
        return rs

    def parse(t, vrs):
        urls = vrs[0].get("values", [])
        statuses = vrs[1].get("values", [])
        titles = vrs[2].get("values", []) if len(vrs) > 2 else None
        return rows_from_columns(t, urls, statuses, titles)

    out = []
    names = list(headers)
    for i in range(0, len(names), COLUMN_CHUNK_TABS):
        chunk = names[i:i + COLUMN_CHUNK_TABS]
        plan = [(t, ranges_for(t)) for t in chunk]
        flat = [r for _t, rs in plan for r in rs]
        try:
            vrs = _retry(spreadsheet.values_batch_get, flat).get("valueRanges", [])
            pos = 0
            for t, rs in plan:
                out.extend(parse(t, vrs[pos:pos + len(rs)]))
                pos += len(rs)
        except APIError as e:
            logger.warning("batch read failed (%s); falling back per tab", str(e)[:120])
            for t, rs in plan:
                try:
                    out.extend(parse(t, _retry(spreadsheet.values_batch_get, rs).get("valueRanges", [])))
                except APIError as e2:
                    logger.warning("tab %r unreadable, skipped: %s", t, str(e2)[:120])
                time.sleep(CHUNK_PAUSE)
        time.sleep(CHUNK_PAUSE)
    logger.info("sheet roster: %d job tabs read, %d data rows", len(headers), len(out))
    return out
