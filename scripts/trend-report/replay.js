// scripts/trend-report/replay.js
/**
 * Reconstruct per-week per-job activity from Sheet-sourced job records.
 *
 * Fields expected on each job: id, status ('active'|'removed'|'paused'),
 * scrapedAt (ISO string or null), statusChangedDate (ISO string or null).
 *
 * For each (job, week):
 *   isActive          = job.scrapedAt <= weekEnd
 *                       AND (status !== 'removed' OR statusChangedDate > weekEnd)
 *   isNewThisWeek     = weekStart <= scrapedAt < weekEnd
 *   isRemovedThisWeek = status === 'removed' AND
 *                       weekStart <= statusChangedDate < weekEnd
 *
 * Jobs with no scrapedAt are skipped (never active).
 */

import { weekEndFor } from './weeks.js';

function parseDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function replayJobsAcrossWeeks(jobs, weeks) {
  const rows = [];
  for (const job of jobs) {
    const scrapedAt = parseDateOrNull(job.scrapedAt);
    const statusChanged = parseDateOrNull(job.statusChangedDate);
    const isRemoved = job.status === 'removed';

    for (const weekStart of weeks) {
      const weekEnd = weekEndFor(weekStart);
      const inWeek = (d) => !!(d && d >= weekStart && d < weekEnd);

      let isActive = false;
      if (scrapedAt && scrapedAt < weekEnd) {
        if (!isRemoved) {
          isActive = true;
        } else if (statusChanged && statusChanged >= weekEnd) {
          isActive = true;
        }
      }

      rows.push({
        jobId: job.id,
        weekStart,
        isActive,
        isNewThisWeek: inWeek(scrapedAt),
        isRemovedThisWeek: isRemoved && inWeek(statusChanged),
      });
    }
  }
  return rows;
}
