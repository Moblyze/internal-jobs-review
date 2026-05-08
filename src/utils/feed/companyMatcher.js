import { normalizeCompanyName } from '../companyNormalizer.js'
import { companyToSlug } from '../formatters.js'

export function matchCompanyToSlug(rawName, companiesData) {
  if (!rawName || typeof rawName !== 'string') return null
  const normalized = normalizeCompanyName(rawName.trim())
  if (!normalized) return null
  const lookup = new Map()
  for (const c of companiesData?.companies || []) {
    lookup.set(normalizeCompanyName(c.name).toLowerCase(), c.name)
  }
  const matched = lookup.get(normalized.toLowerCase())
  return matched ? companyToSlug(matched) : null
}
