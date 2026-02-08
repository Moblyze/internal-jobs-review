#!/usr/bin/env node

/**
 * One-Time Location Geocoding Script
 *
 * Geocodes all unique locations from jobs.json using Mapbox API
 * Stores results in locations-geocoded.json for permanent use
 *
 * Usage:
 *   npm run geocode-locations
 *
 * Requirements:
 *   - VITE_MAPBOX_TOKEN in .env file
 *   - public/data/jobs.json exists
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

// Load environment variables
config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const JOBS_FILE = path.join(__dirname, '../public/data/jobs.json')
const OUTPUT_FILE = path.join(__dirname, '../public/data/locations-geocoded.json')
const MAPBOX_TOKEN = process.env.VITE_MAPBOX_TOKEN

// Mapbox API settings
const MAPBOX_BASE_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places'
const RATE_LIMIT_DELAY = 100 // 100ms between requests (safe under 600/min limit)

/**
 * Sleep utility for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Geocode a single location using Mapbox API
 */
async function geocodeLocation(locationQuery, accessToken) {
  if (!locationQuery || !accessToken) {
    return null
  }

  try {
    // Clean up location query
    const cleanQuery = locationQuery
      .replace(/^locations\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!cleanQuery) {
      return null
    }

    // Build URL with proper encoding
    const encodedQuery = encodeURIComponent(cleanQuery)
    const url = `${MAPBOX_BASE_URL}/${encodedQuery}.json?access_token=${accessToken}&limit=1`

    const response = await fetch(url)

    if (!response.ok) {
      console.error(`  ✗ API error (${response.status}) for: ${cleanQuery}`)
      return null
    }

    const data = await response.json()

    if (!data.features || data.features.length === 0) {
      console.warn(`  ⚠ No results for: ${cleanQuery}`)
      return null
    }

    const feature = data.features[0]

    // Parse the response into structured data
    return parseMapboxResponse(feature, cleanQuery)

  } catch (error) {
    console.error(`  ✗ Error geocoding: ${locationQuery}`, error.message)
    return null
  }
}

/**
 * Parse Mapbox geocoding response into structured location data
 */
function parseMapboxResponse(feature, originalQuery) {
  const { place_name, center, context, place_type, text } = feature

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

  // Extract city from place_name or text
  if (place_type.includes('place') || place_type.includes('locality')) {
    city = text
  }

  // Parse context for additional details
  if (context && Array.isArray(context)) {
    context.forEach(item => {
      const id = item.id || ''

      if (id.startsWith('place.')) {
        city = city || item.text
      } else if (id.startsWith('region.')) {
        state = item.text
        // Extract state code if available
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
      }
    })
  }

  // Handle case where the feature itself is a region/state
  if (place_type.includes('region') && !state) {
    state = text
    if (feature.properties && feature.properties.short_code) {
      const parts = feature.properties.short_code.split('-')
      stateCode = parts.length > 1 ? parts[1].toUpperCase() : null
    }
  }

  // Handle country-level results
  if (place_type.includes('country') && !country) {
    country = text
    if (feature.properties && feature.properties.short_code) {
      countryCode = feature.properties.short_code.toUpperCase()
    }
  }

  return {
    original: originalQuery,
    mapboxPlaceName: place_name,
    city,
    state,
    stateCode,
    country,
    countryCode,
    coordinates,
    placeType: place_type,
    confidence: feature.relevance || 1.0
  }
}

/**
 * Extract unique locations from jobs data
 */
function extractUniqueLocations(jobs) {
  const locationSet = new Set()

  jobs.forEach(job => {
    if (job.location) {
      // Handle both simple strings and multi-line locations
      const locations = job.location.split('\n')
      locations.forEach(loc => {
        const cleaned = loc.replace(/^locations\s*/i, '').trim()
        if (cleaned && cleaned.toLowerCase() !== 'locations') {
          locationSet.add(cleaned)
        }
      })
    }
  })

  return Array.from(locationSet).sort()
}

