#!/usr/bin/env node

/**
 * Slack Weekly Digest for Client Jobs - Aggregated
 *
 * Posts a weekly summary every Monday to #jobs-aggregated with:
 * - Total active jobs across all 18 target employers
 * - Net change from last week
 * - Per-employer breakdown (only those with changes)
 * - Top movers highlight
 *
 * State is persisted via GitHub Actions cache in data/weekly-digest-state.json.
 *
 * Environment:
 *   GOOGLE_SERVICE_ACCOUNT_PATH  - path to service account JSON
 *   SLACK_BOT_TOKEN              - Slack Bot User OAuth Token (xoxb-...)
 *   SLACK_CHANNEL_ID             - Slack channel ID for #jobs-aggregated
 *
 * Usage:
 *   node scripts/slack-weekly-digest.js
 *   node scripts/slack-weekly-digest.js --dry-run   # print message, don't post
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

const STATE_FILE = path.join(__dirname, '../data/weekly-digest-state.json');
const DEFAULT_CREDENTIALS_PATH = path.join(__dirname, '../../job-scraping/config/service_account.json');
const DRY_RUN = process.argv.includes('--dry-run');

// The 18 target employers and their expected worksheet tab names.
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

// Short display names for compact Slack output
const SHORT_NAMES = {
  'Helix Energy Solutions': 'Helix',
  'Interocean Marine Services': 'Interocean',
  'Altrad Sparrows': 'Altrad Sparrows',
  'ROVOP': 'ROVOP',
  'Oceaneering': 'Oceaneering',
  'Petrofac': 'Petrofac',
  'LRQA': 'LRQA',
  'OSM Thome': 'OSM Thome',
  'Wellsafe Solutions': 'Wellsafe',
  'Dron & Dickson': 'Dron & Dickson',
  'Sulmara': 'Sulmara',
  'Allrig Group': 'Allrig',
  'Coast Renewable Services': 'Coast Renewable',
  'Taurus Industrial Group': 'Taurus IG',
  'PBS by Ponticelli': 'PBS',
  'IO Consulting': 'IO Consulting',
  'Finnco': 'Finnco',
  'Rig Integrity Solutions': 'Rig Integrity',
};

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

// Aliases for matching sheet tab names that don't contain the full employer name
const TAB_ALIASES = {
  'Rig Integrity Solutions': ['rig_integrity', 'rig integrity'],
};

/**
 * Read all worksheets and return per-employer active job counts.
 *
 * Mirrors the daily digest's methodology so the two digests are consistent:
 *   - prefer a direct employer tab over an Aggregator tab (avoids double-count)
 *   - dedup active jobs by `title|||url` (the sheet accumulates duplicate rows
 *     across scrape runs; counting raw rows previously inflated the weekly
 *     total to ~6x the deduped daily total)
 *
 * Returns: { [employerName]: { activeCount: number } }
 */
