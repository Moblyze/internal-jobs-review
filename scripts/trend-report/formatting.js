// scripts/trend-report/formatting.js
/**
 * Daily data refresh for the "Jobs Weekly" dashboard tab.
 *
 * Writes VALUES ONLY — never touches formatting, column widths, merges,
 * charts, or data validation. Jesse owns the visual design of the tab; this
 * script just keeps the data behind the charts + filter + rules table fresh.
 *
 * What it writes each run:
 *   P18:Q31  — filter panel values (checkbox TRUE + label per subsector)
 *   Q33:S46  — classification rules (header, explanation, 11 rows)
 *   A60:L88  — raw chart data: section label, Chart 1 QUERY formula, Chart 2
 *               per-subsector filter-gated SUMIFS
 *
 * Subsector formulas use ISBLANK to return empty for weeks that don't yet
 * exist in Trend Data, so the chart shows only real weeks without needing
 * the script to re-tune ranges as data grows.
 */

import { getMarketDefinitions } from '../focusMarketClassifier.js';
import { FOCUS_MARKET_LABELS } from '../../src/utils/focusMarkets.js';

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

// Filter panel — columns P:Q
const FILTER_PANEL_HEADER_ROW_1_BASED = 18;      // "Subsector filter"
const FIRST_CHECKBOX_ROW_1_BASED = 21;           // P21..P31

// Rules / definitions table — columns Q:S
const RULES_HEADER_ROW_1_BASED = 33;
const RULES_FIRST_DATA_ROW_1_BASED = 36;

// Raw chart data — columns A:L, rows 60-137
const RAW_SECTION_HEADER_ROW_1_BASED = 60;
const RAW_TOTAL_LABEL_ROW_1_BASED = 62;
const RAW_TOTAL_QUERY_ROW_1_BASED = 63;          // QUERY spills A63:B74+ as weeks accumulate
const RAW_SUBSECTOR_LABEL_ROW_1_BASED = 76;
const RAW_SUBSECTOR_HEADER_ROW_1_BASED = 77;
const RAW_SUBSECTOR_FIRST_DATA_ROW_1_BASED = 78;
const RAW_DATA_COL_WIDTH = 12;                   // A..L
const SUBSECTOR_PREALLOCATED_WEEKS = 60;         // enough rows to cover ~1 year+

export async function formatDashboard(sheets, spreadsheetId, dashboardSheetId, dashboardTitle) {
  const filterPanel = buildFilterPanelValues();
  const rulesTable = buildRulesTableValues();
  const rawChartData = buildRawChartDataValues();

  const filterLastRow =
    FIRST_CHECKBOX_ROW_1_BASED + FOCUS_MARKETS_ALPHABETICAL.length - 1;
  const rulesLastRow =
    RULES_FIRST_DATA_ROW_1_BASED + rulesTable.dataRows.length - 1;
  const rawLastRow =
    RAW_SUBSECTOR_FIRST_DATA_ROW_1_BASED + SUBSECTOR_PREALLOCATED_WEEKS - 1;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: `${dashboardTitle}!P${FILTER_PANEL_HEADER_ROW_1_BASED}:Q${filterLastRow}`,
          values: filterPanel,
        },
        {
          range: `${dashboardTitle}!Q${RULES_HEADER_ROW_1_BASED}:S${rulesLastRow}`,
          values: [
            ['Subsector classification rules', '', ''],
            [rulesTable.explanation, '', ''],
            ['Subsector', 'Include keywords (title match = 3×, description = 1×)', 'Exclude keywords (any title hit disqualifies)'],
            ...rulesTable.dataRows,
          ],
        },
        {
          range: `${dashboardTitle}!A${RAW_SECTION_HEADER_ROW_1_BASED}:L${rawLastRow}`,
          values: rawChartData,
        },
      ],
    },
  });
}

function buildFilterPanelValues() {
  const rows = [];
  rows.push(['Subsector filter', '']);
  rows.push(['', '']);
  rows.push(['', 'Subsector']);
  for (const name of FOCUS_MARKETS_ALPHABETICAL) {
    rows.push([true, name]);
  }
  return rows;
}

function buildRulesTableValues() {
  const defs = getMarketDefinitions();
  const defsBySlug = Object.fromEntries(defs.map((d) => [d.slug, d]));
  const labelToSlug = Object.fromEntries(
    Object.entries(FOCUS_MARKET_LABELS).map(([slug, label]) => [label, slug]),
  );

  const dataRows = [];
  for (const label of FOCUS_MARKETS_ALPHABETICAL) {
    const slug = labelToSlug[label];
    const def = slug ? defsBySlug[slug] : null;
    dataRows.push([
      label,
      def ? def.include.join(', ') : '— no classifier rules defined yet —',
      def ? def.exclude.join(', ') : '—',
    ]);
  }

  return {
    explanation:
      'Direct-employer jobs (Halliburton, BP, etc.) are classified by keyword matching on title + description — rules below. Title hits score 3×, description hits 1×; highest scorer wins. Any exclude keyword in the title disqualifies that market. Aggregator jobs inherit their subsector from the search profile they were scraped under (defined in scrapers/config/aggregators.yaml). The Decommissioning rules below are synced with src/utils/marketContentMatcher.js, which is what the website itself uses for the Decommissioning filter.',
    dataRows,
  };
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
function buildRawChartDataValues() {
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
    const weekSourceRow = RAW_TOTAL_QUERY_ROW_1_BASED + 1 + weekIdx;
    // Week ref: blank if the QUERY hasn't spilled that far yet.
    const weekRef = `=IFERROR(IF(ISBLANK(A${weekSourceRow}), "", A${weekSourceRow}), "")`;
    const dataRow = [weekRef];
    for (let subIdx = 0; subIdx < FOCUS_MARKETS_ALPHABETICAL.length; subIdx++) {
      const colLetter = columnLetter(1 + subIdx);
      const checkboxRow = FIRST_CHECKBOX_ROW_1_BASED + subIdx;
      const formula =
        `=IF(ISBLANK($A${rowNum}), "", ` +
        `IF($P$${checkboxRow}, ` +
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
