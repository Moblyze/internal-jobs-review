/**
 * Fold replay rows into per-(week, dimension_value) metrics.
 *
 * Supported dimensions:
 *   'employer'  -> job.company
 *   'subsector' -> job.dims.focusMarketLabel
 *   'region'    -> job.dims.regionName
 *   'country'   -> job.dims.country
 *
 * Rows where the dimension value is null/empty are excluded.
 *
 * Output row shape:
 *   { weekStart, dimension, value, active, new: Number, removed: Number, net: Number }
 */

const DIMENSION_GETTERS = {
  employer: (job) => job.company || null,
  subsector: (job) => job.dims?.focusMarketLabel || null,
  region: (job) => job.dims?.regionName || null,
  country: (job) => job.dims?.country || null,
};

export function aggregateByDimension(replayRows, jobs, dimension) {
  const getValue = DIMENSION_GETTERS[dimension];
  if (!getValue) {
    throw new Error(`Unknown dimension: ${dimension}`);
  }

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const buckets = new Map();

  for (const row of replayRows) {
    const job = jobById.get(row.jobId);
    if (!job) continue;
    const value = getValue(job);
    if (!value) continue;
    const key = `${row.weekStart.toISOString()}|${value}`;

    let b = buckets.get(key);
    if (!b) {
      b = { weekStart: row.weekStart, dimension, value, active: 0, new: 0, removed: 0 };
      buckets.set(key, b);
    }

    if (row.isActive) b.active += 1;
    if (row.isNewThisWeek) b.new += 1;
    if (row.isRemovedThisWeek) b.removed += 1;
  }

  const rows = Array.from(buckets.values());
  for (const b of rows) {
    b.net = b.new - b.removed;
  }
  return rows;
}
