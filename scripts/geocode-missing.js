#!/usr/bin/env node

/**
 * Geocode missing locations from the latest jobs.json
 * Fetches jobs.json from the live site, finds locations not in
 * locations-geocoded.json, and geocodes them via Mapbox API.
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEOCODED_FILE = path.join(__dirname, '../public/data/locations-geocoded.json');
const LOCAL_JOBS_FILE = path.join(__dirname, '../public/data/jobs.json');
const MAPBOX_TOKEN = process.env.VITE_MAPBOX_TOKEN;
const RATE_LIMIT_MS = 150; // 150ms between requests
const USE_LOCAL = process.argv.includes('--local');

if (!MAPBOX_TOKEN) {
  console.error('Error: VITE_MAPBOX_TOKEN not set in .env');
  process.exit(1);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Geocode a single location using Mapbox Geocoding API
 */
async function geocodeLocation(query) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=place,locality,neighborhood,address,region,country`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Mapbox API error: ${response.status}`);
  }

  const data = await response.json();
  if (!data.features || data.features.length === 0) {
    return null;
  }

  const feature = data.features[0];
  const result = {
    city: null,
    state: null,
    stateCode: null,
    country: null,
    countryCode: null,
    coordinates: {
      latitude: feature.center[1],
      longitude: feature.center[0]
    },
    mapboxPlaceName: feature.place_name,
    confidence: feature.relevance || 0
  };

  // Parse context for city, state, country
  const context = feature.context || [];

  // The feature itself might be the city
  if (feature.place_type?.includes('place') || feature.place_type?.includes('locality')) {
    result.city = feature.text;
  }

  for (const ctx of context) {
    if (ctx.id.startsWith('region')) {
      result.state = ctx.text;
      if (ctx.short_code) {
        const parts = ctx.short_code.split('-');
        result.stateCode = parts.length > 1 ? parts[1].toUpperCase() : ctx.short_code.toUpperCase();
      }
    } else if (ctx.id.startsWith('country')) {
      result.country = ctx.text;
      result.countryCode = ctx.short_code?.toUpperCase() || null;
    } else if (ctx.id.startsWith('place') && !result.city) {
      result.city = ctx.text;
    }
  }

  // If the feature is a region (state-level), use it as state
  if (feature.place_type?.includes('region') && !result.state) {
    result.state = feature.text;
    if (feature.properties?.short_code) {
      const parts = feature.properties.short_code.split('-');
      result.stateCode = parts.length > 1 ? parts[1].toUpperCase() : feature.properties.short_code.toUpperCase();
    }
  }

  // If the feature is a country, use it as country
  if (feature.place_type?.includes('country') && !result.country) {
    result.country = feature.text;
    result.countryCode = feature.properties?.short_code?.toUpperCase() || null;
  }

  return result;
}

/**
 * Build a better search query from the location string
 */
function buildSearchQuery(location) {
  // Handle "+N more" suffixes
  let clean = location.replace(/\s*\+\d+\s*more…?$/i, '').trim();

  // Handle "103 Oilfield, Libya" type strings
  clean = clean.replace(/^\d+\s+/, '');

  // Handle raw format like "US-TX-HOUSTON-123 MAIN ST"
  const rawMatch = clean.match(/^([A-Z]{2})-([A-Z]{2,4})-(.+)/);
  if (rawMatch) {
    const parts = rawMatch[3].split('-');
    const city = parts[0];
    return `${city}, ${rawMatch[1]}`;
  }

  return clean;
}

async function main() {
  let jobs;
  if (USE_LOCAL) {
    console.log(`Reading local jobs.json from ${LOCAL_JOBS_FILE}...`);
    jobs = JSON.parse(fs.readFileSync(LOCAL_JOBS_FILE, 'utf-8'));
  } else {
    console.log('Fetching latest jobs.json from live site...');
    const jobsResponse = await fetch('https://moblyze.github.io/internal-jobs-review/data/jobs.json');
    jobs = await jobsResponse.json();
  }

  console.log(`Loaded ${jobs.length} jobs`);

  // Extract unique locations
  const locs = new Set();
  for (const job of jobs) {
    if (job.location) {
      for (const loc of job.location.split('\n')) {
        const cleaned = loc.replace(/^locations\s*/i, '').trim();
        if (cleaned && cleaned.toLowerCase() !== 'locations') {
          locs.add(cleaned);
        }
      }
    }
  }

  // Load existing geocoded data
  const geocoded = JSON.parse(fs.readFileSync(GEOCODED_FILE, 'utf-8'));
  const originalCount = Object.keys(geocoded).length;

  // Find missing
  const missing = [...locs].filter(l => !geocoded[l]).sort();
  console.log(`\nFound ${missing.length} locations not in geocoded data (out of ${locs.size} total)`);

  if (missing.length === 0) {
    console.log('All locations are already geocoded!');
    return;
  }

  // Geocode each missing location
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < missing.length; i++) {
    const location = missing[i];
    const query = buildSearchQuery(location);
    const progress = `[${i + 1}/${missing.length}]`;

    try {
      const result = await geocodeLocation(query);
      if (result) {
        geocoded[location] = result;
        succeeded++;
        const country = result.country || result.countryCode || '??';
        process.stdout.write(`\r${progress} ${location.slice(0, 50).padEnd(50)} -> ${country}    `);
      } else {
        failed++;
        console.log(`\n${progress} FAILED (no results): ${location} (query: "${query}")`);
      }
    } catch (err) {
      failed++;
      console.log(`\n${progress} ERROR: ${location} - ${err.message}`);
    }

    if (i < missing.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  console.log(`\n\nResults: ${succeeded} geocoded, ${failed} failed`);
  console.log(`Total entries: ${originalCount} -> ${Object.keys(geocoded).length}`);

  // Save updated file
  // Sort keys for consistency
  const sorted = {};
  for (const key of Object.keys(geocoded).sort()) {
    sorted[key] = geocoded[key];
  }

  fs.writeFileSync(GEOCODED_FILE, JSON.stringify(sorted, null, 2), 'utf-8');
  console.log(`\nSaved to ${GEOCODED_FILE}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
