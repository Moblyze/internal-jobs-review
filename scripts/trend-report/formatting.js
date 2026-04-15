// scripts/trend-report/formatting.js
/**
 * Daily data refresh for the "Jobs Weekly" dashboard tab.
 *
 * Writes VALUES ONLY to three side-by-side chart source blocks below row 60,
 * all sharing Column A for weeks:
 *
 *   Column A            Chart 1 source — QUERY of weekly totals (spills A:B)
 *   Columns D:N         Chart 2 source — 11 subsectors (week refs via $A)
 *   Columns W:AF        Chart 3 source — 10 employer dropdown slots (week
 *                       refs via $A; header refs Q35:Q44 dropdown cells)
 *
 * Side-by-side means no vertical stacking: each block can grow downward for
 * years of future weeks without the risk of one block overflowing into
 * another. Blank rows past current weekCount are written as truly empty
 * cells (not =NA()) so the sheet stays visually clean.
 *
 * Jesse owns everything else on the tab — main dashboard rows 1-56,
 * filter/checkboxes at P18:P29, employer dropdowns at Q34:Q44, definitions
 * table, chart objects themselves, column widths, merges, styling.
 *
 * The filter checkbox column P19:P29 is REFERENCED by the script-written
 * subsector formulas — so the filter location is load-bearing even though
 * the script doesn't write there.
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

// Filter checkbox anchor — P19:P29 (11 checkboxes, one per subsector).
// Load-bearing: subsector SUMIFS below reference these cell addresses.
const FIRST_CHECKBOX_ROW_1_BASED = 19;

// Shared row anchors for all three side-by-side blocks.
const SECTION_HEADER_ROW_1_BASED = 60;
const LABEL_ROW_1_BASED = 62;
const HEADER_ROW_1_BASED = 63;
const FIRST_DATA_ROW_1_BASED = 64;
const PREALLOCATED_WEEKS = 100;
const LAST_DATA_ROW_1_BASED = FIRST_DATA_ROW_1_BASED + PREALLOCATED_WEEKS - 1; // 163

// Chart 3 employer dropdowns — user-owned cells at Q35:Q44.
const EMPLOYER_DROPDOWN_COL_LETTER = 'Q';
const EMPLOYER_DROPDOWN_FIRST_ROW_1_BASED = 35;
const EMPLOYER_DROPDOWN_COUNT = 10;

// Column anchors within the side-by-side block.
const CHART2_FIRST_COL_LETTER = 'D';
const CHART2_FIRST_COL_INDEX = 3;  // A=0
const CHART3_FIRST_COL_LETTER = 'W';
const CHART3_FIRST_COL_INDEX = 22;

// Employer dropdown list at V1:V100 — consumed by data-validation rules
// on Q35:Q44.
const EMPLOYER_LIST_PAD_ROWS = 100;

// Legacy ranges from the previous stacked-block layout. Written as empty on
// every run so the script stays idempotent against any sheet that still
// holds old data from before the side-by-side refactor.
const LEGACY_RANGES_TO_BLANK = [
  { range: 'A76:L163', rows: 88, cols: 12 },
  { range: 'A200:K261', rows: 62, cols: 11 },
];

export async function formatDashboard(sheets, spreadsheetId, dashboardSheetId, dashboardTitle, weekCount = 0, directEmployerNames = []) {
  const chart1Values = buildChart1Values();
  const chart2Values = buildChart2Values(weekCount);
  const chart3Values = buildChart3Values(weekCount);

  const employerListRows = directEmployerNames.map((name) => [name]);
  while (employerListRows.length < EMPLOYER_LIST_PAD_ROWS) employerListRows.push(['']);

  const legacyBlanks = LEGACY_RANGES_TO_BLANK.map(({ range, rows, cols }) => ({
    range: `${dashboardTitle}!${range}`,
    values: Array.from({ length: rows }, () => new Array(cols).fill('')),
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: `${dashboardTitle}!A${SECTION_HEADER_ROW_1_BASED}:A${HEADER_ROW_1_BASED}`,
          values: chart1Values,
        },
        {
          range: `${dashboardTitle}!${CHART2_FIRST_COL_LETTER}${LABEL_ROW_1_BASED}:N${LAST_DATA_ROW_1_BASED}`,
          values: chart2Values,
        },
        {
          range: `${dashboardTitle}!${CHART3_FIRST_COL_LETTER}${LABEL_ROW_1_BASED}:AF${LAST_DATA_ROW_1_BASED}`,
          values: chart3Values,
        },
        {
          range: `${dashboardTitle}!V1:V${EMPLOYER_LIST_PAD_ROWS}`,
          values: employerListRows,
        },
        ...legacyBlanks,
      ],
    },
  });
}

/**
 * Chart 1 block: A60:A63 (column A only).
 *
 *   A60  section header
 *   A61  blank
 *   A62  "Chart 1 — New Postings by Week" label
 *   A63  QUERY formula — spills into A63:B{N} with header row "Week | New
 *        Postings" and one data row per week. This script deliberately
 *        never writes to column B so QUERY spill is never blocked.
 */
