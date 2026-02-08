/**
 * Export jobs from Google Sheets to JSON
 *
 * Fetches job data from the Google Sheets used by the scraper
 * and exports to public/data/jobs.json for the web app to consume.
 *
 * Usage: npm run export-jobs
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CREDENTIALS_PATH = path.join(__dirname, '../../job-scraping/config/service_account.json');
const SPREADSHEET_NAME = 'Job Scraping Results'; // Must match .env in job-scraping
const OUTPUT_PATH = path.join(__dirname, '../public/data/jobs.json');

// Column mapping (matches JobPosting.to_sheet_row() order from scraper)
const COLUMNS = {
  TITLE: 0,
  COMPANY: 1,
  LOCATION: 2,
  DESCRIPTION: 3,
  URL: 4,
  POSTED_DATE: 5,
  SKILLS: 6,
  SALARY: 7,
  STATUS: 8,
  STATUS_CHANGED_DATE: 9,
  SCRAPED_AT: 10
};

async function authenticate() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.readonly'
    ],
  });

  return await auth.getClient();
}

function parseRow(row, sheetName) {
  // Skip empty rows or header rows
  if (!row[COLUMNS.TITLE] || row[COLUMNS.TITLE] === 'Title') {
    return null;
  }

  return {
    id: `${sheetName}-${row[COLUMNS.URL]}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase(),
    title: row[COLUMNS.TITLE] || '',
    company: row[COLUMNS.COMPANY] || sheetName,
    location: row[COLUMNS.LOCATION] || '',
    description: row[COLUMNS.DESCRIPTION] || '',
    url: row[COLUMNS.URL] || '',
    postedDate: row[COLUMNS.POSTED_DATE] || null,
    skills: row[COLUMNS.SKILLS] ? row[COLUMNS.SKILLS].split(';').map(s => s.trim()).filter(Boolean) : [],
    salary: row[COLUMNS.SALARY] || null,
    status: row[COLUMNS.STATUS] || 'active',
    statusChangedDate: row[COLUMNS.STATUS_CHANGED_DATE] || null,
    scrapedAt: row[COLUMNS.SCRAPED_AT] || null,
  };
}

async function fetchAllJobs(auth) {
  const sheets = google.sheets({ version: 'v4', auth });

  // Get spreadsheet metadata to find all worksheets
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: await getSpreadsheetId(sheets),
  });

  const allJobs = [];

  // Fetch data from each worksheet (company)
  for (const sheet of spreadsheet.data.sheets) {
    const sheetName = sheet.properties.title;

    console.log(`Fetching jobs from "${sheetName}"...`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheet.data.spreadsheetId,
      range: `${sheetName}!A:K`, // All columns from the sheet (updated for status columns)
    });

    const rows = response.data.values || [];

    // Parse rows (skip header)
    const jobs = rows.slice(1)
      .map(row => parseRow(row, sheetName))
      .filter(job => job !== null);

    console.log(`  Found ${jobs.length} jobs from ${sheetName}`);
    allJobs.push(...jobs);
  }

  return allJobs;
}

async function getSpreadsheetId(sheets) {
  // Find spreadsheet by name
  const drive = google.drive({ version: 'v3', auth: sheets.context._options.auth });

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

async function main() {
  try {
    console.log('🔐 Authenticating with Google Sheets...');
    const auth = await authenticate();

    console.log('📊 Fetching jobs from Google Sheets...');
    const jobs = await fetchAllJobs(auth);

    console.log(`\n✅ Successfully fetched ${jobs.length} total jobs`);

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write to JSON file
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(jobs, null, 2), 'utf8');
    console.log(`📝 Exported to ${OUTPUT_PATH}`);

    // Print summary by company
    const byCompany = jobs.reduce((acc, job) => {
      acc[job.company] = (acc[job.company] || 0) + 1;
      return acc;
    }, {});

    console.log('\n📈 Summary by company:');
    Object.entries(byCompany).forEach(([company, count]) => {
      console.log(`  ${company}: ${count} jobs`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
