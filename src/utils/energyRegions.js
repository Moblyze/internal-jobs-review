/**
 * Energy Regions Utility
 *
 * Defines major global energy regions for quick filtering
 * Based on industry-standard oil & gas operational areas
 */

import { getAllLocations } from './locationParser.js'

/**
 * Top 5 Energy Regions (US/UK Focus)
 * Priority regions for Moblyze job seekers
 */
export const TOP_ENERGY_REGIONS = [
  {
    id: 'gulf-of-mexico',
    name: 'Gulf of Mexico',
    description: 'Houston, TX; New Orleans, LA; Gulf offshore',
    locations: [
      'Houston, TX',
      'New Orleans, LA',
      'Lafayette, LA',
      'Beaumont, TX',
      'Port Arthur, TX',
      'Corpus Christi, TX',
      'Galveston, TX',
      'Baton Rouge, LA',
      'Lake Charles, LA',
      'Houma, LA',
      'Morgan City, LA',
      'Freeport, TX',
      'Texas City, TX',
      'Pasadena, TX',
      'Baytown, TX',
      'Channelview, TX',
      'Deer Park, TX',
      'Gulf of Mexico'
    ],
    offshore: true,
    keywords: ['gulf', 'houston', 'offshore', 'new orleans', 'lafayette']
  },
  {
    id: 'permian-basin',
    name: 'Permian Basin',
    description: 'Midland, TX; Odessa, TX; Carlsbad, NM',
    locations: [
      'Midland, TX',
      'Odessa, TX',
      'Carlsbad, NM',
      'Pecos, TX',
      'Andrews, TX',
      'Big Spring, TX',
      'Monahans, TX',
      'Fort Stockton, TX',
      'Kermit, TX',
      'Seminole, TX',
      'Hobbs, NM',
      'Lovington, NM'
    ],
    keywords: ['permian', 'midland', 'odessa', 'carlsbad']
  },
  {
    id: 'north-sea',
    name: 'North Sea',
    description: 'Aberdeen, UK; UK/Norway offshore',
    locations: [
      'Aberdeen, United Kingdom',
      'Stavanger, Norway',
      'Edinburgh, United Kingdom',
      'Bergen, Norway',
      'Great Yarmouth, United Kingdom'
    ],
    countries: ['GB', 'NO'],
    offshore: true,
    keywords: ['north sea', 'aberdeen', 'stavanger', 'norway', 'scotland']
  },
  {
    id: 'appalachia',
    name: 'Appalachia',
    description: 'Pennsylvania, West Virginia (Marcellus/Utica)',
    locations: [
      'Pittsburgh, PA',
      'Canonsburg, PA',
      'Morgantown, WV',
      'Wheeling, WV',
      'Charleston, WV',
      'Washington, PA',
      'Waynesburg, PA',
      'Clarksburg, WV',
      'Bridgeport, WV'
    ],
    keywords: ['appalachia', 'marcellus', 'utica', 'pittsburgh', 'pennsylvania']
  },
  {
    id: 'alaska',
    name: 'Alaska',
    description: 'Anchorage, AK; Prudhoe Bay, AK',
    locations: [
      'Anchorage, AK',
      'Prudhoe Bay, AK',
      'Fairbanks, AK',
      'Kenai, AK',
      'Valdez, AK',
      'North Slope, AK',
      'Deadhorse, AK',
      'Barrow, AK',
      'Homer, AK',
      'Palmer, AK',
      'Wasilla, AK',
      'Juneau, AK'
    ],
    states: ['AK'],
    keywords: ['alaska', 'anchorage', 'prudhoe', 'fairbanks']
  }
]

/**
 * Additional Energy Regions (Secondary)
 * Shown when user clicks "Show more regions"
 */
