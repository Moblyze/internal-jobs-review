// scripts/trend-report/classify.js
/**
 * classifyJob: returns { focusMarketSlug, focusMarketLabel, regionName, country }
 * for a raw job record. Wraps existing classifiers.
 *
 * Any classifier failure is swallowed and returns null for that dimension —
 * trend reporting should never fail end-to-end because one job had a weird location.
 *
 * NOTE: src/utils/energyRegions.js and src/utils/locationParser.js are browser-only
 * modules (they use import.meta.env and fetch). They cannot be imported in a Node.js
 * context. Region and country extraction here uses the same keyword/location data
 * defined in those modules but composed in a Node-compatible way.
 */

import { classifyFocusMarket } from '../focusMarketClassifier.js';
import { getMarketLabel } from '../../src/utils/focusMarkets.js';

// ---------------------------------------------------------------------------
// Region data — mirrors TOP_ENERGY_REGIONS + ADDITIONAL_ENERGY_REGIONS from
// src/utils/energyRegions.js. Kept as a local constant so this script runs in
// Node without triggering the browser-only import chain in energyRegions.js.
// ---------------------------------------------------------------------------
const ALL_ENERGY_REGIONS = [
  {
    name: 'Gulf of Mexico',
    locations: [
      'Houston, TX', 'New Orleans, LA', 'Lafayette, LA', 'Beaumont, TX',
      'Port Arthur, TX', 'Corpus Christi, TX', 'Galveston, TX', 'Baton Rouge, LA',
      'Lake Charles, LA', 'Houma, LA', 'Morgan City, LA', 'Freeport, TX',
      'Texas City, TX', 'Pasadena, TX', 'Baytown, TX', 'Channelview, TX',
      'Deer Park, TX', 'Gulf of Mexico',
    ],
    keywords: ['gulf', 'houston', 'offshore', 'new orleans', 'lafayette'],
  },
  {
    name: 'Permian Basin',
    locations: [
      'Midland, TX', 'Odessa, TX', 'Carlsbad, NM', 'Pecos, TX', 'Andrews, TX',
      'Big Spring, TX', 'Monahans, TX', 'Fort Stockton, TX', 'Kermit, TX',
      'Seminole, TX', 'Hobbs, NM', 'Lovington, NM',
    ],
    keywords: ['permian', 'midland', 'odessa', 'carlsbad'],
  },
  {
    name: 'North Sea',
    locations: [
      'Aberdeen, United Kingdom', 'Stavanger, Norway', 'Edinburgh, United Kingdom',
      'Bergen, Norway', 'Great Yarmouth, United Kingdom',
    ],
    keywords: ['north sea', 'aberdeen', 'stavanger', 'norway', 'scotland'],
  },
  {
    name: 'Appalachia',
    locations: [
      'Pittsburgh, PA', 'Canonsburg, PA', 'Morgantown, WV', 'Wheeling, WV',
      'Charleston, WV', 'Washington, PA', 'Waynesburg, PA', 'Clarksburg, WV',
      'Bridgeport, WV',
    ],
    keywords: ['appalachia', 'marcellus', 'utica', 'pittsburgh', 'pennsylvania'],
  },
  {
    name: 'Alaska',
    locations: [
      'Anchorage, AK', 'Prudhoe Bay, AK', 'Fairbanks, AK', 'Kenai, AK',
      'Valdez, AK', 'North Slope, AK', 'Deadhorse, AK', 'Barrow, AK',
      'Homer, AK', 'Palmer, AK', 'Wasilla, AK', 'Juneau, AK',
    ],
    keywords: ['alaska', 'anchorage', 'prudhoe', 'fairbanks'],
  },
  {
    name: 'Rockies',
    locations: [
      'Denver, CO', 'Casper, WY', 'Cheyenne, WY', 'Grand Junction, CO',
      'Pinedale, WY', 'Rock Springs, WY', 'Vernal, UT', 'Rangely, CO', 'Rifle, CO',
    ],
    keywords: ['rockies', 'denver', 'colorado', 'wyoming', 'casper'],
  },
  {
    name: 'Bakken',
    locations: [
      'Williston, ND', 'Dickinson, ND', 'Watford City, ND', 'Sidney, MT',
      'Tioga, ND', 'Stanley, ND',
    ],
    keywords: ['bakken', 'williston', 'north dakota'],
  },
  {
    name: 'Eagle Ford',
    locations: [
      'San Antonio, TX', 'Laredo, TX', 'Pleasanton, TX', 'Cotulla, TX',
      'Karnes City, TX', 'Gonzales, TX', 'Cuero, TX', 'Victoria, TX',
    ],
    keywords: ['eagle ford'],
  },
  {
    name: 'DJ Basin',
    locations: [
      'Greeley, CO', 'Weld County, CO', 'Brighton, CO', 'Fort Lupton, CO',
      'Frederick, CO',
    ],
    keywords: ['dj basin', 'denver-julesburg', 'wattenberg'],
  },
  {
    name: 'Western Canada',
    locations: [
      'Calgary, AB, Canada', 'Edmonton, AB, Canada', 'Fort McMurray, AB, Canada',
      'Regina, SK, Canada',
    ],
    keywords: ['calgary', 'alberta', 'canada', 'edmonton'],
  },
  {
    name: 'Latin America',
    locations: [
      'Rio de Janeiro, Brazil', 'São Paulo, Brazil', 'Mexico City, Mexico',
      'Bogotá, Colombia', 'Buenos Aires, Argentina',
    ],
    keywords: ['brazil', 'mexico', 'colombia', 'latin', 'rio'],
  },
];

