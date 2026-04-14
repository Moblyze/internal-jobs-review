import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateByDimension } from '../aggregate.js';

const weeks = [
  new Date('2026-04-06T00:00:00Z'),
  new Date('2026-04-13T00:00:00Z'),
];

const jobs = [
  {
    id: 'a1',
    company: 'Halliburton',
    dims: { focusMarketLabel: 'ROV & Subsea', regionName: 'Gulf of Mexico', country: 'United States' },
  },
  {
    id: 'a2',
    company: 'Halliburton',
    dims: { focusMarketLabel: 'Rope Access', regionName: 'Gulf of Mexico', country: 'United States' },
  },
  {
    id: 'a3',
    company: 'BP',
    dims: { focusMarketLabel: 'ROV & Subsea', regionName: 'North Sea', country: 'United Kingdom' },
  },
];

const replayRows = [
  { jobId: 'a1', weekStart: weeks[0], isActive: true, isNewThisWeek: true, isRemovedThisWeek: false },
  { jobId: 'a2', weekStart: weeks[0], isActive: true, isNewThisWeek: false, isRemovedThisWeek: false },
  { jobId: 'a3', weekStart: weeks[0], isActive: true, isNewThisWeek: true, isRemovedThisWeek: false },
  { jobId: 'a1', weekStart: weeks[1], isActive: true, isNewThisWeek: false, isRemovedThisWeek: false },
  { jobId: 'a2', weekStart: weeks[1], isActive: true, isNewThisWeek: false, isRemovedThisWeek: false },
  { jobId: 'a3', weekStart: weeks[1], isActive: false, isNewThisWeek: false, isRemovedThisWeek: true },
];

test('aggregates by employer', () => {
  const rows = aggregateByDimension(replayRows, jobs, 'employer');
  const hal406 = rows.find((r) => r.value === 'Halliburton' && r.weekStart === weeks[0]);
  assert.equal(hal406.active, 2);
  assert.equal(hal406.new, 1);
  assert.equal(hal406.removed, 0);
  assert.equal(hal406.net, 1);

  const bp413 = rows.find((r) => r.value === 'BP' && r.weekStart === weeks[1]);
  assert.equal(bp413.active, 0);
  assert.equal(bp413.removed, 1);
  assert.equal(bp413.net, -1);
});

test('aggregates by subsector (focus market label)', () => {
  const rows = aggregateByDimension(replayRows, jobs, 'subsector');
  const rov406 = rows.find((r) => r.value === 'ROV & Subsea' && r.weekStart === weeks[0]);
  assert.equal(rov406.active, 2);
  assert.equal(rov406.new, 2);
});

test('aggregates by region', () => {
  const rows = aggregateByDimension(replayRows, jobs, 'region');
  const gom406 = rows.find((r) => r.value === 'Gulf of Mexico' && r.weekStart === weeks[0]);
  assert.equal(gom406.active, 2);
});

test('aggregates by country', () => {
  const rows = aggregateByDimension(replayRows, jobs, 'country');
  const uk406 = rows.find((r) => r.value === 'United Kingdom' && r.weekStart === weeks[0]);
  assert.equal(uk406.active, 1);
});

test('skips rows where the dimension value is null', () => {
  const jobsWithNull = [
    { id: 'x1', company: 'X', dims: { focusMarketLabel: null, regionName: null, country: null } },
  ];
  const replay = [
    { jobId: 'x1', weekStart: weeks[0], isActive: true, isNewThisWeek: true, isRemovedThisWeek: false },
  ];
  const subsector = aggregateByDimension(replay, jobsWithNull, 'subsector');
  assert.equal(subsector.length, 0);
  const region = aggregateByDimension(replay, jobsWithNull, 'region');
  assert.equal(region.length, 0);
});
