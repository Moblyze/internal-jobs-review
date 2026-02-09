#!/usr/bin/env node

/**
 * Sync and Process Jobs - Automated Pipeline
 *
 * Complete automation script that:
 * 1. Fetches latest jobs from Google Sheets
 * 2. Identifies new/unprocessed jobs (without structuredDescription)
 * 3. Runs AI processing on only those jobs
 * 4. Saves results
 *
 * Usage:
 *   npm run sync-process                    # Full pipeline
 *   npm run sync-process -- --dry-run       # Test without saving
 *   npm run sync-process -- --skip-export   # Only process, don't fetch
 *   npm run sync-process -- --limit=10      # Limit AI processing to N jobs
 *
 * Scheduled Usage (cron):
 *   0 2 * * * cd /path/to/moblyze-jobs-web && npm run sync-process >> logs/sync.log 2>&1
 *   (Runs daily at 2 AM)
 *
 * Cost Estimation:
 *   - Claude Sonnet 4.5: ~$0.01 per job description
 *   - If you get 50 new jobs/day: ~$0.50/day or ~$15/month
 *   - If you get 10 new jobs/day: ~$0.10/day or ~$3/month
 */

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File paths
const JOBS_FILE = path.join(__dirname, '../public/data/jobs.json');
const BACKUP_FILE = path.join(__dirname, '../public/data/jobs.backup.json');
const LOG_DIR = path.join(__dirname, '../logs');
const SYNC_LOG = path.join(LOG_DIR, 'sync-process.log');
const ERROR_LOG = path.join(LOG_DIR, 'description-processing-errors.log');

// Google Sheets configuration
const CREDENTIALS_PATH = path.join(__dirname, '../../job-scraping/config/service_account.json');
const SPREADSHEET_NAME = 'Job Scraping Results';

// Processing settings
const RATE_LIMIT_DELAY = 500; // 500ms between AI requests
const SAVE_INTERVAL = 10; // Save progress every N jobs

// Column mapping (matches export-jobs.js)
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
  STATUS: 10,
  STATUS_CHANGED_DATE: 11,
  SCRAPED_AT: 12
};

/**
 * Parse command-line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    skipExport: false,
    limit: null,
  };

  args.forEach(arg => {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--skip-export') {
      options.skipExport = true;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    }
  });

  return options;
}

/**
 * Log to both console and file
 */
function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  console.log(message);

  // Ensure log directory exists
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  fs.appendFileSync(SYNC_LOG, logMessage + '\n', 'utf-8');
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Authenticate with Google Sheets
 */
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

/**
 * Parse row from Google Sheets
 */
function parseRow(row, sheetName) {
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
    requisitionId: row[COLUMNS.REQUISITION_ID] || null,
    postedDate: row[COLUMNS.POSTED_DATE] || null,
    skills: row[COLUMNS.SKILLS] ? row[COLUMNS.SKILLS].split(';').map(s => s.trim()).filter(Boolean) : [],
    certifications: row[COLUMNS.CERTIFICATIONS] ? row[COLUMNS.CERTIFICATIONS].split(';').map(c => c.trim()).filter(Boolean) : [],
    salary: row[COLUMNS.SALARY] || null,
    status: row[COLUMNS.STATUS] || 'active',
    statusChangedDate: row[COLUMNS.STATUS_CHANGED_DATE] || null,
    scrapedAt: row[COLUMNS.SCRAPED_AT] || null,
  };
}

/**
 * Get spreadsheet ID by name
 */
async function getSpreadsheetId(sheets) {
  const drive = google.drive({ version: 'v3', auth: sheets.context._options.auth });

  const response = await drive.files.list({
    q: `name='${SPREADSHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet'`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (!response.data.files || response.data.files.length === 0) {
    throw new Error(`Spreadsheet "${SPREADSHEET_NAME}" not found`);
  }

  return response.data.files[0].id;
}

/**
 * Fetch all jobs from Google Sheets
 */
async function fetchJobsFromSheets(auth) {
  const sheets = google.sheets({ version: 'v4', auth });

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: await getSpreadsheetId(sheets),
  });

  const allJobs = [];

  for (const sheet of spreadsheet.data.sheets) {
    const sheetName = sheet.properties.title;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheet.data.spreadsheetId,
      range: `${sheetName}!A:K`,
    });

    const rows = response.data.values || [];
    const jobs = rows.slice(1)
      .map(row => parseRow(row, sheetName))
      .filter(job => job !== null);

    allJobs.push(...jobs);
  }

  return allJobs;
}

