// scripts/trend-report/sheets.js
/**
 * Google Sheets I/O for the trend report: authorize, read source tabs, write
 * output tabs. Single module because all operations share the same v4 client
 * and tab-classification rules.
 *
 * Env:
 *   GOOGLE_SERVICE_ACCOUNT_PATH  path to service account JSON (falls back to
 *                                ../../../job-scraping/config/service_account.json
 *                                to match slack-weekly-digest.js convention)
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CREDS = path.join(__dirname, '../../../job-scraping/config/service_account.json');

// Tabs that must never be treated as source-job data.
const NON_DATA_TAB_NAMES = new Set([
  'Overview',
  'Source Coverage Matrix',
  'Run History',
  'Target Companies',
  'Client Jobs - Aggregated',
  'Agency Blocklist',
  'Trend Data',
  'BD Dashboard',
]);

// Column-header matchers. Strict on the first few columns; lenient on order
// of the rest since the sheets may drift.
const DIRECT_REQUIRED_HEADERS = ['Title', 'Company', 'Location', 'Description', 'URL'];
const AGGREGATOR_MEGA_HEADERS = ['Job ID', 'Title', 'Company', 'Location', 'Description', 'URL', 'Source'];

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function authorize() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || DEFAULT_CREDS;
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Service account not found at ${keyPath}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// ---------------------------------------------------------------------------
// Writing (for output tabs)
// ---------------------------------------------------------------------------

/** Create the tab if it does not exist. Returns sheetId. */
export async function ensureTab(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.find((s) => s.properties.title === title);
  if (existing) return existing.properties.sheetId;

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

/** Clear a tab and write a 2D array starting at A1. USER_ENTERED so formulas parse. */
export async function replaceTab(sheets, spreadsheetId, title, values) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${title}`,
  });
  if (values.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

// ---------------------------------------------------------------------------
// Reading (source tabs → normalized jobs)
// ---------------------------------------------------------------------------

/**
 * Classify a tab title into one of:
 *   'direct'             - a direct-employer tab (company = tab name)
 *   'aggregator-mega'    - the "Aggregator Jobs" tab (16-col, has Source + Profile)
 *   'aggregator-profile' - "Aggregator - <slug>" tab (profile from tab name)
 *   'skip'               - not a source-job tab
 */
function classifyTab(title) {
  if (NON_DATA_TAB_NAMES.has(title)) return 'skip';
  if (title.startsWith('_')) return 'skip';
  if (title.startsWith('Agency')) return 'skip';
  if (title === 'Aggregator Jobs') return 'aggregator-mega';
  if (title.startsWith('Aggregator - ')) return 'aggregator-profile';
  return 'direct';
}

/** Returns the tabs that actually contain source-job rows. */
async function listDataTabs(sheets, spreadsheetId, skipTabNames = []) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const skip = new Set([...NON_DATA_TAB_NAMES, ...skipTabNames]);
  const tabs = [];
  for (const s of meta.data.sheets) {
    const title = s.properties.title;
    if (skip.has(title)) continue;
    const kind = classifyTab(title);
    if (kind === 'skip') continue;
    tabs.push({ title, kind });
  }
  return tabs;
}

/**
 * Build a deterministic job id. Employer tabs often reuse the same URL for
 * different requisitions via query strings, so we hash url+company+title.
 */
function makeId(source, company, title, url) {
  const raw = `${source}|${company}|${title}|${url}`;
  // cheap 53-bit hash; avoids pulling in crypto
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (h * 31 + raw.charCodeAt(i)) | 0;
  }
  return `${source}-${Math.abs(h).toString(36)}`;
}

/** Map a header-cell array to an index lookup (case-insensitive, trimmed). */
function headerIndex(headers) {
  const idx = {};
  headers.forEach((h, i) => {
    if (typeof h === 'string') idx[h.trim()] = i;
  });
  return idx;
}

function pickRow(row, idx, name) {
  const i = idx[name];
  return i == null ? '' : (row[i] ?? '');
}

/**
 * Read every source-job row from the Sheet, normalize to:
 *   { id, source, company, title, location, description, url, status,
 *     scrapedAt, statusChangedDate, profileSlug }
 *
 * profileSlug is populated for aggregator-mega (Profile column) and
 * aggregator-profile (tab name suffix). null for direct-employer rows.
 *
 * URL-based dedup keeps the first seen occurrence.
 */
export async function loadJobs(sheets, spreadsheetId, { skipTabNames = [] } = {}) {
  const tabs = await listDataTabs(sheets, spreadsheetId, skipTabNames);
  const seenUrls = new Set();
  const jobs = [];
  let totalRowsRead = 0;
  let tabsReadOk = 0;
  const tabErrors = [];

  for (const { title, kind } of tabs) {
    let data;
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${title}!A1:Z`,
      });
      data = res.data.values || [];
    } catch (err) {
      tabErrors.push({ title, error: err.message });
      continue;
    }
    if (data.length < 2) continue;

    const headers = data[0];
    const idx = headerIndex(headers);

    // Sanity-check headers for the expected schema.
    if (kind === 'aggregator-mega') {
      if (!AGGREGATOR_MEGA_HEADERS.every((h) => idx[h] != null)) {
        tabErrors.push({ title, error: `aggregator-mega missing expected headers, got: ${headers.join(',')}` });
        continue;
      }
    } else {
      if (!DIRECT_REQUIRED_HEADERS.every((h) => idx[h] != null)) {
        tabErrors.push({ title, error: `direct missing expected headers, got: ${headers.join(',')}` });
        continue;
      }
    }

    const profileFromTab =
      kind === 'aggregator-profile' ? title.slice('Aggregator - '.length) : null;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const url = pickRow(row, idx, 'URL');
      if (!url) continue;
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      const company = pickRow(row, idx, 'Company') || (kind === 'direct' ? title : '');
      const rowTitle = pickRow(row, idx, 'Title');
      const status = (pickRow(row, idx, 'Status') || 'active').toLowerCase();
      const scrapedAt = pickRow(row, idx, 'Scraped At') || null;
      const statusChangedDate = pickRow(row, idx, 'Status Changed Date') || null;
      const description = pickRow(row, idx, 'Description');
      const location = pickRow(row, idx, 'Location');

      let source;
      let profileSlug = null;
      if (kind === 'direct') {
        source = 'direct';
      } else if (kind === 'aggregator-mega') {
        source = pickRow(row, idx, 'Source') || 'aggregator';
        profileSlug = pickRow(row, idx, 'Profile') || null;
      } else {
        source = 'aggregator';
        profileSlug = profileFromTab;
      }

      const id = makeId(source, company, rowTitle, url);

      jobs.push({
        id,
        source,
        company,
        title: rowTitle,
        location,
        description,
        url,
        status,
        scrapedAt,
        statusChangedDate,
        profileSlug,
      });

      totalRowsRead += 1;
    }
    tabsReadOk += 1;
  }

  return { jobs, stats: { tabsReadOk, totalRowsRead, tabErrors } };
}
