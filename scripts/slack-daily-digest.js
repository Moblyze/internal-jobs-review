#!/usr/bin/env node

/**
 * Slack Daily Digest for Client Jobs - Aggregated
 *
 * After each daily scrape, reads the Google Sheet for the 18 target employers,
 * compares against previous state, and posts a Slack message summarising
 * new jobs added and jobs removed.
 *
 * State is persisted via GitHub Actions cache in data/digest-state.json.
 *
 * Environment:
 *   GOOGLE_SERVICE_ACCOUNT_PATH  - path to service account JSON
 *   SLACK_BOT_TOKEN              - Slack Bot User OAuth Token (xoxb-...)
 *   SLACK_CHANNEL_ID             - Slack channel ID for #jobs-aggregated
 *
 * Usage:
 *   node scripts/slack-daily-digest.js
 *   node scripts/slack-daily-digest.js --dry-run   # print message, don't post
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Configuration ────────────────────────────────────────────────────────────

const SPREADSHEET_ID = '1xb3QBZG9Dtkyo_UmOGu3Oc3zMr2Cg1ohOyt-cd3WT7Y';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?gid=1820304798#gid=1820304798`;

const STATE_FILE = path.join(__dirname, '../data/digest-state.json');
const DEFAULT_CREDENTIALS_PATH = path.join(__dirname, '../../job-scraping/config/service_account.json');
const DRY_RUN = process.argv.includes('--dry-run');

// The 18 target employers and their expected worksheet tab names.
// Keys are normalised names used in state; values are patterns to match tab titles.
const TARGET_EMPLOYERS = [
  'Helix Energy Solutions',
  'Interocean Marine Services',
  'Altrad Sparrows',
  'ROVOP',
  'Oceaneering',
  'Petrofac',
  'LRQA',
  'OSM Thome',
  'Wellsafe Solutions',
  'Dron & Dickson',
  'Sulmara',
  'Allrig Group',
  'Coast Renewable Services',
  'Taurus Industrial Group',
  'PBS by Ponticelli',
  'IO Consulting',
  'Finnco',
  'Rig Integrity Solutions',
];

// ── Retry Helper ─────────────────────────────────────────────────────────────

/**
 * Retry an async function with exponential backoff on rate-limit errors.
 * Google Sheets API returns HTTP 429 or errors with "Quota exceeded" on rate limits.
 */
