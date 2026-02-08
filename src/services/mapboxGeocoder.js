/**
 * Mapbox Geocoding Service
 *
 * Provides geocoding functionality using Mapbox Geocoding API
 * Free tier: 100,000 requests/month (plenty for one-time geocoding)
 *
 * Features:
 * - Single location geocoding
 * - Batch geocoding with rate limiting
 * - Parse response for structured data
 * - Error handling and retries
 */

const MAPBOX_BASE_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places'
const RATE_LIMIT_DELAY = 100 // 100ms between requests (600/min = safe under 600/min limit)

/**
 * Sleep utility for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Geocode a single location using Mapbox API
 *
 * @param {string} locationQuery - Location string to geocode
 * @param {string} accessToken - Mapbox access token
 * @returns {Promise<Object|null>} - Geocoded location data or null if failed
 */
export async function geocodeLocation(locationQuery, accessToken) {
  if (!locationQuery || !accessToken) {
    console.error('Missing location query or access token')
    return null
  }

  try {
    // Clean up location query
    const cleanQuery = locationQuery
      .replace(/^locations\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!cleanQuery) {
      console.warn('Empty location query after cleaning:', locationQuery)
      return null
    }

    // Build URL with proper encoding
    const encodedQuery = encodeURIComponent(cleanQuery)
    const url = `${MAPBOX_BASE_URL}/${encodedQuery}.json?access_token=${accessToken}&limit=1`

    const response = await fetch(url)

    if (!response.ok) {
      console.error(`Mapbox API error (${response.status}):`, await response.text())
      return null
    }

    const data = await response.json()

    if (!data.features || data.features.length === 0) {
      console.warn('No results found for:', cleanQuery)
      return null
    }

    const feature = data.features[0]

    // Parse the response into structured data
    const parsed = parseMapboxResponse(feature)

    return parsed

  } catch (error) {
    console.error('Error geocoding location:', locationQuery, error)
    return null
  }
}

/**
 * Parse Mapbox geocoding response into structured location data
 *
 * @param {Object} feature - Mapbox feature object
 * @returns {Object} - Structured location data
 */
function parseMapboxResponse(feature) {
  const { place_name, center, context, place_type } = feature

  // Extract coordinates
  const coordinates = {
    longitude: center[0],
    latitude: center[1]
  }

  // Initialize location components
  let city = null
  let state = null
  let stateCode = null
  let country = null
  let countryCode = null
  let postalCode = null

  // Extract city from place_name or text
  if (place_type.includes('place') || place_type.includes('locality')) {
    city = feature.text
  }

  // Parse context for additional details
  if (context && Array.isArray(context)) {
    context.forEach(item => {
      const id = item.id || ''

      if (id.startsWith('place.')) {
        city = city || item.text
      } else if (id.startsWith('region.')) {
        state = item.text
        // Extract state code if available (e.g., "Texas" → code might be in short_code)
        if (item.short_code) {
          const parts = item.short_code.split('-')
          stateCode = parts.length > 1 ? parts[1].toUpperCase() : null
        }
      } else if (id.startsWith('country.')) {
        country = item.text
        // Country code is in short_code (e.g., "us", "gb")
        if (item.short_code) {
          countryCode = item.short_code.toUpperCase()
        }
      } else if (id.startsWith('postcode.')) {
        postalCode = item.text
      }
    })
  }

  // Handle case where the feature itself is a region/state
  if (place_type.includes('region') && !state) {
    state = feature.text
    if (feature.properties && feature.properties.short_code) {
      const parts = feature.properties.short_code.split('-')
      stateCode = parts.length > 1 ? parts[1].toUpperCase() : null
    }
  }

  // Handle country-level results
  if (place_type.includes('country') && !country) {
    country = feature.text
    if (feature.properties && feature.properties.short_code) {
      countryCode = feature.properties.short_code.toUpperCase()
    }
  }

  return {
    original: place_name,
    city,
    state,
    stateCode,
    country,
    countryCode,
    postalCode,
    coordinates,
    placeType: place_type,
    confidence: feature.relevance || 1.0
  }
}

/**
 * Format geocoded location for display
 *
 * @param {Object} geocoded - Geocoded location data
 * @returns {string} - Formatted location string
 */
export function formatGeocodedLocation(geocoded) {
  if (!geocoded) return null

  const { city, state, stateCode, country, countryCode } = geocoded

  // US locations: "City, ST"
  if (countryCode === 'US' && city && stateCode) {
    return `${city}, ${stateCode}`
  }

  // Canadian locations: "City, Province, Canada"
  if (countryCode === 'CA' && city && stateCode) {
    return `${city}, ${stateCode}, Canada`
  }

  // Other locations with state/province: "City, State, Country"
  if (city && state && country) {
    return `${city}, ${state}, ${country}`
  }

  // City with country: "City, Country"
  if (city && country) {
    return `${city}, ${country}`
  }

  // Fallback to original Mapbox place name
  return geocoded.original
}

/**
 * Batch geocode multiple locations with rate limiting
 *
 * @param {string[]} locations - Array of location strings
 * @param {string} accessToken - Mapbox access token
 * @param {Function} onProgress - Progress callback (current, total, location)
 * @returns {Promise<Object>} - Map of location -> geocoded data
 */
export async function batchGeocode(locations, accessToken, onProgress = null) {
  const results = {}
  const total = locations.length
  let completed = 0
  let succeeded = 0
  let failed = 0

  console.log(`Starting batch geocode of ${total} locations...`)

  for (const location of locations) {
    try {
      const geocoded = await geocodeLocation(location, accessToken)

      if (geocoded) {
        results[location] = geocoded
        succeeded++
      } else {
        failed++
      }

      completed++

      if (onProgress) {
        onProgress(completed, total, location, geocoded)
      }

      // Rate limiting: wait between requests
      if (completed < total) {
        await sleep(RATE_LIMIT_DELAY)
      }

    } catch (error) {
      console.error(`Failed to geocode: ${location}`, error)
      failed++
      completed++
    }
  }

  console.log(`Batch geocoding complete:`)
  console.log(`  Total: ${total}`)
  console.log(`  Succeeded: ${succeeded}`)
  console.log(`  Failed: ${failed}`)

  return results
}

/**
 * Load geocoded locations from storage
 *
 * @param {string} path - Path to geocoded data file
 * @returns {Promise<Object>} - Map of location -> geocoded data
 */
export async function loadGeocodedLocations(path = '/data/locations-geocoded.json') {
  try {
    const response = await fetch(path)
    if (!response.ok) {
      console.warn('No geocoded locations file found')
      return {}
    }
    return await response.json()
  } catch (error) {
    console.error('Error loading geocoded locations:', error)
    return {}
  }
}
