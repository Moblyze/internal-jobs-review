/**
 * Location Formatter with Geocoded Data Support
 *
 * Primary formatter that uses geocoded Mapbox data
 * Falls back to locationParser for non-geocoded locations
 */

import { formatLocation as fallbackFormatLocation, getLocationWithMetadata } from './locationParser'

// Cache for geocoded data (loaded once)
let geocodedCache = null
let cacheLoaded = false

/**
 * Load geocoded data cache
 */
async function loadGeocodedCache() {
  if (cacheLoaded) {
    return geocodedCache
  }

  try {
    const response = await fetch('/data/locations-geocoded.json')
    if (response.ok) {
      geocodedCache = await response.json()
      console.log(`Loaded ${Object.keys(geocodedCache).length} geocoded locations`)
    } else {
      console.warn('Geocoded data not found, using fallback parser')
      geocodedCache = {}
    }
  } catch (error) {
    console.warn('Could not load geocoded data, using fallback parser:', error)
    geocodedCache = {}
  }

  cacheLoaded = true
  return geocodedCache
}

/**
 * Format a single location string using geocoded data
 *
 * @param {string} locationStr - Raw location string
 * @param {Object} geocodedData - Geocoded data cache
 * @returns {string|null} - Formatted location or null
 */
function formatWithGeocoded(locationStr, geocodedData) {
  const cleanedStr = locationStr.replace(/^locations\s*/i, '').trim()

  if (!geocodedData || !geocodedData[cleanedStr]) {
    return null
  }

  const geo = geocodedData[cleanedStr]
  const { city, state, stateCode, country, countryCode } = geo

  // Format based on country conventions
  if (countryCode === 'US' && city && stateCode) {
    return `${city}, ${stateCode}`
  }

  if (countryCode === 'CA' && city && stateCode) {
    return `${city}, ${stateCode}, Canada`
  }

  if (countryCode === 'BR' && city && state) {
    return `${city}, ${state}, Brazil`
  }

  if (countryCode === 'GB' && city) {
    return `${city}, United Kingdom`
  }

  if (countryCode === 'IN' && city && state) {
    return `${city}, ${state}, India`
  }

  if (city && state && country) {
    return `${city}, ${state}, ${country}`
  }

  if (city && country) {
    return `${city}, ${country}`
  }

  if (geo.mapboxPlaceName) {
    return geo.mapboxPlaceName
  }

  return cleanedStr
}

/**
 * Main export: Format location using geocoded data with fallback
 *
 * @param {string} location - Raw location string
 * @returns {Promise<string|null>} - Formatted location
 */
export async function formatLocationEnhanced(location) {
  if (!location) return null

  const geodata = await loadGeocodedCache()

  // Handle multiple locations separated by newlines
  const locations = location.split('\n').filter(loc => {
    const trimmed = loc.trim()
    return trimmed && trimmed.toLowerCase() !== 'locations'
  })

  if (locations.length === 0) return null

  // Try geocoded data first
  const formatted = formatWithGeocoded(locations[0], geodata)
  if (formatted) {
    if (locations.length > 1) {
      return `${formatted} +${locations.length - 1} more`
    }
    return formatted
  }

  // Fallback to original parser
  return fallbackFormatLocation(location)
}

/**
 * Synchronous version that uses cached geocoded data
 * Call loadGeocodedCache() first to warm the cache
 *
 * @param {string} location - Raw location string
 * @returns {string|null} - Formatted location
 */
export function formatLocationSync(location) {
  if (!location) return null

  // Handle multiple locations separated by newlines
  const locations = location.split('\n').filter(loc => {
    const trimmed = loc.trim()
    return trimmed && trimmed.toLowerCase() !== 'locations'
  })

  if (locations.length === 0) return null

  // Try geocoded data if cache is loaded
  if (cacheLoaded && geocodedCache) {
    const formatted = formatWithGeocoded(locations[0], geocodedCache)
    if (formatted) {
      if (locations.length > 1) {
        return `${formatted} +${locations.length - 1} more`
      }
      return formatted
    }
  }

  // Fallback to original parser
  return fallbackFormatLocation(location)
}

/**
 * Preload geocoded data cache (call on app init)
 */
export function preloadGeocodedData() {
  return loadGeocodedCache()
}
