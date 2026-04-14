// internal-jobs-review/scripts/trend-report/__tests__/weeks.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weekStartFor,
  weekEndFor,
  listWeeksBetween,
  formatWeekStart,
} from '../weeks.js';

test('weekStartFor returns Monday 00:00 UTC for a Wednesday', () => {
  // 2026-04-08 is a Wednesday
  const wed = new Date('2026-04-08T14:23:00Z');
  const start = weekStartFor(wed);
  assert.equal(start.toISOString(), '2026-04-06T00:00:00.000Z'); // Monday
});

test('weekStartFor returns same day for a Monday', () => {
  const mon = new Date('2026-04-06T08:00:00Z');
  const start = weekStartFor(mon);
  assert.equal(start.toISOString(), '2026-04-06T00:00:00.000Z');
});

test('weekStartFor handles Sunday as end of previous week', () => {
  const sun = new Date('2026-04-12T23:00:00Z');
  const start = weekStartFor(sun);
  assert.equal(start.toISOString(), '2026-04-06T00:00:00.000Z');
});

test('weekEndFor returns Monday 00:00 UTC of following week (exclusive)', () => {
  const anyDay = new Date('2026-04-08T14:23:00Z');
  const end = weekEndFor(anyDay);
  assert.equal(end.toISOString(), '2026-04-13T00:00:00.000Z');
});

test('listWeeksBetween returns Monday-aligned week starts inclusive of both ends', () => {
  const from = new Date('2026-03-15T00:00:00Z'); // Sunday
  const to = new Date('2026-04-08T00:00:00Z');   // Wednesday
  const weeks = listWeeksBetween(from, to);
  assert.deepEqual(
    weeks.map((d) => d.toISOString()),
    [
      '2026-03-09T00:00:00.000Z',
      '2026-03-16T00:00:00.000Z',
      '2026-03-23T00:00:00.000Z',
      '2026-03-30T00:00:00.000Z',
      '2026-04-06T00:00:00.000Z',
    ],
  );
});

test('formatWeekStart returns YYYY-MM-DD', () => {
  const mon = new Date('2026-04-06T00:00:00Z');
  assert.equal(formatWeekStart(mon), '2026-04-06');
});
