// Map an entry's phase/construction_subphase/decom_stage into a single
// 6-position stage index (1-based) for the Stepper UI. Returns null if the
// entry's phase data is incomplete (caller renders the "unknown" variant).

export const GREENFIELD_STAGES = [
  { key: 'pre_sanction',           label: 'Pre-sanction',     meaning: 'Concept / FEED / pre-FID' },
  { key: 'sanctioned_engineering', label: 'Sanctioned eng',   meaning: 'FID done, EPC engaged' },
  { key: 'rampup',                 label: 'Constr · Ramp-up', meaning: 'Civil works, early trades' },
  { key: 'peak',                   label: 'Constr · Peak',    meaning: 'Peak headcount — trades blast' },
  { key: 'commissioning',          label: 'Constr · Commiss', meaning: 'Hookup complete, startup crews' },
  { key: 'operating',              label: 'Operating',        meaning: 'Producing — O&M only' },
]

export const DECOM_STAGES = [
  { key: 'planning',         label: 'Planning',         meaning: 'Operator announces intent' },
  { key: 'permits',          label: 'Permits',          meaning: 'Regulatory filings' },
  { key: 'contract_awarded', label: 'Contract awarded', meaning: 'Decom EPC win' },
  { key: 'mobilization',     label: 'Mobilization',     meaning: 'Vessel/yard spin-up' },
  { key: 'active_execution', label: 'Active execution', meaning: 'P&A, heavy lift, dismantling' },
  { key: 'site_clearance',   label: 'Site clearance',   meaning: 'Final survey, demob' },
]

// Returns { track, stages, currentIndex, currentLabel } or null if unknown.
export function getPhaseStage(entry) {
  if (!entry) return null

  if (entry.lifecycle_track === 'decommissioning') {
    if (!entry.decom_stage) return null
    const currentIndex = DECOM_STAGES.findIndex(s => s.key === entry.decom_stage)
    if (currentIndex < 0) return null
    return {
      track: 'decommissioning',
      stages: DECOM_STAGES,
      currentIndex,
      currentLabel: DECOM_STAGES[currentIndex].label,
    }
  }

  // Greenfield (default if lifecycle_track is undefined for legacy entries)
  if (!entry.phase) return null
  let key = entry.phase
  if (entry.phase === 'construction') {
    if (!entry.construction_subphase) return null
    key = entry.construction_subphase
  }
  const currentIndex = GREENFIELD_STAGES.findIndex(s => s.key === key)
  if (currentIndex < 0) return null
  return {
    track: 'greenfield',
    stages: GREENFIELD_STAGES,
    currentIndex,
    currentLabel: GREENFIELD_STAGES[currentIndex].label,
  }
}
