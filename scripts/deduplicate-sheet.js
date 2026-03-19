#!/usr/bin/env node

/**
 * Deduplicate Google Sheet job data
 *
 * The daily scrape CI runs re-exported the same jobs every run because
 * the SQLite dedup tracker wasn't persisted between CI runs.  This
 * resulted in ~46K rows when there are only ~9,600 unique jobs.
 *
 * Dedup rules:
 *   - Within a single source: one row per unique (company + title + location)
 *   - Across sources the same job CAN appear (e.g. direct + Jooble) — that's fine
 *   - When duplicates exist, keep the most recent entry (by Scraped At timestamp)
 *
 * All worksheets live in a single "Job Scraping Results" spreadsheet.
 * Each worksheet IS a source (company or aggregator profile), so
 * dedup key = lowercase(company + title + location).
 *
 * The "Aggregator Jobs" worksheet contains mixed sources, so its
 * dedup key = lowercase(source + company + title + location).
 *
 * Usage:
 *   node scripts/deduplicate-sheet.js --dry-run   # report only, no changes
 *   node scripts/deduplicate-sheet.js              # deduplicate in place
 *
 * Environment:
 *   GOOGLE_SERVICE_ACCOUNT_PATH  — path to service account JSON
 *     (falls back to ../../job-scraping/config/service_account.json)
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration -----------------------------------------------------------

const SPREADSHEET_NAME = 'Job Scraping Results';

// Sheets to skip entirely (not job data or managed separately)
const SKIP_SHEETS = ['Overview'];

// Column indices for the employer sheets (A-N, 14 columns)
const EMPLOYER_SCRAPED_AT_COL = 13;  // Column N (0-indexed)

// Column indices for the aggregator sheet (A-P, 16 columns)
const AGG_SOURCE_COL = 6;       // Column G
const AGG_COMPANY_COL = 2;      // Column C
const AGG_TITLE_COL = 1;        // Column B
const AGG_LOCATION_COL = 3;     // Column D
const AGG_SCRAPED_AT_COL = 15;  // Column P

// Default credentials path
const DEFAULT_CREDENTIALS_PATH = path.join(
  __dirname, '../../job-scraping/config/service_account.json'
);

// --- Helpers -----------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
  };
}

function getCredentialsPath() {
  const envPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (fs.existsSync(DEFAULT_CREDENTIALS_PATH)) return DEFAULT_CREDENTIALS_PATH;
  return null;
}

async function authenticate(credentialsPath) {
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });
  return auth.getClient();
}

async function findSpreadsheetId(auth) {
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.list({
    q: `name='${SPREADSHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet'`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });
  if (!response.data.files || response.data.files.length === 0) {
    throw new Error(`Spreadsheet "${SPREADSHEET_NAME}" not found.`);
  }
  return response.data.files[0].id;
}

/**
 * Parse a date string into a timestamp for comparison.
 * Returns 0 if the string is empty or unparseable.
 */
