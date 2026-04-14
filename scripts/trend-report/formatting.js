// scripts/trend-report/formatting.js
/**
 * Dashboard styling + charts. Applied after replaceTab writes the raw values.
 *
 * Layout beyond the main A:F view:
 *   H1:I14   — total-new-postings chart source (QUERY spill)
 *   K1:V13   — per-subsector chart source (hardcoded 11 focus-market columns,
 *              each cell IF-gated by a checkbox so the BD team can toggle
 *              subsectors on/off)
 *   H78:I91  — filter panel: "Subsector filter" header, 11 checkboxes in H81:H91,
 *              labels in I81:I91 (rows map 1:1 to columns L..V in the chart data)
 *
 * All operations are idempotent — re-applying is safe. Checkbox values are
 * reset to TRUE on each run.
 */

import { getMarketDefinitions } from '../focusMarketClassifier.js';
import { FOCUS_MARKET_LABELS } from '../../src/utils/focusMarkets.js';

const TREND_DATA = 'Trend Data';

// Rules table anchor: directly below filter panel.
const RULES_HEADER_ROW_1_BASED = 93;      // A93
const RULES_EXPLANATION_ROW_1_BASED = 94; // A94
const RULES_COL_HEADER_ROW_1_BASED = 95;  // A95
const RULES_FIRST_DATA_ROW_1_BASED = 96;  // A96

const TITLE_ROW = 0;
const META_ROWS = [1, 2];
const SECTION_HEADER_ROWS = [4, 11, 18, 31, 45];
const COLUMN_HEADER_ROWS = [12, 19, 32, 46];

// Focus markets in alphabetical order. Must stay in lockstep with
// FOCUS_MARKET_LABELS in src/utils/focusMarkets.js — these labels are what the
// aggregate rows in Trend Data use, so mismatched strings would zero out the
// chart silently.
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

// Column L = index 11 in the subsector chart source. Checkbox for column L
// lives at row 81, column H. Column M → row 82, etc.
const FIRST_SUBSECTOR_COL = 11;          // 'L'
const FIRST_CHECKBOX_ROW_1_BASED = 81;   // H81
const FILTER_PANEL_HEADER_ROW_1_BASED = 78;
const FILTER_PANEL_COL_LABEL_ROW_1_BASED = 80;

// Palette
const NAVY = { red: 0.12, green: 0.22, blue: 0.38 };
const PALE_BLUE = { red: 0.91, green: 0.94, blue: 0.98 };
const WHITE = { red: 1, green: 1, blue: 1 };
const BORDER_GRAY = { red: 0.6, green: 0.6, blue: 0.6 };

export async function formatDashboard(sheets, spreadsheetId, dashboardSheetId, dashboardTitle) {
  await writeChartSourceAndFilter(sheets, spreadsheetId, dashboardTitle);

  const existingCharts = await listExistingCharts(sheets, spreadsheetId, dashboardSheetId);
  const deleteRequests = existingCharts.map((chartId) => ({
    deleteEmbeddedObject: { objectId: chartId },
  }));

  const requests = [
    ...deleteRequests,
    ...buildFormattingRequests(dashboardSheetId),
    ...buildChartRequests(dashboardSheetId),
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

// ---------------------------------------------------------------------------
// Chart source + filter panel values
// ---------------------------------------------------------------------------

async function writeChartSourceAndFilter(sheets, spreadsheetId, dashboardTitle) {
  const totalActive = buildTotalActiveSourceValues();
  const subsectorTable = buildSubsectorFilteredTable();
  const filterPanel = buildFilterPanelValues();
  const rulesTable = buildRulesTableValues();
  const lastRulesRow = RULES_FIRST_DATA_ROW_1_BASED + rulesTable.dataRows.length - 1;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `${dashboardTitle}!H1:I2`, values: totalActive },
        { range: `${dashboardTitle}!K1:V13`, values: subsectorTable },
        { range: `${dashboardTitle}!H${FILTER_PANEL_HEADER_ROW_1_BASED}:I91`, values: filterPanel },
        {
          range: `${dashboardTitle}!A${RULES_HEADER_ROW_1_BASED}:C${lastRulesRow}`,
          values: [
            ['Subsector classification rules', '', ''],
            [rulesTable.explanation, '', ''],
            ['Subsector', 'Include keywords (title match = 3×, description = 1×)', 'Exclude keywords (any title hit disqualifies)'],
            ...rulesTable.dataRows,
          ],
        },
      ],
    },
  });
}