function buildChart1Values() {
  const query =
    `=QUERY('${TREND_DATA}'!A:E, "select A, sum(E) where B = 'employer' group by A order by A label A 'Week', sum(E) 'New Postings'", 1)`;
  return [
    ['Chart data (auto-generated — feeds charts above; do not edit by hand)'],
    [''],
    ['Chart 1 — New Postings by Week'],
    [query],
  ];
}

/**
 * Chart 2 block: D62:N163 (102 rows × 11 cols).
 *
 *   D62         "Chart 2 — Subsectors (filter-gated)" label
 *   D63:N63     11 subsector names
 *   D64:N163    SUMIFS per week per subsector. Week axis comes from column
 *               A (Chart 1 QUERY spill). Subsector filter is gated by
 *               $P$19:$P$29 checkboxes — default-show when blank.
 */
function buildChart2Values(weekCount) {
  const width = FOCUS_MARKETS_ALPHABETICAL.length; // 11
  const blankRow = () => new Array(width).fill('');

  const rows = [];

  const labelRow = blankRow();
  labelRow[0] = 'Chart 2 — Subsectors (filter-gated)';
  rows.push(labelRow);

  rows.push(FOCUS_MARKETS_ALPHABETICAL.slice());

  for (let weekIdx = 0; weekIdx < PREALLOCATED_WEEKS; weekIdx++) {
    if (weekIdx >= weekCount) {
      rows.push(blankRow());
      continue;
    }
    const rowNum = FIRST_DATA_ROW_1_BASED + weekIdx;
    const dataRow = [];
    for (let subIdx = 0; subIdx < width; subIdx++) {
      const colLetter = columnLetter(CHART2_FIRST_COL_INDEX + subIdx);
      const checkboxRow = FIRST_CHECKBOX_ROW_1_BASED + subIdx;
      const formula =
        `=IF($A${rowNum}="", "", ` +
        `IF(OR($P$${checkboxRow}=TRUE, ISBLANK($P$${checkboxRow})), ` +
        `SUMIFS('${TREND_DATA}'!E:E, '${TREND_DATA}'!A:A, $A${rowNum}, ` +
        `'${TREND_DATA}'!B:B, "subsector", '${TREND_DATA}'!C:C, ${colLetter}$${HEADER_ROW_1_BASED}), 0))`;
      dataRow.push(formula);
    }
    rows.push(dataRow);
  }

  return rows;
}

/**
 * Chart 3 block: W62:AF163 (102 rows × 10 cols).
 *
 *   W62         "Chart 3 — Employers (dropdown-gated)" label
 *   W63:AF63    10 formulas each referencing a dropdown cell at Q35:Q44.
 *               Blank dropdown → blank header → chart skips that series.
 *   W64:AF163   SUMIFS per week per selected employer. Week axis comes
 *               from column A (Chart 1 QUERY spill). Blank dropdown slot
 *               returns NA() so the chart skips that series.
 */
function buildChart3Values(weekCount) {
  const width = EMPLOYER_DROPDOWN_COUNT; // 10
  const blankRow = () => new Array(width).fill('');

  const rows = [];

  const labelRow = blankRow();
  labelRow[0] = 'Chart 3 — Employers (dropdown-gated)';
  rows.push(labelRow);

  const headerRow = [];
  for (let slot = 0; slot < width; slot++) {
    const dropdownCell = `${EMPLOYER_DROPDOWN_COL_LETTER}${EMPLOYER_DROPDOWN_FIRST_ROW_1_BASED + slot}`;
    headerRow.push(`=IF(ISBLANK(${dropdownCell}), "", ${dropdownCell})`);
  }
  rows.push(headerRow);

  for (let weekIdx = 0; weekIdx < PREALLOCATED_WEEKS; weekIdx++) {
    if (weekIdx >= weekCount) {
      rows.push(blankRow());
      continue;
    }
    const rowNum = FIRST_DATA_ROW_1_BASED + weekIdx;
    const dataRow = [];
    for (let slot = 0; slot < width; slot++) {
      const colLetter = columnLetter(CHART3_FIRST_COL_INDEX + slot);
      const headerCell = `${colLetter}$${HEADER_ROW_1_BASED}`;
      const formula =
        `=IF(${headerCell}="", NA(), ` +
        `IF($A${rowNum}="", "", ` +
        `SUMIFS('${TREND_DATA}'!E:E, '${TREND_DATA}'!A:A, $A${rowNum}, ` +
        `'${TREND_DATA}'!B:B, "employer", '${TREND_DATA}'!C:C, ${headerCell})))`;
      dataRow.push(formula);
    }
    rows.push(dataRow);
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
