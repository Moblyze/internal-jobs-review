import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateInsights } from '../insights.js';

const thisWeek = new Date('2026-04-13T00:00:00Z');
const lastWeek = new Date('2026-04-06T00:00:00Z');
const twoAgo = new Date('2026-03-30T00:00:00Z');

const aggRows = [
  { weekStart: twoAgo,  dimension: 'employer', value: 'Halliburton', active: 420, new: 10, removed: 5, net: 5,  momentum3w: 5 },
  { weekStart: lastWeek, dimension: 'employer', value: 'Halliburton', active: 430, new: 15, removed: 5, net: 10, momentum3w: 7.5 },
  { weekStart: thisWeek, dimension: 'employer', value: 'Halliburton', active: 470, new: 45, removed: 5, net: 40, momentum3w: 18.3 },
  { weekStart: thisWeek, dimension: 'employer', value: 'BP', active: 440, new: 20, removed: 18, net: 2, momentum3w: 1 },
  { weekStart: twoAgo,  dimension: 'subsector', value: 'ROV & Subsea', active: 180, new: 8,  removed: 3, net: 5,  momentum3w: 5 },
  { weekStart: lastWeek, dimension: 'subsector', value: 'ROV & Subsea', active: 195, new: 20, removed: 5, net: 15, momentum3w: 10 },
  { weekStart: thisWeek, dimension: 'subsector', value: 'ROV & Subsea', active: 230, new: 40, removed: 5, net: 35, momentum3w: 18.3 },
  { weekStart: thisWeek, dimension: 'subsector', value: 'Decommissioning', active: 40, new: 2, removed: 18, net: -16, momentum3w: -10 },
  { weekStart: thisWeek, dimension: 'region', value: 'Gulf of Mexico', active: 310, new: 45, removed: 8, net: 37, momentum3w: 22 },
  { weekStart: thisWeek, dimension: 'employer', value: 'TinyCo', active: 3, new: 1, removed: 0, net: 1, momentum3w: 1 },
];

test('generateInsights returns 3–5 lines', () => {
  const lines = generateInsights(aggRows, thisWeek);
  assert.ok(lines.length >= 3 && lines.length <= 5, `got ${lines.length} lines`);
  for (const l of lines) assert.equal(typeof l, 'string');
});

test('generateInsights flags the biggest new-job gain employer', () => {
  const lines = generateInsights(aggRows, thisWeek);
  assert.ok(lines.some((l) => l.includes('Halliburton') && l.includes('45')));
});

test('generateInsights flags biggest subsector net gain', () => {
  const lines = generateInsights(aggRows, thisWeek);
  assert.ok(lines.some((l) => l.includes('ROV & Subsea')));
});

test('generateInsights flags biggest subsector net decrease', () => {
  const lines = generateInsights(aggRows, thisWeek);
  assert.ok(lines.some((l) => l.toLowerCase().includes('decommissioning')));
});

test('generateInsights ignores tiny employers', () => {
  const lines = generateInsights(aggRows, thisWeek);
  assert.ok(!lines.some((l) => l.includes('TinyCo')));
});
