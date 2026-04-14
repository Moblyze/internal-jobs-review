// scripts/trend-report/formatting.js
/**
 * Daily data refresh for the "Jobs Weekly" dashboard tab.
 *
 * Writes VALUES ONLY to a single area — the raw chart data block at A60:L137.
 * Jesse owns everything else on the tab (title row, main dashboard A:F
 * sections, filter/checkboxes at P:S, definitions table, chart objects,
 * column widths, merges, styling). This script never touches those.
 *
 * The filter checkbox column P21:P31 is REFERENCED by the script-written
 * subsector formulas — so the filter location is load-bearing even though
 * the script doesn't write to it. If you move the checkboxes, the formulas
 * here must be updated in lockstep.
 */

const TREND_DATA = 'Trend Data';

const FOCUS_MARKETS_ALPHABETICAL = [
  'Decommissioning',
  'Drilling',
  'Energy Trades',
  'Industrial Construction',
  'Marine & Offshore',
  'NDT Inspection',
  'Pipeline & Mechanical',
  'Process & Plant',
  'ROV & Subsea',
  'Rope Access',
  'Survey & Geophysical',
];

// Filter checkbox anchor — user-owned cells, not written by the script, but
// referenced by the subsector SUMIFS formulas below.
const FIRST_CHECKBOX_ROW_1_BASED = 21;           // P21..P31

// Raw chart data — columns A:L, rows 60-137
const RAW_SECTION_HEADER_ROW_1_BASED = 60;
const RAW_TOTAL_LABEL_ROW_1_BASED = 62;
const RAW_TOTAL_QUERY_ROW_1_BASED = 63;          // QUERY spills A63:B74+ as weeks accumulate
const RAW_SUBSECTOR_LABEL_ROW_1_BASED = 76;
const RAW_SUBSECTOR_HEADER_ROW_1_BASED = 77;
const RAW_SUBSECTOR_FIRST_DATA_ROW_1_BASED = 78;
const RAW_DATA_COL_WIDTH = 12;                   // A..L
// Pre-allocate 60 rows so chart 2 auto-picks up future weeks without needing
// the script to re-tune ranges. Week refs beyond current data land on blank
// or label cells — the ISNUMBER guard in the formula below returns NA() for
// those so charts skip them silently.
const SUBSECTOR_PREALLOCATED_WEEKS = 60;

export async function formatDashboard(sheets, spreadsheetId, dashboardSheetId, dashboardTitle, weekCount = 0) {
  const rawChartData = buildRawChartDataValues(weekCount);
  const rawLastRow =
    RAW_SUBSECTOR_FIRST_DATA_ROW_1_BASED + SUBSECTOR_PREALLOCATED_WEEKS - 1;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: `${dashboardTitle}!A${RAW_SECTION_HEADER_ROW_1_BASED}:L${rawLastRow}`,
          values: rawChartData,
        },
      ],
    },
  });
}

/**
 * Raw chart data block.
 *
 *   A60  section header
 *   A62  "Chart 1 source" label
 *   A63  QUERY formula (dynamic spill — grows as Trend Data grows)
 *   A76  "Chart 2 source (filter-gated)" label
 *   A77  header row: Week | 11 subsector names
 *   A78-A137  60 preallocated data rows. Each row's week is
 *             =A(64 + idx) — referencing the nth spilled cell from the
 *             Chart 1 QUERY. Subsector cells use ISBLANK so empty weeks stay
 *             empty (chart hides the bar).
 */
function buildRawChartDataValues(weekCount) {
  const width = RAW_DATA_COL_WIDTH;
  const pad = (row) => row.concat(new Array(Math.max(0, width - row.length)).fill(''));

  const rows = [];

  // Row 60: section header
  rows.push(pad(['Chart data (auto-generated — feeds the charts above; do not edit by hand)']));
  // Row 61: blank
  rows.push(pad(['']));
  // Row 62: Chart 1 label
  rows.push(pad(['Chart 1 source — New Postings by Week']));
  // Row 63: QUERY formula (spills down as weeks accumulate)
  const totalQuery =
    `=QUERY('${TREND_DATA}'!A:E, "select A, sum(E) where B = 'employer' group by A order by A label A 'Week', sum(E) 'New Postings'", 1)`;
  rows.push(pad([totalQuery]));
  // Rows 64-74: placeholders for QUERY spill (12 slots after header — spill can overflow further)
  for (let i = 0; i < 11; i++) rows.push(pad(['']));
  // Row 75: blank
  rows.push(pad(['']));
  // Row 76: Chart 2 label
  rows.push(pad(['Chart 2 source — New Postings by Subsector per Week (filter-gated)']));
  // Row 77: header — Week + 11 subsector names
  rows.push(pad(['Week', ...FOCUS_MARKETS_ALPHABETICAL]));
  // Rows 78-137: 60 preallocated rows. Week ref points to QUERY's nth data row.
  for (let weekIdx = 0; weekIdx < SUBSECTOR_PREALLOCATED_WEEKS; weekIdx++) {
    const rowNum = RAW_SUBSECTOR_FIRST_DATA_ROW_1_BASED + weekIdx;
    // For weeks beyond the current data, force NA — don't chain through
    // cells that might resolve to dates via our own subsector formulas.
    let weekRef;
    if (weekIdx < weekCount) {
      const weekSourceRow = RAW_TOTAL_QUERY_ROW_1_BASED + 1 + weekIdx;
      weekRef = `=A${weekSourceRow}`;
    } else {
      weekRef = '=NA()';
    }
    const dataRow = [weekRef];
    for (let subIdx = 0; subIdx < FOCUS_MARKETS_ALPHABETICAL.length; subIdx++) {
      const colLetter = columnLetter(1 + subIdx);
      const checkboxRow = FIRST_CHECKBOX_ROW_1_BASED + subIdx;
      // Default-show when the checkbox cell is blank (resilient to the
      // filter area being wiped or not yet populated). Explicit FALSE hides.
      const formula =
        `=IF(ISNA($A${rowNum}), NA(), ` +
        `IF(OR($P$${checkboxRow}=TRUE, ISBLANK($P$${checkboxRow})), ` +
        `SUMIFS('${TREND_DATA}'!E:E, '${TREND_DATA}'!A:A, $A${rowNum}, ` +
        `'${TREND_DATA}'!B:B, "subsector", '${TREND_DATA}'!C:C, ${colLetter}$${RAW_SUBSECTOR_HEADER_ROW_1_BASED}), 0))`;
      dataRow.push(formula);
    }
    rows.push(pad(dataRow));
  }

  return rows;
}

function columnLetter(idx) {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}
