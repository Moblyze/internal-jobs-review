import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveArchetypes, ARCHETYPES } from '../archetypes.js'

test('null phase returns empty list', () => {
  assert.deepEqual(deriveArchetypes(null, ['rov_subsea'], 'midsize'), [])
})

test('unknown phase returns empty list', () => {
  assert.deepEqual(deriveArchetypes('discovery', ['rov_subsea'], 'midsize'), [])
})

test('construction + rov_subsea + midsize includes site_manager, hiring_manager, rov_supervisor', () => {
  const result = deriveArchetypes('construction', ['rov_subsea'], 'midsize')
  assert.ok(result.includes('site_manager'))
  assert.ok(result.includes('hiring_manager'))
  assert.ok(result.includes('rov_supervisor'))
  assert.ok(!result.includes('hr_business_partner'))
})

test('small company collapses regardless of phase', () => {
  const result = deriveArchetypes('construction', ['rov_subsea'], 'small')
  assert.deepEqual(result.sort(), ['hiring_manager', 'rov_supervisor'].sort())
})

test('solo company is the same collapsed shape', () => {
  const result = deriveArchetypes('sanctioned_engineering', ['survey_geophysical'], 'solo')
  assert.deepEqual(result.sort(), ['hiring_manager', 'survey_lead'].sort())
})

test('large company adds hr_business_partner', () => {
  const result = deriveArchetypes('construction', ['rov_subsea'], 'large')
  assert.ok(result.includes('hr_business_partner'))
})

test('mega company adds hr_business_partner AND business_unit_director', () => {
  const result = deriveArchetypes('construction', ['rov_subsea'], 'mega')
  assert.ok(result.includes('hr_business_partner'))
  assert.ok(result.includes('business_unit_director'))
})

test('mega company already including business_unit_director does not duplicate', () => {
  const result = deriveArchetypes('pre_sanction', [], 'mega')
  const count = result.filter(a => a === 'business_unit_director').length
  assert.equal(count, 1)
})

test('multiple disciplines combine', () => {
  const result = deriveArchetypes('construction', ['rov_subsea', 'survey_geophysical', 'ndt_inspection'], 'midsize')
  assert.ok(result.includes('rov_supervisor'))
  assert.ok(result.includes('survey_lead'))
  assert.ok(result.includes('ndt_supervisor'))
})

test('discipline without a natural lead is silently dropped', () => {
  const result = deriveArchetypes('construction', ['rope_access', 'rov_subsea'], 'midsize')
  assert.ok(result.includes('rov_supervisor'))
  // rope_access maps to [], nothing added from it
})

test('unknown size_tier behaves like midsize (no collapse, no HRBP)', () => {
  const result = deriveArchetypes('construction', ['rov_subsea'], 'unknown')
  assert.ok(result.includes('site_manager'))
  assert.ok(result.includes('rov_supervisor'))
  assert.ok(!result.includes('hr_business_partner'))
})

test('every output archetype is in the canonical ARCHETYPES vocab', () => {
  const cases = [
    ['pre_sanction', [], 'small'],
    ['sanctioned_engineering', ['rov_subsea', 'ndt_inspection'], 'mega'],
    ['construction', ['drilling_operations'], 'midsize'],
    ['operating', ['survey_geophysical'], 'large'],
  ]
  for (const [phase, scope, tier] of cases) {
    const result = deriveArchetypes(phase, scope, tier)
    for (const a of result) {
      assert.ok(ARCHETYPES.includes(a), `archetype ${a} not in vocab`)
    }
  }
})
