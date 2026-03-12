/**
 * Focus Market definitions
 *
 * Maps aggregator search profile slugs to human-readable market names.
 * Priority markets are the currently active ("NOW") sourcing targets.
 */

/** Profile slug → human-readable market name */
export const FOCUS_MARKET_LABELS = {
  subsea_oil_gas: 'ROV & Subsea',
  rope_access: 'Rope Access',
  ndt_inspection: 'NDT Inspection',
  drilling_operations: 'Drilling',
  marine_offshore_ops: 'Marine & Offshore',
  energy_trades: 'Energy Trades',
  pipeline_mechanical: 'Pipeline & Mechanical',
  industrial_construction: 'Industrial Construction',
  process_plant_operations: 'Process & Plant',
  survey_geophysical: 'Survey & Geophysical',
}

/** Profile slugs that are actively being sourced right now */
export const PRIORITY_MARKET_SLUGS = [
  'subsea_oil_gas',
  'rope_access',
]

/**
 * Get the human-readable label for a profile slug.
 * Falls back to title-casing the slug if not in the mapping.
 */
export function getMarketLabel(profileSlug) {
  if (FOCUS_MARKET_LABELS[profileSlug]) {
    return FOCUS_MARKET_LABELS[profileSlug]
  }
  // Fallback: convert snake_case to Title Case
  return profileSlug
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
