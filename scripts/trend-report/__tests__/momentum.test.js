import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMomentum } from '../momentum.js';

const w1 = new Date('2026-03-30T00:00:00Z');
const w2 = new Date('2026-04-06T00:00:00Z');
const w3 = new Date('2026-04-13T00:00:00Z');

test('momentum3w averages net across current and two prior weeks', () => {
  const rows = [
    { weekStart: w1, dimension: 'employer', value: 'Halliburton', active: 10, new: 3, removed: 1, net: 2 },
    { weekStart: w2, dimension: 'employer', value: 'Halliburton', active: 12, new: 4, removed: 2, net: 2 },
    { weekStart: w3, dimension: 'employer', value: 'Halliburton', active: 15, new: 5, removed: 2, net: 3 },
  ];
  const out = addMomentum(rows);
  const halW3 = out.find((r) => r.weekStart === w3 && r.value === 'Halliburton');
  assert.equal(Math.round(halW3.momentum3w * 100) / 100, 2.33);
});

test('momentum3w averages over available weeks when fewer than 3 exist', () => {
  const rows = [
    { weekStart: w2, dimension: 'employer', value: 'BP', active: 20, new: 6, removed: 2, net: 4 },
    { weekStart: w3, dimension: 'employer', value: 'BP', active: 22, new: 5, removed: 3, net: 2 },
  ];
  const out = addMomentum(rows);
  const bpW3 = out.find((r) => r.weekStart === w3 && r.value === 'BP');
  assert.equal(bpW3.momentum3w, 3);
});

test('momentum3w keeps dimensions and values independent', () => {
  const rows = [
    { weekStart: w1, dimension: 'employer', value: 'A', active: 1, new: 1, removed: 0, net: 1 },
    { weekStart: w1, dimension: 'employer', value: 'B', active: 1, new: 5, removed: 0, net: 5 },
  ];
  const out = addMomentum(rows);
  const a = out.find((r) => r.value === 'A');
  const b = out.find((r) => r.value === 'B');
  assert.equal(a.momentum3w, 1);
  assert.equal(b.momentum3w, 5);
});