function buildRulesTableValues() {
  const defs = getMarketDefinitions();
  const defsBySlug = Object.fromEntries(defs.map(d => [d.slug, d]));
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

function buildTotalActiveSourceValues() {
  const formula =
    `=QUERY('${TREND_DATA}'!A:E, "select A, sum(E) where B = 'employer' group by A order by A label A 'Week', sum(E) 'New Postings'", 1)`;
  return [
    ['Chart: New Postings by Week', ''],
    [formula, ''],
  ];
}

/**
 * Subsector chart source at K1:V13.
 *   K1        — chart label
 *   K2        — 'Week' header
 *   L2..V2    — focus market names (11, alphabetical)
 *   K3..K13   — =H3..=H13 (references the total-active QUERY's week column)
 *   L3..V13   — =IF(checkbox, SUMIFS(...), 0) — each cell pulls from Trend
 *                Data only when its corresponding subsector checkbox is TRUE.
 */
function buildSubsectorFilteredTable() {
  const labelRow = [
    'Chart: New Postings by Subsector',
    ...new Array(11).fill(''), // L..V padding
  ];
  const headerRow = ['Week', ...FOCUS_MARKETS_ALPHABETICAL];

  const dataRows = [];
  for (let r = 3; r <= 13; r++) {
    const row = [`=H${r}`];
    for (let i = 0; i < FOCUS_MARKETS_ALPHABETICAL.length; i++) {
      const colLetter = columnLetter(FIRST_SUBSECTOR_COL + i);
      const checkboxRow = FIRST_CHECKBOX_ROW_1_BASED + i;
      const formula =
        `=IF($H$${checkboxRow}, ` +
        `SUMIFS('${TREND_DATA}'!E:E, '${TREND_DATA}'!A:A, $K${r}, ` +
        `'${TREND_DATA}'!B:B, "subsector", '${TREND_DATA}'!C:C, ${colLetter}$2), 0)`;
      row.push(formula);
    }
    dataRows.push(row);
  }

  return [labelRow, headerRow, ...dataRows];
}

/**
 * Filter panel at H78:I91.
 *   H78  — bold header
 *   H80  — column label row header (empty; checkbox col)
 *   I80  — 'Subsector'
 *   H81..H91 — 11 TRUE values (become checkboxes after dataValidation applied)
 *   I81..I91 — subsector names (matches L2..V2 in the chart source)
 */
function buildFilterPanelValues() {
  // 14 rows from H78 through H91.
  //   row 78: 'Subsector filter'
  //   row 79: blank
  //   row 80: '' | 'Subsector'
  //   rows 81-91: TRUE | <subsector>
  const rows = [];
  rows.push(['Subsector filter', '']);    // H78:I78
  rows.push(['', '']);                     // H79:I79
  rows.push(['', 'Subsector']);            // H80:I80
  for (const name of FOCUS_MARKETS_ALPHABETICAL) {
    rows.push([true, name]);              // H81..H91 | I81..I91
  }
  return rows;
}

async function listExistingCharts(sheets, spreadsheetId, dashboardSheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.sheetId,sheets.charts.chartId',
  });
  const sheet = meta.data.sheets.find((s) => s.properties.sheetId === dashboardSheetId);
  if (!sheet || !sheet.charts) return [];
  return sheet.charts.map((c) => c.chartId);
}

// ---------------------------------------------------------------------------
// Formatting + data-validation requests
// ---------------------------------------------------------------------------

