// One ordered set of project stages for every feed entry, new-build and decommissioning alike.
// The enrichment step still writes its own fields (phase + construction_subphase for new builds,
// decom_stage for decommissioning); this file maps them onto the six stages below so the card
// stepper, the expanded card, the company modal and the Stage filter all speak the same language.
//
//   Raw value(s)                                         Stage
//   phase=pre_sanction            decom_stage=planning   1 Planning
//                                 decom_stage=permits    1 Planning
//   phase=sanctioned_engineering  decom_stage=contract_awarded   2 Awarded
//   construction + rampup (or no subphase)  decom_stage=mobilization  3 Mobilizing
//   construction + peak           decom_stage=active_execution    4 Peak work
//   construction + commissioning  decom_stage=site_clearance      5 Completion
//   phase=operating                                      6 Operating

export const STAGES = [
  { key: 'planning',   label: 'Planning',   meaning: 'Concept, studies or permits. No final go-ahead yet.' },
  { key: 'awarded',    label: 'Awarded',    meaning: 'Investment approved or main contract awarded. Engineering under way.' },
  { key: 'mobilizing', label: 'Mobilizing', meaning: 'Early works and first crews. Vessels and yards spin up.' },
  { key: 'peak',       label: 'Peak work',  meaning: 'Peak headcount on site or offshore.' },
  { key: 'completion', label: 'Completion', meaning: 'Commissioning and startup, or final survey and demob.' },
  { key: 'operating',  label: 'Operating',  meaning: 'Running. Operations and maintenance hiring only.' },
]

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]))

const NEW_BUILD = {
  pre_sanction: 'planning',
  sanctioned_engineering: 'awarded',
  operating: 'operating',
}
const CONSTRUCTION = { rampup: 'mobilizing', peak: 'peak', commissioning: 'completion' }
const DECOM = {
  planning: 'planning',
  permits: 'planning',
  contract_awarded: 'awarded',
  mobilization: 'mobilizing',
  active_execution: 'peak',
  site_clearance: 'completion',
}

// Stage key for an entry, or null when the entry carries no usable stage data.
export function stageKeyOf(entry) {
  if (!entry) return null
  if (entry.lifecycle_track === 'decommissioning') {
    return DECOM[entry.decom_stage] || null
  }
  if (entry.phase === 'construction') return CONSTRUCTION[entry.construction_subphase] || 'mobilizing'
  return NEW_BUILD[entry.phase] || null
}

// Returns { track, stages, currentIndex, currentKey, currentLabel } or null if unknown.
export function getPhaseStage(entry) {
  const key = stageKeyOf(entry)
  if (!key) return null
  const currentIndex = STAGE_INDEX[key]
  return {
    track: entry.lifecycle_track === 'decommissioning' ? 'decommissioning' : 'new_build',
    stages: STAGES,
    currentIndex,
    currentKey: key,
    currentLabel: STAGES[currentIndex].label,
  }
}

export function stageLabel(key) {
  return STAGES[STAGE_INDEX[key]]?.label || null
}

// Stage filter values from the URL (?phases=). Older links used the raw phase values; map them on.
const LEGACY_FILTER = {
  pre_sanction: ['planning'],
  sanctioned_engineering: ['awarded'],
  construction: ['mobilizing', 'peak', 'completion'],
  operating: ['operating'],
}
export function normalizeStageFilter(values = []) {
  const out = new Set()
  for (const v of values) {
    if (v in STAGE_INDEX) out.add(v)
    else for (const k of LEGACY_FILTER[v] || []) out.add(k)
  }
  return [...out]
}