async function readSheetData(authClient) {
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties.title',
  });

  const sheetTitles = spreadsheet.data.sheets.map(s => s.properties.title);
  const skipSheets = new Set(['Overview', 'Source Coverage Matrix', 'Target Companies', 'Aggregator Jobs', 'Template', 'Client Jobs - Aggregated', '_Client Org Lookup', '_Roles', '_Certs', 'Run History']);

  // Match tabs to employers, preferring direct tabs over Aggregator tabs.
  const directMatches = new Map();     // employer -> title
  const aggregatorMatches = new Map(); // employer -> title

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
      const aliases = TAB_ALIASES[emp];
      if (aliases) return aliases.some(alias => titleLower.includes(alias));
      return false;
    });

    if (!matchedEmployer) continue;

    if (isAggregator) {
      if (!aggregatorMatches.has(matchedEmployer)) aggregatorMatches.set(matchedEmployer, title);
    } else {
      if (!directMatches.has(matchedEmployer)) directMatches.set(matchedEmployer, title);
    }
  }

  const matchedSheets = []; // { title, employer }
  for (const employer of TARGET_EMPLOYERS) {
    const title = directMatches.get(employer) || aggregatorMatches.get(employer);
    if (title) matchedSheets.push({ title, employer });
  }

  const result = {};
  if (matchedSheets.length === 0) return result;

  const ranges = matchedSheets.map(s => `'${s.title}'`);
  const batchResponse = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges,
  });
  const valueRanges = batchResponse.data.valueRanges || [];

  for (let idx = 0; idx < matchedSheets.length; idx++) {
    const { title, employer } = matchedSheets[idx];
    const rows = valueRanges[idx]?.values || [];

    if (rows.length <= 1) {
      result[employer] = { activeCount: 0 };
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
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const jobTitle = (row[titleCol] || '').trim();
      const jobUrl = (row[urlCol] || '').trim();
      if (!jobTitle || !jobUrl) continue;

      const status = statusCol !== -1 ? (row[statusCol] || '').trim().toLowerCase() : 'active';
      if (status !== 'removed' && status !== 'inactive' && status !== 'closed') {
        active.add(`${jobTitle}|||${jobUrl}`);
      }
    }

    result[employer] = { activeCount: active.size };
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
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveState(currentData) {
  const snapshot = {
    timestamp: new Date().toISOString(),
    weekOf: getWeekOfDate(),
    employers: {},
  };

  for (const [employer, data] of Object.entries(currentData)) {
    snapshot.employers[employer] = {
      activeCount: data.activeCount,
    };
  }

  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(snapshot, null, 2));
  console.log(`State saved to ${STATE_FILE}`);
}

// ── Week Calculation ─────────────────────────────────────────────────────────

/**
 * Returns the Monday of the current week as a formatted date string.
 * e.g., "Mar 17, 2026"
 */
