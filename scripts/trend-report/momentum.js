// scripts/trend-report/momentum.js
/**
 * Add a 3-week rolling momentum to aggregate rows.
 *
 * For each (dimension, value, week), momentum3w = mean of `net` across
 * this week and up to the two prior weeks (using whatever rows exist for
 * that same dimension+value). Input rows are not assumed sorted; output
 * preserves input order.
 */

export function addMomentum(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.dimension}|${r.value}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const byRowKey = new Map();
  for (const group of groups.values()) {
    group.sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
    for (let i = 0; i < group.length; i++) {
      const window = group.slice(Math.max(0, i - 2), i + 1);
      const mean = window.reduce((s, x) => s + x.net, 0) / window.length;
      byRowKey.set(
        `${group[i].weekStart.toISOString()}|${group[i].dimension}|${group[i].value}`,
        mean,
      );
    }
  }

  return rows.map((r) => ({
    ...r,
    momentum3w: byRowKey.get(`${r.weekStart.toISOString()}|${r.dimension}|${r.value}`),
  }));
}
