#!/usr/bin/env node

/**
 * Fix row heights across all worksheets in "Job Scraping Results"
 *
 * Sets all data rows (skipping headers) to a compact single-line height.
 * Can be run independently of the dedup script.
 *
 * Usage:
 *   node scripts/fix-sheet-row-heights.js
 *   node scripts/fix-sheet-row-heights.js --height 30   # custom pixel height
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
const SKIP_SHEETS = ['Overview'];
const DEFAULT_ROW_HEIGHT_PX = 21; // Standard single-line height
const SHEET_OP_DELAY_MS = 2500;   // Delay between API calls to avoid rate limits

const DEFAULT_CREDENTIALS_PATH = path.join(
  __dirname, '../../job-scraping/config/service_account.json'
);

// --- Helpers -----------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const heightIdx = args.indexOf('--height');
  const height = heightIdx >= 0 && args[heightIdx + 1]
    ? parseInt(args[heightIdx + 1], 10)
    : DEFAULT_ROW_HEIGHT_PX;
  return { height };
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Main --------------------------------------------------------------------

async function main() {
  const { height } = parseArgs();

  console.log('='.repeat(60));
  console.log('  Fix Sheet Row Heights');
  console.log(`  Target height: ${height}px`);
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log('='.repeat(60));
  console.log('');

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

  const spreadsheetId = await findSpreadsheetId(auth);
  console.log(`Spreadsheet ID: ${spreadsheetId}\n`);

  const meta = await sheets.spreadsheets.get({ spreadsheetId });

  for (const sheet of meta.data.sheets) {
    const sheetName = sheet.properties.title;
    const sheetId = sheet.properties.sheetId;

    if (SKIP_SHEETS.includes(sheetName)) {
      console.log(`  [SKIP] "${sheetName}" (excluded)`);
      continue;
    }

    // Get the row count from the sheet grid properties
    const rowCount = sheet.properties.gridProperties.rowCount;

    if (rowCount <= 1) {
      console.log(`  [SKIP] "${sheetName}" (empty or header only)`);
      continue;
    }

    // Set all data rows to the target height
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
            properties: { pixelSize: height },
            fields: 'pixelSize',
          },
        }],
      },
    });

    console.log(`  [OK]   "${sheetName}": ${rowCount - 1} data rows set to ${height}px`);
    await delay(SHEET_OP_DELAY_MS);
  }

  console.log('\nDone. All sheet row heights updated.');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