export const ADDITIONAL_ENERGY_REGIONS = [
  {
    id: 'middle-east',
    name: 'Middle East',
    description: 'Saudi Arabia, UAE, Qatar, Kuwait',
    locations: [
      'Dubai, United Arab Emirates',
      'Abu Dhabi, United Arab Emirates',
      'Doha, Qatar',
      'Riyadh, Saudi Arabia',
      'Kuwait City, Kuwait',
      'Manama, Bahrain',
      'Muscat, Oman'
    ],
    countries: ['AE', 'SA', 'QA', 'KW', 'BH', 'OM'],
    keywords: ['dubai', 'abu dhabi', 'saudi', 'qatar', 'kuwait', 'middle east']
  },
  {
    id: 'asia-pacific',
    name: 'Asia Pacific',
    description: 'Singapore, Malaysia, Indonesia, Australia',
    locations: [
      'Singapore',
      'Kuala Lumpur, Malaysia',
      'Perth, Australia',
      'Jakarta, Indonesia',
      'Mumbai, India',
      'Brisbane, Australia',
      'Bangkok, Thailand',
      'Manila, Philippines'
    ],
    countries: ['SG', 'MY', 'AU', 'ID', 'IN', 'TH', 'PH'],
    keywords: ['singapore', 'malaysia', 'australia', 'asia', 'perth']
  },
  {
    id: 'rockies',
    name: 'Rockies',
    description: 'Colorado, Wyoming',
    locations: [
      'Denver, CO',
      'Casper, WY',
      'Cheyenne, WY',
      'Grand Junction, CO',
      'Pinedale, WY',
      'Rock Springs, WY',
      'Vernal, UT',
      'Rangely, CO',
      'Rifle, CO'
    ],
    keywords: ['rockies', 'denver', 'colorado', 'wyoming', 'casper']
  },
  {
    id: 'bakken',
    name: 'Bakken',
    description: 'North Dakota',
    locations: [
      'Williston, ND',
      'Dickinson, ND',
      'Watford City, ND',
      'Sidney, MT',
      'Tioga, ND',
      'Stanley, ND'
    ],
    keywords: ['bakken', 'williston', 'north dakota']
  },
  {
    id: 'eagle-ford',
    name: 'Eagle Ford',
    description: 'South Texas shale play',
    locations: [
      'San Antonio, TX',
      'Laredo, TX',
      'Pleasanton, TX',
      'Cotulla, TX',
      'Karnes City, TX',
      'Gonzales, TX',
      'Cuero, TX',
      'Victoria, TX'
    ],
    keywords: ['eagle ford']
  },
  {
    id: 'dj-basin',
    name: 'DJ Basin',
    description: 'Denver-Julesburg Basin, Colorado/Wyoming',
    locations: [
      'Greeley, CO',
      'Weld County, CO',
      'Brighton, CO',
      'Fort Lupton, CO',
      'Frederick, CO'
    ],
    keywords: ['dj basin', 'denver-julesburg', 'wattenberg']
  },
  {
    id: 'western-canada',
    name: 'Western Canada',
    description: 'Alberta & Saskatchewan',
    locations: [
      'Calgary, AB, Canada',
      'Edmonton, AB, Canada',
      'Fort McMurray, AB, Canada',
      'Regina, SK, Canada'
    ],
    states: ['AB', 'SK'],
    countries: ['CA'],
    keywords: ['calgary', 'alberta', 'canada', 'edmonton']
  },
  {
    id: 'latin-america',
    name: 'Latin America',
    description: 'Brazil, Mexico, Colombia',
    locations: [
      'Rio de Janeiro, Brazil',
      'São Paulo, Brazil',
      'Mexico City, Mexico',
      'Bogotá, Colombia',
      'Buenos Aires, Argentina'
    ],
    countries: ['BR', 'MX', 'CO', 'AR'],
    keywords: ['brazil', 'mexico', 'colombia', 'latin', 'rio']
  }
]

/**
 * All energy regions combined
 */
export const ALL_ENERGY_REGIONS = [...TOP_ENERGY_REGIONS, ...ADDITIONAL_ENERGY_REGIONS]

