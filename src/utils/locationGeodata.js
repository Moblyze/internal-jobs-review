/**
 * Location Geodata Utilities
 *
 * Uses pre-geocoded location data from Mapbox for accurate location display
 * Replaces country-state-city library lookups with permanent geocoded data
 */

import { getAllLocations } from './locationParser.js'

// Cache for geocoded data
let geocodedDataCache = null

/**
 * Load geocoded location data
 * This is called once and cached for the session
 *
 * @returns {Promise<Object>} - Map of location -> geocoded data
 */
export async function loadGeocodedData() {
  if (geocodedDataCache) {
    return geocodedDataCache
  }

  try {
    const response = await fetch('/data/locations-geocoded.json')
    if (!response.ok) {
      console.warn('Geocoded locations file not found, using fallback parsing')
      geocodedDataCache = {}
      return geocodedDataCache
    }
    geocodedDataCache = await response.json()
    return geocodedDataCache
  } catch (error) {
    console.error('Error loading geocoded locations:', error)
    geocodedDataCache = {}
    return geocodedDataCache
  }
}

/**
 * Helper to convert text to title case
 */
function toTitleCase(str) {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Format a location using geocoded data
 *
 * @param {string} location - Raw location string
 * @param {Object} geodata - Geocoded data for this location
 * @returns {string} - Formatted location string
 */
export function formatLocationWithGeodata(location, geodata) {
  if (!geodata) {
    // Fallback to original location
    return location
  }

  let { city, state, stateCode, country, countryCode } = geodata

  // Handle Singapore special case (city-state with null country in Mapbox data)
  if (!country && state && state.includes('Singapore')) {
    country = 'Singapore'
    countryCode = 'SG'
    state = null
    stateCode = null
  }

  // Singapore locations: "City, Singapore" or just "Singapore"
  if (countryCode === 'SG' && city) {
    if (city.toLowerCase() === 'singapore' || city.toLowerCase() === 'singapore river') {
      return 'Singapore'
    }
    return `${city}, Singapore`
  }

  // US locations: "City, ST"
  if (countryCode === 'US' && city && stateCode) {
    return `${city}, ${stateCode}`
  }

  // Canadian locations: "City, AB, Canada"
  if (countryCode === 'CA' && city && stateCode) {
    return `${city}, ${stateCode}, Canada`
  }

  // Brazilian locations: "City, State, Brazil"
  if (countryCode === 'BR' && city && state) {
    return `${city}, ${state}, Brazil`
  }

  // UK locations: "City, United Kingdom"
  if (countryCode === 'GB' && city) {
    return `${city}, United Kingdom`
  }

  // Indian locations with state: "City, State, India"
  if (countryCode === 'IN' && city && state) {
    return `${city}, ${state}, India`
  }

  // Other international with state: "City, State, Country"
  if (city && state && country) {
    return `${city}, ${state}, ${country}`
  }

  // City with country: "City, Country"
  if (city && country) {
    return `${city}, ${country}`
  }

  // Fallback to Mapbox place name
  if (geodata.mapboxPlaceName) {
    return geodata.mapboxPlaceName
  }

  // Final fallback
  return location
}

/**
 * Get formatted location with geodata lookup
 *
 * @param {string} location - Raw location string
 * @returns {Promise<string>} - Formatted location
 */
export async function getFormattedLocation(location) {
  const geodata = await loadGeocodedData()

  // Clean up location for lookup
  const cleanLocation = location
    .replace(/^locations\s*/i, '')
    .trim()

  const locationGeodata = geodata[cleanLocation]

  return formatLocationWithGeodata(cleanLocation, locationGeodata)
}

/**
 * Get location metadata for grouping and filtering
 *
 * @param {string} location - Raw location string
 * @returns {Promise<Object>} - Location metadata
 */
export async function getLocationMetadata(location) {
  const geodata = await loadGeocodedData()

  // Clean up location for lookup
  const cleanLocation = location
    .replace(/^locations\s*/i, '')
    .trim()

  const locationGeodata = geodata[cleanLocation]

  if (!locationGeodata) {
    return {
      original: cleanLocation,
      formatted: cleanLocation,
      city: null,
      state: null,
      stateCode: null,
      country: 'Other',
      countryCode: null,
      coordinates: null
    }
  }

  // Handle Singapore special case (city-state with null country in Mapbox data)
  let country = locationGeodata.country
  let state = locationGeodata.state
  let stateCode = locationGeodata.stateCode
  let city = locationGeodata.city
  let countryCode = locationGeodata.countryCode

  if (!country && state && state.includes('Singapore')) {
    country = 'Singapore'
    countryCode = 'SG'
    state = null
    stateCode = null
    // Use city as-is (e.g., "Singapore River" or just "Singapore")
  }

  return {
    original: cleanLocation,
    formatted: formatLocationWithGeodata(cleanLocation, locationGeodata),
    city,
    state,
    stateCode,
    country: country || 'Other',
    countryCode,
    coordinates: locationGeodata.coordinates
  }
}

/**
 * Create grouped location options for react-select with proper state grouping
 *
 * @param {Array|string[]} jobsOrLocations - Array of job objects OR array of raw location strings
 * @returns {Promise<Array>} - React-select grouped options
 */
export async function createGroupedLocationOptionsWithGeodata(jobsOrLocations) {
  const geodata = await loadGeocodedData()

  // Extract raw location strings from jobs or use provided array
  let rawLocations = []
  let jobs = [] // Keep reference to jobs for counting

  if (Array.isArray(jobsOrLocations)) {
    // Check if first element is a job object or a location string
    const firstItem = jobsOrLocations[0]
    if (firstItem && typeof firstItem === 'object' && firstItem.location) {
      // Array of job objects - extract raw locations
      jobs = jobsOrLocations
      const locationSet = new Set()
      jobsOrLocations.forEach(job => {
        if (job.location) {
          // Split by newlines to get individual locations
          const locs = job.location.split('\n')
          locs.forEach(loc => {
            const cleaned = loc.replace(/^locations\s*/i, '').trim()
            if (cleaned && cleaned.toLowerCase() !== 'locations') {
              locationSet.add(cleaned)
            }
          })
        }
      })
      rawLocations = Array.from(locationSet)
    } else {
      // Array of location strings - check if they're raw or formatted
      // Raw locations contain hyphens like "US-TX-HOUSTON"
      // Formatted locations are like "Houston, TX"
      const firstLoc = jobsOrLocations[0]
      if (firstLoc && /^[A-Z]{2}-/.test(firstLoc)) {
        // Already raw format
        rawLocations = jobsOrLocations
      } else {
        // Formatted strings - can't process, return empty
        console.warn('createGroupedLocationOptionsWithGeodata: received formatted location strings instead of raw locations')
        return []
      }
    }
  }

  // Get metadata for all locations
  const locationMetadata = await Promise.all(
    rawLocations.map(loc => getLocationMetadata(loc))
  )

  // Group locations and deduplicate
  const grouped = {}
  const seenLocations = new Set() // Track formatted locations to prevent duplicates

  locationMetadata.forEach(meta => {
    const { countryCode, country, state, stateCode, formatted, city } = meta

    // Skip duplicates
    if (seenLocations.has(formatted)) {
      return
    }
    seenLocations.add(formatted)

    let groupKey, displayLabel

    // Group by state/province for locations that have meaningful state divisions
    if (state || stateCode) {
      // US, Canada, Brazil, India, etc. - group by "Country - State"
      groupKey = `${country} - ${state || stateCode}`

      // Display only city name (country/state already in group header)
      if (city) {
        displayLabel = city
      } else {
        // Fallback: clean up raw location strings (e.g., "US-TX-OTHER TEXAS" → "Other Texas")
        // Remove country/state codes and format nicely
        displayLabel = formatted
          .replace(/^[A-Z]{2}-[A-Z]{2,4}-/, '') // Remove "US-TX-" prefix
          .replace(/-/g, ' ')                    // Replace hyphens with spaces
          .trim()
        displayLabel = toTitleCase(displayLabel) // "OTHER TEXAS" → "Other Texas"
      }
    }
    // Locations without state/province - group by country only
    else {
      groupKey = country || 'Other'

      // For locations without state, show city only if we have it
      if (city && city !== country) {
        displayLabel = city
      } else {
        displayLabel = formatted
      }
    }

    if (!grouped[groupKey]) {
      grouped[groupKey] = []
    }

    grouped[groupKey].push({
      label: displayLabel, // Clean label without redundant country/state
      value: formatted,    // Use formatted value for filtering
      searchText: `${country} ${state || ''} ${city || formatted}`.toLowerCase(),
      metadata: meta
    })
  })

  // Count jobs for each formatted location (if we have jobs data)
  if (jobs.length > 0) {
    // Create a map of formatted location -> job count
    const locationJobCounts = new Map()

    jobs.forEach(job => {
      const jobFormattedLocations = getAllLocations(job.location)
      jobFormattedLocations.forEach(formattedLoc => {
        locationJobCounts.set(formattedLoc, (locationJobCounts.get(formattedLoc) || 0) + 1)
      })
    })

    // Filter out locations with 0 jobs and empty groups
    Object.keys(grouped).forEach(groupKey => {
      grouped[groupKey] = grouped[groupKey].filter(option => {
        const jobCount = locationJobCounts.get(option.value) || 0
        return jobCount > 0
      })

      // Remove empty groups
      if (grouped[groupKey].length === 0) {
        delete grouped[groupKey]
      }
    })
  }

  // Sort groups
  const sortedGroups = Object.keys(grouped).sort((a, b) => {
    // US states first (alphabetically)
    const aIsUS = a.startsWith('United States')
    const bIsUS = b.startsWith('United States')

    if (aIsUS && !bIsUS) return -1
    if (!aIsUS && bIsUS) return 1

    // Then other countries alphabetically
    if (a === 'Other') return 1
    if (b === 'Other') return -1

    return a.localeCompare(b)
  })

  // Sort locations within each group
  sortedGroups.forEach(group => {
    grouped[group].sort((a, b) => a.label.localeCompare(b.label))
  })

  // Convert to react-select format
  return sortedGroups.map(group => ({
    label: group,
    options: grouped[group]
  }))
}

/**
 * Get top locations from jobs data (for quick select pills)
 *
 * @param {Array} jobs - Jobs array
 * @param {number} limit - Number of top locations to return
 * @returns {Promise<string[]>} - Array of formatted location strings
 */
export async function getTopLocationsFormatted(jobs, limit = 10) {
  const locationCounts = {}

  jobs.forEach(job => {
    if (job.location) {
      const locations = job.location.split('\n')
      locations.forEach(loc => {
        const cleaned = loc.replace(/^locations\s*/i, '').trim()
        if (cleaned && cleaned.toLowerCase() !== 'locations') {
          locationCounts[cleaned] = (locationCounts[cleaned] || 0) + 1
        }
      })
    }
  })

  // Sort by count
  const sorted = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)

  // Format with geodata
  const formatted = await Promise.all(
    sorted.map(async ([loc]) => {
      return await getFormattedLocation(loc)
    })
  )

  return formatted
}
