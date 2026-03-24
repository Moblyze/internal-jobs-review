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
const CLEAN_EXISTING = process.argv.includes('--clean');

if (!MAPBOX_TOKEN && !CLEAN_EXISTING) {
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
 * Strings that are NOT real locations and should never be sent to Mapbox.
 * These are placeholder values from scrapers, aggregators, or ATS systems.
 */
const NON_LOCATION_PATTERNS = [
  /^location\s*not\s*specified$/i,
  /^location\s*not\s*available$/i,
  /^not\s*specified$/i,
  /^not\s*available$/i,
  /^n\/?a$/i,
  /^tba$/i,
  /^tbc$/i,
  /^tbd$/i,
  /^unknown$/i,
  /^remote$/i,
  /^multiple\s*locations?$/i,
  /^various\s*locations?$/i,
  /^\d+\s+locations?$/i,          // "2 Locations", "3 Locations", etc.
  /^multi-location/i,             // "Multi-Location, United States", etc.
  /^see\s*description$/i,
  /^see\s*job\s*description$/i,
  /^anywhere$/i,
  /^flexible$/i,
  /^global$/i,
  /^worldwide$/i,
  /^international$/i,
  /^offshore$/i,
  /^onshore$/i,
];

/**
 * Corporate entity suffixes that indicate a company name, not a location.
 * Matches LLC, Inc, Corp, Ltd, GmbH, etc. as whole words (case-insensitive).
 *
 * NOTE: Short ambiguous suffixes (AG, NV, BV, KG, SAS) are checked separately
 * to avoid matching US state codes like "City, NV" or "City, TX".
 */
const COMPANY_SUFFIX_PATTERN = /\b(LLC|L\.?L\.?C\.?|Inc\.?|Incorporated|Corp\.?|Corporation|Ltd\.?|Limited|GmbH|S\.A\.?|Pty|L\.?P\.?|PLC|PBLLC|LLP|Co\.\s*Ltd)\b/i;

/**
 * Short ambiguous corporate suffixes that could also be state/country codes.
 * Only match these when they appear at end of string and are NOT preceded by ", "
 * (which would indicate a geographic code like "Reno, NV").
 */
const AMBIGUOUS_CORP_SUFFIX_PATTERN = /(?<!,\s*)\b(AG|SAS|BV|NV|KG)\s*$/i;

/**
 * Words that strongly suggest a company name rather than a location.
 * Only used when combined with other heuristics (no geographic indicators present).
 */
const COMPANY_INDICATOR_WORDS = /\b(Staffing|Consulting|Consultants?|Associates|Solutions|Technologies|Engineering|Services|Systems|Holdings?|Partners?|Group|Industries|Contractors?|Construction|Manufacturing|Logistics|Aviation|Marine|Robotics|Automation|Instruments|Energy|Solar|Offshore|Shipyard|Welding|Pipeline|Drilling|Inspection|Mechanical|Electrical)\b/i;

/**
 * Geographic indicator words that suggest the string IS a location even if
 * it contains company-like words (e.g., "International, King County").
 */
const GEO_INDICATOR_PATTERN = /\b(County|City|State|Province|District|Region|Township|Borough|Village|Town|Area|Metro|Valley|Mountain|Lake|River|Bay|Beach|Port|Island|Creek|Springs?|Falls|Heights|Hills?|Park|Grove|Plains?|Point|Fork|Junction|Station|Harbor|Cape|Strait)\b/i;

/**
 * Workday regional bucket codes that are not real locations.
 * Pattern: {CC}-OTHER {description} or XX-OTHER {description}
 */
const WORKDAY_BUCKET_PATTERN = /^[A-Z]{2}-OTHER\b/i;

/**
 * Check if a string looks like a company name rather than a location.
 */
function isCompanyName(location) {
  const trimmed = location.trim();

  // If it has a clear corporate entity suffix, it's a company name
  if (COMPANY_SUFFIX_PATTERN.test(trimmed)) {
    return true;
  }

  // Check ambiguous short suffixes (AG, NV, etc.) only when NOT after a comma
  if (AMBIGUOUS_CORP_SUFFIX_PATTERN.test(trimmed)) {
    return true;
  }

  // If it has geographic indicators, it's probably a location even if it has company-like words
  if (GEO_INDICATOR_PATTERN.test(trimmed)) {
    return false;
  }

  // Check for company indicator words combined with heuristics:
  // - No comma (locations usually have "City, State" or "City, Country")
  // - Multiple capitalized words that look like a proper noun/brand name
  if (COMPANY_INDICATOR_WORDS.test(trimmed)) {
    const hasCommaGeo = /,\s*[A-Z]{2}\s*$/.test(trimmed); // ends with ", XX" country/state code
    if (!hasCommaGeo) {
      return true;
    }
  }

  // Strings like "US0767 Prysmian Cables and Systems Usa LLC" — starts with alphanumeric code
  if (/^\w{2,}\d+\s/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Check if a location string is a Workday regional bucket code.
 * These are placeholder regions like "US-OTHER ALABAMA", "XX-OTHER COUNTRY".
 */
function isWorkdayBucket(location) {
  return WORKDAY_BUCKET_PATTERN.test(location.trim());
}

/**
 * Check if a string looks like a Workday-format address (CC-XX-CITY-ADDRESS).
 * These should be cleaned/parsed, NOT rejected as company names.
 */
function isWorkdayFormat(location) {
  return /^[A-Z]{2}-[A-Z]/.test(location.trim());
}

/**
 * Check if a location string is a non-geocodable placeholder
 */
function isNonLocation(location) {
  const cleaned = location.trim();
  if (NON_LOCATION_PATTERNS.some(pattern => pattern.test(cleaned))) return true;
  if (isWorkdayBucket(cleaned)) return true;
  // Don't flag Workday-format addresses as company names — they'll be parsed later
  if (isWorkdayFormat(cleaned)) return false;
  if (isCompanyName(cleaned)) return true;
  return false;
}

/**
 * Parse a Workday-format address string into a clean geocodable location.
 *
 * Workday formats:
 *   {CC}-{STATE}-{CITY}-{ADDRESS}     e.g. "US-TX-HOUSTON-123 MAIN ST"
 *   {CC}-{STATE/CITY}-{CITY/ADDRESS}  e.g. "AE-ABU DHABI-MUSSAFAH..."
 *   {CC}-{CITY}-{ADDRESS}             e.g. "DE-CELLE-BAKER-HUGHES-STRASSE 1"
 *
 * Returns a clean "City, State, Country" string or null if not a Workday format.
 */
function parseWorkdayLocation(location) {
  const trimmed = location.trim();

  // Must start with 2-letter country code followed by a dash
  const match = trimmed.match(/^([A-Z]{2})-(.+)/);
  if (!match) return null;

  const countryCode = match[1];
  const rest = match[2];

  // Skip bucket codes (handled elsewhere)
  if (/^OTHER\b/i.test(rest)) return null;

  // Split on dashes to get segments
  const segments = rest.split('-').map(s => s.trim()).filter(Boolean);
  if (segments.length < 2) return null;

  // For known patterns with state codes (US-TX-HOUSTON, CA-AB-CALGARY, AU-WA-PERTH, etc.)
  // The second segment is a 2-3 letter state/province code
  const isStateCode = /^[A-Z]{2,3}$/i.test(segments[0]);

  let city, stateCode;
  if (isStateCode && segments.length >= 2) {
    stateCode = segments[0];
    city = segments[1];
  } else {
    // No state code — first segment is the city (e.g., "AE-ABU DHABI-..." or "DE-CELLE-...")
    city = segments[0];
    stateCode = null;
  }

  // Title-case the city (it comes in ALL CAPS from Workday)
  city = titleCase(city);

  // Build the clean location string
  if (stateCode) {
    return `${city}, ${stateCode}, ${countryCode}`;
  }
  return `${city}, ${countryCode}`;
}

/**
 * Extract just the first location from a multi-location concatenated string.
 *
 * Multi-location strings look like:
 *   "Aberdeen (Westhill), GB Leer, DE Dubai, AE OSLO, NO"
 *   "Paris, FR Lisbon, PT"
 *   "VIGRA, NO STAVANGER, NO"
 *
 * Pattern: "{City}, {CC} {City}, {CC} ..." — split on the 2-letter country code
 * boundary and take just the first location.
 *
 * Returns the cleaned first location, or null if not a multi-location string.
 */
function extractFirstFromMultiLocation(location) {
  const trimmed = location.trim();

  // Look for pattern: "City, CC City, CC" or "CITY, CC CITY, CC"
  // A multi-location has at least two occurrences of ", XX " or ", XX" at end
  const countryCodeBoundary = /,\s*[A-Z]{2}(?:\s+[A-Z])/;
  if (!countryCodeBoundary.test(trimmed)) return null;

  // Split after the first ", XX" country code + space boundary
  // e.g. "Aberdeen (Westhill), GB Leer, DE ..." -> take "Aberdeen (Westhill), GB"
  const firstLocMatch = trimmed.match(/^(.+?,\s*[A-Z]{2})(?:\s+[A-Z])/);
  if (firstLocMatch) {
    const firstLoc = firstLocMatch[1].trim();
    // Verify the remainder also looks like location(s)
    const remainder = trimmed.slice(firstLocMatch[0].length - 1).trim(); // -1 to keep the first char of next city
    if (/,\s*[A-Z]{2}\b/.test(remainder)) {
      return firstLoc;
    }
  }

  return null;
}

/**
 * Convert ALL CAPS string to Title Case.
 */
function titleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Clean and transform a location string before geocoding.
 * Handles Workday formats, multi-location strings, and other quirks.
 *
 * Returns { query, reason } where:
 *   - query is the cleaned string to geocode (or null to skip)
 *   - reason explains what was done (for logging)
 */
function cleanLocationString(location) {
  const trimmed = location.trim();

  // 1. Try parsing as Workday format (CC-STATE-CITY-ADDRESS)
  const workdayParsed = parseWorkdayLocation(trimmed);
  if (workdayParsed) {
    return { query: workdayParsed, reason: `Workday format -> "${workdayParsed}"` };
  }

  // 2. Try extracting first from multi-location concatenation
  const firstLoc = extractFirstFromMultiLocation(trimmed);
  if (firstLoc) {
    return { query: firstLoc, reason: `Multi-location -> first: "${firstLoc}"` };
  }

  // 3. Fall through to existing buildSearchQuery logic
  return { query: null, reason: null };
}

/**
 * Build a better search query from the location string.
 * Called AFTER cleanLocationString for cases that don't match special patterns.
 */
function buildSearchQuery(location) {
  // Handle "+N more" suffixes
  let clean = location.replace(/\s*\+\d+\s*more…?$/i, '').trim();

  // Handle "103 Oilfield, Libya" type strings — but NOT "2 Locations" style
  // Only strip leading digits when followed by a real place-like word
  if (!/^\d+\s+locations?$/i.test(clean)) {
    clean = clean.replace(/^\d+\s+/, '');
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

  // Clean existing bad entries if --clean flag is passed
  if (CLEAN_EXISTING) {
    console.log('\n--- Cleaning existing bad entries ---');
    let cleanedCompanies = 0;
    let cleanedBuckets = 0;

    for (const key of Object.keys(geocoded)) {
      // Skip entries already marked
      if (geocoded[key]._skip) continue;

      if (isWorkdayBucket(key)) {
        geocoded[key] = { _skip: true, _reason: 'Workday regional bucket code' };
        cleanedBuckets++;
      } else if (!isWorkdayFormat(key) && isCompanyName(key)) {
        geocoded[key] = { _skip: true, _reason: 'Company name, not a location' };
        cleanedCompanies++;
      }
    }

    console.log(`Marked ${cleanedCompanies} company names as _skip`);
    console.log(`Marked ${cleanedBuckets} Workday bucket codes as _skip`);
  }

  // Find missing
  const missing = [...locs].filter(l => !geocoded[l]).sort();
  console.log(`\nFound ${missing.length} locations not in geocoded data (out of ${locs.size} total)`);

  if (missing.length === 0) {
    console.log('All locations are already geocoded!');
    if (CLEAN_EXISTING) {
      // Still save if we cleaned existing entries
      const sorted = {};
      for (const key of Object.keys(geocoded).sort()) {
        sorted[key] = geocoded[key];
      }
      fs.writeFileSync(GEOCODED_FILE, JSON.stringify(sorted, null, 2), 'utf-8');
      console.log(`\nSaved cleaned data to ${GEOCODED_FILE}`);
    }
    return;
  }

  // Geocode each missing location
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let cleaned = 0;

  for (let i = 0; i < missing.length; i++) {
    const location = missing[i];
    const progress = `[${i + 1}/${missing.length}]`;

    // Skip non-location placeholder strings, company names, and bucket codes
    if (isNonLocation(location)) {
      const reason = isWorkdayBucket(location) ? 'Workday bucket code'
        : isCompanyName(location) ? 'company name'
        : 'non-location placeholder';
      console.log(`\n${progress} SKIPPED (${reason}): ${location}`);
      geocoded[location] = { _skip: true, _reason: reason };
      skipped++;
      continue;
    }

    // Try to clean/transform the location string before geocoding
    const { query: cleanedQuery, reason: cleanReason } = cleanLocationString(location);
    let query;
    if (cleanedQuery) {
      query = cleanedQuery;
      cleaned++;
      console.log(`\n${progress} CLEANED (${cleanReason}): ${location}`);
    } else {
      query = buildSearchQuery(location);
    }

    try {
      const result = await geocodeLocation(query);
      if (result) {
        if (cleanedQuery) {
          result.original = location;
          result.cleanedQuery = cleanedQuery;
        }
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

  console.log(`\n\nResults: ${succeeded} geocoded, ${failed} failed, ${skipped} skipped, ${cleaned} cleaned`);
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
