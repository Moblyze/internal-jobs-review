import { describe, it, expect } from 'vitest'
import { getPhaseStage, GREENFIELD_STAGES, DECOM_STAGES } from './phaseStage'

describe('getPhaseStage', () => {
  it('returns null for null entry', () => {
    expect(getPhaseStage(null)).toBeNull()
  })

  it('returns null for entry without phase or lifecycle_track', () => {
    expect(getPhaseStage({})).toBeNull()
  })

  it('maps pre_sanction → stage 0', () => {
    const r = getPhaseStage({ phase: 'pre_sanction', lifecycle_track: 'greenfield' })
    expect(r.track).toBe('greenfield')
    expect(r.currentIndex).toBe(0)
    expect(r.currentLabel).toBe('Pre-sanction')
  })

  it('maps sanctioned_engineering → stage 1', () => {
    const r = getPhaseStage({ phase: 'sanctioned_engineering' })
    expect(r.currentIndex).toBe(1)
  })

  it('maps construction + rampup → stage 2', () => {
    const r = getPhaseStage({ phase: 'construction', construction_subphase: 'rampup' })
    expect(r.currentIndex).toBe(2)
    expect(r.currentLabel).toBe('Constr · Ramp-up')
  })

  it('maps construction + peak → stage 3', () => {
    const r = getPhaseStage({ phase: 'construction', construction_subphase: 'peak' })
    expect(r.currentIndex).toBe(3)
  })

  it('maps construction + commissioning → stage 4', () => {
    const r = getPhaseStage({ phase: 'construction', construction_subphase: 'commissioning' })
    expect(r.currentIndex).toBe(4)
  })

  it('maps operating → stage 5', () => {
    const r = getPhaseStage({ phase: 'operating' })
    expect(r.currentIndex).toBe(5)
  })

  it('returns null for construction without sub-phase', () => {
    expect(getPhaseStage({ phase: 'construction', construction_subphase: null })).toBeNull()
  })

  it('handles decommissioning track', () => {
    const r = getPhaseStage({ lifecycle_track: 'decommissioning', decom_stage: 'contract_awarded' })
    expect(r.track).toBe('decommissioning')
    expect(r.currentIndex).toBe(2)
    expect(r.currentLabel).toBe('Contract awarded')
    expect(r.stages).toBe(DECOM_STAGES)
  })

  it('maps all 6 decom stages correctly', () => {
    const expected = ['planning', 'permits', 'contract_awarded', 'mobilization', 'active_execution', 'site_clearance']
    expected.forEach((key, i) => {
      const r = getPhaseStage({ lifecycle_track: 'decommissioning', decom_stage: key })
      expect(r.currentIndex).toBe(i)
    })
  })

  it('returns null for decom track without decom_stage', () => {
    expect(getPhaseStage({ lifecycle_track: 'decommissioning' })).toBeNull()
  })

  it('returns null for unknown decom_stage value', () => {
    expect(getPhaseStage({ lifecycle_track: 'decommissioning', decom_stage: 'bogus' })).toBeNull()
  })

  it('defaults to greenfield when lifecycle_track is missing (legacy entries)', () => {
    const r = getPhaseStage({ phase: 'operating' })
    expect(r.track).toBe('greenfield')
  })
})
