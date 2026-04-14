// internal-jobs-review/scripts/trend-report/weeks.js
/**
 * Week-math utilities. All weeks are Monday-aligned, UTC.
 *
 * week_start = Monday 00:00:00 UTC of the week containing the given date.
 * week_end (exclusive) = Monday 00:00:00 UTC of the following week.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Returns the Monday 00:00 UTC of the week containing `date`. */
export function weekStartFor(date) {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  // getUTCDay: Sun=0, Mon=1 ... Sat=6. We want Monday as 0-offset.
  const dayFromMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayFromMonday);
  return d;
}

/** Exclusive end of the week: Monday 00:00 UTC of the following week. */
export function weekEndFor(date) {
  const start = weekStartFor(date);
  return new Date(start.getTime() + 7 * MS_PER_DAY);
}

/**
 * Returns the ordered list of Monday-aligned week-starts that overlap
 * the inclusive range [from, to].
 */
export function listWeeksBetween(from, to) {
  const first = weekStartFor(from);
  const last = weekStartFor(to);
  const weeks = [];
  for (let t = first.getTime(); t <= last.getTime(); t += 7 * MS_PER_DAY) {
    weeks.push(new Date(t));
  }
  return weeks;
}

/** YYYY-MM-DD UTC. */
export function formatWeekStart(weekStartDate) {
  return weekStartDate.toISOString().slice(0, 10);
}