function parseTimestamp(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * Normalise a string for dedup key: lowercase, trim, collapse whitespace.
 */
function norm(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// --- Deduplication logic -----------------------------------------------------

/**
 * Deduplicate rows within a single employer worksheet.
 *
 * Headers are expected in HEADER_ROW order:
 *   Title(0) Company(1) Location(2) ... Scraped At(13)
 *
 * Dedup key: company + title + location (all normalised).
 * Tie-break: most recent Scraped At wins.
 *
 * @param {string[][]} rows  Data rows (no header)
 * @param {string[]} headers Header row
 * @returns {{ kept: string[][], removed: number }}
 */
function deduplicateEmployerRows(rows, headers) {
  // Build column map from headers for safety
  const colIdx = {};
  headers.forEach((h, i) => { colIdx[h] = i; });

  const titleCol = colIdx['Title'] ?? 0;
  const companyCol = colIdx['Company'] ?? 1;
  const locationCol = colIdx['Location'] ?? 2;
  const scrapedAtCol = colIdx['Scraped At'] ?? EMPLOYER_SCRAPED_AT_COL;

  const groups = new Map(); // key -> { row, ts }

  for (const row of rows) {
    const key = [
      norm(row[companyCol]),
      norm(row[titleCol]),
      norm(row[locationCol]),
    ].join('|||');

    const ts = parseTimestamp(row[scrapedAtCol]);
    const existing = groups.get(key);

    if (!existing || ts > existing.ts) {
      groups.set(key, { row, ts });
    }
  }

  const kept = Array.from(groups.values()).map(g => g.row);
  return { kept, removed: rows.length - kept.length };
}

/**
 * Deduplicate rows within the Aggregator worksheet.
 *
 * Dedup key: source + company + title + location (all normalised).
 * Tie-break: most recent Scraped At wins.
 *
 * @param {string[][]} rows  Data rows (no header)
 * @param {string[]} headers Header row
 * @returns {{ kept: string[][], removed: number }}
 */
function deduplicateAggregatorRows(rows, headers) {
  const colIdx = {};
  headers.forEach((h, i) => { colIdx[h] = i; });

  const sourceCol = colIdx['Source'] ?? AGG_SOURCE_COL;
  const companyCol = colIdx['Company'] ?? AGG_COMPANY_COL;
  const titleCol = colIdx['Title'] ?? AGG_TITLE_COL;
  const locationCol = colIdx['Location'] ?? AGG_LOCATION_COL;
  const scrapedAtCol = colIdx['Scraped At'] ?? AGG_SCRAPED_AT_COL;

  const groups = new Map();

  for (const row of rows) {
    const key = [
      norm(row[sourceCol]),
      norm(row[companyCol]),
      norm(row[titleCol]),
      norm(row[locationCol]),
    ].join('|||');

    const ts = parseTimestamp(row[scrapedAtCol]);
    const existing = groups.get(key);

    if (!existing || ts > existing.ts) {
      groups.set(key, { row, ts });
    }
  }

  const kept = Array.from(groups.values()).map(g => g.row);
  return { kept, removed: rows.length - kept.length };
}

// --- Row height --------------------------------------------------------------

const ROW_HEIGHT_PX = 21; // Standard single-line height (~1 inch)

/**
 * Set all data rows (skip header) to a fixed pixel height.
 */
async function setRowHeights(sheets, spreadsheetId, sheetId, rowCount) {
  if (rowCount <= 1) return; // nothing beyond the header
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: 1, // skip header
            endIndex: rowCount,
          },
          properties: { pixelSize: ROW_HEIGHT_PX },
          fields: 'pixelSize',
        },
      }],
    },
  });
}

// --- Rate-limit helper -------------------------------------------------------

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const SHEET_OP_DELAY_MS = 2500; // 2.5s between sheet operations

// --- Sheet rewrite -----------------------------------------------------------

/**
 * Clear a worksheet and rewrite it with header + rows.
 *
 * Strategy: clear all data, then write header + rows in one batch.
 * This avoids partial-write issues.
 */
async function rewriteSheet(sheets, spreadsheetId, sheetName, headers, rows) {
  // Clear everything
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${sheetName}'`,
  });

  if (rows.length === 0) {
    // Write just the header
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
    return;
  }

  // Write header + all rows in one call
  const allData = [headers, ...rows];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: allData },
  });
}

// --- Main --------------------------------------------------------------------