/**
 * Find all locations in jobs data that match a given region
 *
 * @param {Object} region - Region definition
 * @param {Array} allLocations - All unique locations from jobs data
 * @returns {Array} - Matching location strings
 */
export function getRegionLocations(region, allLocations) {
  const matches = new Set()

  allLocations.forEach(location => {
    const locationLower = location.toLowerCase()

    // 1. Check if location matches any of the region's explicit locations
    const matchesExplicit = region.locations.some(regionLoc => {
      const regionLocLower = regionLoc.toLowerCase()
      const cityName = regionLocLower.split(',')[0].trim()
      // More precise matching - must be word boundary or start of location
      const pattern = new RegExp(`(^|[\\s-])${cityName}([\\s,-]|$)`, 'i')
      return pattern.test(location)
    })

    if (matchesExplicit) {
      matches.add(location)
      return
    }

    // 2. Check if location matches region keywords
    // For international regions (those with `countries`), keywords must also
    // pass a country check to prevent cross-country bleeding (e.g., "aberdeen"
    // in North Sea matching "Aberdeen, MD" in the US).
    const matchesKeyword = region.keywords?.some(keyword => {
      const keywordLower = keyword.toLowerCase()
      let keywordFound = false
      // For multi-word keywords, require substring match
      if (keywordLower.includes(' ')) {
        keywordFound = locationLower.includes(keywordLower)
      } else {
        // For single word keywords, use word boundary
        const pattern = new RegExp(`(^|[\\s-])${keywordLower}([\\s,-]|$)`, 'i')
        keywordFound = pattern.test(location)
      }
      return keywordFound
    })

    if (matchesKeyword) {
      // If the region has countries defined, verify the location is in one of
      // those countries before accepting the keyword match. This prevents
      // international keywords from matching domestic US locations.
      if (region.countries) {
        const locationInCountry = _locationMatchesCountries(location, locationLower, region)
        if (locationInCountry) {
          matches.add(location)
        }
        // Keyword matched but wrong country - skip this location
        return
      }
      // Domestic region with no countries constraint - keyword match is sufficient
      matches.add(location)
      return
    }

    // 3. For regions with country codes, match locations in those countries
    // (State-based matching has been removed to avoid overly broad matches.
    // US domestic regions rely on explicit locations and keywords instead.)
    if (region.countries) {
      const matchesCountry = _locationMatchesCountries(location, locationLower, region)
      if (matchesCountry) {
        matches.add(location)
      }
    }
  })

  return Array.from(matches)
}

/**
 * Find all location option VALUES that match a given region, using option
 * metadata for reliable matching.
 *
 * This is the preferred method for region pill selection because it matches
 * against the same option values used by the dropdown, guaranteeing that
 * selected values will be recognized by react-select. The older
 * getRegionLocations() relies on extractAllLocations() which can produce
 * different formatted strings due to async geodata race conditions.
 *
 * @param {Object} region - Region definition from TOP_ENERGY_REGIONS / ADDITIONAL_ENERGY_REGIONS
 * @param {Array} locationOptions - Grouped react-select options from createGroupedLocationOptionsWithGeodata
 * @returns {Array<string>} - Matching option values (deduplicated)
 */
