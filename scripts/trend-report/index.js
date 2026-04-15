#!/usr/bin/env node
/**
 * Trend Report Builder
 *
 * Reads all source-job tabs from the Google Sheet, reconstructs weekly
 * active-job snapshots via replay + aggregation, and writes two new tabs:
 * "Trend Data" (long-format rows) and "BD Dashboard" (formulas + insights).
 *
 * Usage:
 *   node scripts/trend-report/index.js               # write to Sheet
 *   node scripts/trend-report/index.js --dry-run     # print, don't write
 *   node scripts/trend-report/index.js --weeks=12    # only most recent N weeks
 */

import { classifyJob } from './classify.js';
import { FOCUS_MARKET_LABELS, getMarketLabel } from '../../src/utils/focusMarkets.js';
import { listWeeksBetween, weekStartFor, formatWeekStart } from './weeks.js';
import { replayJobsAcrossWeeks } from './replay.js';
import { aggregateByDimension } from './aggregate.js';
import { addMomentum } from './momentum.js';
import { generateInsights } from './insights.js';
import { authorize, ensureTab, replaceTab, loadJobs } from './sheets.js';
import { buildDashboardValues } from './dashboard.js';
import { formatDashboard } from './formatting.js';

const SPREADSHEET_ID = '1xb3QBZG9Dtkyo_UmOGu3Oc3zMr2Cg1ohOyt-cd3WT7Y';
const TREND_DATA_TAB = 'Trend Data';
const DASHBOARD_TAB = 'Jobs Weekly';
const DIMENSIONS = ['employer', 'subsector', 'region', 'country'];

const DRY_RUN = process.argv.includes('--dry-run');
const weeksArg = process.argv.find((a) => a.startsWith('--weeks='));
const MAX_WEEKS = weeksArg ? parseInt(weeksArg.split('=')[1], 10) : null;

function log(msg) {
  console.log(`[trend-report] ${msg}`);
}

async function main() {
  log(`dry-run=${DRY_RUN} max-weeks=${MAX_WEEKS ?? 'all'}`);

  const sheets = await authorize();
  const { jobs: rawJobs, stats } = await loadJobs(sheets, SPREADSHEET_ID, {
    skipTabNames: [TREND_DATA_TAB, DASHBOARD_TAB],
  });
  log(`read ${stats.totalRowsRead} rows from ${stats.tabsReadOk} tabs, ${rawJobs.length} jobs after URL dedup`);
  if (stats.tabErrors.length > 0) {
    log(`${stats.tabErrors.length} tab read errors — first 3: ${JSON.stringify(stats.tabErrors.slice(0, 3))}`);
  }

  // Classify each job. Aggregator rows carry a profileSlug, but only slugs
  // that match one of the 11 real focus markets count as authoritative — the
  // other aggregator tabs ("Aggregator - interocean", etc.) are company-scoped
  // searches that should not leak into the subsector dimension.
  const decorated = rawJobs.map((j) => {
    const dims = classifyJob(j);
    if (j.profileSlug && FOCUS_MARKET_LABELS[j.profileSlug]) {
      dims.focusMarketSlug = j.profileSlug;
      dims.focusMarketLabel = getMarketLabel(j.profileSlug);
    }
    return { ...j, dims };
  });

  const now = new Date();
  const earliest = earliestScrapedAt(rawJobs);
  let weeks = listWeeksBetween(earliest, now);
  if (MAX_WEEKS) weeks = weeks.slice(-MAX_WEEKS);
  const currentWeekStart = weekStartFor(now);
  log(`replaying ${weeks.length} weeks (${formatWeekStart(weeks[0])} .. ${formatWeekStart(weeks[weeks.length - 1])})`);

  const replayRows = replayJobsAcrossWeeks(decorated, weeks);
  let aggRows = [];
  for (const dim of DIMENSIONS) {
    aggRows = aggRows.concat(aggregateByDimension(replayRows, decorated, dim));
  }
  aggRows = addMomentum(aggRows);
  log(`produced ${aggRows.length} aggregate rows across ${DIMENSIONS.length} dimensions`);

  const trendValues = [
    ['week_start', 'dimension', 'value', 'active', 'new', 'removed', 'net', 'momentum3w'],
    ...aggRows
      .sort(rowSort)
      .map((r) => [
        formatWeekStart(r.weekStart),
        r.dimension,
        r.value,
        r.active,
        r.new,
        r.removed,
        r.net,
        Math.round((r.momentum3w ?? 0) * 100) / 100,
      ]),
  ];

  const insightLines = generateInsights(aggRows, currentWeekStart);
  const dashboardValues = buildDashboardValues({ insightLines, currentWeekStart, now });

  if (DRY_RUN) {
    log(`DRY RUN: would write ${trendValues.length - 1} trend rows and dashboard with ${insightLines.length} insights`);
    log(`First 5 trend rows: ${JSON.stringify(trendValues.slice(1, 6))}`);
    log(`Insights:`);
    insightLines.forEach((l) => console.log(`  - ${l}`));
    return;
  }

  await ensureTab(sheets, SPREADSHEET_ID, TREND_DATA_TAB);
  const dashboardSheetId = await ensureTab(sheets, SPREADSHEET_ID, DASHBOARD_TAB);
  // Trend Data is a full-tab refresh.
  await replaceTab(sheets, SPREADSHEET_ID, TREND_DATA_TAB, trendValues);
  // Jobs Weekly: targeted A:F update only — does NOT clear the tab. User's
  // filter/definitions area (rows 18-46, cols P-S) stays untouched.
  const dashboardEndRow = dashboardValues.length;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${DASHBOARD_TAB}!A1:F${dashboardEndRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: dashboardValues },
  });
  // Top employers by total new postings. Includes direct + aggregator,
  // filters to names with at least 5 postings to skip obvious noise, then
  // top 50, then alphabetized for the dropdown.
  const employerTotals = new Map();
  for (const r of aggRows) {
    if (r.dimension !== 'employer') continue;
    if (!r.value) continue;
    employerTotals.set(r.value, (employerTotals.get(r.value) || 0) + (r.new || 0));
  }
  const topEmployers = [...employerTotals.entries()]
    .filter(([name, total]) => total >= 5 && /^[A-Za-z0-9]/.test(name))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([name]) => name)
    .sort();
  log(`dropdown list: ${topEmployers.length} top employers by total new postings`);
  await formatDashboard(sheets, SPREADSHEET_ID, dashboardSheetId, DASHBOARD_TAB, weeks.length, topEmployers);
  log(`wrote ${trendValues.length - 1} trend rows and dashboard to sheet ${SPREADSHEET_ID}`);
}

function earliestScrapedAt(jobs) {
  let min = null;
  for (const j of jobs) {
    if (!j.scrapedAt) continue;
    const d = new Date(j.scrapedAt);
    if (Number.isNaN(d.getTime())) continue;
    if (!min || d < min) min = d;
  }
  if (!min) {
    min = new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000);
  }
  return min;
}

function rowSort(a, b) {
  if (a.weekStart.getTime() !== b.weekStart.getTime()) {
    return a.weekStart.getTime() - b.weekStart.getTime();
  }
  if (a.dimension !== b.dimension) return a.dimension.localeCompare(b.dimension);
  return String(a.value).localeCompare(String(b.value));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
