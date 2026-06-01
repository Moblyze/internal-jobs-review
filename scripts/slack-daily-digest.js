#!/usr/bin/env node

/**
 * Slack Daily Digest for Client Jobs - Aggregated
 *
 * After each daily scrape, reads the Google Sheet for the 19 target employers,
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

// The 19 target employers (alphabetical) and their expected worksheet tab names.
const TARGET_EMPLOYERS = [
  'Allrig Group',
  'Altrad Sparrows',
  'Coast Renewable Services',
  'Dron & Dickson',
  'Finnco',
  'Helix Energy Solutions',
  'Interocean Marine Services',
  'IO Consulting',
  'LRQA',
  'Oceaneering',
  'OSM Thome',
  'Pareto',
  'PBS by Ponticelli',
  'Petrofac',
  'Rig Integrity Solutions',
  'ROVOP',
  'Sulmara',
  'Taurus Industrial Group',
  'Wellsafe Solutions',
];

// Aliases for matching sheet tab names that don't contain the full employer name
const TAB_ALIASES = {
  'Rig Integrity Solutions': ['rig_integrity', 'rig integrity'],
};

// Short display names for the table (must stay under ~24 chars to fit)
const DISPLAY_NAMES = {
  'Allrig Group': 'Allrig Group',
  'Altrad Sparrows': 'Altrad Sparrows',
  'Coast Renewable Services': 'Coast Renewable',
  'Dron & Dickson': 'Dron & Dickson',
  'Finnco': 'Finnco',
  'Helix Energy Solutions': 'Helix Energy',
  'Interocean Marine Services': 'Interocean Marine',
  'IO Consulting': 'IO Consulting',
  'LRQA': 'LRQA',
  'Oceaneering': 'Oceaneering',
  'OSM Thome': 'OSM Thome',
  'Pareto': 'Pareto',
  'PBS by Ponticelli': 'PBS by Ponticelli',
  'Petrofac': 'Petrofac',
  'Rig Integrity Solutions': 'Rig Integrity',
  'ROVOP': 'ROVOP',
  'Sulmara': 'Sulmara',
  'Taurus Industrial Group': 'Taurus Industrial',
  'Wellsafe Solutions': 'Wellsafe Solutions',
};

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

// ── Job Classification ──────────────────────────────────────────────────────

/**
 * Classify a job into one of three market categories based on available fields.
 * Returns: 'rope_access' | 'rov' | 'other'
 */
