/**
 * Employment Type Normalizer
 *
 * Consolidates ~25 raw employment type strings from various job sources
 * into 6 canonical categories for clean filtering.
 */

const CANONICAL_TYPES = [
  'Full-Time',
  'Contract',
  'Part-Time',
  'Full or Part-Time',
  'Temporary',
  'Internship',
]

const NORMALIZATION_MAP = {
  // Full-Time
  'full-time': 'Full-Time',
  'full time': 'Full-Time',
  'full_time': 'Full-Time',
  'permanent': 'Full-Time',
  'contract type: permanent': 'Full-Time',

  // Contract
  'contract': 'Contract',
  'contractor': 'Contract',
  'contract/traveling': 'Contract',
  'contractual': 'Contract',
  'consultant': 'Contract',
  'rotation': 'Contract',

  // Part-Time
  'part-time': 'Part-Time',
  'casual': 'Part-Time',

  // Full or Part-Time
  'full-time, part-time': 'Full or Part-Time',

  // Temporary
  'temporary': 'Temporary',
  'temp to direct': 'Temporary',

  // Internship
  'internship': 'Internship',
}

// Values that don't map to a meaningful filter category
const EXCLUDED_VALUES = new Set(['unknown', 'all', 'other'])

/**
 * Normalize a raw employment type string to a canonical category.
 * Returns null for values that should be excluded from filters.
 */
export function normalizeEmploymentType(raw) {
  if (!raw) return null
  const lower = raw.toLowerCase().trim()
  if (EXCLUDED_VALUES.has(lower)) return null
  return NORMALIZATION_MAP[lower] || null
}

/**
 * Check if a job matches any of the selected canonical employment types.
 * A job matches if its raw employmentType normalizes to one of the selected types.
 */
export function jobMatchesEmploymentTypes(job, selectedTypes) {
  if (!selectedTypes || selectedTypes.length === 0) return true
  const normalized = normalizeEmploymentType(job.employmentType)
  if (!normalized) return false
  return selectedTypes.includes(normalized)
}

export { CANONICAL_TYPES }
