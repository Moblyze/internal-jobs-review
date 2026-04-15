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
// referenced by the subsector SUMIFS formulas below. Jesse's current layout
// has the 11 checkboxes at P19:P29 (header row at P18, data rows follow).
// If the filter block gets moved again, update this constant in lockstep.
const FIRST_CHECKBOX_ROW_1_BASED = 19;           // P19..P29

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

// ── Chart 3 (Employer Trends) ──────────────────────────────────────────────
// Up to 10 employers picked via dropdowns at Q36:Q45.
const EMPLOYER_DROPDOWN_COL_LETTER = 'Q';
const EMPLOYER_DROPDOWN_FIRST_ROW_1_BASED = 36;    // Q36
const EMPLOYER_DROPDOWN_COUNT = 10;
const EMPLOYER_RAW_LABEL_ROW_1_BASED = 200;
const EMPLOYER_RAW_HEADER_ROW_1_BASED = 201;
const EMPLOYER_RAW_FIRST_DATA_ROW_1_BASED = 202;
const EMPLOYER_PREALLOCATED_WEEKS = 60;
const EMPLOYER_RAW_COL_WIDTH = 1 + EMPLOYER_DROPDOWN_COUNT; // Week + 10 series
// Helper list of unique employers (populated by QUERY, consumed by dropdowns).
const EMPLOYER_LIST_CELL = 'V1';

export async function formatDashboard(sheets, spreadsheetId, dashboardSheetId, dashboardTitle, weekCount = 0, directEmployerNames = []) {
  const rawChartData = buildRawChartDataValues(weekCount);
  const rawLastRow =
    RAW_SUBSECTOR_FIRST_DATA_ROW_1_BASED + SUBSECTOR_PREALLOCATED_WEEKS - 1;

  const employerChartData = buildEmployerChartSource(weekCount);
  const employerLastRow =
    EMPLOYER_RAW_FIRST_DATA_ROW_1_BASED + EMPLOYER_PREALLOCATED_WEEKS - 1;
  const employerLastCol = columnLetter(EMPLOYER_RAW_COL_WIDTH - 1); // 'K'

  // Curated employer list at V1:V{N} — only direct-scrape employers (~31
  // clean, canonical names like Baker Hughes, BP, Halliburton). Skips
  // aggregator-scraped company strings which are messy and number in the
  // thousands.
  const employerListRows = directEmployerNames.map((name) => [name]);
  // Pad with blanks up to 100 rows so the data-validation range V1:V500 is
  // stable and old entries from larger past runs get cleared.
  const EMPLOYER_LIST_PAD_ROWS = 100;
  while (employerListRows.length < EMPLOYER_LIST_PAD_ROWS) employerListRows.push(['']);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: `${dashboardTitle}!A${RAW_SECTION_HEADER_ROW_1_BASED}:L${rawLastRow}`,
          values: rawChartData,
        },
        {
          range: `${dashboardTitle}!A${EMPLOYER_RAW_LABEL_ROW_1_BASED}:${employerLastCol}${employerLastRow}`,
          values: employerChartData,
        },
        {
          range: `${dashboardTitle}!V1:V${EMPLOYER_LIST_PAD_ROWS}`,
          values: employerListRows,
        },
      ],
    },
  });
}

/**
 * Chart 3 source at A200:K261.
 *
 *   A200  section label
 *   A201  'Week' | B201..K201  = refs to dropdown cells P36..P45 (series
 *                                labels; blank dropdown → blank label → chart
 *                                skips that series entirely)
 *   A202..A261  week refs (NA for weeks beyond current data)
 *   B202..K261  SUMIFS per week per selected employer, NA when the matching
 *                dropdown is empty so the chart line doesn't plot zeros.
 */
function buildEmployerChartSource(weekCount) {
  const width = EMPLOYER_RAW_COL_WIDTH;
  const pad = (row) => row.concat(new Array(Math.max(0, width - row.length)).fill(''));
  const rows = [];

  // Row 200: section label
  rows.push(pad(['Chart 3 source — Employer Trends (dropdown-gated, select from P36:P45)']));

  // Row 201: header row — 'Week' + 10 refs to dropdown cells
  const headerRow = ['Week'];
  for (let slot = 0; slot < EMPLOYER_DROPDOWN_COUNT; slot++) {
    const dropdownCell = `${EMPLOYER_DROPDOWN_COL_LETTER}${EMPLOYER_DROPDOWN_FIRST_ROW_1_BASED + slot}`;
    // Empty string for blank dropdowns so chart skips the series.
    headerRow.push(`=IF(ISBLANK(${dropdownCell}), "", ${dropdownCell})`);
  }
  rows.push(pad(headerRow));

  // Rows 202-261: data
  for (let weekIdx = 0; weekIdx < EMPLOYER_PREALLOCATED_WEEKS; weekIdx++) {
    const rowNum = EMPLOYER_RAW_FIRST_DATA_ROW_1_BASED + weekIdx;
    let weekRef;
    if (weekIdx < weekCount) {
      const weekSourceRow = RAW_TOTAL_QUERY_ROW_1_BASED + 1 + weekIdx;
      weekRef = `=A${weekSourceRow}`;
    } else {
      weekRef = '=NA()';
    }
    const dataRow = [weekRef];
    for (let slot = 0; slot < EMPLOYER_DROPDOWN_COUNT; slot++) {
      const seriesColLetter = columnLetter(1 + slot); // B..K
      const headerCell = `${seriesColLetter}$${EMPLOYER_RAW_HEADER_ROW_1_BASED}`;
      const formula =
        `=IF(${headerCell}="", NA(), ` +
        `IF(ISNA($A${rowNum}), NA(), ` +
        `SUMIFS('${TREND_DATA}'!E:E, '${TREND_DATA}'!A:A, $A${rowNum}, ` +
        `'${TREND_DATA}'!B:B, "employer", '${TREND_DATA}'!C:C, ${headerCell})))`;
      dataRow.push(formula);
    }
    rows.push(pad(dataRow));
  }

  return rows;
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
