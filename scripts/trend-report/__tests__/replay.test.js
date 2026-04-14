import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayJobsAcrossWeeks } from '../replay.js';

const weeks = [
  new Date('2026-03-30T00:00:00Z'),
  new Date('2026-04-06T00:00:00Z'),
  new Date('2026-04-13T00:00:00Z'),
];

test('a still-active job is active in every week on or after scrapedAt', () => {
  const job = {
    id: 'j1',
    status: 'active',
    scrapedAt: '2026-04-07T10:00:00Z',
    statusChangedDate: null,
  };
  const rows = replayJobsAcrossWeeks([job], weeks);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => [r.weekStart.toISOString().slice(0, 10), r.isActive, r.isNewThisWeek, r.isRemovedThisWeek]),
    [
      ['2026-03-30', false, false, false],
      ['2026-04-06', true,  true,  false],
      ['2026-04-13', true,  false, false],
    ],
  );
});

test('a removed job is inactive the week of removal and after', () => {
  const job = {
    id: 'j2',
    status: 'removed',
    scrapedAt: '2026-03-20T00:00:00Z',
    statusChangedDate: '2026-04-10T00:00:00Z',
  };
  const rows = replayJobsAcrossWeeks([job], weeks);
  assert.deepEqual(
    rows.map((r) => [r.weekStart.toISOString().slice(0, 10), r.isActive, r.isRemovedThisWeek]),
    [
      ['2026-03-30', true,  false],
      ['2026-04-06', false, true],
      ['2026-04-13', false, false],
    ],
  );
});

test('a job scraped in the middle of a week counts as new-this-week for that week', () => {
  const job = {
    id: 'j3',
    status: 'active',
    scrapedAt: '2026-04-08T10:00:00Z',
    statusChangedDate: null,
  };
  const rows = replayJobsAcrossWeeks([job], weeks);
  const wk = rows.find((r) => r.weekStart.toISOString().slice(0, 10) === '2026-04-06');
  assert.equal(wk.isNewThisWeek, true);
  assert.equal(wk.isActive, true);
});

test('missing scrapedAt is tolerated and the job is never active', () => {
  const job = { id: 'j4', status: 'active', scrapedAt: null, statusChangedDate: null };
  const rows = replayJobsAcrossWeeks([job], weeks);
  for (const r of rows) {
    assert.equal(r.isActive, false);
    assert.equal(r.isNewThisWeek, false);
  }
});
