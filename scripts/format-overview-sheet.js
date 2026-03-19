#!/usr/bin/env node

/**
 * Format the Overview sheet in "Job Scraping Results" for a clean, professional look.
 *
 * Handles both sections:
 *   1. Summary table (Employer | Active Jobs | Inactive Jobs | Total Jobs)
 *   2. Run reports (timestamped scrape logs below the summary)
 *
 * Applies:
 *   - Dark navy header with white bold text
 *   - Frozen header row and first column
 *   - Column widths, row heights, font sizing
 *   - Number formatting with commas
 *   - Zebra-stripe alternating rows
 *   - Thin borders on all data cells
 *   - Sort summary data rows by Total Jobs descending
 *   - Filter dropdowns on headers
 *   - Clean up stale data in columns E-G of the summary section
 *
 * Usage:
 *   node scripts/format-overview-sheet.js
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration -----------------------------------------------------------

const SPREADSHEET_ID = '1xb3QBZG9Dtkyo_UmOGu3Oc3zMr2Cg1ohOyt-cd3WT7Y';
const OVERVIEW_SHEET_ID = 1712290111;

const DEFAULT_CREDENTIALS_PATH = path.join(
  __dirname, '../../job-scraping/config/service_account.json'
);

// Colors (RGBA 0-1)
const NAVY = { red: 0.16, green: 0.22, blue: 0.35, alpha: 1 };
const WHITE = { red: 1, green: 1, blue: 1, alpha: 1 };
const LIGHT_GRAY = { red: 0.95, green: 0.95, blue: 0.96, alpha: 1 };
const MEDIUM_GRAY = { red: 0.85, green: 0.85, blue: 0.87, alpha: 1 };
const BORDER_GRAY = { red: 0.78, green: 0.78, blue: 0.8, alpha: 1 };
const TOTAL_ROW_BG = { red: 0.92, green: 0.94, blue: 0.98, alpha: 1 };
const REPORT_HEADER_BG = { red: 0.25, green: 0.32, blue: 0.45, alpha: 1 };

const THIN_BORDER = {
  style: 'SOLID',
  colorStyle: { rgbColor: BORDER_GRAY },
};

// --- Helpers -----------------------------------------------------------------

function getCredentialsPath() {
  const envPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (fs.existsSync(DEFAULT_CREDENTIALS_PATH)) return DEFAULT_CREDENTIALS_PATH;
  return null;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Main --------------------------------------------------------------------

async function main() {
  console.log('='.repeat(60));
  console.log('  Format Overview Sheet');
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log('='.repeat(60));
  console.log('');

  const credentialsPath = getCredentialsPath();
  if (!credentialsPath) {
    console.error('No Google credentials found.');
    process.exit(1);
  }
  console.log(`Credentials: ${credentialsPath}`);

  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  // Step 1: Read current data
  console.log('\n[1/6] Reading current Overview data...');
  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Overview!A1:Z200',
  });
  const rows = dataRes.data.values || [];
  console.log(`  Found ${rows.length} rows`);

  // Identify summary section: rows 1 (header) through TOTAL row
  // Summary ends at the row containing "TOTAL" in column A within the first ~40 rows
  let summaryEndRow = 0; // 0-indexed
  let summaryDataRows = []; // employer data rows (not header, not blank, not TOTAL)
  for (let i = 1; i < Math.min(rows.length, 50); i++) {
    const cellA = (rows[i][0] || '').toString().trim();
    if (cellA === 'TOTAL') {
      summaryEndRow = i;
      break;
    }
    if (cellA === '') continue; // blank separator row
    summaryDataRows.push({ index: i, data: rows[i] });
  }

  if (summaryEndRow === 0) {
    console.error('Could not find TOTAL row in summary section. Aborting.');
    process.exit(1);
  }

  console.log(`  Summary section: rows 1-${summaryEndRow + 1} (${summaryDataRows.length} employers)`);

  // Sort employer rows by Total Jobs (column D, index 3) descending
  summaryDataRows.sort((a, b) => {
    const aTotal = parseInt(a.data[3]) || 0;
    const bTotal = parseInt(b.data[3]) || 0;
    return bTotal - aTotal;
  });

  // Rebuild summary data: header, sorted employers, blank, TOTAL
  const header = ['Employer', 'Active Jobs', 'Inactive Jobs', 'Total Jobs'];
  let totalActive = 0, totalInactive = 0, totalAll = 0;
  const sortedEmployerRows = summaryDataRows.map(r => {
    const active = parseInt(r.data[1]) || 0;
    const inactive = parseInt(r.data[2]) || 0;
    const total = parseInt(r.data[3]) || 0;
    totalActive += active;
    totalInactive += inactive;
    totalAll += total;
    return [r.data[0], active, inactive, total];
  });

  const newSummary = [header];
  newSummary.push(...sortedEmployerRows);
  newSummary.push([]); // blank row
  newSummary.push(['TOTAL', totalActive, totalInactive, totalAll]);

  const newSummaryEndRow = newSummary.length; // 1-indexed count
  const totalRowIndex = newSummaryEndRow - 1; // 0-indexed

  // Collect run report rows (everything after the old summary)
  const runReportStartOld = summaryEndRow + 1;
  // Skip blank rows between summary and first run report
  let runReportFirstData = runReportStartOld;
  while (runReportFirstData < rows.length && (!rows[runReportFirstData] || rows[runReportFirstData].every(c => !c))) {
    runReportFirstData++;
  }
  const runReportRows = rows.slice(runReportFirstData);

  // Step 2: Clear the sheet and rewrite clean data
  console.log('\n[2/6] Rewriting clean data...');

  // Clear everything first (columns A-G to remove stale data in E-G)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Overview!A1:Z500',
  });
  await delay(1000);

  // Write summary section
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Overview!A1:D${newSummaryEndRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: newSummary },
  });
  await delay(1000);

  // Write run reports starting 2 rows below summary
  const runReportStart = newSummaryEndRow + 2; // 1-indexed
  if (runReportRows.length > 0) {
    const runReportEnd = runReportStart + runReportRows.length - 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Overview!A${runReportStart}:G${runReportEnd}`,
      valueInputOption: 'RAW',
      requestBody: { values: runReportRows },
    });
    console.log(`  Wrote ${runReportRows.length} run report rows starting at row ${runReportStart}`);
  }
  await delay(1000);

  // Identify run report sub-header rows (contain "--- Run Report") and column header rows
  const runReportHeaderIndices = []; // 0-indexed sheet row
  const runReportColHeaderIndices = [];
  const runReportTotalIndices = [];
  for (let i = 0; i < runReportRows.length; i++) {
    const cellA = (runReportRows[i][0] || '').toString();
    if (cellA.startsWith('--- Run Report')) {
      runReportHeaderIndices.push(runReportStart - 1 + i); // 0-indexed
    } else if (cellA === 'Source') {
      runReportColHeaderIndices.push(runReportStart - 1 + i);
    } else if (cellA === 'TOTAL') {
      runReportTotalIndices.push(runReportStart - 1 + i);
    }
  }

  // Step 3: Apply formatting with batchUpdate
  console.log('\n[3/6] Applying formatting (batch 1: structure)...');

  const totalDataRows = newSummaryEndRow + 1 + runReportRows.length;
  const requests = [];

  // --- Frozen rows/columns ---
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId: OVERVIEW_SHEET_ID,
        gridProperties: {
          frozenRowCount: 1,
          frozenColumnCount: 1,
        },
      },
      fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
    },
  });

  // --- Column widths ---
  const columnWidths = [
    { col: 0, width: 220 },  // A: Employer/Source
    { col: 1, width: 110 },  // B: Active Jobs / Jobs Added
    { col: 2, width: 120 },  // C: Inactive Jobs / Jobs Removed
    { col: 3, width: 100 },  // D: Total Jobs / Active
    { col: 4, width: 100 },  // E: Inactive (run reports)
    { col: 5, width: 90 },   // F: Total (run reports)
    { col: 6, width: 180 },  // G: Status (run reports)
  ];
  for (const cw of columnWidths) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: OVERVIEW_SHEET_ID,
          dimension: 'COLUMNS',
          startIndex: cw.col,
          endIndex: cw.col + 1,
        },
        properties: { pixelSize: cw.width },
        fields: 'pixelSize',
      },
    });
  }

  // --- Row heights ---
  // Header row: 32px
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: OVERVIEW_SHEET_ID,
        dimension: 'ROWS',
        startIndex: 0,
        endIndex: 1,
      },
      properties: { pixelSize: 32 },
      fields: 'pixelSize',
    },
  });

  // All data rows: 21px
  if (totalDataRows > 1) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: OVERVIEW_SHEET_ID,
          dimension: 'ROWS',
          startIndex: 1,
          endIndex: Math.max(totalDataRows, newSummaryEndRow + 1 + runReportRows.length + 5),
        },
        properties: { pixelSize: 21 },
        fields: 'pixelSize',
      },
    });
  }

  // --- Summary header row (row 1): dark navy background, white bold text ---
  requests.push({
    repeatCell: {
      range: {
        sheetId: OVERVIEW_SHEET_ID,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: 4,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: NAVY,
          textFormat: {
            foregroundColor: WHITE,
            bold: true,
            fontSize: 11,
            fontFamily: 'Arial',
          },
          horizontalAlignment: 'LEFT',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
          padding: { left: 8, right: 8, top: 2, bottom: 2 },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)',
    },
  });

  // --- Summary data rows: font, alignment, text wrapping ---
  if (sortedEmployerRows.length > 0) {
    // Employer name column (A) - left-aligned text
    requests.push({
      repeatCell: {
        range: {
          sheetId: OVERVIEW_SHEET_ID,
          startRowIndex: 1,
          endRowIndex: 1 + sortedEmployerRows.length,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              fontSize: 10,
              fontFamily: 'Arial',
              bold: false,
              foregroundColor: { red: 0.13, green: 0.13, blue: 0.13 },
            },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'CLIP',
            padding: { left: 8, right: 8, top: 2, bottom: 2 },
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)',
      },
    });

    // Number columns (B-D) - right-aligned with comma formatting
    requests.push({
      repeatCell: {
        range: {
          sheetId: OVERVIEW_SHEET_ID,
          startRowIndex: 1,
          endRowIndex: 1 + sortedEmployerRows.length,
          startColumnIndex: 1,
          endColumnIndex: 4,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              fontSize: 10,
              fontFamily: 'Arial',
              bold: false,
              foregroundColor: { red: 0.13, green: 0.13, blue: 0.13 },
            },
            numberFormat: {
              type: 'NUMBER',
              pattern: '#,##0',
            },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'CLIP',
            padding: { left: 8, right: 8, top: 2, bottom: 2 },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)',
      },
    });
  }

  // --- TOTAL row: bold with light blue background ---
  requests.push({
    repeatCell: {
      range: {
        sheetId: OVERVIEW_SHEET_ID,
        startRowIndex: totalRowIndex,
        endRowIndex: totalRowIndex + 1,
        startColumnIndex: 0,
        endColumnIndex: 4,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: TOTAL_ROW_BG,
          textFormat: {
            bold: true,
            fontSize: 10,
            fontFamily: 'Arial',
            foregroundColor: NAVY,
          },
          horizontalAlignment: 'RIGHT',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
          numberFormat: {
            type: 'NUMBER',
            pattern: '#,##0',
          },
          padding: { left: 8, right: 8, top: 2, bottom: 2 },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,numberFormat,padding)',
    },
  });

  // TOTAL label left-aligned
  requests.push({
    repeatCell: {
      range: {
        sheetId: OVERVIEW_SHEET_ID,
        startRowIndex: totalRowIndex,
        endRowIndex: totalRowIndex + 1,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: 'LEFT',
        },
      },
      fields: 'userEnteredFormat.horizontalAlignment',
    },
  });

  // --- Borders around summary table ---
  requests.push({
    updateBorders: {
      range: {
        sheetId: OVERVIEW_SHEET_ID,
        startRowIndex: 0,
        endRowIndex: totalRowIndex + 1,
        startColumnIndex: 0,
        endColumnIndex: 4,
      },
      top: THIN_BORDER,
      bottom: THIN_BORDER,
      left: THIN_BORDER,
      right: THIN_BORDER,
      innerHorizontal: THIN_BORDER,
      innerVertical: THIN_BORDER,
    },
  });

  // --- Zebra striping on summary data rows ---
  for (let i = 0; i < sortedEmployerRows.length; i++) {
    if (i % 2 === 1) {
      requests.push({
        repeatCell: {
          range: {
            sheetId: OVERVIEW_SHEET_ID,
            startRowIndex: 1 + i,
            endRowIndex: 2 + i,
            startColumnIndex: 0,
            endColumnIndex: 4,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: LIGHT_GRAY,
            },
          },
          fields: 'userEnteredFormat.backgroundColor',
        },
      });
    }
  }

  // --- Basic filter on summary header ---
  requests.push({
    setBasicFilter: {
      filter: {
        range: {
          sheetId: OVERVIEW_SHEET_ID,
          startRowIndex: 0,
          endRowIndex: 1 + sortedEmployerRows.length,
          startColumnIndex: 0,
          endColumnIndex: 4,
        },
      },
    },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests },
  });
  console.log(`  Applied ${requests.length} formatting requests`);
  await delay(2000);

  // Step 4: Format run reports section
  console.log('\n[4/6] Formatting run reports section...');

  const reportRequests = [];

  // Run report section headers ("--- Run Report: ... ---") - dark background, white text, merge across cols
  for (const rowIdx of runReportHeaderIndices) {
    reportRequests.push({
      repeatCell: {
        range: {
          sheetId: OVERVIEW_SHEET_ID,
          startRowIndex: rowIdx,
          endRowIndex: rowIdx + 1,
          startColumnIndex: 0,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: REPORT_HEADER_BG,
            textFormat: {
              foregroundColor: WHITE,
              bold: true,
              fontSize: 10,
              fontFamily: 'Arial',
            },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'CLIP',
            padding: { left: 8, right: 8, top: 2, bottom: 2 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)',
      },
    });
  }

  // Run report column headers (Source, Jobs Added, etc.) - medium gray bg, bold
  for (const rowIdx of runReportColHeaderIndices) {
    reportRequests.push({
      repeatCell: {
        range: {
          sheetId: OVERVIEW_SHEET_ID,
          startRowIndex: rowIdx,
          endRowIndex: rowIdx + 1,
          startColumnIndex: 0,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: MEDIUM_GRAY,
            textFormat: {
              bold: true,
              fontSize: 9,
              fontFamily: 'Arial',
              foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
            },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'CLIP',
            padding: { left: 8, right: 8, top: 1, bottom: 1 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)',
      },
    });
  }

  // Run report TOTAL rows - light blue, bold
  for (const rowIdx of runReportTotalIndices) {
    reportRequests.push({
      repeatCell: {
        range: {
          sheetId: OVERVIEW_SHEET_ID,
          startRowIndex: rowIdx,
          endRowIndex: rowIdx + 1,
          startColumnIndex: 0,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: TOTAL_ROW_BG,
            textFormat: {
              bold: true,
              fontSize: 9,
              fontFamily: 'Arial',
              foregroundColor: NAVY,
            },
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'CLIP',
            padding: { left: 8, right: 8, top: 1, bottom: 1 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy,padding)',
      },
    });
  }

  // All run report data rows: set font to 9pt Arial, number format
  if (runReportRows.length > 0) {
    const rrStartIdx = runReportStart - 1; // 0-indexed
    const rrEndIdx = rrStartIdx + runReportRows.length;

    // Number columns in run reports (B-F, indices 1-5)
    reportRequests.push({
      repeatCell: {
        range: {
          sheetId: OVERVIEW_SHEET_ID,
          startRowIndex: rrStartIdx,
          endRowIndex: rrEndIdx,
          startColumnIndex: 1,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: 'NUMBER',
              pattern: '#,##0',
            },
            horizontalAlignment: 'RIGHT',
            textFormat: {
              fontSize: 9,
              fontFamily: 'Arial',
            },
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,textFormat)',
      },
    });

    // Text columns A and G
    reportRequests.push({
      repeatCell: {
        range: {
          sheetId: OVERVIEW_SHEET_ID,
          startRowIndex: rrStartIdx,
          endRowIndex: rrEndIdx,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              fontSize: 9,
              fontFamily: 'Arial',
            },
            horizontalAlignment: 'LEFT',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
      },
    });

    reportRequests.push({
      repeatCell: {
        range: {
          sheetId: OVERVIEW_SHEET_ID,
          startRowIndex: rrStartIdx,
          endRowIndex: rrEndIdx,
          startColumnIndex: 6,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              fontSize: 9,
              fontFamily: 'Arial',
            },
            horizontalAlignment: 'LEFT',
            wrapStrategy: 'CLIP',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,wrapStrategy)',
      },
    });

    // Light borders around run report blocks
    reportRequests.push({
      updateBorders: {
        range: {
          sheetId: OVERVIEW_SHEET_ID,
          startRowIndex: rrStartIdx,
          endRowIndex: rrEndIdx,
          startColumnIndex: 0,
          endColumnIndex: 7,
        },
        innerHorizontal: { style: 'SOLID_MEDIUM', colorStyle: { rgbColor: { red: 0.93, green: 0.93, blue: 0.93 } } },
        innerVertical: { style: 'SOLID', colorStyle: { rgbColor: { red: 0.9, green: 0.9, blue: 0.9 } } },
      },
    });
  }

  if (reportRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: reportRequests },
    });
    console.log(`  Applied ${reportRequests.length} run report formatting requests`);
    await delay(1000);
  }

  // Step 5: Clear any residual content in columns E-Z of the summary section
  console.log('\n[5/6] Clearing residual data in extra columns...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `Overview!E1:Z${newSummaryEndRow}`,
  });

  // Step 6: Hide unused columns H-Z
  console.log('\n[6/6] Hiding unused columns...');
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        updateDimensionProperties: {
          range: {
            sheetId: OVERVIEW_SHEET_ID,
            dimension: 'COLUMNS',
            startIndex: 7,  // column H
            endIndex: 26,   // column Z
          },
          properties: { hiddenByUser: true },
          fields: 'hiddenByUser',
        },
      }],
    },
  });

  console.log('\nDone! Overview sheet formatted successfully.');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  if (err.response) {
    console.error('API Error:', JSON.stringify(err.response.data, null, 2));
  }
  console.error(err.stack);
  process.exit(1);
});
