import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyJob } from '../classify.js';

test('classifyJob returns focus market label for a subsea job', () => {
  const out = classifyJob({
    title: 'ROV Pilot Technician',
    description: 'Operate remotely operated vehicles subsea.',
    location: 'Houston, TX, United States',
  });
  assert.equal(out.focusMarketSlug, 'subsea_oil_gas');
  assert.equal(out.focusMarketLabel, 'ROV & Subsea');
});

test('classifyJob returns null focus market for a non-matching job', () => {
  const out = classifyJob({
    title: 'Pastry Chef',
    description: 'Bake croissants.',
    location: 'Paris, France',
  });
  assert.equal(out.focusMarketSlug, null);
  assert.equal(out.focusMarketLabel, null);
});

test('classifyJob returns Gulf of Mexico for a Houston job', () => {
  const out = classifyJob({
    title: 'Drilling Engineer',
    description: 'Offshore drilling.',
    location: 'Houston, TX, United States',
  });
  assert.equal(out.regionName, 'Gulf of Mexico');
  assert.equal(out.country, 'United States');
});

test('classifyJob returns null region for a region-less location', () => {
  const out = classifyJob({
    title: 'Drilling Engineer',
    description: 'Onshore drilling.',
    location: 'Riyadh, Saudi Arabia',
  });
  assert.equal(out.regionName, null);
  assert.equal(out.country, 'Saudi Arabia');
});

test('classifyJob tolerates missing fields', () => {
  const out = classifyJob({ title: '', description: '', location: '' });
  assert.equal(out.focusMarketSlug, null);
  assert.equal(out.regionName, null);
  assert.equal(out.country, null);
});
