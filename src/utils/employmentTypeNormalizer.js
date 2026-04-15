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
  'Other',
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

  // Other — non-specific values the user should still be able to filter on
  'unknown': 'Other',
  'all': 'Other',
  'other': 'Other',
}

/**
 * Normalize a raw employment type string to a canonical category.
 * Returns null only when the input is empty or an unrecognized string;
 * recognized but non-specific values (Unknown/All/Other) map to 'Other'.
 */
export function normalizeEmploymentType(raw) {
  if (!raw) return null
  const lower = raw.toLowerCase().trim()
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
