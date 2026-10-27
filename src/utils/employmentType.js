// Employment types arrive as 50+ raw strings ("FULL_TIME", "Contractual Rotation", scraped junk such as
// "APPLY NOW"). The filters show this short canonical set instead.
export const EMPLOYMENT_TYPES = ['Full-time', 'Contract', 'Part-time', 'Temporary', 'Internship', 'Other']

export function canonicalEmploymentType(raw) {
  const v = String(raw || '').toLowerCase().replace(/[_-]+/g, ' ')
  if (!v.trim()) return 'Other'
  if (/intern/.test(v)) return 'Internship'
  if (/part ?time/.test(v)) return 'Part-time'
  if (/permanent|full ?time|regular/.test(v) && !/temp/.test(v)) return 'Full-time'
  if (/temp|seasonal|casual|per ?diem|when required/.test(v)) return 'Temporary'
  if (/contract|consult|rotation|rotational|fixed ?term|freelance|\bterm\b/.test(v)) return 'Contract'
  return 'Other'
}