function classifyJob(title, description, skills, certifications, employmentType) {
  const combined = `${title} ${description} ${skills} ${certifications} ${employmentType}`.toLowerCase();

  if (combined.includes('rope access') || combined.includes('irata')) {
    return 'rope_access';
  }

  if (/\brov\b/.test(combined)) {
    return 'rov';
  }

  return 'other';
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
  const skipSheets = new Set(['Overview', 'Source Coverage Matrix', 'Target Companies', 'Aggregator Jobs', 'Template', 'Client Jobs - Aggregated', '_Client Org Lookup', '_Roles', '_Certs', 'Run History']);

  // Build list of matched sheets so we can batch-fetch them all at once.
  // Prefer employer-specific tabs over Aggregator tabs to avoid double-counting.
  const directMatches = new Map();     // employer -> { title, employer }
  const aggregatorMatches = new Map(); // employer -> { title, employer }

  for (const title of sheetTitles) {
    if (skipSheets.has(title)) continue;

    const isAggregator = title.startsWith('Aggregator');

    const titleLower = title.toLowerCase();
    const titleNorm = normalise(title);

    const matchedEmployer = TARGET_EMPLOYERS.find(emp => {
      if (titleLower.includes(emp.toLowerCase()) ||
          emp.toLowerCase().includes(titleLower) ||
          titleNorm === normalise(emp) ||
          titleNorm.includes(normalise(emp)) ||
          normalise(emp).includes(titleNorm)) {
        return true;
      }
      // Check aliases for edge cases
      const aliases = TAB_ALIASES[emp];
      if (aliases) {
        return aliases.some(alias => titleLower.includes(alias));
      }
      return false;
    });

    if (matchedEmployer) {
      const entry = { title, employer: matchedEmployer };
      if (isAggregator) {
        if (!aggregatorMatches.has(matchedEmployer)) {
          aggregatorMatches.set(matchedEmployer, entry);
        }
      } else {
        // Direct tab takes priority; keep first match
        if (!directMatches.has(matchedEmployer)) {
          directMatches.set(matchedEmployer, entry);
        }
      }
    }
  }

  // Use direct tab when available, fall back to aggregator tab.
  // Tag the source so the guardrail can flag aggregator-sourced (keyword-search)
  // clients that come back implausibly large.
  const matchedSheets = [];
  for (const employer of TARGET_EMPLOYERS) {
    const direct = directMatches.get(employer);
    const match = direct || aggregatorMatches.get(employer);
    if (match) matchedSheets.push({ ...match, source: direct ? 'direct' : 'aggregator' });
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
      result[employer] = { active: new Set(), removed: new Set(), activeCount: 0, removedCount: 0, ropeAccessCount: 0, rovCount: 0, otherCount: 0 };
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

    const descCol = headers.indexOf('description');
    const skillsCol = headers.indexOf('skills');
    const certsCol = headers.indexOf('certifications');
    const empTypeCol = headers.indexOf('employment type');

    const active = new Set();
    const removed = new Set();
    let rawActive = 0; // non-removed rows BEFORE dedup — used to detect duplicate accumulation
    let ropeAccessCount = 0;
    let rovCount = 0;
    let otherCount = 0;

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
        rawActive++;
        // Only classify if this is a new unique active job (avoid double-counting duplicates)
        const isNew = !active.has(key);
        active.add(key);

        if (isNew) {
          const category = classifyJob(
            jobTitle,
            descCol !== -1 ? (row[descCol] || '') : '',
            skillsCol !== -1 ? (row[skillsCol] || '') : '',
            certsCol !== -1 ? (row[certsCol] || '') : '',
            empTypeCol !== -1 ? (row[empTypeCol] || '') : '',
          );

          if (category === 'rope_access') ropeAccessCount++;
          else if (category === 'rov') rovCount++;
          else otherCount++;
        }
      }
    }

    result[employer] = {
      active,
      removed,
      activeCount: active.size,
      rawActiveCount: rawActive,
      source: matchedSheets[idx].source,
      removedCount: removed.size,
      ropeAccessCount,
      rovCount,
      otherCount,
    };
  }

  return result;
}

// ── Guardrail / Sanity Checks ────────────────────────────────────────────────

// Thresholds for the auto sanity-check flags appended to the digest.
const DUP_RATIO_FLAG = 3;     // raw rows >= 3x unique => duplicate accumulation
const DUP_MIN_ROWS = 200;     // ignore small tabs where a high ratio is meaningless
const AGG_NOISE_FLAG = 50;    // an aggregator-sourced client over this is suspicious

/**
 * Flag the two failure modes that have actually bitten us:
 *   1. Duplicate-row accumulation (raw rows >> unique) — a write-path regression.
 *   2. Aggregator/keyword-sourced clients coming back implausibly large —
 *      keyword bleed (the Finnco / Rig Integrity / IO Consulting incident).
 * Returns a list of human-readable flag strings (empty on a clean day).
 */
function computeGuardrailFlags(currentData) {
  const flags = [];
  for (const [employer, d] of Object.entries(currentData)) {
    const name = DISPLAY_NAMES[employer] || employer;
    const live = d.activeCount || 0;
    const raw = d.rawActiveCount || 0;

    if (raw >= DUP_MIN_ROWS && live > 0 && raw / live >= DUP_RATIO_FLAG) {
      flags.push(
        `${name}: ${raw} rows but only ${live} unique (${(raw / live).toFixed(1)}× ` +
        `duplication) — check the scraper write path`
      );
    }

    if (d.source === 'aggregator' && live > AGG_NOISE_FLAG) {
      flags.push(
        `${name}: ${live} live from a keyword-search (aggregator) source ` +
        `— verify these actually name the company`
      );
    }
  }
  return flags;
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
      ropeAccessCount: data.ropeAccessCount,
      rovCount: data.rovCount,
      otherCount: data.otherCount,
    };
  }

  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(serialisable, null, 2));
  console.log(`State saved to ${STATE_FILE}`);
}

// ── Diff Calculation ─────────────────────────────────────────────────────────

