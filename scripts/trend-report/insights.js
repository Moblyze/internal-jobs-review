// scripts/trend-report/insights.js
/**
 * Generate 3–5 key insight strings from this-week's aggregate rows.
 *
 * Un-noisy rules:
 *   - Ignore employer rows with active < 10 unless new >= 10.
 *   - Emit at most 1 per employer, 1 per subsector, 1 per region.
 *   - Candidates, in priority order:
 *       1. employer with largest `new` this week
 *       2. subsector with largest `net` this week (positive)
 *       3. subsector with smallest `net` this week (most negative)
 *       4. region with highest `momentum3w`
 *       5. employer with 3+ consecutive weeks of positive net
 */

function formatEmployer(row) {
  return `${row.value}: +${row.new} new postings this week (active ${row.active}, net ${fmtNet(row.net)}).`;
}

function formatSubsectorUp(row) {
  return `${row.value} subsector up ${fmtNet(row.net)} this week (active ${row.active}).`;
}

function formatSubsectorDown(row) {
  return `${row.value} subsector down ${Math.abs(row.net)} this week (active ${row.active}).`;
}

function formatRegionMomentum(row) {
  return `${row.value}: 3-week momentum ${fmtNet(Math.round(row.momentum3w * 10) / 10)} (active ${row.active}).`;
}

function formatStreak(row, streak) {
  return `${row.value}: positive net growth for ${streak} consecutive weeks.`;
}

function fmtNet(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function generateInsights(aggRows, currentWeekStart) {
  const thisWeekKey = currentWeekStart.toISOString();
  const isThisWeek = (r) => r.weekStart.toISOString() === thisWeekKey;

  const employerRows = aggRows.filter((r) => r.dimension === 'employer');
  const subsectorRows = aggRows.filter((r) => r.dimension === 'subsector');
  const regionRows = aggRows.filter((r) => r.dimension === 'region');

  const employerThis = employerRows
    .filter(isThisWeek)
    .filter((r) => r.active >= 10 || r.new >= 10);

  const subsectorThis = subsectorRows.filter(isThisWeek);
  const regionThis = regionRows.filter(isThisWeek);

  const lines = [];

  const topEmployer = [...employerThis].sort((a, b) => b.new - a.new)[0];
  if (topEmployer && topEmployer.new > 0) lines.push(formatEmployer(topEmployer));

  const topSubUp = [...subsectorThis].sort((a, b) => b.net - a.net)[0];
  if (topSubUp && topSubUp.net > 0) lines.push(formatSubsectorUp(topSubUp));

  const topSubDown = [...subsectorThis].sort((a, b) => a.net - b.net)[0];
  if (topSubDown && topSubDown.net < 0) lines.push(formatSubsectorDown(topSubDown));

  const topRegion = [...regionThis].sort(
    (a, b) => (b.momentum3w ?? 0) - (a.momentum3w ?? 0),
  )[0];
  if (topRegion && (topRegion.momentum3w ?? 0) > 0) lines.push(formatRegionMomentum(topRegion));

  if (lines.length < 5) {
    const streaks = positiveStreaks(employerRows, currentWeekStart);
    const best = streaks
      .filter((s) => s.streak >= 3)
      .sort((a, b) => b.streak - a.streak || b.row.active - a.row.active)[0];
    if (best && !lines.some((l) => l.startsWith(`${best.row.value}:`))) {
      lines.push(formatStreak(best.row, best.streak));
    }
  }

  return lines.slice(0, 5);
}

function positiveStreaks(employerRows, currentWeekStart) {
  const byEmployer = new Map();
  for (const r of employerRows) {
    if (!byEmployer.has(r.value)) byEmployer.set(r.value, []);
    byEmployer.get(r.value).push(r);
  }
  const results = [];
  const thisKey = currentWeekStart.toISOString();
  for (const [value, rows] of byEmployer) {
    rows.sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime());
    let streak = 0;
    let row = null;
    for (const r of rows) {
      if (!row && r.weekStart.toISOString() === thisKey) row = r;
      if (r.net > 0) streak += 1;
      else break;
    }
    if (row) results.push({ row, streak });
  }
  return results;
}
