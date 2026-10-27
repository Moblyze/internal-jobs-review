// Feed stages: every raw stage value the enrichment step can write maps onto one ordered set of six.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STAGES, stageKeyOf, getPhaseStage, normalizeStageFilter } from '../../src/utils/feed/phaseStage.js'

test('six stages in order', () => {
  assert.deepEqual(STAGES.map(s => s.label), ['Planning', 'Awarded', 'Mobilizing', 'Peak work', 'Completion', 'Operating'])
})

test('new-build values map onto the shared stages', () => {
  const cases = [
    [{ phase: 'pre_sanction' }, 'planning'],
    [{ phase: 'sanctioned_engineering' }, 'awarded'],
    [{ phase: 'construction', construction_subphase: 'rampup' }, 'mobilizing'],
    [{ phase: 'construction', construction_subphase: 'peak' }, 'peak'],
    [{ phase: 'construction', construction_subphase: 'commissioning' }, 'completion'],
    [{ phase: 'construction' }, 'mobilizing'],
    [{ phase: 'operating', lifecycle_track: 'greenfield' }, 'operating'],
  ]
  for (const [e, k] of cases) assert.equal(stageKeyOf(e), k, JSON.stringify(e))
})

test('decommissioning values map onto the same stages, decom_stage wins over phase', () => {
  const d = s => ({ lifecycle_track: 'decommissioning', decom_stage: s })
  assert.equal(stageKeyOf(d('planning')), 'planning')
  assert.equal(stageKeyOf(d('permits')), 'planning')
  assert.equal(stageKeyOf(d('contract_awarded')), 'awarded')
  assert.equal(stageKeyOf(d('mobilization')), 'mobilizing')
  assert.equal(stageKeyOf(d('active_execution')), 'peak')
  assert.equal(stageKeyOf(d('site_clearance')), 'completion')
  assert.equal(stageKeyOf({ ...d('planning'), phase: 'operating' }), 'planning')
  assert.equal(getPhaseStage(d('permits')).track, 'decommissioning')
})

test('unknown stage data returns null', () => {
  assert.equal(getPhaseStage(null), null)
  assert.equal(getPhaseStage({}), null)
  assert.equal(getPhaseStage({ lifecycle_track: 'decommissioning' }), null)
  assert.equal(getPhaseStage({ phase: 'something_else' }), null)
})

test('stage 3 is index 2 (stepper fills the first three dots)', () => {
  assert.equal(getPhaseStage({ phase: 'construction', construction_subphase: 'rampup' }).currentIndex, 2)
})

test('old ?phases= links still filter', () => {
  assert.deepEqual(normalizeStageFilter(['construction']), ['mobilizing', 'peak', 'completion'])
  assert.deepEqual(normalizeStageFilter(['pre_sanction', 'awarded']), ['planning', 'awarded'])
  assert.deepEqual(normalizeStageFilter(['nope']), [])
})