function computeDiff(previous, current) {
  const rows = [];          // per-employer row data for the table
  let totalNew = 0;
  let totalRemoved = 0;
  let totalLive = 0;
  let totalRA = 0;
  let totalROV = 0;
  let totalOther = 0;

  for (const employer of TARGET_EMPLOYERS) {
    const prev = previous?.[employer];
    const curr = current[employer];

    const prevActive = new Set(prev?.active || []);
    const prevRemoved = new Set(prev?.removed || []);

    let newCount = 0;
    let removedCount = 0;

    if (curr) {
      for (const key of curr.active) {
        if (!prevActive.has(key)) newCount++;
      }
      for (const key of curr.removed) {
        if (!prevRemoved.has(key)) removedCount++;
      }
    }

    const live = curr?.activeCount || 0;
    const ra = curr?.ropeAccessCount || 0;
    const rov = curr?.rovCount || 0;
    const other = curr?.otherCount || 0;

    totalNew += newCount;
    totalRemoved += removedCount;
    totalLive += live;
    totalRA += ra;
    totalROV += rov;
    totalOther += other;

    rows.push({
      employer,
      displayName: DISPLAY_NAMES[employer] || employer,
      newCount,
      removedCount,
      live,
      ra,
      rov,
      other,
    });
  }

  return { rows, totalNew, totalRemoved, totalLive, totalRA, totalROV, totalOther };
}

// ── Slack Message Building ───────────────────────────────────────────────────

/**
 * Format a number for display: 0 → '—', positive → string
 */
function fmt(n) {
  return n === 0 ? '—' : String(n);
}

/**
 * Right-pad a string to a fixed width.
 */
function pad(s, width) {
  return s + ' '.repeat(Math.max(0, width - s.length));
}

/**
 * Left-pad a string to a fixed width (for numeric columns).
 */
function lpad(s, width) {
  return ' '.repeat(Math.max(0, width - s.length)) + s;
}

function buildSlackMessage(diff, isFirstRun, currentData) {
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

  // Build table
  const COL = { name: 22, num: 4, cat: 6 };
  const SEP = '  ';

  // Column widths
  const W = { name: 22, small: 5, mid: 11 };
  const DIV = ' │ ';

  const header =
    pad('Client', W.name) + SEP +
    lpad('+New', W.small) + SEP +
    lpad('\uD83D\uDDD1\uFE0F', W.small) + SEP +
    lpad('Live', W.small) + DIV +
    lpad('Rope Access', W.mid) + SEP +
    lpad('ROV', W.small) + SEP +
    lpad('Other', W.small);

  const divider = '─'.repeat(header.length);

  const dataRows = diff.rows.map(r =>
    pad(r.displayName, W.name) + SEP +
    lpad(fmt(r.newCount), W.small) + SEP +
    lpad(fmt(r.removedCount), W.small) + SEP +
    lpad(fmt(r.live), W.small) + DIV +
    lpad(fmt(r.ra), W.mid) + SEP +
    lpad(fmt(r.rov), W.small) + SEP +
    lpad(fmt(r.other), W.small)
  );

  const totalsRow =
    pad('TOTAL', W.name) + SEP +
    lpad(String(diff.totalNew), W.small) + SEP +
    lpad(String(diff.totalRemoved), W.small) + SEP +
    lpad(String(diff.totalLive), W.small) + DIV +
    lpad(String(diff.totalRA), W.mid) + SEP +
    lpad(String(diff.totalROV), W.small) + SEP +
    lpad(String(diff.totalOther), W.small);

  const table = [header, divider, ...dataRows, divider, totalsRow].join('\n');

  const noChanges = diff.totalNew === 0 && diff.totalRemoved === 0;
  const changeNote = noChanges ? '\n_No changes since last scan._' : '';

  // Build fallback text
  const parts = [];
  if (diff.totalNew > 0) parts.push(`${diff.totalNew} new`);
  if (diff.totalRemoved > 0) parts.push(`${diff.totalRemoved} removed`);
  const summary = parts.length > 0 ? parts.join(', ') : 'no changes';

  const flags = computeGuardrailFlags(currentData);

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:clipboard: *Daily Job Scan Complete — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}*`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '```\n' + table + '\n```',
      },
    },
  ];

  // Only surfaced when something looks off — no noise on clean days.
  if (flags.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':rotating_light: *Sanity-check flags* (auto):\n' + flags.map(f => `• ${f}`).join('\n'),
      },
    });
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: changeNote + `\n<${SHEET_URL}|Review sheet>`,
    },
  });

  const flagSuffix = flags.length > 0 ? ` :rotating_light: ${flags.length} sanity flag${flags.length === 1 ? '' : 's'}` : '';

  return {
    text: `Daily Job Scan: ${summary}. ${diff.totalLive} active jobs.${flagSuffix}`,
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
  const message = buildSlackMessage(diff, isFirstRun, currentData);
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