/**
 * Progress bar utility
 */
function drawProgressBar(current, total, location) {
  const percentage = ((current / total) * 100).toFixed(1)
  const barLength = 40
  const filledLength = Math.round((current / total) * barLength)
  const bar = '='.repeat(filledLength) + '-'.repeat(barLength - filledLength)

  // Clear line and draw progress
  process.stdout.write(`\r[${bar}] ${percentage}% (${current}/${total}) ${location.slice(0, 40).padEnd(40)}`)
}

/**
 * Main geocoding process
 */
async function main() {
  console.log('\n🗺️  Mapbox Location Geocoding Script\n')

  // Validate environment
  if (!MAPBOX_TOKEN) {
    console.error('❌ Error: VITE_MAPBOX_TOKEN not found in .env file')
    console.error('   Please follow setup instructions in MAPBOX_SETUP.md')
    process.exit(1)
  }

  if (!fs.existsSync(JOBS_FILE)) {
    console.error(`❌ Error: Jobs file not found: ${JOBS_FILE}`)
    process.exit(1)
  }

  // Load jobs data
  console.log('📂 Loading jobs data...')
  const jobsData = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
  console.log(`   Found ${jobsData.length} jobs`)

  // Extract unique locations
  console.log('\n📍 Extracting unique locations...')
  const uniqueLocations = extractUniqueLocations(jobsData)
  console.log(`   Found ${uniqueLocations.length} unique locations`)

  // Load existing geocoded data (for resume support)
  let existingData = {}
  if (fs.existsSync(OUTPUT_FILE)) {
    console.log('\n📦 Loading existing geocoded data...')
    existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'))
    console.log(`   Found ${Object.keys(existingData).length} previously geocoded locations`)
  }

  // Filter out already geocoded locations
  const locationsToGeocode = uniqueLocations.filter(loc => !existingData[loc])

  if (locationsToGeocode.length === 0) {
    console.log('\n✅ All locations already geocoded!')
    console.log(`   Results: ${OUTPUT_FILE}`)
    process.exit(0)
  }

  console.log(`\n🔄 Geocoding ${locationsToGeocode.length} new locations...\n`)

  // Geocode locations with progress tracking
  const results = { ...existingData }
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < locationsToGeocode.length; i++) {
    const location = locationsToGeocode[i]

    drawProgressBar(i + 1, locationsToGeocode.length, location)

    const geocoded = await geocodeLocation(location, MAPBOX_TOKEN)

    if (geocoded) {
      results[location] = geocoded
      succeeded++
    } else {
      failed++
    }

    // Rate limiting
    if (i < locationsToGeocode.length - 1) {
      await sleep(RATE_LIMIT_DELAY)
    }
  }

  // Clear progress bar
  process.stdout.write('\r' + ' '.repeat(100) + '\r')

  // Save results
  console.log('\n💾 Saving results...')
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8')

  // Summary
  console.log('\n✅ Geocoding complete!\n')
  console.log(`   Total locations: ${uniqueLocations.length}`)
  console.log(`   Previously geocoded: ${Object.keys(existingData).length}`)
  console.log(`   Newly geocoded: ${succeeded}`)
  console.log(`   Failed: ${failed}`)
  console.log(`\n   Results saved to: ${OUTPUT_FILE}`)

  if (failed > 0) {
    console.log('\n⚠️  Some locations failed to geocode (see warnings above)')
    console.log('   These may be too vague (e.g., country names) or invalid')
  }

  console.log('\n📝 Next steps:')
  console.log('   1. Review the geocoded data in public/data/locations-geocoded.json')
  console.log('   2. Commit the file to your repository:')
  console.log('      git add public/data/locations-geocoded.json')
  console.log('      git commit -m "Add geocoded location data"')
  console.log('\n')
}

// Run the script
main().catch(error => {
  console.error('\n❌ Fatal error:', error)
  process.exit(1)
})
