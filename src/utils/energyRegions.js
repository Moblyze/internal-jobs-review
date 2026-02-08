/**
 * Energy Regions Utility
 *
 * Defines major global energy regions for quick filtering
 * Based on industry-standard oil & gas operational areas
 */

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
      'Gulf of Mexico'
    ],
    states: ['TX', 'LA', 'MS', 'AL', 'FL'],
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
      'Fort Stockton, TX'
    ],
    states: ['TX', 'NM'],
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
      'Charleston, WV'
    ],
    states: ['PA', 'OH', 'WV'],
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
      'Valdez, AK'
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
      'Grand Junction, CO'
    ],
    states: ['CO', 'WY'],
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
      'Sidney, MT'
    ],
    states: ['ND', 'MT'],
    keywords: ['bakken', 'williston', 'north dakota']
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

    // Check if location matches any of the region's explicit locations
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

    // Check if location matches region keywords (be more careful here)
    const matchesKeyword = region.keywords?.some(keyword => {
      const keywordLower = keyword.toLowerCase()
      // For multi-word keywords, require exact match
      if (keywordLower.includes(' ')) {
        return locationLower.includes(keywordLower)
      }
      // For single word keywords, use word boundary
      const pattern = new RegExp(`(^|[\\s-])${keywordLower}([\\s,-]|$)`, 'i')
      return pattern.test(location)
    })

    if (matchesKeyword) {
      matches.add(location)
      return
    }

    // For regions with state codes, match locations in those states
    // Only match if it's a US/CA region to avoid false matches
    if (region.states && !region.countries) {
      const matchesState = region.states.some(stateCode => {
        const stateCodeLower = stateCode.toLowerCase()
        // Match "City, TX" or "US-TX-City" patterns with word boundaries
        return locationLower.includes(`, ${stateCodeLower}`) ||
               locationLower.includes(`, ${stateCodeLower},`) ||
               new RegExp(`-${stateCodeLower}-`, 'i').test(location)
      })

      if (matchesState) {
        matches.add(location)
        return
      }
    }

    // For regions with country codes, match locations in those countries
    if (region.countries) {
      const matchesCountry = region.countries.some(countryCode => {
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

      if (matchesCountry) {
        matches.add(location)
      }
    }
  })

  return Array.from(matches)
}

/**
 * Get all unique locations from jobs data that can be used for region matching
 *
 * @param {Array} jobs - Jobs array
 * @returns {Array} - Array of unique location strings
 */
export function extractAllLocations(jobs) {
  const locations = new Set()

  jobs.forEach(job => {
    if (job.location) {
      // Split multi-location strings
      const jobLocations = job.location.split('\n')
      jobLocations.forEach(loc => {
        const cleaned = loc.replace(/^locations\s*/i, '').trim()
        if (cleaned && cleaned.toLowerCase() !== 'locations') {
          locations.add(cleaned)
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
