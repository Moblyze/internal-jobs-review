// scripts/trend-report/formatting.js
/**
 * Dashboard styling + charts. Applied after replaceTab writes the raw values.
 *
 * - Writes chart-source QUERY formulas at H1 / K1 (off the BD-visible A:F area).
 * - Bolds the title, section headers, and column-header rows.
 * - Sets column widths for readability.
 * - Deletes any existing embedded charts on the tab (so re-runs stay clean).
 * - Adds two charts: Total active by week (line), Subsector active by week
 *   (stacked area).
 *
 * All operations are idempotent — re-applying is safe.
 */

const TREND_DATA = 'Trend Data';

// Row indices (0-based) for rows that need special formatting. These match
// the layout emitted by buildDashboardValues() in dashboard.js.
const TITLE_ROW = 0;
const META_ROWS = [1, 2];
const SECTION_HEADER_ROWS = [4, 11, 18, 31, 45];
const COLUMN_HEADER_ROWS = [12, 19, 32, 46];

// Palette
const NAVY = { red: 0.12, green: 0.22, blue: 0.38 };
const PALE_BLUE = { red: 0.91, green: 0.94, blue: 0.98 };
const WHITE = { red: 1, green: 1, blue: 1 };
const BORDER_GRAY = { red: 0.6, green: 0.6, blue: 0.6 };

export async function formatDashboard(sheets, spreadsheetId, dashboardSheetId, dashboardTitle) {
  await writeChartSource(sheets, spreadsheetId, dashboardTitle);

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

async function writeChartSource(sheets, spreadsheetId, dashboardTitle) {
  const totalActiveFormula =
    `=QUERY('${TREND_DATA}'!A:D, "select A, sum(D) where B = 'employer' group by A order by A label A 'Week', sum(D) 'Total Active'", 1)`;
  const subsectorFormula =
    `=QUERY('${TREND_DATA}'!A:D, "select A, sum(D) where B = 'subsector' group by A pivot C order by A", 1)`;

  // Row 1: labels. Row 2: formulas that spill downward.
  const values = [
    ['Chart: Total Active by Week', '', '', 'Chart: Subsector Active by Week'],
    [totalActiveFormula, '', '', subsectorFormula],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${dashboardTitle}!H1:L2`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
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

function buildFormattingRequests(sheetId) {
  const requests = [];

  // Column widths
  requests.push(setColumnWidth(sheetId, 0, 1, 280)); // A: insight text
  requests.push(setColumnWidth(sheetId, 1, 2, 160)); // B: metric labels / values
  requests.push(setColumnWidth(sheetId, 2, 6, 110)); // C-F: numeric columns
  requests.push(setColumnWidth(sheetId, 6, 7, 20));  // G: visual gap
  requests.push(setColumnWidth(sheetId, 7, 11, 100)); // H-K: chart source

  // Title row — merge, bold, large, navy bg, white text, centered
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
  // Title row height
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: TITLE_ROW, endIndex: TITLE_ROW + 1 },
      properties: { pixelSize: 40 },
      fields: 'pixelSize',
    },
  });

  // Metadata rows (Last updated / Current week)
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

  // Section headers (Key insights, This week at a glance, Top 10..., etc.)
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

  // Column-header rows (Metric/Value, Employer/Active/..., etc.)
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

  return requests;
}

function buildChartRequests(sheetId) {
  return [
    // Chart 1: Total Active by Week — line chart
    {
      addChart: {
        chart: {
          spec: {
            title: 'Total Active Jobs by Week',
            basicChart: {
              chartType: 'LINE',
              legendPosition: 'NO_LEGEND',
              headerCount: 1,
              axis: [
                { position: 'BOTTOM_AXIS', title: 'Week' },
                { position: 'LEFT_AXIS', title: 'Active jobs' },
              ],
              domains: [
                {
                  domain: {
                    sourceRange: {
                      sources: [
                        { sheetId, startRowIndex: 1, endRowIndex: 14, startColumnIndex: 7, endColumnIndex: 8 }, // H2:H14
                      ],
                    },
                  },
                },
              ],
              series: [
                {
                  series: {
                    sourceRange: {
                      sources: [
                        { sheetId, startRowIndex: 1, endRowIndex: 14, startColumnIndex: 8, endColumnIndex: 9 }, // I2:I14
                      ],
                    },
                  },
                  targetAxis: 'LEFT_AXIS',
                },
              ],
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
    // Chart 2: Subsector Active by Week — stacked area
    {
      addChart: {
        chart: {
          spec: {
            title: 'Subsector Active Jobs by Week',
            basicChart: {
              chartType: 'AREA',
              stackedType: 'STACKED',
              legendPosition: 'RIGHT_LEGEND',
              headerCount: 1,
              axis: [
                { position: 'BOTTOM_AXIS', title: 'Week' },
                { position: 'LEFT_AXIS', title: 'Active jobs' },
              ],
              domains: [
                {
                  domain: {
                    sourceRange: {
                      sources: [
                        { sheetId, startRowIndex: 1, endRowIndex: 14, startColumnIndex: 10, endColumnIndex: 11 }, // K2:K14
                      ],
                    },
                  },
                },
              ],
              // One series per subsector column. Pivot produces columns L..V
              // (up to 11 focus markets). Sheets ignores empty source columns
              // silently, so hardcoding 11 is safe.
              series: Array.from({ length: 11 }, (_, i) => ({
                series: {
                  sourceRange: {
                    sources: [
                      {
                        sheetId,
                        startRowIndex: 1,
                        endRowIndex: 14,
                        startColumnIndex: 11 + i,
                        endColumnIndex: 12 + i,
                      },
                    ],
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
