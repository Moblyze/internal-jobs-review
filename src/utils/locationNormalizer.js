/**
 * Location Normalizer
 *
 * Standardizes all location formats to consistent display:
 * - US Locations: "City, State" (e.g., "Houston, Texas" → "Houston, TX")
 * - International: "City, Country" (e.g., "Florence, Italy")
 * - Special: Keep as-is (e.g., "Global Recruiting")
 *
 * Based on Indeed best practices for location standardization
 */

// State name to abbreviation mapping
const STATE_ABBREVIATIONS = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY'
}

// Known US state abbreviations
const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
])

// Special locations that should be kept as-is
const SPECIAL_LOCATIONS = new Set([
  'Global Recruiting', 'Gulf of Mexico', 'Noble Interceptor',
  'Noble BlackLion', 'Noble BlackHawk', 'Noble BlackHornet',
  'Noble Faye Kozack'
])

// Known major cities for context (when only city name is provided)
const MAJOR_US_CITIES = {
  'houston': 'TX',
  'dallas': 'TX',
  'austin': 'TX',
  'san antonio': 'TX',
  'chicago': 'IL',
  'new york': 'NY',
  'los angeles': 'CA',
  'san francisco': 'CA',
  'seattle': 'WA',
  'boston': 'MA',
  'miami': 'FL',
  'denver': 'CO',
  'phoenix': 'AZ',
  'atlanta': 'GA',
  'philadelphia': 'PA'
}

const MAJOR_INTERNATIONAL_CITIES = {
  'aberdeen': 'United Kingdom',
  'london': 'United Kingdom',
  'florence': 'Italy',
  'rome': 'Italy',
  'paris': 'France',
  'tokyo': 'Japan',
  'singapore': 'Singapore'
}

/**
 * Normalizes a single location string to consistent format
 * @param {string} location - Raw location string
 * @returns {string} - Normalized location string
 */
export function normalizeLocation(location) {
  if (!location || typeof location !== 'string') return null

  const trimmed = location.trim()
  if (!trimmed) return null

  // Special locations - keep as-is
  if (SPECIAL_LOCATIONS.has(trimmed)) {
    return trimmed
  }

  const lower = trimmed.toLowerCase()

  // Pattern 1: "City, Full State Name" → "City, ST"
  // Example: "Houston, Texas" → "Houston, TX"
  const fullStateMatch = trimmed.match(/^([^,]+),\s*([A-Za-z\s]+)$/)
  if (fullStateMatch) {
    const [, city, stateName] = fullStateMatch
    const stateAbbr = STATE_ABBREVIATIONS[stateName.toLowerCase()]
    if (stateAbbr) {
      return `${city.trim()}, ${stateAbbr}`
    }
    // If not a US state, assume it's "City, Country"
    return `${city.trim()}, ${stateName.trim()}`
  }

  // Pattern 2: "City, ST" (already correct format for US)
  // Example: "Houston, TX"
  const stateAbbrMatch = trimmed.match(/^([^,]+),\s*([A-Z]{2})$/)
  if (stateAbbrMatch) {
    const [, city, state] = stateAbbrMatch
    if (US_STATES.has(state)) {
      return `${city.trim()}, ${state}`
    }
  }

  // Pattern 3: Just city name - try to infer location
  // Example: "Houston" → "Houston, TX"
  if (/^[A-Za-z\s]+$/.test(trimmed) && !trimmed.includes(',')) {
    // Check if it's a known major US city
    if (MAJOR_US_CITIES[lower]) {
      return `${trimmed}, ${MAJOR_US_CITIES[lower]}`
    }
    // Check if it's a known international city
    if (MAJOR_INTERNATIONAL_CITIES[lower]) {
      return `${trimmed}, ${MAJOR_INTERNATIONAL_CITIES[lower]}`
    }
    // Unknown city - keep as-is (will be handled by display logic)
    return trimmed
  }

  // Already normalized or unrecognized format
  return trimmed
}

/**
 * Gets display label for location filter dropdown
 * Format: "Country: City, State" for grouping
 *
 * @param {string} normalizedLocation - Normalized location string
 * @returns {object} - { label, value, country, searchText }
 */
export function getLocationFilterOption(normalizedLocation) {
  if (!normalizedLocation) return null

  // Special locations
  if (SPECIAL_LOCATIONS.has(normalizedLocation)) {
    return {
      label: `Other: ${normalizedLocation}`,
      value: normalizedLocation,
      country: 'Other',
      searchText: normalizedLocation.toLowerCase()
    }
  }

  // Parse normalized location
  const parts = normalizedLocation.split(',').map(p => p.trim())

  if (parts.length === 1) {
    // Just city name (unknown location)
    return {
      label: `Unknown: ${normalizedLocation}`,
      value: normalizedLocation,
      country: 'Unknown',
      searchText: normalizedLocation.toLowerCase()
    }
  }

  if (parts.length === 2) {
    const [city, stateOrCountry] = parts

    // US location (state abbreviation)
    if (US_STATES.has(stateOrCountry)) {
      return {
        label: `United States: ${city}, ${stateOrCountry}`,
        value: normalizedLocation,
        country: 'United States',
        searchText: `united states ${city} ${stateOrCountry}`.toLowerCase()
      }
    }

    // International location
    return {
      label: `${stateOrCountry}: ${city}`,
      value: normalizedLocation,
      country: stateOrCountry,
      searchText: `${stateOrCountry} ${city}`.toLowerCase()
    }
  }

  if (parts.length === 3) {
    // "City, State, Country" format
    const [city, state, country] = parts
    return {
      label: `${country}: ${city}, ${state}`,
      value: normalizedLocation,
      country: country,
      searchText: `${country} ${city} ${state}`.toLowerCase()
    }
  }

  // Fallback
  return {
    label: normalizedLocation,
    value: normalizedLocation,
    country: 'Other',
    searchText: normalizedLocation.toLowerCase()
  }
}

/**
 * Creates react-select grouped options from normalized locations
 *
 * @param {string[]} locations - Array of location strings
 * @returns {Array} - React-select grouped options
 */
export function createNormalizedLocationOptions(locations) {
  // Normalize all locations
  const normalized = locations
    .map(normalizeLocation)
    .filter(Boolean)

  // Remove duplicates
  const unique = [...new Set(normalized)]

  // Create filter options
  const options = unique
    .map(getLocationFilterOption)
    .filter(Boolean)

  // Group by country
  const grouped = options.reduce((acc, opt) => {
    if (!acc[opt.country]) {
      acc[opt.country] = []
    }
    acc[opt.country].push(opt)
    return acc
  }, {})

  // Sort countries (US first, then alphabetical)
  const sortedCountries = Object.keys(grouped).sort((a, b) => {
    if (a === 'United States') return -1
    if (b === 'United States') return 1
    if (a === 'Other') return 1
    if (b === 'Other') return -1
    if (a === 'Unknown') return 1
    if (b === 'Unknown') return -1
    return a.localeCompare(b)
  })

  // Create react-select grouped format
  return sortedCountries.map(country => ({
    label: country,
    options: grouped[country].sort((a, b) => a.label.localeCompare(b.label))
  }))
}
