#!/usr/bin/env node

/**
 * Rebuild the Overview sheet in "Job Scraping Results" with live job counts.
 *
 * Reads every employer and aggregator worksheet directly, counts rows by Status,
 * then writes a clean, professionally formatted dashboard.
 *
 * Sections:
 *   1. Employer Summary  — Active / Inactive / Total per employer
 *   2. Aggregator Summary — Jobs Found / Sources / Last Run per profile
 *   3. Latest Run Report  — most recent run only (history moved to "Run History")
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
const OVERVIEW_SHEET_NAME = 'Overview';
const RUN_HISTORY_SHEET_NAME = 'Run History';

const DEFAULT_CREDENTIALS_PATH = path.join(
  __dirname, '../../job-scraping/config/service_account.json'
);

// Employer worksheets (must match scraper config sheet_name values)
const EMPLOYER_SHEETS = [
  'Baker Hughes',
  'Noble Corporation',
  'KBR',
  'Subsea7',
  'Halliburton',
  'TechnipFMC',
  'Schlumberger',
  'Chevron',
  'ConocoPhillips',
  'Occidental Petroleum',
  'Marathon Petroleum',
  'Worley',
  'Phillips 66',
  'BP',
  'ExxonMobil',
  'Transocean',
  'Interocean Marine Services',
  'Helix Energy Solutions',
  'Petrofac',
  'LRQA',
  'Oceaneering',
  'ROVOP',
  'Altrad Sparrows',
  'OSM Thome',
  'Wellsafe Solutions',
  'Allrig Group',
  'Coast Renewable Services',
  'Taurus Industrial Group',
  'PBS by Ponticelli',
  'Dron & Dickson',
  'Sulmara',
];

// Aggregator worksheets (prefix = "Aggregator - ")
const AGGREGATOR_SHEETS = [
  'Aggregator - subsea_oil_gas',
  'Aggregator - rope_access',
  'Aggregator - energy_trades',
  'Aggregator - survey_geophysical',
  'Aggregator - ndt_inspection',
  'Aggregator - drilling_operations',
  'Aggregator - marine_offshore_ops',
  'Aggregator - pipeline_mechanical',
  'Aggregator - industrial_construction',
  'Aggregator - process_plant_operations',
  'Aggregator - helix_energy',
  'Aggregator - interocean',
  'Aggregator - altrad_sparrows',
  'Aggregator - rovop',
  'Aggregator - oceaneering',
  'Aggregator - petrofac',
  'Aggregator - lrqa',
  'Aggregator - osm_thome',
  'Aggregator - wellsafe_solutions',
  'Aggregator - dron_dickson',
  'Aggregator - sulmara',
  'Aggregator - allrig',
  'Aggregator - taurus_ig',
  'Aggregator - rig_integrity',
  'Aggregator - finnco',
  'Aggregator - io_consulting',
  'Aggregator - pbs_ponticelli',
  'Aggregator - coast_renewable',
];

// Status column index (0-based). Header: Title(0), Company(1), Location(2),
// Description(3), URL(4), Requisition ID(5), Posted Date(6), Skills(7),
// Certifications(8), Salary(9), Employment Type(10), Status(11),
// Status Changed Date(12), Scraped At(13)
const STATUS_COL = 11;
const SCRAPED_AT_COL = 13;
const COMPANY_COL = 1;

// Colors (RGBA 0-1)
const NAVY = { red: 0.16, green: 0.22, blue: 0.35, alpha: 1 };
const WHITE = { red: 1, green: 1, blue: 1, alpha: 1 };
const LIGHT_GRAY = { red: 0.95, green: 0.95, blue: 0.96, alpha: 1 };
const TOTAL_ROW_BG = { red: 0.92, green: 0.94, blue: 0.98, alpha: 1 };
const SECTION_HEADER_BG = { red: 0.25, green: 0.32, blue: 0.45, alpha: 1 };
const BORDER_GRAY = { red: 0.78, green: 0.78, blue: 0.8, alpha: 1 };

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

/** Count active, inactive, and total rows; find the latest scraped-at date. */
function countRows(rows) {
  let active = 0;
  let inactive = 0;
  let latestScraped = '';

  // Skip header row (index 0)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const status = (row[STATUS_COL] || '').toString().toLowerCase().trim();
    if (status === 'active' || status === '') {
      active++;
    } else {
      // "removed", "inactive", or anything else
      inactive++;
    }

    const scraped = (row[SCRAPED_AT_COL] || '').toString();
    if (scraped > latestScraped) latestScraped = scraped;
  }

  return { active, inactive, total: active + inactive, latestScraped };
}

