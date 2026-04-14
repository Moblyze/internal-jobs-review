#!/usr/bin/env node
/**
 * Trend Report Builder
 *
 * Reads dist/data/jobs.json, reconstructs weekly active-job snapshots,
 * and writes to the "Trend Data" and "BD Dashboard" tabs of the
 * Job Scraping Results Sheet.
 *
 * Usage:
 *   node scripts/trend-report/index.js               # write to Sheet
 *   node scripts/trend-report/index.js --dry-run     # print, don't write
 *   node scripts/trend-report/index.js --weeks=12    # only most recent N weeks
 */

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`trend-report: starting (dry-run=${DRY_RUN})`);
  console.log('trend-report: not yet implemented');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
