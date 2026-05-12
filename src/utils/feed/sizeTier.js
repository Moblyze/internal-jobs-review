// src/utils/feed/sizeTier.js
// Derive a coarse size tier from PDL's size string (already in pdl-company-cache.json).
// PDL `size` values: "1-10", "11-50", "51-200", "201-500", "501-1000",
// "1001-5000", "5001-10000", "10001+"

const PDL_SIZE_TO_TIER = {
  '1-10':       'solo',
  '11-50':      'small',
  '51-200':     'small',
  '201-500':    'midsize',
  '501-1000':   'midsize',
  '1001-5000':  'large',
  '5001-10000': 'large',
  '10001+':     'mega',
}

export function pdlSizeToTier(pdlSize) {
  if (!pdlSize) return 'unknown'
  return PDL_SIZE_TO_TIER[pdlSize] || 'unknown'
}

// Look up a company by name in the loaded pdl-company-cache.json shape:
//   { "Company Name": { name, size, ... } }
// Match is case-insensitive on the key. Returns the tier string.
export function getSizeTier(companyName, pdlCache) {
  if (!companyName || !pdlCache) return 'unknown'
  const target = String(companyName).toLowerCase().trim()
  for (const [key, value] of Object.entries(pdlCache)) {
    if (key.toLowerCase().trim() === target) {
      return pdlSizeToTier(value?.size)
    }
  }
  return 'unknown'
}
