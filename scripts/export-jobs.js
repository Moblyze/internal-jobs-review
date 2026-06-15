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
const AGGREGATOR_SPREADSHEET_ID = '1xb3QBZG9Dtkyo_UmOGu3Oc3zMr2Cg1ohOyt-cd3WT7Y';
const OUTPUT_PATH = path.join(__dirname, '../public/data/jobs.json');

// Column mapping (matches JobPosting.to_sheet_row() order from scraper)
// Updated: Employment Type added at column 10, shifting Status/StatusChanged/ScrapedAt
const COLUMNS = {
  TITLE: 0,
  COMPANY: 1,
  LOCATION: 2,
  DESCRIPTION: 3,
  URL: 4,
  REQUISITION_ID: 5,
  POSTED_DATE: 6,
  SKILLS: 7,
  CERTIFICATIONS: 8,
  SALARY: 9,
  EMPLOYMENT_TYPE: 10,
  STATUS: 11,
  STATUS_CHANGED_DATE: 12,
  SCRAPED_AT: 13
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

function parseRow(row, sheetName, columnMap) {
  // Skip empty rows
  if (!row || row.length === 0) {
    return null;
  }

  // Helper to get column value by name
  const getCol = (name) => {
    const index = columnMap[name];
    return index !== undefined ? (row[index] || null) : null;
  };

  const title = getCol('Title');
  const url = getCol('URL');

  // Skip if no title or URL
  if (!title || !url) {
    return null;
  }

  const job = {
    id: `${sheetName}-${url}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase(),
    title: title,
    company: getCol('Company') || sheetName,
    location: getCol('Location') || '',
    description: getCol('Description') || '',
    url: url,
    requisitionId: getCol('Requisition ID'),
    postedDate: getCol('Posted Date'),
    skills: getCol('Skills') ? getCol('Skills').split(';').map(s => s.trim()).filter(Boolean) : [],
    certifications: getCol('Certifications') ? getCol('Certifications').split(';').map(c => c.trim()).filter(Boolean) : [],
    salary: getCol('Salary'),
    employmentType: getCol('Employment Type') || null,
    status: getCol('Status') || 'active',
    statusChangedDate: getCol('Status Changed Date'),
    scrapedAt: getCol('Scraped At'),
  };
  job.appReady = isAppReady(job);
  return job;
}

// Rate limiting helper to avoid Google Sheets API quota limits
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAllJobs(auth) {
  const sheets = google.sheets({ version: 'v4', auth });

  // Get spreadsheet metadata to find all worksheets
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: await getSpreadsheetId(sheets),
  });

  const allJobs = [];

  // Fetch data from each worksheet (company), skip Aggregator Jobs tab (handled separately)
  for (const sheet of spreadsheet.data.sheets) {
    const sheetName = sheet.properties.title;

    if (sheetName === 'Aggregator Jobs') {
      console.log(`Skipping "${sheetName}" (handled by aggregator fetch)`);
      continue;
    }

    // Skip backup snapshot tabs created by the cleanup script (e.g.
    // "Aggregator - finnco (backup 2026-06-01)"). They hold pre-cleanup rows;
    // ingesting them would re-import deleted noise/duplicates into the site.
    if (/\(backup/i.test(sheetName)) {
      console.log(`Skipping "${sheetName}" (backup snapshot tab)`);
      continue;
    }

    console.log(`Fetching jobs from "${sheetName}"...`);

    // Add delay between API calls to respect rate limits
    await delay(1000); // 1 second delay between sheet fetches

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheet.data.spreadsheetId,
      range: `${sheetName}!A:N`, // All columns from the sheet (A-N = 14 columns, includes Employment Type)
    });

    const rows = response.data.values || [];

    if (rows.length === 0) {
      console.log(`  No data in ${sheetName}, skipping`);
      continue;
    }

    // Build column map from header row
    const headers = rows[0];
    const columnMap = {};
    headers.forEach((header, index) => {
      columnMap[header] = index;
    });

    // Validate required columns exist
    const required = ['Title', 'Company', 'URL'];
    const missing = required.filter(col => columnMap[col] === undefined);
    if (missing.length > 0) {
      console.warn(`  ⚠️  ${sheetName} missing required columns: ${missing.join(', ')}`);
      console.warn(`  Available columns: ${headers.join(', ')}`);
      continue;
    }

    // Parse data rows (skip header)
    const jobs = rows.slice(1)
      .map(row => parseRow(row, sheetName, columnMap))
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

// Aggregator Jobs sheet column mapping (16 cols: A-P)
const AGGREGATOR_COLUMNS = {
  JOB_ID: 0, TITLE: 1, COMPANY: 2, LOCATION: 3, DESCRIPTION: 4,
  URL: 5, SOURCE: 6, POSTED_DATE: 7, SKILLS: 8, CERTIFICATIONS: 9,
  SALARY: 10, EMPLOYMENT_TYPE: 11, PROFILE: 12, STATUS: 13,
  STATUS_CHANGED_DATE: 14, SCRAPED_AT: 15
};

// Map aggregator employment types to review site enum
// Handles both raw scraper values and cleaned values from the upload pipeline
const EMP_TYPE_MAP = {
  'Contract': 'Contractor',
  'Contractor': 'Contractor',
  'Temporary': 'Temporary',
  'Full-time': 'Full-Time',
  'Full-Time': 'Full-Time',
  'Part-time': 'Part-Time',
  'Part-Time': 'Part-Time',
  'Temp-to-Hire': 'Contractor',
  'Unknown': 'Other',
  'Other': 'Other',
};

function parseAggregatorRow(row) {
  if (!row || row.length < 6) return null;

  const title = row[AGGREGATOR_COLUMNS.TITLE];
  const url = row[AGGREGATOR_COLUMNS.URL];
  if (!title || !url) return null;

  const rawEmpType = row[AGGREGATOR_COLUMNS.EMPLOYMENT_TYPE] || '';
  const skills = row[AGGREGATOR_COLUMNS.SKILLS] || '';
  const certs = row[AGGREGATOR_COLUMNS.CERTIFICATIONS] || '';

  const job = {
    id: `agg-${row[AGGREGATOR_COLUMNS.JOB_ID] || url}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase(),
    title,
    company: row[AGGREGATOR_COLUMNS.COMPANY] || '',
    location: row[AGGREGATOR_COLUMNS.LOCATION] || '',
    description: row[AGGREGATOR_COLUMNS.DESCRIPTION] || '',
    url,
    requisitionId: null,
    postedDate: row[AGGREGATOR_COLUMNS.POSTED_DATE] || null,
    skills: skills ? skills.split(';').map(s => s.trim()).filter(Boolean) : [],
    certifications: certs ? certs.split(';').map(c => c.trim()).filter(Boolean) : [],
    salary: row[AGGREGATOR_COLUMNS.SALARY] || null,
    employmentType: EMP_TYPE_MAP[rawEmpType] ?? null,
    status: (row[AGGREGATOR_COLUMNS.STATUS] || 'active').toLowerCase(),
    statusChangedDate: row[AGGREGATOR_COLUMNS.STATUS_CHANGED_DATE] || null,
    scrapedAt: row[AGGREGATOR_COLUMNS.SCRAPED_AT] || null,
    source: row[AGGREGATOR_COLUMNS.SOURCE] || null,
    profile: row[AGGREGATOR_COLUMNS.PROFILE] || null,
  };
  job.appReady = isAppReady(job);
  return job;
}

// Valid search profiles that map to app role categories
const APP_VALID_PROFILES = new Set([
  'subsea_oil_gas', 'rope_access', 'energy_trades', 'survey_geophysical',
  'ndt_inspection', 'drilling_operations', 'marine_offshore_ops',
  'pipeline_mechanical', 'industrial_construction', 'process_plant_operations',
]);

// Certifications recognized by the app (subset — matches certification extractor categories)
const APP_CERT_KEYWORDS = [
  'API', 'IRATA', 'CSWIP', 'BOSIET', 'HUET', 'FOET', 'NEBOSH', 'COMPEX',
  'NACE', 'CDL', 'OSHA', 'TWIC', 'NCCER', 'AWS', 'CWI', 'ASNT', 'NDE',
  'NDT', 'IWCF', 'WellSharp', 'GWO', 'OPITO', 'STCW', 'Rigger',
];

// Non-trade role patterns to exclude from app seeding
const NON_TRADE_TITLE_PATTERNS = [
  /\badministrative\s+assistant\b/i, /\baccountant\b/i, /\baccounting\b/i,
  /\b(?:HR|human\s+resources)\s+(?:coordinator|manager|assistant|specialist)\b/i,
  /\bpayroll\b/i, /\bdemand\s+planner\b/i, /\breceptionist\b/i,
];

/**
 * Determine if a job is suitable for app seeding.
 *
 * Criteria (all must pass):
 * 1. Status is not closed/deleted/archived
 * 2. Has title (>= 3 chars), company, location (trimmed)
 * 3. Title is not a test record or internal code
 * 4. Description > 50 chars
 * 5. Employment type is NOT Full-Time or Internship
 * 6. Salary does not indicate annual/full-time pay (e.g. "/yr", "per year")
 * 7. Has a valid profile OR has recognized certifications
 * 8. Not a non-trade office role
 * 9. Not stale (> 120 days old)
 */
function isAppReady(job) {
  // Exclude closed/deleted/archived jobs
  const status = (job.status || 'active').toLowerCase();
  if (['closed', 'deleted', 'archived', 'pending'].includes(status)) return false;

  // Required fields with trimmed whitespace check
  const title = (job.title || '').trim();
  const location = (job.location || '').trim();
  if (title.length < 3 || !job.company || !location) return false;

  // Filter test/dummy records (but not "Test Engineer", "Test Technician", etc.)
  if (/^test\b/i.test(title) && !/engineer|technician|inspector|analyst|specialist|operator/i.test(title)) return false;
  if (/^[A-Z0-9.\-]+$/.test(title)) return false;

  if ((job.description || '').length < 50) return false;

  // Excluded employment types
  if (job.employmentType === 'Full-Time' || job.employmentType === 'Internship') return false;

  // Annual salary implies full-time
  const salary = (job.salary || '').toLowerCase();
  if (salary && (/\/yr\b/.test(salary) || /per\s+year/.test(salary) || /annual/.test(salary))) return false;

  // Must have a valid profile OR recognized certifications
  const hasValidProfile = job.profile && APP_VALID_PROFILES.has(job.profile);
  const certs = job.certifications || [];
  const certsStr = Array.isArray(certs) ? certs.join(' ') : String(certs);
  const hasAppCerts = APP_CERT_KEYWORDS.some(kw => certsStr.toLowerCase().includes(kw.toLowerCase()));

  if (!hasValidProfile && !hasAppCerts) return false;

  // Exclude non-trade office roles
  if (NON_TRADE_TITLE_PATTERNS.some(p => p.test(title))) return false;

  // Stale job filter (> 120 days)
  const dateStr = job.postedDate || job.scrapedAt;
  if (dateStr) {
    const jobDate = new Date(dateStr);
    if (!isNaN(jobDate.getTime())) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 120);
      if (jobDate < cutoff) return false;
    }
  }

  return true;
}