/** Extract unique companies from an aggregator worksheet. */
function getUniqueSources(rows) {
  const sources = new Set();
  for (let i = 1; i < rows.length; i++) {
    const company = (rows[i]?.[COMPANY_COL] || '').toString().trim();
    if (company) sources.add(company);
  }
  return [...sources];
}

/** Format ISO date string to YYYY-MM-DD */
function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    return isoStr.substring(0, 10);
  } catch {
    return '—';
  }
}

/** Pretty-print an aggregator profile name: "subsea_oil_gas" -> "Subsea Oil Gas" */
function formatProfileName(sheetName) {
  const profile = sheetName.replace('Aggregator - ', '');
  return profile
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// --- Main --------------------------------------------------------------------

async function main() {
  console.log('='.repeat(60));
  console.log('  Rebuild Overview Sheet — Live Job Counts');
  console.log('  Date: ' + new Date().toISOString());
  console.log('='.repeat(60));
  console.log('');

  const credentialsPath = getCredentialsPath();
  if (!credentialsPath) {
    console.error('No Google credentials found.');
    process.exit(1);
  }
  console.log('Credentials: ' + credentialsPath);

  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  // -------------------------------------------------------------------------
  // Step 1: Discover which worksheets actually exist
  // -------------------------------------------------------------------------
  console.log('\n[1/8] Discovering worksheets...');
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties.title,sheets.properties.sheetId',
  });
  const existingSheets = {};
  for (const s of spreadsheet.data.sheets) {
    existingSheets[s.properties.title] = s.properties.sheetId;
  }
  const overviewSheetId = existingSheets[OVERVIEW_SHEET_NAME];
  if (overviewSheetId === undefined) {
    console.error('Overview sheet not found!');
    process.exit(1);
  }
  console.log('  Found ' + Object.keys(existingSheets).length + ' worksheets');

  // -------------------------------------------------------------------------
  // Step 2: Read all employer worksheets and count jobs
  // -------------------------------------------------------------------------
  console.log('\n[2/8] Reading employer worksheets...');
  const employerData = [];

  // Batch read: read Status + Scraped At columns for all employer sheets
  const employerRanges = EMPLOYER_SHEETS
    .filter(name => existingSheets[name] !== undefined)
    .map(name => "'" + name + "'!A1:N");

  if (employerRanges.length > 0) {
    const batchRes = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges: employerRanges,
    });
    await delay(2000);

    for (const vr of batchRes.data.valueRanges) {
      // Extract sheet name from range like "'Baker Hughes'!A1:N"
      const sheetName = vr.range.split('!')[0].replace(/^'|'$/g, '');
      const rows = vr.values || [];
      const counts = countRows(rows);
      employerData.push({
        name: sheetName,
        active: counts.active,
        inactive: counts.inactive,
        total: counts.total,
        source: 'direct',
        lastScraped: formatDate(counts.latestScraped),
      });
      console.log('  ' + sheetName + ': ' + counts.active + ' active, ' + counts.inactive + ' inactive (' + counts.total + ' total)');
    }
  }

  // Sort by total descending
  employerData.sort((a, b) => b.total - a.total);

  // -------------------------------------------------------------------------
  // Step 3: Read aggregator worksheets
  // -------------------------------------------------------------------------
  console.log('\n[3/8] Reading aggregator worksheets...');
  const aggregatorData = [];

  const aggregatorRanges = AGGREGATOR_SHEETS
    .filter(name => existingSheets[name] !== undefined)
    .map(name => "'" + name + "'!A1:N");

  if (aggregatorRanges.length > 0) {
    const batchRes = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges: aggregatorRanges,
    });
    await delay(2000);

    for (const vr of batchRes.data.valueRanges) {
      const sheetName = vr.range.split('!')[0].replace(/^'|'$/g, '');
      const rows = vr.values || [];
      const counts = countRows(rows);
      const sources = getUniqueSources(rows);
      aggregatorData.push({
        name: sheetName,
        profileName: formatProfileName(sheetName),
        jobsFound: counts.total,
        active: counts.active,
        sources: sources.length > 0 ? sources.slice(0, 5).join(', ') : '—',
        lastRun: formatDate(counts.latestScraped),
      });
      console.log('  ' + sheetName + ': ' + counts.total + ' jobs from ' + sources.length + ' sources');
    }
  }

  // Sort by jobs found descending
  aggregatorData.sort((a, b) => b.jobsFound - a.jobsFound);

  // -------------------------------------------------------------------------
  // Step 4: Extract run reports and find the latest one
  // -------------------------------------------------------------------------
  console.log('\n[4/8] Reading current run reports...');
  const overviewRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Overview!A1:G500',
  });
  await delay(2000);

  const overviewRows = overviewRes.data.values || [];

  // Parse run reports — each starts with "--- Run Report: <timestamp> ---"
  const runReports = [];
  let currentReport = null;

  for (const row of overviewRows) {
    const cellA = (row[0] || '').toString();
    if (cellA.startsWith('--- Run Report')) {
      if (currentReport) runReports.push(currentReport);
      currentReport = { header: cellA, rows: [row] };
    } else if (currentReport) {
      currentReport.rows.push(row);
    }
  }
  if (currentReport) runReports.push(currentReport);

  console.log('  Found ' + runReports.length + ' run reports');

  // Find the latest run report (last one chronologically)
  const latestReport = runReports.length > 0 ? runReports[runReports.length - 1] : null;
  const historicalReports = runReports.slice(0, -1);

  // -------------------------------------------------------------------------
  // Step 5: Move historical reports to "Run History" sheet
  // -------------------------------------------------------------------------
  console.log('\n[5/8] Moving historical run reports to "Run History"...');

  if (historicalReports.length > 0) {
    // Create "Run History" sheet if it doesn't exist
    if (existingSheets[RUN_HISTORY_SHEET_NAME] === undefined) {
      console.log('  Creating "Run History" worksheet...');
      const addRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: RUN_HISTORY_SHEET_NAME,
              },
            },
          }],
        },
      });
      existingSheets[RUN_HISTORY_SHEET_NAME] =
        addRes.data.replies[0].addSheet.properties.sheetId;
      await delay(2000);
    }

    // Flatten historical reports into rows
    const historyRows = [];
    for (const report of historicalReports) {
      historyRows.push(...report.rows);
      historyRows.push([]); // blank separator
    }

    if (historyRows.length > 0) {
      // Clear existing Run History data
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: "'" + RUN_HISTORY_SHEET_NAME + "'!A1:G2000",
      });
      await delay(2000);

      // Write historical data
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: "'" + RUN_HISTORY_SHEET_NAME + "'!A1:G" + historyRows.length,
        valueInputOption: 'RAW',
        requestBody: { values: historyRows },
      });
      console.log('  Wrote ' + historyRows.length + ' rows to Run History');
      await delay(2000);
    }
  } else {
    console.log('  No historical reports to move');
  }

  // -------------------------------------------------------------------------
  // Step 6: Build and write the new Overview content
  // -------------------------------------------------------------------------
  console.log('\n[6/8] Building Overview content...');

  const allRows = [];

  // --- Section 1: Employer Summary ---
  allRows.push(['EMPLOYER SUMMARY', '', '', '', '', '']);
  allRows.push(['Employer', 'Active Jobs', 'Inactive Jobs', 'Total Jobs', 'Source', 'Last Scraped']);

  let totalActive = 0, totalInactive = 0, totalAll = 0;
  for (const emp of employerData) {
    allRows.push([emp.name, emp.active, emp.inactive, emp.total, emp.source, emp.lastScraped]);
    totalActive += emp.active;
    totalInactive += emp.inactive;
    totalAll += emp.total;
  }
  allRows.push(['TOTAL', totalActive, totalInactive, totalAll, '', '']);

  const employerSectionEnd = allRows.length; // 1-indexed row count

  // Blank separator
  allRows.push([]);
  allRows.push([]);

  // --- Section 2: Aggregator Summary ---
  const aggregatorSectionStart = allRows.length; // 0-indexed
  allRows.push(['AGGREGATOR SUMMARY', '', '', '', '', '']);
  allRows.push(['Profile', 'Active Jobs', 'Total Jobs', 'Sources', 'Last Run', '']);

  let aggTotalActive = 0, aggTotalJobs = 0;
  for (const agg of aggregatorData) {
    allRows.push([agg.profileName, agg.active, agg.jobsFound, agg.sources, agg.lastRun, '']);
    aggTotalActive += agg.active;
    aggTotalJobs += agg.jobsFound;
  }
  allRows.push(['TOTAL', aggTotalActive, aggTotalJobs, '', '', '']);

  const aggregatorSectionEnd = allRows.length;

  // Blank separator
  allRows.push([]);
  allRows.push([]);

  // --- Section 3: Latest Run Report ---
  const latestReportStart = allRows.length;
  if (latestReport) {
    allRows.push(['LATEST RUN REPORT', '', '', '', '', '']);
    for (const row of latestReport.rows) {
      // Pad to 6 columns
      const padded = [...(row || [])];
      while (padded.length < 7) padded.push('');
      allRows.push(padded.slice(0, 7));
    }
  }
  const latestReportEnd = allRows.length;

  // -------------------------------------------------------------------------
  // Step 7: Clear Overview and write new data
  // -------------------------------------------------------------------------
  console.log('\n[7/8] Writing data to Overview sheet...');

  // Clear everything
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Overview!A1:Z500',
  });
  await delay(2000);

  // Write all rows
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Overview!A1:G' + allRows.length,
    valueInputOption: 'RAW',
    requestBody: { values: allRows },
  });
  await delay(2000);

  console.log('  Wrote ' + allRows.length + ' rows');

  // -------------------------------------------------------------------------
  // Step 8: Apply formatting
  // -------------------------------------------------------------------------
  console.log('\n[8/8] Applying formatting...');

  const requests = [];

  // --- Frozen panes: freeze row 1 and column A ---
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId: overviewSheetId,
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
    { col: 0, width: 240 },  // A: Employer/Profile
    { col: 1, width: 110 },  // B: Active Jobs
    { col: 2, width: 120 },  // C: Inactive Jobs / Total Jobs
    { col: 3, width: 110 },  // D: Total Jobs / Sources
    { col: 4, width: 180 },  // E: Source / Sources / Last Run
    { col: 5, width: 120 },  // F: Last Scraped
    { col: 6, width: 100 },  // G: Status (run report)
  ];
  for (const cw of columnWidths) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: overviewSheetId,
          dimension: 'COLUMNS',
          startIndex: cw.col,
          endIndex: cw.col + 1,
        },
        properties: { pixelSize: cw.width },
        fields: 'pixelSize',
      },
    });
  }

  // --- Default row height for all rows ---
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: overviewSheetId,
        dimension: 'ROWS',
        startIndex: 0,
        endIndex: allRows.length + 5,
      },
      properties: { pixelSize: 24 },
      fields: 'pixelSize',
    },
  });

  // --- Default font for all cells ---
  requests.push({
    repeatCell: {
      range: {
        sheetId: overviewSheetId,
        startRowIndex: 0,
        endRowIndex: allRows.length,
        startColumnIndex: 0,
        endColumnIndex: 7,
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            fontSize: 10,
            fontFamily: 'Arial',
            foregroundColor: { red: 0.13, green: 0.13, blue: 0.13 },
          },
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
          padding: { left: 8, right: 8, top: 2, bottom: 2 },
        },
      },
      fields: 'userEnteredFormat(textFormat,verticalAlignment,wrapStrategy,padding)',
    },
  });

  // =====================================================
  // SECTION 1: Employer Summary
  // =====================================================

  // Row 0: "EMPLOYER SUMMARY" section title — dark navy, merged feel
  requests.push({
    repeatCell: {
      range: {
        sheetId: overviewSheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: 6,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: NAVY,
          textFormat: {
            foregroundColor: WHITE,
            bold: true,
            fontSize: 12,
            fontFamily: 'Arial',
          },
          horizontalAlignment: 'LEFT',
          verticalAlignment: 'MIDDLE',
          padding: { left: 10, right: 8, top: 4, bottom: 4 },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)',
    },
  });

  // Section title row height
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: overviewSheetId,
        dimension: 'ROWS',
        startIndex: 0,
        endIndex: 1,
      },
      properties: { pixelSize: 32 },
      fields: 'pixelSize',
    },
  });

  // Row 1: Column headers — dark navy bg, white bold text
  requests.push({
    repeatCell: {
      range: {
        sheetId: overviewSheetId,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 0,
        endColumnIndex: 6,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: SECTION_HEADER_BG,
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

  // Header row height
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: overviewSheetId,
        dimension: 'ROWS',
        startIndex: 1,
        endIndex: 2,
      },
      properties: { pixelSize: 28 },
      fields: 'pixelSize',
    },
  });

  // Employer data rows (rows 2 through employerSectionEnd-2): number formatting for B-D
  const employerDataStart = 2;
  const employerDataEnd = employerSectionEnd - 1; // exclude TOTAL row
  if (employerDataEnd > employerDataStart) {
    // Number columns B-D: right-aligned with comma formatting
    requests.push({
      repeatCell: {
        range: {
          sheetId: overviewSheetId,
          startRowIndex: employerDataStart,
          endRowIndex: employerDataEnd,
          startColumnIndex: 1,
          endColumnIndex: 4,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
            horizontalAlignment: 'RIGHT',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    });

    // Zebra striping on employer data rows
    for (let i = employerDataStart; i < employerDataEnd; i++) {
      if ((i - employerDataStart) % 2 === 1) {
        requests.push({
          repeatCell: {
            range: {
              sheetId: overviewSheetId,
              startRowIndex: i,
              endRowIndex: i + 1,
              startColumnIndex: 0,
              endColumnIndex: 6,
            },
            cell: {
              userEnteredFormat: { backgroundColor: LIGHT_GRAY },
            },
            fields: 'userEnteredFormat.backgroundColor',
          },
        });
      }
    }
  }

  // TOTAL row: bold, light blue bg
  const employerTotalRow = employerSectionEnd - 1;
  requests.push({
    repeatCell: {
      range: {
        sheetId: overviewSheetId,
        startRowIndex: employerTotalRow,
        endRowIndex: employerTotalRow + 1,
        startColumnIndex: 0,
        endColumnIndex: 6,
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
          numberFormat: { type: 'NUMBER', pattern: '#,##0' },
          horizontalAlignment: 'RIGHT',
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment)',
    },
  });
  // TOTAL label left-aligned
  requests.push({
    repeatCell: {
      range: {
        sheetId: overviewSheetId,
        startRowIndex: employerTotalRow,
        endRowIndex: employerTotalRow + 1,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
      cell: {
        userEnteredFormat: { horizontalAlignment: 'LEFT' },
      },
      fields: 'userEnteredFormat.horizontalAlignment',
    },
  });

  // Borders around employer summary (header + data + total)
  requests.push({
    updateBorders: {
      range: {
        sheetId: overviewSheetId,
        startRowIndex: 1,
        endRowIndex: employerSectionEnd,
        startColumnIndex: 0,
        endColumnIndex: 6,
      },
      top: THIN_BORDER,
      bottom: THIN_BORDER,
      left: THIN_BORDER,
      right: THIN_BORDER,
      innerHorizontal: THIN_BORDER,
      innerVertical: THIN_BORDER,
    },
  });

  // =====================================================
  // SECTION 2: Aggregator Summary
  // =====================================================

  // Section title row
  requests.push({
    repeatCell: {
      range: {
        sheetId: overviewSheetId,
        startRowIndex: aggregatorSectionStart,
        endRowIndex: aggregatorSectionStart + 1,
        startColumnIndex: 0,
        endColumnIndex: 6,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: NAVY,
          textFormat: {
            foregroundColor: WHITE,
            bold: true,
            fontSize: 12,
            fontFamily: 'Arial',
          },
          horizontalAlignment: 'LEFT',
          verticalAlignment: 'MIDDLE',
          padding: { left: 10, right: 8, top: 4, bottom: 4 },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)',
    },
  });

  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: overviewSheetId,
        dimension: 'ROWS',
        startIndex: aggregatorSectionStart,
        endIndex: aggregatorSectionStart + 1,
      },
      properties: { pixelSize: 32 },
      fields: 'pixelSize',
    },
  });

  // Column headers
  const aggHeaderRow = aggregatorSectionStart + 1;
  requests.push({
    repeatCell: {
      range: {
        sheetId: overviewSheetId,
        startRowIndex: aggHeaderRow,
        endRowIndex: aggHeaderRow + 1,
        startColumnIndex: 0,
        endColumnIndex: 6,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: SECTION_HEADER_BG,
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

  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: overviewSheetId,
        dimension: 'ROWS',
        startIndex: aggHeaderRow,
        endIndex: aggHeaderRow + 1,
      },
      properties: { pixelSize: 28 },
      fields: 'pixelSize',
    },
  });

  // Aggregator data rows
  const aggDataStart = aggHeaderRow + 1;
  const aggDataEnd = aggregatorSectionEnd - 1; // exclude TOTAL
  if (aggDataEnd > aggDataStart) {
    // Number columns B-C
    requests.push({
      repeatCell: {
        range: {
          sheetId: overviewSheetId,
          startRowIndex: aggDataStart,
          endRowIndex: aggDataEnd,
          startColumnIndex: 1,
          endColumnIndex: 3,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
            horizontalAlignment: 'RIGHT',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    });

    // Zebra striping
    for (let i = aggDataStart; i < aggDataEnd; i++) {
      if ((i - aggDataStart) % 2 === 1) {
        requests.push({
          repeatCell: {
            range: {
              sheetId: overviewSheetId,
              startRowIndex: i,
              endRowIndex: i + 1,
              startColumnIndex: 0,
              endColumnIndex: 6,
            },
            cell: {
              userEnteredFormat: { backgroundColor: LIGHT_GRAY },
            },
            fields: 'userEnteredFormat.backgroundColor',
          },
        });
      }
    }
  }

  // Aggregator TOTAL row
  const aggTotalRow = aggregatorSectionEnd - 1;
  requests.push({
    repeatCell: {
      range: {
        sheetId: overviewSheetId,
        startRowIndex: aggTotalRow,
        endRowIndex: aggTotalRow + 1,
        startColumnIndex: 0,
        endColumnIndex: 6,
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
          numberFormat: { type: 'NUMBER', pattern: '#,##0' },
          horizontalAlignment: 'RIGHT',
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment)',
    },
  });
  requests.push({
    repeatCell: {
      range: {
        sheetId: overviewSheetId,
        startRowIndex: aggTotalRow,
        endRowIndex: aggTotalRow + 1,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
      cell: {
        userEnteredFormat: { horizontalAlignment: 'LEFT' },
      },
      fields: 'userEnteredFormat.horizontalAlignment',
    },
  });

  // Borders around aggregator summary
  requests.push({
    updateBorders: {
      range: {
        sheetId: overviewSheetId,
        startRowIndex: aggHeaderRow,
        endRowIndex: aggregatorSectionEnd,
        startColumnIndex: 0,
        endColumnIndex: 6,
      },
      top: THIN_BORDER,
      bottom: THIN_BORDER,
      left: THIN_BORDER,
      right: THIN_BORDER,
      innerHorizontal: THIN_BORDER,
      innerVertical: THIN_BORDER,
    },
  });

  // =====================================================
  // SECTION 3: Latest Run Report
  // =====================================================

  if (latestReport) {
    // Section title
    requests.push({
      repeatCell: {
        range: {
          sheetId: overviewSheetId,
          startRowIndex: latestReportStart,
          endRowIndex: latestReportStart + 1,
          startColumnIndex: 0,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: NAVY,
            textFormat: {
              foregroundColor: WHITE,
              bold: true,
              fontSize: 12,
              fontFamily: 'Arial',
            },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            padding: { left: 10, right: 8, top: 4, bottom: 4 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)',
      },
    });

    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: overviewSheetId,
          dimension: 'ROWS',
          startIndex: latestReportStart,
          endIndex: latestReportStart + 1,
        },
        properties: { pixelSize: 32 },
        fields: 'pixelSize',
      },
    });

    // Run report header row (the "--- Run Report: ... ---" line)
    if (latestReportEnd > latestReportStart + 1) {
      const rrHeaderRow = latestReportStart + 1;
      requests.push({
        repeatCell: {
          range: {
            sheetId: overviewSheetId,
            startRowIndex: rrHeaderRow,
            endRowIndex: rrHeaderRow + 1,
            startColumnIndex: 0,
            endColumnIndex: 7,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: SECTION_HEADER_BG,
              textFormat: {
                foregroundColor: WHITE,
                bold: true,
                fontSize: 10,
                fontFamily: 'Arial',
              },
              horizontalAlignment: 'LEFT',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      });

      // Format column headers if present
      if (latestReportEnd > rrHeaderRow + 1) {
        const colHeaderRow = rrHeaderRow + 1;
        const firstCell = (allRows[colHeaderRow] || [])[0] || '';
        if (firstCell === 'Source') {
          requests.push({
            repeatCell: {
              range: {
                sheetId: overviewSheetId,
                startRowIndex: colHeaderRow,
                endRowIndex: colHeaderRow + 1,
                startColumnIndex: 0,
                endColumnIndex: 7,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.85, green: 0.85, blue: 0.87, alpha: 1 },
                  textFormat: {
                    bold: true,
                    fontSize: 9,
                    fontFamily: 'Arial',
                    foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
                  },
                  horizontalAlignment: 'LEFT',
                  verticalAlignment: 'MIDDLE',
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
            },
          });
        }
      }

      // Run report data number formatting
      requests.push({
        repeatCell: {
          range: {
            sheetId: overviewSheetId,
            startRowIndex: rrHeaderRow,
            endRowIndex: latestReportEnd,
            startColumnIndex: 1,
            endColumnIndex: 6,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: { type: 'NUMBER', pattern: '#,##0' },
              horizontalAlignment: 'RIGHT',
              textFormat: { fontSize: 9, fontFamily: 'Arial' },
            },
          },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment,textFormat)',
        },
      });

      // TOTAL rows in run report: bold with light blue
      for (let i = latestReportStart + 1; i < latestReportEnd; i++) {
        if ((allRows[i] || [])[0] === 'TOTAL') {
          requests.push({
            repeatCell: {
              range: {
                sheetId: overviewSheetId,
                startRowIndex: i,
                endRowIndex: i + 1,
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
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
          });
        }
      }

      // Borders around run report
      requests.push({
        updateBorders: {
          range: {
            sheetId: overviewSheetId,
            startRowIndex: rrHeaderRow,
            endRowIndex: latestReportEnd,
            startColumnIndex: 0,
            endColumnIndex: 7,
          },
          top: THIN_BORDER,
          bottom: THIN_BORDER,
          left: THIN_BORDER,
          right: THIN_BORDER,
          innerHorizontal: THIN_BORDER,
          innerVertical: THIN_BORDER,
        },
      });
    }
  }

  // --- Hide unused columns H-Z ---
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: overviewSheetId,
        dimension: 'COLUMNS',
        startIndex: 7,
        endIndex: 26,
      },
      properties: { hiddenByUser: true },
      fields: 'hiddenByUser',
    },
  });

  // --- Remove any existing basic filter before adding a new one ---
  requests.push({
    clearBasicFilter: {
      sheetId: overviewSheetId,
    },
  });

  // Apply all formatting
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests },
  });

  console.log('  Applied ' + requests.length + ' formatting requests');

  // -------------------------------------------------------------------------
  // Done!
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log('  Overview sheet rebuilt successfully!');
  console.log('  Employer Summary: ' + employerData.length + ' employers, ' + totalAll + ' total jobs');
  console.log('  Aggregator Summary: ' + aggregatorData.length + ' profiles, ' + aggTotalJobs + ' total jobs');
  console.log('  Run History: ' + historicalReports.length + ' reports archived');
  console.log('  Latest Report: ' + (latestReport ? latestReport.header : 'none'));
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('FATAL:', err.message);
  if (err.response) {
    console.error('API Error:', JSON.stringify(err.response.data, null, 2));
  }
  console.error(err.stack);
  process.exit(1);
});