async function withRetry(fn, { maxRetries = 5, initialDelayMs = 10_000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit =
        err?.code === 429 ||
        err?.status === 429 ||
        err?.response?.status === 429 ||
        (err?.message || '').includes('Quota exceeded') ||
        (err?.message || '').includes('RATE_LIMIT_EXCEEDED') ||
        (err?.message || '').includes('rateLimitExceeded');

      if (!isRateLimit || attempt === maxRetries) {
        throw err;
      }

      const delay = initialDelayMs * Math.pow(2, attempt);
      console.log(`  Rate limited (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// ── Google Sheets Auth ───────────────────────────────────────────────────────

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
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  return auth.getClient();
}

// ── Sheet Reading ────────────────────────────────────────────────────────────

/**
 * Read all worksheets from the spreadsheet and return per-employer job data.
 * Returns: { [employerName]: { active: Set<jobKey>, removed: Set<jobKey>, activeCount: number, removedCount: number } }
 *
 * A jobKey is a normalised string: `title|||url` to uniquely identify a job.
 */
async function readSheetData(authClient) {
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  // First, get all sheet names (with retry for rate limits)
  const spreadsheet = await withRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: 'sheets.properties.title',
    })
  );

  const sheetTitles = spreadsheet.data.sheets.map(s => s.properties.title);
  const skipSheets = new Set(['Overview', 'Source Coverage Matrix', 'Target Companies', 'Aggregator Jobs', 'Template']);

  // Build list of matched sheets so we can batch-fetch them all at once
  const matchedSheets = []; // { title, employer }
  for (const title of sheetTitles) {
    if (skipSheets.has(title)) continue;

    const matchedEmployer = TARGET_EMPLOYERS.find(emp =>
      title.toLowerCase().includes(emp.toLowerCase()) ||
      emp.toLowerCase().includes(title.toLowerCase()) ||
      normalise(title) === normalise(emp)
    );

    if (matchedEmployer) {
      matchedSheets.push({ title, employer: matchedEmployer });
    }
  }

  if (matchedSheets.length === 0) return {};

  // Use batchGet to fetch all matched sheets in a single API call
  const ranges = matchedSheets.map(s => `'${s.title}'`);
  console.log(`  Fetching ${ranges.length} sheets in a single batchGet call...`);

  const batchResponse = await withRetry(() =>
    sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges,
    })
  );

  const result = {};
  const valueRanges = batchResponse.data.valueRanges || [];

  for (let idx = 0; idx < matchedSheets.length; idx++) {
    const { title, employer } = matchedSheets[idx];
    const rows = valueRanges[idx]?.values || [];

    if (rows.length <= 1) {
      result[employer] = { active: new Set(), removed: new Set(), activeCount: 0, removedCount: 0 };
      continue;
    }

    const headers = rows[0].map(h => h.trim().toLowerCase());
    const titleCol = headers.indexOf('title');
    const urlCol = headers.indexOf('url');
    const statusCol = headers.indexOf('status');

    if (titleCol === -1 || urlCol === -1) {
      console.warn(`  Skipping "${title}": missing Title or URL column`);
      continue;
    }

    const active = new Set();
    const removed = new Set();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const jobTitle = (row[titleCol] || '').trim();
      const jobUrl = (row[urlCol] || '').trim();
      if (!jobTitle || !jobUrl) continue;

      const key = `${jobTitle}|||${jobUrl}`;
      const status = statusCol !== -1 ? (row[statusCol] || '').trim().toLowerCase() : 'active';

      if (status === 'removed' || status === 'inactive' || status === 'closed') {
        removed.add(key);
      } else {
        active.add(key);
      }
    }

    result[employer] = {
      active,
      removed,
      activeCount: active.size,
      removedCount: removed.size,
    };
  }

  return result;
}

function normalise(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── State Management ─────────────────────────────────────────────────────────

function loadPreviousState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Convert arrays back to Sets isn't needed — we store as arrays, compare as sets
    return raw;
  } catch {
    return null;
  }
}

function saveState(currentData) {
  const serialisable = {};
  for (const [employer, data] of Object.entries(currentData)) {
    serialisable[employer] = {
      active: [...data.active],
      removed: [...data.removed],
      activeCount: data.activeCount,
      removedCount: data.removedCount,
    };
  }

  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(serialisable, null, 2));
  console.log(`State saved to ${STATE_FILE}`);
}

// ── Diff Calculation ─────────────────────────────────────────────────────────

function computeDiff(previous, current) {
  const newJobs = {};       // employer -> count of new active jobs
  const removedJobs = {};   // employer -> count of newly removed jobs
  let totalNew = 0;
  let totalRemoved = 0;

  for (const employer of TARGET_EMPLOYERS) {
    const prev = previous?.[employer];
    const curr = current[employer];

    if (!curr) continue;

    const prevActive = new Set(prev?.active || []);
    const prevRemoved = new Set(prev?.removed || []);

    // New jobs: in current active but not in previous active
    let newCount = 0;
    for (const key of curr.active) {
      if (!prevActive.has(key)) newCount++;
    }

    // Newly removed: in current removed but not in previous removed
    let removedCount = 0;
    for (const key of curr.removed) {
      if (!prevRemoved.has(key)) removedCount++;
    }

    if (newCount > 0) {
      newJobs[employer] = newCount;
      totalNew += newCount;
    }

    if (removedCount > 0) {
      removedJobs[employer] = removedCount;
      totalRemoved += removedCount;
    }
  }

  return { newJobs, removedJobs, totalNew, totalRemoved };
}

// ── Slack Message Building ───────────────────────────────────────────────────

function buildSlackMessage(diff, isFirstRun) {
  const blocks = [];

  if (isFirstRun) {
    return {
      text: 'Daily Job Scan: initial baseline captured. Changes will be reported from the next run.',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ':clipboard: *Daily Job Scan — Baseline Captured*\nThis is the first run. Job counts have been recorded. Changes will be reported starting tomorrow.',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<${SHEET_URL}|View sheet>`,
          },
        },
      ],
    };
  }

  if (diff.totalNew === 0 && diff.totalRemoved === 0) {
    return {
      text: 'Daily Job Scan: no changes today.',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ':clipboard: *Daily Job Scan Complete*\nNo new jobs or removals detected across the 18 target employers today.',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<${SHEET_URL}|View sheet>`,
          },
        },
      ],
    };
  }

  // New jobs section
  if (diff.totalNew > 0) {
    const lines = Object.entries(diff.newJobs)
      .sort((a, b) => b[1] - a[1])
      .map(([emp, count]) => `• ${emp}: ${count} new`);

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:clipboard: *Daily Job Scan Complete*\n${diff.totalNew} new job${diff.totalNew === 1 ? '' : 's'} added:\n${lines.join('\n')}`,
      },
    });
  }

  // Removed jobs section
  if (diff.totalRemoved > 0) {
    const lines = Object.entries(diff.removedJobs)
      .sort((a, b) => b[1] - a[1])
      .map(([emp, count]) => `• ${emp}: ${count} removed`);

    const header = diff.totalNew > 0 ? '' : ':clipboard: *Daily Job Scan Complete*\n';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${header}:wastebasket: *Jobs Removed from Source Sites*\n${diff.totalRemoved} job${diff.totalRemoved === 1 ? '' : 's'} no longer active:\n${lines.join('\n')}`,
      },
    });
  }

  // Link to sheet
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `<${SHEET_URL}|Review sheet>`,
    },
  });

  // Build fallback text
  const parts = [];
  if (diff.totalNew > 0) parts.push(`${diff.totalNew} new jobs added`);
  if (diff.totalRemoved > 0) parts.push(`${diff.totalRemoved} jobs removed`);

  return {
    text: `Daily Job Scan: ${parts.join(', ')}`,
    blocks,
  };
}

// ── Slack Posting ────────────────────────────────────────────────────────────

async function postToSlack(message) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;

  if (!token) throw new Error('SLACK_BOT_TOKEN environment variable is required');
  if (!channelId) throw new Error('SLACK_CHANNEL_ID environment variable is required');

  const body = {
    channel: channelId,
    text: message.text,
    blocks: message.blocks,
  };

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();

  if (!result.ok) {
    throw new Error(`Slack API error: ${result.error}`);
  }

  console.log(`Slack message posted to channel ${channelId}`);
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Slack Daily Digest ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  // 1. Authenticate with Google Sheets
  console.log('Authenticating with Google Sheets...');
  const authClient = await authenticate();

  // 2. Read current sheet data
  console.log('Reading sheet data for target employers...');
  const currentData = await readSheetData(authClient);
  const employersFound = Object.keys(currentData).length;
  console.log(`Found data for ${employersFound} of ${TARGET_EMPLOYERS.length} target employers`);

  for (const [emp, data] of Object.entries(currentData)) {
    console.log(`  ${emp}: ${data.activeCount} active, ${data.removedCount} removed`);
  }

  // 3. Load previous state and compute diff
  const previousState = loadPreviousState();
  const isFirstRun = previousState === null;

  if (isFirstRun) {
    console.log('No previous state found — this is the first run.');
  }

  const diff = computeDiff(previousState, currentData);
  console.log(`\nDiff: ${diff.totalNew} new, ${diff.totalRemoved} removed`);

  // 4. Build and send Slack message
  const message = buildSlackMessage(diff, isFirstRun);
  console.log('\nSlack message:');
  console.log(JSON.stringify(message, null, 2));

  if (!DRY_RUN) {
    await postToSlack(message);
  } else {
    console.log('\n(Dry run — message not posted)');
  }

  // 5. Save current state for next run
  saveState(currentData);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