async function fetchAggregatorJobs(auth) {
  const sheets = google.sheets({ version: 'v4', auth });

  console.log('📊 Fetching aggregator jobs...');

  // Add delay before aggregator API call to respect rate limits
  await delay(1000);

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: AGGREGATOR_SPREADSHEET_ID,
      range: 'Aggregator Jobs!A2:P', // Skip header row
    });

    const rows = response.data.values || [];
    const jobs = rows.map(parseAggregatorRow).filter(j => j !== null);

    // Filter stale jobs (>90 days old)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const fresh = jobs.filter(j => {
      if (!j.postedDate) return true;
      const d = new Date(j.postedDate);
      return isNaN(d.getTime()) || d >= cutoff;
    });

    console.log(`  Found ${jobs.length} aggregator jobs, ${fresh.length} after stale filter`);
    return fresh;
  } catch (error) {
    console.warn(`  ⚠️  Could not fetch aggregator jobs: ${error.message}`);
    return [];
  }
}

async function main() {
  try {
    console.log('🔐 Authenticating with Google Sheets...');
    const auth = await authenticate();

    console.log('📊 Fetching employer jobs from Google Sheets...');

    // Add initial delay to avoid hitting rate limits immediately
    await delay(500);

    const employerJobs = await fetchAllJobs(auth);

    const aggregatorJobs = await fetchAggregatorJobs(auth);

    // Merge (employer first, then aggregator)
    const allJobs = [...employerJobs, ...aggregatorJobs];

    // Deduplicate by URL first, then by company+title+location
    const jobsByUrl = new Map();
    allJobs.forEach(job => {
      if (!job.url) return;
      const existing = jobsByUrl.get(job.url);
      if (!existing) {
        jobsByUrl.set(job.url, job);
      } else {
        // Keep the one with the more recent scrapedAt date
        const existingDate = new Date(existing.scrapedAt || '1970-01-01').getTime();
        const newDate = new Date(job.scrapedAt || '1970-01-01').getTime();
        if (newDate > existingDate) {
          jobsByUrl.set(job.url, job);
        }
      }
    });

    // Second pass: deduplicate by company+title+location for jobs with different URLs but same content
    const jobsByKey = new Map();
    for (const job of jobsByUrl.values()) {
      const key = [
        (job.company || '').toLowerCase().trim(),
        (job.title || '').toLowerCase().trim(),
        (job.location || '').toLowerCase().trim(),
      ].join('|');

      const existing = jobsByKey.get(key);
      if (!existing) {
        jobsByKey.set(key, job);
      } else {
        const existingDate = new Date(existing.scrapedAt || existing.postedDate || '1970-01-01').getTime();
        const newDate = new Date(job.scrapedAt || job.postedDate || '1970-01-01').getTime();
        if (newDate > existingDate) {
          jobsByKey.set(key, job);
        }
      }
    }

    const jobs = Array.from(jobsByKey.values());
    const urlDupes = allJobs.length - jobsByUrl.size;
    const keyDupes = jobsByUrl.size - jobs.length;
    console.log(`\nDeduplication: ${allJobs.length} -> ${jobs.length} jobs (removed ${urlDupes} URL duplicates + ${keyDupes} content duplicates)`);

    const appReadyCount = jobs.filter(j => j.appReady).length;
    console.log(`\n✅ Successfully fetched ${jobs.length} unique jobs (${employerJobs.length} employer + ${aggregatorJobs.length} aggregator raw, ${appReadyCount} app-ready)`);

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write to JSON file (full data for detail pages)
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(jobs, null, 2), 'utf8');
    console.log(`📝 Exported to ${OUTPUT_PATH}`);

    // Generate lightweight index file (run as separate script for cert extraction logic)
    console.log('\n📝 Generating lightweight index...');
    const { execSync } = await import('child_process');
    execSync('node scripts/generate-index.js', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });

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
