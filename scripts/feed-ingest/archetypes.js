// scripts/feed-ingest/archetypes.js
// Deterministic mapping (phase, scope, size_tier) -> archetype list.
// Single source of truth for what kinds of contacts to surface per article.

export const ARCHETYPES = [
  'project_manager',
  'hiring_manager',
  'ops_director',
  'site_manager',
  'business_unit_director',
  'hr_business_partner',
  'rov_supervisor',
  'survey_lead',
  'ndt_supervisor',
  'drilling_supervisor',
]

const PHASE_BASE = {
  pre_sanction:           ['project_manager', 'business_unit_director'],
  sanctioned_engineering: ['project_manager', 'hiring_manager', 'business_unit_director'],
  construction:           ['site_manager', 'hiring_manager', 'project_manager'],
  operating:              ['ops_director', 'hiring_manager'],
}

// Discipline lookup — derived from public/data/feed/taxonomy.json discipline_tags.
// Tags without a natural discipline lead map to []; phase-level archetypes carry them.
const SCOPE_DISCIPLINE = {
  rov_subsea:               ['rov_supervisor'],
  survey_geophysical:       ['survey_lead'],
  ndt_inspection:           ['ndt_supervisor'],
  drilling_operations:      ['drilling_supervisor'],
  energy_trades:            [],
  industrial_construction:  [],
  pipeline_mechanical:      [],
  rope_access:              [],
  marine_offshore_ops:      [],
  process_plant_operations: [],
}

export function deriveArchetypes(phase, scope, size_tier) {
  if (!phase || !PHASE_BASE[phase]) return []
  const base = PHASE_BASE[phase]
  const disciplines = (scope || []).flatMap(s => SCOPE_DISCIPLINE[s] || [])

  if (size_tier === 'solo' || size_tier === 'small') {
    return Array.from(new Set(['hiring_manager', ...disciplines.slice(0, 1)]))
  }

  const archetypes = [...base, ...disciplines]
  if (size_tier === 'large' || size_tier === 'mega') {
    archetypes.push('hr_business_partner')
  }
  if (size_tier === 'mega' && !archetypes.includes('business_unit_director')) {
    archetypes.push('business_unit_director')
  }
  return Array.from(new Set(archetypes))
}