export function getRegionLocationValues(region, locationOptions) {
  const matches = new Set()

  // Flatten grouped options into a single list
  const flatOptions = locationOptions.flatMap(group => group.options || [])

  flatOptions.forEach(option => {
    const value = option.value
    const meta = option.metadata || {}
    const valueLower = value.toLowerCase()

    // --- Metadata-based matching (most reliable) ---

    // Match by state code for US domestic regions that define states
    if (region.states && !region.countries && meta.countryCode === 'US') {
      const stateUpper = (meta.stateCode || '').toUpperCase()
      if (region.states.includes(stateUpper)) {
        matches.add(value)
        return
      }
    }

    // Match by country code for international regions
    if (region.countries && meta.countryCode) {
      const metaCC = meta.countryCode.toUpperCase()
      if (region.countries.includes(metaCC)) {
        // For Canada with province constraints, also check province
        if (metaCC === 'CA' && region.states) {
          const provUpper = (meta.stateCode || '').toUpperCase()
          if (region.states.includes(provUpper)) {
            matches.add(value)
          }
          return
        }
        matches.add(value)
        return
      }
    }

    // --- String-based matching (fallback for options without metadata) ---

    // Check explicit location city names
    const matchesExplicit = region.locations.some(regionLoc => {
      const cityName = regionLoc.split(',')[0].trim().toLowerCase()
      const pattern = new RegExp(`(^|[\\s-])${cityName}([\\s,-]|$)`, 'i')
      return pattern.test(value)
    })

    if (matchesExplicit) {
      matches.add(value)
      return
    }

    // Check keywords
    const matchesKeyword = region.keywords?.some(keyword => {
      const keywordLower = keyword.toLowerCase()
      if (keywordLower.includes(' ')) {
        return valueLower.includes(keywordLower)
      }
      const pattern = new RegExp(`(^|[\\s-])${keywordLower}([\\s,-]|$)`, 'i')
      return pattern.test(value)
    })

    if (matchesKeyword) {
      if (region.countries) {
        // International region: verify country
        const locationInCountry = _locationMatchesCountries(value, valueLower, region)
        if (locationInCountry) {
          matches.add(value)
        }
      } else {
        matches.add(value)
      }
    }
  })

  return Array.from(matches)
}

/**
 * Helper: Check if a location string matches any of the region's countries.
 * Handles country code prefixes (e.g., "AE-ABU DHABI") and Canadian province codes.
 *
 * @param {string} location - Original location string
 * @param {string} locationLower - Lowercased location string
 * @param {Object} region - Region definition with countries (and optionally states for CA)
 * @returns {boolean}
 */
function _locationMatchesCountries(location, locationLower, region) {
  return region.countries.some(countryCode => {
    const countryCodeLower = countryCode.toLowerCase()
    // Match country code at start like "AE-ABU DHABI" with word boundary
    const startsWithCountry = new RegExp(`^${countryCodeLower}-`, 'i').test(location)
    // For Canada, also check province codes if states are defined
    if (countryCode === 'CA' && region.states) {
      const matchesProvince = region.states.some(provCode =>
        new RegExp(`-${provCode.toLowerCase()}-`, 'i').test(location) ||
        locationLower.includes(`, ${provCode.toLowerCase()},`)
      )
      return startsWithCountry || matchesProvince
    }
    return startsWithCountry
  })
}

/**
 * Get all unique locations from jobs data that can be used for region matching
 * Returns FORMATTED locations to maintain consistency with the filter system
 *
 * @param {Array} jobs - Jobs array
 * @returns {Array} - Array of unique FORMATTED location strings
 */
export function extractAllLocations(jobs) {
  const locations = new Set()

  jobs.forEach(job => {
    if (job.location) {
      // Get formatted locations from the job using the imported function
      const formattedLocations = getAllLocations(job.location)
      formattedLocations.forEach(formattedLoc => {
        if (formattedLoc) {
          locations.add(formattedLoc)
        }
      })
    }
  })

  return Array.from(locations)
}

/**
 * Get region match counts for display
 *
 * @param {Object} region - Region definition
 * @param {Array} jobs - Jobs array
 * @returns {Object} - { region, matchedLocations, jobCount }
 */
export function getRegionStats(region, jobs) {
  const allLocations = extractAllLocations(jobs)
  const matchedLocations = getRegionLocations(region, allLocations)

  // Count jobs that have any of the matched locations
  const jobCount = jobs.filter(job => {
    if (!job.location) return false

    const jobLocations = job.location.split('\n').map(loc =>
      loc.replace(/^locations\s*/i, '').trim()
    )

    return jobLocations.some(loc => matchedLocations.includes(loc))
  }).length

  return {
    region,
    matchedLocations,
    jobCount
  }
}