function getWeekOfDate() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[monday.getMonth()]} ${monday.getDate()}, ${monday.getFullYear()}`;
}

// ── Diff Calculation ─────────────────────────────────────────────────────────

function computeWeeklyDiff(previous, current) {
  const changes = []; // { employer, added, removed, currentTotal, prevTotal }
  let totalActive = 0;
  let prevTotalActive = 0;
  const newEmployers = [];
  const unchangedEmployers = [];

  for (const employer of TARGET_EMPLOYERS) {
    const curr = current[employer];
    const prev = previous?.employers?.[employer];

    if (!curr) continue;

    totalActive += curr.activeCount;

    if (!prev) {
      // New employer — wasn't in previous state
      newEmployers.push({ employer, activeCount: curr.activeCount });
      continue;
    }

    prevTotalActive += prev.activeCount;
    const diff = curr.activeCount - prev.activeCount;

    if (diff !== 0) {
      changes.push({
        employer,
        added: diff > 0 ? diff : 0,
        removed: diff < 0 ? Math.abs(diff) : 0,
        currentTotal: curr.activeCount,
        prevTotal: prev.activeCount,
        netChange: diff,
      });
    } else {
      unchangedEmployers.push(employer);
    }
  }

  // Sort changes by absolute net change (top movers first)
  changes.sort((a, b) => Math.abs(b.netChange) - Math.abs(a.netChange));

  const netChange = totalActive - prevTotalActive;

  return {
    totalActive,
    prevTotalActive,
    netChange,
    changes,
    newEmployers,
    unchangedEmployers,
    employersMonitored: Object.keys(current).length,
  };
}

// ── Slack Message Building ───────────────────────────────────────────────────

function shortName(employer) {
  return SHORT_NAMES[employer] || employer;
}

function buildSlackMessage(diff, isFirstRun) {
  const blocks = [];
  const weekOf = getWeekOfDate();

  if (isFirstRun) {
    return {
      text: `Weekly Jobs Digest: baseline captured for Week of ${weekOf}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `Weekly Jobs Digest — Week of ${weekOf}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:bar_chart: *Baseline Captured*\n\n*${diff.employersMonitored} employers monitored* | *${diff.totalActive.toLocaleString()} active jobs*\n\nThis is the first weekly snapshot. Week-over-week comparisons will begin next Monday.`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: buildEmployerList(diff),
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:clipboard: <${SHEET_URL}|Review the curation sheet>`,
          },
        },
      ],
    };
  }

  // ── Header ──
  const changeStr = diff.netChange >= 0
    ? `+${diff.netChange} from last week`
    : `${diff.netChange} from last week`;

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `Weekly Jobs Digest — Week of ${weekOf}`,
      emoji: true,
    },
  });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `:bar_chart: *${diff.employersMonitored} employers monitored* | *${diff.totalActive.toLocaleString()} active jobs* (${changeStr})`,
    },
  });

  // ── New Employers (if any) ──
  if (diff.newEmployers.length > 0) {
    const lines = diff.newEmployers
      .map(e => `• ${shortName(e.employer)}: ${e.activeCount} jobs`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:new: *New Employers Added:*\n${lines}`,
      },
    });
  }

  // ── Per-employer changes ──
  if (diff.changes.length > 0) {
    const added = diff.changes.filter(c => c.netChange > 0);
    const removed = diff.changes.filter(c => c.netChange < 0);

    if (added.length > 0) {
      const lines = added
        .sort((a, b) => b.netChange - a.netChange)
        .map(c => `• ${shortName(c.employer)}: +${c.added} jobs (${c.currentTotal} total)`)
        .join('\n');
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:chart_with_upwards_trend: *New This Week:*\n${lines}`,
        },
      });
    }

    if (removed.length > 0) {
      const lines = removed
        .sort((a, b) => a.netChange - b.netChange)
        .map(c => `• ${shortName(c.employer)}: -${c.removed} jobs (${c.currentTotal} total)`)
        .join('\n');
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:chart_with_downwards_trend: *Removed This Week:*\n${lines}`,
        },
      });
    }
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':white_check_mark: No changes across any employers this week.',
      },
    });
  }

  // ── Unchanged employers ──
  if (diff.unchangedEmployers.length > 0) {
    const names = diff.unchangedEmployers.map(e => shortName(e)).join(', ');
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*No changes:* ${names}`,
        },
      ],
    });
  }

  // ── Divider + link ──
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `:clipboard: <${SHEET_URL}|Review the curation sheet>`,
    },
  });

  // Fallback text
  const parts = [];
  if (diff.netChange !== 0) parts.push(`${changeStr}`);
  parts.push(`${diff.totalActive} active jobs`);

  return {
    text: `Weekly Jobs Digest (${weekOf}): ${parts.join(', ')}`,
    blocks,
  };
}

/**
 * Build a simple employer list for the baseline message.
 */
function buildEmployerList(diff) {
  // Combine all employers we have data for, sorted by count descending
  const all = TARGET_EMPLOYERS
    .filter(emp => diff.changes.find(c => c.employer === emp) || diff.newEmployers.find(e => e.employer === emp) || diff.unchangedEmployers.includes(emp))
    .map(emp => {
      const ne = diff.newEmployers.find(e => e.employer === emp);
      if (ne) return { employer: emp, count: ne.activeCount };
      return { employer: emp, count: 0 };
    });

  // For first run, just list from current data
  // (diff won't have the right structure on first run, so we handle this differently)
  return '*Current counts:*\nSee the curation sheet for full details.';
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
  console.log('=== Slack Weekly Digest ===');
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
    console.log(`  ${emp}: ${data.activeCount} active`);
  }

  // 3. Load previous state and compute diff
  const previousState = loadPreviousState();
  const isFirstRun = previousState === null;

  if (isFirstRun) {
    console.log('No previous state found — this is the first run.');
  } else {
    console.log(`Previous state from: ${previousState.timestamp} (Week of ${previousState.weekOf})`);
  }

  const diff = computeWeeklyDiff(previousState, currentData);
  console.log(`\nWeekly summary: ${diff.totalActive} active jobs, net change: ${diff.netChange >= 0 ? '+' : ''}${diff.netChange}`);
  console.log(`  ${diff.changes.length} employers with changes`);
  console.log(`  ${diff.unchangedEmployers.length} employers unchanged`);
  console.log(`  ${diff.newEmployers.length} new employers`);

  // 4. Build and send Slack message
  const message = buildSlackMessage(diff, isFirstRun);
  console.log('\nSlack message:');
  console.log(JSON.stringify(message, null, 2));

  if (!DRY_RUN) {
    await postToSlack(message);
  } else {
    console.log('\n(Dry run — message not posted)');
  }

  // 5. Save current state for next week
  saveState(currentData);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
