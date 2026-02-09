/**
 * Geocode all locations in jobs.json using Mapbox API
 * Run with: node geocode-all-locations.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAPBOX_TOKEN = process.env.VITE_MAPBOX_TOKEN;
const MAPBOX_BASE_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places';
const RATE_LIMIT_DELAY = 100;

if (!MAPBOX_TOKEN) {
  console.error('❌ VITE_MAPBOX_TOKEN not found in environment');
  process.exit(1);
}

// Load jobs data
const jobsPath = path.join(__dirname, 'dist/data/jobs.json');
const geocodedPath = path.join(__dirname, 'dist/data/locations-geocoded.json');

const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
const existingGeocoded = JSON.parse(fs.readFileSync(geocodedPath, 'utf8'));

console.log(`📊 Loaded ${jobs.length} jobs`);
console.log(`📍 Existing geocoded locations: ${Object.keys(existingGeocoded).length}`);

// Extract unique locations from jobs
const uniqueLocations = new Set();
jobs.forEach(job => {
  if (job.location) {
    const cleaned = job.location.replace(/^locations\s*/i, '').trim();
    // Split multi-line locations
    cleaned.split('\n').forEach(loc => {
      const trimmed = loc.trim();
      if (trimmed && trimmed.toLowerCase() !== 'locations') {
        uniqueLocations.add(trimmed);
      }
    });
  }
});

console.log(`🔍 Total unique locations in jobs: ${uniqueLocations.size}`);

// Find unmatched locations
const unmatchedLocations = Array.from(uniqueLocations).filter(loc => !existingGeocoded[loc]);
console.log(`❌ Unmatched locations: ${unmatchedLocations.length}`);

if (unmatchedLocations.length === 0) {
  console.log('✅ All locations already geocoded!');
  process.exit(0);
}

// Parse Mapbox response
function parseMapboxResponse(feature, originalQuery) {
  const { place_name, center, context, place_type, text } = feature;

  const coordinates = {
    longitude: center[0],
    latitude: center[1]
  };

  let city = null;
  let state = null;
  let stateCode = null;
  let country = null;
  let countryCode = null;

  if (place_type.includes('place') || place_type.includes('locality')) {
    city = text;
  }

  if (context && Array.isArray(context)) {
    context.forEach(item => {
      const id = item.id || '';

      if (id.startsWith('place.')) {
        city = city || item.text;
      } else if (id.startsWith('region.')) {
        state = item.text;
        if (item.short_code) {
          const parts = item.short_code.split('-');
          stateCode = parts.length > 1 ? parts[1].toUpperCase() : null;
        }
      } else if (id.startsWith('country.')) {
        country = item.text;
        if (item.short_code) {
          countryCode = item.short_code.toUpperCase();
        }
      }
    });
  }

  // Handle region/state features
  if (place_type.includes('region') && !state) {
    state = text;
    if (feature.properties && feature.properties.short_code) {
      const parts = feature.properties.short_code.split('-');
      stateCode = parts.length > 1 ? parts[1].toUpperCase() : null;
    }
  }

  // Handle country-level results
  if (place_type.includes('country') && !country) {
    country = text;
    if (feature.properties && feature.properties.short_code) {
      countryCode = feature.properties.short_code.toUpperCase();
    }
  }

  // Singapore special handling
  if (!country && countryCode === 'SG') {
    country = 'Singapore';
  }
  if (!country && state && state.includes('Singapore')) {
    country = 'Singapore';
    countryCode = 'SG';
    city = city || 'Singapore';
    state = null;
    stateCode = null;
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
  };
}

// Geocode a single location
async function geocodeLocation(locationStr) {
  try {
    const url = `${MAPBOX_BASE_URL}/${encodeURIComponent(locationStr)}.json?access_token=${MAPBOX_TOKEN}&limit=1`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error(`  ❌ HTTP error: ${response.status} for "${locationStr}"`);
      return null;
    }

    const data = await response.json();

    if (!data.features || data.features.length === 0) {
      console.warn(`  ⚠️  No results for: "${locationStr}"`);
      return null;
    }

    const geocoded = parseMapboxResponse(data.features[0], locationStr);
    return geocoded;

  } catch (error) {
    console.error(`  ❌ Error geocoding "${locationStr}":`, error.message);
    return null;
  }
}

// Sleep utility
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main geocoding function
async function geocodeAll() {
  const results = { ...existingGeocoded };
  let succeeded = 0;
  let failed = 0;

  console.log(`\n🚀 Starting geocoding of ${unmatchedLocations.length} locations...\n`);

  for (let i = 0; i < unmatchedLocations.length; i++) {
    const location = unmatchedLocations[i];
    const progress = `[${i + 1}/${unmatchedLocations.length}]`;

    process.stdout.write(`${progress} Geocoding: "${location.substring(0, 60)}..."`);

    const geocoded = await geocodeLocation(location);

    if (geocoded) {
      results[location] = geocoded;
      succeeded++;
      console.log(` ✅ ${geocoded.city || '?'}, ${geocoded.country || '?'}`);
    } else {
      failed++;
      console.log(` ❌ Failed`);
    }

    // Rate limiting
    if (i < unmatchedLocations.length - 1) {
      await sleep(RATE_LIMIT_DELAY);
    }
  }

  // Save results
  console.log(`\n💾 Saving ${Object.keys(results).length} geocoded locations...`);
  fs.writeFileSync(geocodedPath, JSON.stringify(results, null, 2));

  console.log(`\n✅ Geocoding complete!`);
  console.log(`   • Successfully geocoded: ${succeeded}`);
  console.log(`   • Failed: ${failed}`);
  console.log(`   • Total in file: ${Object.keys(results).length}`);
}

// Run
geocodeAll().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