/**
 * Load AI description parser
 */
async function loadParser() {
  const parserPath = path.join(__dirname, '../src/utils/aiDescriptionParser.js');

  if (!fs.existsSync(parserPath)) {
    throw new Error('AI parser not found at: src/utils/aiDescriptionParser.js');
  }

  const parser = await import(parserPath);

  if (typeof parser.restructureJobDescription !== 'function') {
    throw new Error('AI parser must export restructureJobDescription() function');
  }

  return parser.restructureJobDescription;
}

/**
 * Process a single job description with AI
 */
async function processJobDescription(job, restructureFunction) {
  try {
    if (!job.description || job.description.trim() === '') {
      return { success: true, skipped: true };
    }

    // Increase timeout for longer descriptions
    const timeout = job.description.length > 5000 ? 60000 : 30000;
    const structuredDescription = await restructureFunction(job.description, { timeout });

    if (!structuredDescription || typeof structuredDescription !== 'object') {
      throw new Error('Invalid response from AI parser');
    }

    if (!structuredDescription.sections || !Array.isArray(structuredDescription.sections)) {
      throw new Error('Invalid response structure (expected sections array)');
    }

    if (structuredDescription.error) {
      throw new Error(`AI parser error: ${structuredDescription.error}`);
    }

    return {
      success: true,
      structuredDescription
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Identify new jobs that need processing
 */
function identifyNewJobs(fetchedJobs, existingJobs) {
  const existingJobsMap = new Map(existingJobs.map(j => [j.id, j]));
  const newJobs = [];
  const updatedJobs = [];

  for (const fetchedJob of fetchedJobs) {
    const existing = existingJobsMap.get(fetchedJob.id);

    if (!existing) {
      // Completely new job
      newJobs.push(fetchedJob);
    } else if (!existing.structuredDescription && fetchedJob.description) {
      // Existing job without AI description
      updatedJobs.push(fetchedJob);
    }
  }

  return { newJobs, updatedJobs };
}

/**
 * Merge fetched jobs with existing jobs, preserving structured descriptions
 */
function mergeJobs(fetchedJobs, existingJobs) {
  const existingJobsMap = new Map(existingJobs.map(j => [j.id, j]));
  const mergedJobs = [];

  for (const fetchedJob of fetchedJobs) {
    const existing = existingJobsMap.get(fetchedJob.id);

    if (existing && existing.structuredDescription) {
      // Preserve existing AI-processed description
      mergedJobs.push({
        ...fetchedJob,
        structuredDescription: existing.structuredDescription
      });
    } else {
      // New job or job without AI description
      mergedJobs.push(fetchedJob);
    }
  }

  return mergedJobs;
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();
  log('\n=== Sync and Process Jobs - Starting ===\n');

  const options = parseArgs();

  if (options.dryRun) {
    log('⚠️  DRY RUN MODE - No changes will be saved\n', 'warn');
  }

  const stats = {
    jobsFetched: 0,
    newJobs: 0,
    jobsNeedingAI: 0,
    aiProcessed: 0,
    aiSucceeded: 0,
    aiFailed: 0,
    aiSkipped: 0,
  };

  try {
    // STEP 1: Export jobs from Google Sheets
    let fetchedJobs = [];

    if (!options.skipExport) {
      log('📊 STEP 1: Fetching jobs from Google Sheets...');

      const auth = await authenticate();
      fetchedJobs = await fetchJobsFromSheets(auth);
      stats.jobsFetched = fetchedJobs.length;

      log(`   ✓ Fetched ${stats.jobsFetched} jobs from Google Sheets`);
    } else {
      log('⏭️  STEP 1: Skipped (--skip-export flag)');
    }

    // STEP 2: Load existing jobs and identify what needs processing
    log('\n📂 STEP 2: Analyzing existing jobs...');

    let existingJobs = [];
    if (fs.existsSync(JOBS_FILE)) {
      existingJobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
      log(`   Found ${existingJobs.length} existing jobs`);
    }

    let jobsData;
    let jobsToProcess = [];

    if (options.skipExport) {
      // Just use existing jobs
      jobsData = existingJobs;
      jobsToProcess = existingJobs.filter(j => !j.structuredDescription);
    } else {
      // Merge fetched jobs with existing, preserving AI descriptions
      jobsData = mergeJobs(fetchedJobs, existingJobs);

      // Identify new jobs
      const { newJobs, updatedJobs } = identifyNewJobs(fetchedJobs, existingJobs);
      stats.newJobs = newJobs.length;

      if (stats.newJobs > 0) {
        log(`   🆕 Found ${stats.newJobs} new jobs`);
      }

      // Jobs that need AI processing
      jobsToProcess = jobsData.filter(j => !j.structuredDescription);
    }

    stats.jobsNeedingAI = jobsToProcess.length;

    if (stats.jobsNeedingAI === 0) {
      log('   ✅ All jobs already have AI-processed descriptions!');
      log('\n=== Sync Complete ===\n');
      return;
    }

    log(`   📝 ${stats.jobsNeedingAI} jobs need AI processing`);

    // Apply limit if specified
    if (options.limit) {
      jobsToProcess = jobsToProcess.slice(0, options.limit);
      log(`   Limited to ${options.limit} jobs for this run`);
    }

    // STEP 3: AI Processing
    log('\n🤖 STEP 3: Processing descriptions with AI...');

    const restructureJobDescription = await loadParser();
    log('   ✓ AI parser loaded');

    // Create backup
    if (!options.dryRun) {
      fs.writeFileSync(BACKUP_FILE, JSON.stringify(jobsData, null, 2), 'utf-8');
      log('   ✓ Backup created');
    }

    // Process each job
    log(`\n   Processing ${jobsToProcess.length} jobs...`);

    for (let i = 0; i < jobsToProcess.length; i++) {
      const job = jobsToProcess[i];
      const jobIndex = jobsData.findIndex(j => j.id === job.id);

      const progress = `[${i + 1}/${jobsToProcess.length}]`;
      const truncatedTitle = job.title.slice(0, 40).padEnd(40);

      process.stdout.write(`\r   ${progress} ${truncatedTitle}`);

      const result = await processJobDescription(job, restructureJobDescription);

      if (result.skipped) {
        stats.aiSkipped++;
      } else if (result.success) {
        jobsData[jobIndex].structuredDescription = result.structuredDescription;
        stats.aiSucceeded++;

        // Periodic save
        if (!options.dryRun && stats.aiSucceeded % SAVE_INTERVAL === 0) {
          fs.writeFileSync(JOBS_FILE, JSON.stringify(jobsData, null, 2), 'utf-8');
        }
      } else {
        stats.aiFailed++;
        log(`\n   ✗ Failed: ${job.title} - ${result.error}`, 'error');
      }

      stats.aiProcessed++;

      // Rate limiting
      if (i < jobsToProcess.length - 1) {
        await sleep(RATE_LIMIT_DELAY);
      }
    }

    // Clear progress line
    process.stdout.write('\r' + ' '.repeat(100) + '\r');

    // STEP 4: Save results
    if (!options.dryRun) {
      log('\n💾 STEP 4: Saving results...');
      fs.writeFileSync(JOBS_FILE, JSON.stringify(jobsData, null, 2), 'utf-8');
      log(`   ✓ Saved to ${JOBS_FILE}`);
    } else {
      log('\n⚠️  STEP 4: Skipped (dry run mode)');
    }

    // STEP 5: Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    log('\n=== Processing Complete ===\n');
    log('Summary:');
    if (!options.skipExport) {
      log(`  • Jobs fetched from Sheets: ${stats.jobsFetched}`);
      log(`  • New jobs discovered: ${stats.newJobs}`);
    }
    log(`  • Jobs needing AI processing: ${stats.jobsNeedingAI}`);
    log(`  • AI processing attempted: ${stats.aiProcessed}`);
    log(`  • Successfully processed: ${stats.aiSucceeded}`);
    log(`  • Failed: ${stats.aiFailed}`);
    log(`  • Skipped (no description): ${stats.aiSkipped}`);
    log(`  • Duration: ${duration}s`);

    // Cost estimation
    if (stats.aiSucceeded > 0) {
      const estimatedCost = (stats.aiSucceeded * 0.01).toFixed(2);
      log(`  • Estimated cost: $${estimatedCost} (${stats.aiSucceeded} jobs × ~$0.01)`);
    }

    if (options.dryRun) {
      log('\n⚠️  DRY RUN - No changes saved');
    }

    log('');

  } catch (error) {
    log(`\n❌ Fatal error: ${error.message}`, 'error');
    log(error.stack, 'error');
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
