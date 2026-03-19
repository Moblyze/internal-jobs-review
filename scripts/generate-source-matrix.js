/**
 * Generate Source Coverage Matrix and Target Companies worksheets in Google Sheets
 *
 * Reads job data from public/data/jobs-index.json, builds a companies x sources
 * matrix showing job counts, and writes it to the Google Sheet used by the scrapers.
 *
 * Also creates a "Target Companies" worksheet with intelligence data from companies.json.
 *
 * Usage:
 *   node scripts/generate-source-matrix.js
 *   node scripts/generate-source-matrix.js --dry-run
 *
 * Environment:
 *   GOOGLE_SERVICE_ACCOUNT_PATH - path to service account JSON (default: ../job-scraping/config/service_account.json)
 *   GOOGLE_SHEETS_SPREADSHEET_NAME - spreadsheet name (default: 'Job Scraping Results')
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const DEFAULT_CREDENTIALS_PATH = path.join(__dirname, '../../job-scraping/config/service_account.json');
const SPREADSHEET_NAME = process.env.GOOGLE_SHEETS_SPREADSHEET_NAME || 'Job Scraping Results';
const JOBS_INDEX_PATH = path.join(__dirname, '../public/data/jobs-index.json');
const COMPANIES_JSON_PATH = path.join(__dirname, '../public/data/companies.json');

const DRY_RUN = process.argv.includes('--dry-run');

// ── Authentication ──────────────────────────────────────────────────────────

async function authenticate() {
  const credPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || DEFAULT_CREDENTIALS_PATH;

  if (!fs.existsSync(credPath)) {
    throw new Error(
      `Service account credentials not found at: ${credPath}\n` +
      'Set GOOGLE_SERVICE_ACCOUNT_PATH env var or place credentials file.'
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: credPath,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });

  return await auth.getClient();
}

async function getSpreadsheetId(auth) {
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.list({
    q: `name='${SPREADSHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet'`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (!response.data.files || response.data.files.length === 0) {
    throw new Error(`Spreadsheet "${SPREADSHEET_NAME}" not found. Make sure it's shared with the service account.`);
  }

  return response.data.files[0].id;
}

// ── Data Loading ────────────────────────────────────────────────────────────

function loadJobsIndex() {
  if (!fs.existsSync(JOBS_INDEX_PATH)) {
    throw new Error(`Jobs index not found: ${JOBS_INDEX_PATH}. Run "npm run export-jobs" first.`);
  }

  const jobs = JSON.parse(fs.readFileSync(JOBS_INDEX_PATH, 'utf8'));
  console.log(`Loaded ${jobs.length} jobs from jobs-index.json`);
  return jobs;
}

function loadCompaniesJson() {
  if (!fs.existsSync(COMPANIES_JSON_PATH)) {
    console.warn('companies.json not found, Target Companies sheet will be skipped.');
    return null;
  }

  const data = JSON.parse(fs.readFileSync(COMPANIES_JSON_PATH, 'utf8'));
  return data.companies || [];
}

// ── Matrix Building ─────────────────────────────────────────────────────────

function buildSourceMatrix(jobs) {
  // Only count active jobs (not removed/paused)
  const activeJobs = jobs.filter(j => j.status !== 'removed' && j.status !== 'paused');
  console.log(`Active jobs: ${activeJobs.length} (of ${jobs.length} total)`);

  // Collect all sources and companies
  const sourceSet = new Set();
  const companySourceCounts = {}; // { company: { source: count } }

  for (const job of activeJobs) {
    const company = job.company || 'Unknown';
    const source = job.source || 'direct';

    sourceSet.add(source);

    if (!companySourceCounts[company]) {
      companySourceCounts[company] = {};
    }
    companySourceCounts[company][source] = (companySourceCounts[company][source] || 0) + 1;
  }

  // Sort sources: 'direct' first, then alphabetically
  const sources = Array.from(sourceSet).sort((a, b) => {
    if (a === 'direct') return -1;
    if (b === 'direct') return 1;
    return a.localeCompare(b);
  });

  // Sort companies by total job count descending
  const companies = Object.keys(companySourceCounts).sort((a, b) => {
    const totalA = Object.values(companySourceCounts[a]).reduce((s, v) => s + v, 0);
    const totalB = Object.values(companySourceCounts[b]).reduce((s, v) => s + v, 0);
    return totalB - totalA;
  });

  // Build the matrix rows
  // Header row: Company | source1 | source2 | ... | Total
  const headerRow = ['Company', ...sources, 'Total'];

  const dataRows = [];
  const columnTotals = new Array(sources.length).fill(0);
  let grandTotal = 0;

  for (const company of companies) {
    const row = [company];
    let companyTotal = 0;

    for (let i = 0; i < sources.length; i++) {
      const count = companySourceCounts[company][sources[i]] || 0;
      row.push(count);
      columnTotals[i] += count;
      companyTotal += count;
    }

    row.push(companyTotal);
    grandTotal += companyTotal;
    dataRows.push(row);
  }

  // Totals row
  const totalsRow = ['TOTAL', ...columnTotals, grandTotal];

  return { headerRow, dataRows, totalsRow, sources, companies };
}

// ── Target Companies Building ───────────────────────────────────────────────

function buildTargetCompanies(jobs, targetCompanies) {
  if (!targetCompanies || targetCompanies.length === 0) return null;

  const targetNames = new Set(targetCompanies.map(c => c.name));
  // Also match by brand variations
  const nameToTarget = {};
  for (const tc of targetCompanies) {
    nameToTarget[tc.name.toLowerCase()] = tc;
    for (const variant of (tc.brandVariations || [])) {
      nameToTarget[variant.toLowerCase()] = tc;
    }
  }

  // Count jobs per target company per source
  const activeJobs = jobs.filter(j => j.status !== 'removed' && j.status !== 'paused');

  const companyCounts = {}; // { targetName: { source: count } }
  const lastScraped = {}; // { targetName: latestDate }

  for (const job of activeJobs) {
    const companyLower = (job.company || '').toLowerCase();
    const target = nameToTarget[companyLower];
    if (!target) continue;

    const name = target.name;
    const source = job.source || 'direct';

    if (!companyCounts[name]) companyCounts[name] = {};
    companyCounts[name][source] = (companyCounts[name][source] || 0) + 1;

    // Track latest scraped date
    const dateStr = job.scrapedAt || job.postedDate || '';
    if (dateStr && (!lastScraped[name] || dateStr > lastScraped[name])) {
      lastScraped[name] = dateStr;
    }
  }

  // Collect all sources seen for target companies
  const sourceSet = new Set();
  for (const counts of Object.values(companyCounts)) {
    for (const src of Object.keys(counts)) {
      sourceSet.add(src);
    }
  }
  const sources = Array.from(sourceSet).sort((a, b) => {
    if (a === 'direct') return -1;
    if (b === 'direct') return 1;
    return a.localeCompare(b);
  });

  // Header: Company | direct | source1 | ... | Total | ATS Platform | Careers URL | Last Scraped
  const headerRow = ['Company', ...sources, 'Total', 'ATS Platform', 'Careers URL', 'Last Scraped'];

  const dataRows = [];
  for (const tc of targetCompanies) {
    const counts = companyCounts[tc.name] || {};
    const row = [tc.name];

    let total = 0;
    for (const src of sources) {
      const count = counts[src] || 0;
      row.push(count);
      total += count;
    }

    row.push(total);
    row.push(tc.ats && tc.ats[0] ? tc.ats[0].platform : '');
    row.push(tc.careersUrl || '');
    row.push(lastScraped[tc.name] ? lastScraped[tc.name].split('T')[0] : '');

    dataRows.push(row);
  }

  return { headerRow, dataRows, sources };
}

// ── Google Sheets Writing ───────────────────────────────────────────────────

async function getOrCreateSheet(sheets, spreadsheetId, title, numRows, numCols) {
  // Check if the sheet exists
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = spreadsheet.data.sheets.find(s => s.properties.title === title);

  if (existing) {
    const sheetId = existing.properties.sheetId;
    // Clear existing content
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${title}'!A:ZZ`,
    });
    return sheetId;
  }

  // Create new sheet
  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        addSheet: {
          properties: {
            title,
            gridProperties: { rowCount: numRows, columnCount: numCols },
          },
        },
      }],
    },
  });

  return response.data.replies[0].addSheet.properties.sheetId;
}

function colIndexToLetter(idx) {
  let letter = '';
  let n = idx;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

async function writeSourceMatrix(sheets, spreadsheetId, matrix) {
  const { headerRow, dataRows, totalsRow } = matrix;
  const totalRows = 1 + dataRows.length + 1 + 1; // header + data + blank + totals
  const totalCols = headerRow.length;

  const sheetId = await getOrCreateSheet(
    sheets, spreadsheetId, 'Source Coverage Matrix', totalRows + 10, totalCols + 2
  );

  // Assemble all rows
  const allRows = [
    headerRow,
    ...dataRows,
    [], // blank row before totals
    totalsRow,
  ];

  const lastCol = colIndexToLetter(totalCols - 1);
  const range = `'Source Coverage Matrix'!A1:${lastCol}${allRows.length}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: allRows },
  });

  // Apply formatting
  const requests = [
    // Bold header row
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: totalCols },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    },
    // Bold totals row
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: allRows.length - 1,
          endRowIndex: allRows.length,
          startColumnIndex: 0,
          endColumnIndex: totalCols,
        },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    },
    // Bold Total column header
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: totalCols - 1, endColumnIndex: totalCols },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    },
    // Freeze row 1 and column A
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 },
        },
        fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
      },
    },
    // Conditional formatting: zero values in light red
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{
            sheetId,
            startRowIndex: 1,
            endRowIndex: 1 + dataRows.length,
            startColumnIndex: 1,
            endColumnIndex: totalCols - 1, // exclude Total column
          }],
          booleanRule: {
            condition: { type: 'NUMBER_EQ', values: [{ userEnteredValue: '0' }] },
            format: {
              backgroundColor: { red: 0.96, green: 0.8, blue: 0.8, alpha: 1 },
            },
          },
        },
        index: 0,
      },
    },
    // Conditional formatting: non-zero values in light green
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{
            sheetId,
            startRowIndex: 1,
            endRowIndex: 1 + dataRows.length,
            startColumnIndex: 1,
            endColumnIndex: totalCols - 1,
          }],
          booleanRule: {
            condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] },
            format: {
              backgroundColor: { red: 0.85, green: 0.95, blue: 0.85, alpha: 1 },
            },
          },
        },
        index: 1,
      },
    },
    // Auto-resize columns
    {
      autoResizeDimensions: {
        dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: totalCols },
      },
    },
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  console.log(`  Wrote Source Coverage Matrix: ${dataRows.length} companies x ${headerRow.length - 2} sources`);
}

async function writeTargetCompanies(sheets, spreadsheetId, targetData) {
  if (!targetData) {
    console.log('  Skipping Target Companies (no companies.json data)');
    return;
  }

  const { headerRow, dataRows } = targetData;
  const totalRows = 1 + dataRows.length + 5;
  const totalCols = headerRow.length;

  const sheetId = await getOrCreateSheet(
    sheets, spreadsheetId, 'Target Companies', totalRows, totalCols + 2
  );

  const allRows = [headerRow, ...dataRows];
  const lastCol = colIndexToLetter(totalCols - 1);
  const range = `'Target Companies'!A1:${lastCol}${allRows.length}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: allRows },
  });

  // Apply formatting
  const requests = [
    // Bold header row
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: totalCols },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    },
    // Freeze row 1 and column A
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 },
        },
        fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
      },
    },
    // Conditional formatting for zero job counts (light red)
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{
            sheetId,
            startRowIndex: 1,
            endRowIndex: 1 + dataRows.length,
            startColumnIndex: 1,
            endColumnIndex: totalCols - 3, // exclude ATS/URL/Date columns
          }],
          booleanRule: {
            condition: { type: 'NUMBER_EQ', values: [{ userEnteredValue: '0' }] },
            format: {
              backgroundColor: { red: 0.96, green: 0.8, blue: 0.8, alpha: 1 },
            },
          },
        },
        index: 0,
      },
    },
    // Conditional formatting for non-zero (light green)
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{
            sheetId,
            startRowIndex: 1,
            endRowIndex: 1 + dataRows.length,
            startColumnIndex: 1,
            endColumnIndex: totalCols - 3,
          }],
          booleanRule: {
            condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] },
            format: {
              backgroundColor: { red: 0.85, green: 0.95, blue: 0.85, alpha: 1 },
            },
          },
        },
        index: 1,
      },
    },
    // Auto-resize columns
    {
      autoResizeDimensions: {
        dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: totalCols },
      },
    },
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  console.log(`  Wrote Target Companies: ${dataRows.length} companies`);
}

// ── Dry Run Output ──────────────────────────────────────────────────────────

function printMatrix(matrix) {
  const { headerRow, dataRows, totalsRow } = matrix;

  // Calculate column widths
  const allRows = [headerRow, ...dataRows, totalsRow];
  const colWidths = headerRow.map((_, i) =>
    Math.max(...allRows.map(r => String(r[i] || '').length))
  );

  function formatRow(row) {
    return row.map((cell, i) => String(cell).padStart(i === 0 ? -colWidths[i] : colWidths[i])).join('  ');
  }

  console.log('\n' + '='.repeat(80));
  console.log('SOURCE COVERAGE MATRIX');
  console.log('='.repeat(80));
  console.log(formatRow(headerRow));
  console.log('-'.repeat(80));

  for (const row of dataRows) {
    console.log(formatRow(row));
  }

  console.log('-'.repeat(80));
  console.log(formatRow(totalsRow));
  console.log('='.repeat(80));
}

function printTargetCompanies(targetData) {
  if (!targetData) return;

  const { headerRow, dataRows } = targetData;

  console.log('\n' + '='.repeat(100));
  console.log('TARGET COMPANIES');
  console.log('='.repeat(100));

  // Simple tabular output
  const allRows = [headerRow, ...dataRows];
  const colWidths = headerRow.map((_, i) =>
    Math.max(...allRows.map(r => String(r[i] || '').length), 4)
  );

  function formatRow(row) {
    return row.map((cell, i) => {
      const s = String(cell || '');
      return i === 0 ? s.padEnd(colWidths[i]) : s.padStart(colWidths[i]);
    }).join('  ');
  }

  console.log(formatRow(headerRow));
  console.log('-'.repeat(100));
  for (const row of dataRows) {
    console.log(formatRow(row));
  }
  console.log('='.repeat(100));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Source Coverage Matrix Generator\n');

  // Load job data
  const jobs = loadJobsIndex();
  const targetCompanies = loadCompaniesJson();

  // Build matrices
  const matrix = buildSourceMatrix(jobs);
  const targetData = buildTargetCompanies(jobs, targetCompanies);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Printing matrix data to console (not writing to Sheets)\n');
    printMatrix(matrix);
    printTargetCompanies(targetData);
    return;
  }

  // Authenticate and write to Sheets
  console.log('\nAuthenticating with Google Sheets...');
  const auth = await authenticate();
  const sheets = google.sheets({ version: 'v4', auth });

  console.log(`Looking for spreadsheet: "${SPREADSHEET_NAME}"...`);
  const spreadsheetId = await getSpreadsheetId(auth);
  console.log(`Found spreadsheet: ${spreadsheetId}`);

  console.log('\nWriting worksheets...');
  await writeSourceMatrix(sheets, spreadsheetId, matrix);
  await writeTargetCompanies(sheets, spreadsheetId, targetData);

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