async function main() {
  const { dryRun } = parseArgs();

  console.log('='.repeat(60));
  console.log(`  Google Sheets Job Deduplication`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will modify sheets)'}`);
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log('='.repeat(60));
  console.log('');

  // --- Authenticate ----------------------------------------------------------
  const credentialsPath = getCredentialsPath();
  if (!credentialsPath) {
    console.error(
      'ERROR: No Google service account credentials found.\n' +
      'Set GOOGLE_SERVICE_ACCOUNT_PATH or place service_account.json at:\n' +
      `  ${DEFAULT_CREDENTIALS_PATH}`
    );
    process.exit(1);
  }
  console.log(`Credentials: ${credentialsPath}`);

  const auth = await authenticate(credentialsPath);
  const sheets = google.sheets({ version: 'v4', auth });

  // --- Track totals ----------------------------------------------------------
  const report = [];
  let grandTotalBefore = 0;
  let grandTotalAfter = 0;

  // ==========================================================================
  // Process all worksheets in "Job Scraping Results"
  // ==========================================================================
  console.log('\n--- Spreadsheet: "Job Scraping Results" ---\n');

  const employerSpreadsheetId = await findSpreadsheetId(auth);
  console.log(`Spreadsheet ID: ${employerSpreadsheetId}`);

  const employerMeta = await sheets.spreadsheets.get({
    spreadsheetId: employerSpreadsheetId,
  });

  for (const sheet of employerMeta.data.sheets) {
    const sheetName = sheet.properties.title;

    if (SKIP_SHEETS.includes(sheetName)) {
      console.log(`  [SKIP] "${sheetName}" (excluded)`);
      continue;
    }

    // Read all data
    const lastCol = sheetName === 'Aggregator Jobs' ? 'P' : 'N';
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: employerSpreadsheetId,
      range: `'${sheetName}'!A:${lastCol}`,
    });

    const allRows = response.data.values || [];
    if (allRows.length <= 1) {
      console.log(`  [SKIP] "${sheetName}" (empty or header only)`);
      continue;
    }

    const headers = allRows[0];
    const dataRows = allRows.slice(1);

    // Choose dedup strategy
    let result;
    if (sheetName === 'Aggregator Jobs') {
      result = deduplicateAggregatorRows(dataRows, headers);
    } else {
      result = deduplicateEmployerRows(dataRows, headers);
    }

    const before = dataRows.length;
    const after = result.kept.length;
    const removed = result.removed;
    const pct = before > 0 ? ((removed / before) * 100).toFixed(1) : '0.0';

    grandTotalBefore += before;
    grandTotalAfter += after;

    report.push({
      sheet: sheetName,
      before,
      after,
      removed,
      pct,
    });

    if (removed === 0) {
      console.log(`  [OK]   "${sheetName}": ${before} rows, no duplicates`);
      if (!dryRun) {
        const totalRows = before + 1; // +1 for header
        await setRowHeights(sheets, employerSpreadsheetId, sheet.properties.sheetId, totalRows);
        console.log(`         Row heights set to ${ROW_HEIGHT_PX}px.`);
        await delay(SHEET_OP_DELAY_MS);
      }
    } else {
      console.log(`  [DEDUP] "${sheetName}": ${before} -> ${after} rows (removed ${removed}, ${pct}%)`);

      if (!dryRun) {
        console.log(`         Writing deduplicated data...`);
        await rewriteSheet(sheets, employerSpreadsheetId, sheetName, headers, result.kept);
        // Set row heights to keep rows compact
        const totalRows = result.kept.length + 1; // +1 for header
        await setRowHeights(sheets, employerSpreadsheetId, sheet.properties.sheetId, totalRows);
        console.log(`         Done (rows resized to ${ROW_HEIGHT_PX}px).`);
        await delay(SHEET_OP_DELAY_MS);
      }
    }
  }

  // ==========================================================================
  // Report
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('  DEDUPLICATION REPORT');
  console.log('='.repeat(60));
  console.log('');

  // Column widths
  const maxSheet = Math.max(20, ...report.map(r => r.sheet.length));

  console.log(
    'Worksheet'.padEnd(maxSheet + 2) +
    'Before'.padStart(8) +
    'After'.padStart(8) +
    'Removed'.padStart(9) +
    '  %'
  );
  console.log('-'.repeat(maxSheet + 2 + 8 + 8 + 9 + 8));

  for (const r of report) {
    const label = r.sheet;
    console.log(
      label.padEnd(maxSheet + 2) +
      String(r.before).padStart(8) +
      String(r.after).padStart(8) +
      String(r.removed).padStart(9) +
      String(r.pct + '%').padStart(8)
    );
  }

  console.log('-'.repeat(maxSheet + 2 + 8 + 8 + 9 + 8));

  const grandRemoved = grandTotalBefore - grandTotalAfter;
  const grandPct = grandTotalBefore > 0
    ? ((grandRemoved / grandTotalBefore) * 100).toFixed(1)
    : '0.0';

  console.log(
    'TOTAL'.padEnd(maxSheet + 2) +
    String(grandTotalBefore).padStart(8) +
    String(grandTotalAfter).padStart(8) +
    String(grandRemoved).padStart(9) +
    String(grandPct + '%').padStart(8)
  );

  console.log('');
  if (dryRun) {
    console.log('DRY RUN complete. No changes were made to any sheets.');
    console.log('Run without --dry-run to apply deduplication.');
  } else {
    console.log('Deduplication complete. All sheets have been updated.');
  }
  console.log('');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