// ---------------------------------------------------------------------------
// Country name extraction — handles human-readable location strings like
// "Houston, TX, United States" or "Riyadh, Saudi Arabia". Mirrors the country
// name mappings in src/utils/locationParser.js but applied to formatted strings.
// ---------------------------------------------------------------------------

/**
 * Extract a country name from a human-readable location string.
 * Handles patterns like "City, ST, Country", "City, Country", "City, ST".
 *
 * @param {string} location - Human-readable location string
 * @returns {string|null} Country name or null
 */
function extractCountryFromFormatted(location) {
  if (!location || !location.trim()) return null;

  const parts = location.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  // Known countries — used to identify the last segment when it matches
  const knownCountries = new Set([
    'United States', 'Canada', 'United Kingdom', 'Australia', 'New Zealand',
    'Norway', 'France', 'Germany', 'Italy', 'Spain', 'Netherlands', 'Belgium',
    'Sweden', 'Denmark', 'Finland', 'Poland', 'Portugal', 'Switzerland', 'Austria',
    'India', 'China', 'Japan', 'South Korea', 'Singapore', 'Malaysia', 'Indonesia',
    'Thailand', 'Philippines', 'Vietnam',
    'Brazil', 'Mexico', 'Colombia', 'Argentina', 'Chile', 'Peru', 'Venezuela',
    'Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Oman', 'Bahrain',
    'Israel', 'Turkey', 'Egypt', 'Nigeria', 'Kenya', 'South Africa', 'Morocco',
    'Jordan',
  ]);

  // US state abbreviations (2 chars) — if the last part is a state abbr,
  // the location is US; if the last part is a known country, return it.
  const usStateAbbrs = new Set([
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
    'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
    'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
    'TX','UT','VT','VA','WA','WV','WI','WY',
  ]);

  const last = parts[parts.length - 1];

  // Explicit known country in last segment
  if (knownCountries.has(last)) return last;

  // US state abbreviation in last position → United States
  if (usStateAbbrs.has(last.toUpperCase())) return 'United States';

  // "City, ST" pattern where ST is a 2-char US state
  if (parts.length === 2 && last.length === 2 && usStateAbbrs.has(last.toUpperCase())) {
    return 'United States';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Region matching — mirrors the keyword/location matching in getRegionLocations()
// from src/utils/energyRegions.js, applied to a single raw location string.
// ---------------------------------------------------------------------------

/**
 * Find the energy region name for a human-readable location string.
 *
 * @param {string} location - Human-readable location string
 * @returns {string|null} Region name (e.g. 'Gulf of Mexico') or null
 */
function findRegionForLocation(location) {
  if (!location || !location.trim()) return null;

  const locationLower = location.toLowerCase();

  for (const region of ALL_ENERGY_REGIONS) {
    // Check explicit city names from the region's locations list
    const matchesExplicit = region.locations.some(regionLoc => {
      const cityName = regionLoc.split(',')[0].trim().toLowerCase();
      const pattern = new RegExp(`(^|[\\s-])${cityName}([\\s,-]|$)`, 'i');
      return pattern.test(location);
    });

    if (matchesExplicit) return region.name;

    // Check keywords
    const matchesKeyword = region.keywords?.some(keyword => {
      const keywordLower = keyword.toLowerCase();
      if (keywordLower.includes(' ')) {
        return locationLower.includes(keywordLower);
      }
      const pattern = new RegExp(`(^|[\\s-])${keywordLower}([\\s,-]|$)`, 'i');
      return pattern.test(location);
    });

    if (matchesKeyword) return region.name;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a raw job record into focus market, region, and country dimensions.
 *
 * @param {{ title?: string, description?: string, location?: string }} job
 * @returns {{ focusMarketSlug: string|null, focusMarketLabel: string|null,
 *             regionName: string|null, country: string|null }}
 */
export function classifyJob(job) {
  const title = job.title || '';
  const description = job.description || '';
  const location = job.location || '';

  let focusMarketSlug = null;
  let focusMarketLabel = null;
  try {
    focusMarketSlug = classifyFocusMarket(title, description) || null;
    if (focusMarketSlug) {
      focusMarketLabel = getMarketLabel(focusMarketSlug);
    }
  } catch {
    focusMarketSlug = null;
    focusMarketLabel = null;
  }

  let regionName = null;
  let country = null;
  try {
    regionName = findRegionForLocation(location) || null;
  } catch {
    regionName = null;
  }
  try {
    country = extractCountryFromFormatted(location) || null;
  } catch {
    country = null;
  }

  return { focusMarketSlug, focusMarketLabel, regionName, country };
}