function buildFormattingRequests(sheetId) {
  const requests = [];

  // Column widths
  requests.push(setColumnWidth(sheetId, 0, 1, 280));  // A
  requests.push(setColumnWidth(sheetId, 1, 2, 160));  // B
  requests.push(setColumnWidth(sheetId, 2, 6, 110));  // C-F
  requests.push(setColumnWidth(sheetId, 6, 7, 20));   // G gap
  requests.push(setColumnWidth(sheetId, 7, 11, 100)); // H-K chart sources
  requests.push(setColumnWidth(sheetId, 8, 9, 160));  // I: filter panel labels get width

  // Main title
  requests.push({
    mergeCells: {
      range: rowRange(sheetId, TITLE_ROW, 0, 6),
      mergeType: 'MERGE_ALL',
    },
  });
  requests.push({
    repeatCell: {
      range: rowRange(sheetId, TITLE_ROW, 0, 6),
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true, fontSize: 16, foregroundColor: WHITE },
          backgroundColor: NAVY,
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment)',
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: TITLE_ROW, endIndex: TITLE_ROW + 1 },
      properties: { pixelSize: 40 },
      fields: 'pixelSize',
    },
  });

  // Metadata rows
  for (const r of META_ROWS) {
    requests.push({
      repeatCell: {
        range: rowRange(sheetId, r, 0, 6),
        cell: {
          userEnteredFormat: {
            textFormat: { italic: true, fontSize: 9, foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 } },
          },
        },
        fields: 'userEnteredFormat.textFormat',
      },
    });
  }

  // Section headers
  for (const r of SECTION_HEADER_ROWS) {
    requests.push({
      repeatCell: {
        range: rowRange(sheetId, r, 0, 6),
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 12, foregroundColor: NAVY },
            backgroundColor: PALE_BLUE,
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment)',
      },
    });
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: r, endIndex: r + 1 },
        properties: { pixelSize: 28 },
        fields: 'pixelSize',
      },
    });
  }

  // Column-header rows
  for (const r of COLUMN_HEADER_ROWS) {
    requests.push({
      repeatCell: {
        range: rowRange(sheetId, r, 0, 6),
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 10 },
            borders: {
              bottom: { style: 'SOLID', width: 1, color: BORDER_GRAY },
            },
          },
        },
        fields: 'userEnteredFormat(textFormat,borders)',
      },
    });
  }

  // Filter panel styling
  const filterHeaderRow0 = FILTER_PANEL_HEADER_ROW_1_BASED - 1;   // 77 (0-indexed)
  const filterColLabelRow0 = FILTER_PANEL_COL_LABEL_ROW_1_BASED - 1; // 79
  const firstCheckboxRow0 = FIRST_CHECKBOX_ROW_1_BASED - 1;       // 80
  const lastCheckboxRow0 = firstCheckboxRow0 + FOCUS_MARKETS_ALPHABETICAL.length; // exclusive, = 91

  // "Subsector filter" header (H78:I78) — bold + pale blue bg
  requests.push({
    mergeCells: {
      range: rowRange(sheetId, filterHeaderRow0, 7, 9),
      mergeType: 'MERGE_ALL',
    },
  });
  requests.push({
    repeatCell: {
      range: rowRange(sheetId, filterHeaderRow0, 7, 9),
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true, fontSize: 11, foregroundColor: NAVY },
          backgroundColor: PALE_BLUE,
          verticalAlignment: 'MIDDLE',
          horizontalAlignment: 'CENTER',
        },
      },
      fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment,horizontalAlignment)',
    },
  });

  // Column-label row (H80:I80) — bold + bottom border
  requests.push({
    repeatCell: {
      range: rowRange(sheetId, filterColLabelRow0, 7, 9),
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true, fontSize: 10 },
          borders: { bottom: { style: 'SOLID', width: 1, color: BORDER_GRAY } },
        },
      },
      fields: 'userEnteredFormat(textFormat,borders)',
    },
  });

  // Checkbox cells (H81:H91) — data validation + center align
  requests.push({
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: firstCheckboxRow0,
        endRowIndex: lastCheckboxRow0,
        startColumnIndex: 7,
        endColumnIndex: 8,
      },
      rule: {
        condition: { type: 'BOOLEAN' },
        strict: true,
      },
    },
  });
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: firstCheckboxRow0,
        endRowIndex: lastCheckboxRow0,
        startColumnIndex: 7,
        endColumnIndex: 8,
      },
      cell: {
        userEnteredFormat: { horizontalAlignment: 'CENTER' },
      },
      fields: 'userEnteredFormat.horizontalAlignment',
    },
  });

  // ─── Rules table styling ────────────────────────────────────────────
  const rulesHeaderRow0 = RULES_HEADER_ROW_1_BASED - 1;       // 92
  const rulesExplanationRow0 = RULES_EXPLANATION_ROW_1_BASED - 1; // 93
  const rulesColHeaderRow0 = RULES_COL_HEADER_ROW_1_BASED - 1;   // 94
  const rulesFirstDataRow0 = RULES_FIRST_DATA_ROW_1_BASED - 1;   // 95
  const rulesLastDataRow0Exclusive = rulesFirstDataRow0 + FOCUS_MARKETS_ALPHABETICAL.length;

  // Section header: merge A:F, bold + pale blue
  requests.push({
    mergeCells: {
      range: rowRange(sheetId, rulesHeaderRow0, 0, 6),
      mergeType: 'MERGE_ALL',
    },
  });
  requests.push({
    repeatCell: {
      range: rowRange(sheetId, rulesHeaderRow0, 0, 6),
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true, fontSize: 12, foregroundColor: NAVY },
          backgroundColor: PALE_BLUE,
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment)',
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: rulesHeaderRow0, endIndex: rulesHeaderRow0 + 1 },
      properties: { pixelSize: 28 },
      fields: 'pixelSize',
    },
  });

  // Explanation: merge A:F, italic small gray, wrap
  requests.push({
    mergeCells: {
      range: rowRange(sheetId, rulesExplanationRow0, 0, 6),
      mergeType: 'MERGE_ALL',
    },
  });
  requests.push({
    repeatCell: {
      range: rowRange(sheetId, rulesExplanationRow0, 0, 6),
      cell: {
        userEnteredFormat: {
          textFormat: { italic: true, fontSize: 10, foregroundColor: { red: 0.3, green: 0.3, blue: 0.3 } },
          wrapStrategy: 'WRAP',
          verticalAlignment: 'TOP',
          padding: { top: 4, bottom: 4, left: 4, right: 4 },
        },
      },
      fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment,padding)',
    },
  });

  // Column headers: bold + bottom border
  requests.push({
    repeatCell: {
      range: rowRange(sheetId, rulesColHeaderRow0, 0, 3),
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true, fontSize: 10 },
          backgroundColor: { red: 0.96, green: 0.96, blue: 0.96 },
          borders: { bottom: { style: 'SOLID', width: 1, color: BORDER_GRAY } },
          wrapStrategy: 'WRAP',
          verticalAlignment: 'TOP',
        },
      },
      fields: 'userEnteredFormat(textFormat,backgroundColor,borders,wrapStrategy,verticalAlignment)',
    },
  });

  // Data rows: wrap text, top-align
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: rulesFirstDataRow0,
        endRowIndex: rulesLastDataRow0Exclusive,
        startColumnIndex: 0,
        endColumnIndex: 3,
      },
      cell: {
        userEnteredFormat: {
          textFormat: { fontSize: 10 },
          wrapStrategy: 'WRAP',
          verticalAlignment: 'TOP',
          padding: { top: 4, bottom: 4, left: 4, right: 4 },
        },
      },
      fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment,padding)',
    },
  });
  // Bold the Subsector name column
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: rulesFirstDataRow0,
        endRowIndex: rulesLastDataRow0Exclusive,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true, fontSize: 10 },
        },
      },
      fields: 'userEnteredFormat.textFormat',
    },
  });

  return requests;
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function buildChartRequests(sheetId) {
  return [
    // Chart 1: total new postings — column chart
    {
      addChart: {
        chart: {
          spec: {
            title: 'New Job Postings by Week',
            basicChart: {
              chartType: 'COLUMN',
              legendPosition: 'NO_LEGEND',
              headerCount: 1,
              axis: [
                { position: 'BOTTOM_AXIS', title: 'Week' },
                { position: 'LEFT_AXIS', title: 'New postings' },
              ],
              domains: [{
                domain: {
                  sourceRange: {
                    sources: [
                      { sheetId, startRowIndex: 1, endRowIndex: 14, startColumnIndex: 7, endColumnIndex: 8 },
                    ],
                  },
                },
              }],
              series: [{
                series: {
                  sourceRange: {
                    sources: [
                      { sheetId, startRowIndex: 1, endRowIndex: 14, startColumnIndex: 8, endColumnIndex: 9 },
                    ],
                  },
                },
                targetAxis: 'LEFT_AXIS',
              }],
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId, rowIndex: 58, columnIndex: 0 },
              offsetXPixels: 0,
              offsetYPixels: 0,
              widthPixels: 640,
              heightPixels: 360,
            },
          },
        },
      },
    },

    // Chart 2: subsector new postings — stacked column, filter-aware
    {
      addChart: {
        chart: {
          spec: {
            title: 'New Postings by Subsector per Week',
            basicChart: {
              chartType: 'COLUMN',
              stackedType: 'STACKED',
              legendPosition: 'RIGHT_LEGEND',
              headerCount: 1,
              axis: [
                { position: 'BOTTOM_AXIS', title: 'Week' },
                { position: 'LEFT_AXIS', title: 'New postings' },
              ],
              domains: [{
                domain: {
                  sourceRange: {
                    sources: [
                      { sheetId, startRowIndex: 1, endRowIndex: 14, startColumnIndex: 10, endColumnIndex: 11 },
                    ],
                  },
                },
              }],
              // One series per subsector column (L..V = idx 11..21).
              series: Array.from({ length: FOCUS_MARKETS_ALPHABETICAL.length }, (_, i) => ({
                series: {
                  sourceRange: {
                    sources: [{
                      sheetId,
                      startRowIndex: 1,
                      endRowIndex: 14,
                      startColumnIndex: FIRST_SUBSECTOR_COL + i,
                      endColumnIndex: FIRST_SUBSECTOR_COL + i + 1,
                    }],
                  },
                },
                targetAxis: 'LEFT_AXIS',
              })),
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId, rowIndex: 58, columnIndex: 7 },
              offsetXPixels: 0,
              offsetYPixels: 0,
              widthPixels: 720,
              heightPixels: 360,
            },
          },
        },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowRange(sheetId, rowIndex, startColumnIndex, endColumnIndex) {
  return {
    sheetId,
    startRowIndex: rowIndex,
    endRowIndex: rowIndex + 1,
    startColumnIndex,
    endColumnIndex,
  };
}

function setColumnWidth(sheetId, startIndex, endIndex, pixelSize) {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex, endIndex },
      properties: { pixelSize },
      fields: 'pixelSize',
    },
  };
}

/** 0-based column index → letter (0 → 'A', 25 → 'Z', 26 → 'AA'). */
function columnLetter(idx) {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}
