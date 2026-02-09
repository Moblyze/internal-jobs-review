/**
 * Location Parser Utility
 *
 * Parses various location formats into clean, human-readable formats.
 * Uses geocoded data from Mapbox for accurate location information.
 *
 * Handles patterns like:
 * - "locations\nIT-FI-FLORENCE-VIA FELICE MATTEUCCI 2" → "Florence, Italy"
 * - "US-TX-HOUSTON-2001 RANKIN ROAD" → "Houston, TX"
 * - "Houston" → "Houston"
 * - Multiple locations separated by newlines
 */

// Cache for geocoded data (loaded once, asynchronously on first use)
let geocodedCache = null
let geocodedCachePromise = null

/**
 * Load geocoded data cache (async, called once)
 */
function loadGeocodedCache() {
  if (geocodedCache !== null) {
    return Promise.resolve(geocodedCache)
  }

  if (geocodedCachePromise) {
    return geocodedCachePromise
  }

  geocodedCachePromise = fetch(`${import.meta.env.BASE_URL}data/locations-geocoded.json`)
    .then(response => {
      if (response.ok) {
        return response.json()
      }
      console.info('Geocoded locations not yet generated, using fallback parser')
      return {}
    })
    .then(data => {
      geocodedCache = data
      if (Object.keys(data).length > 0) {
        console.log(`Loaded ${Object.keys(data).length} geocoded locations`)
      }
      return data
    })
    .catch(error => {
      console.warn('Could not load geocoded data, using fallback parser')
      geocodedCache = {}
      return {}
    })

  return geocodedCachePromise
}

/**
 * Try to format location using geocoded data
 */
function tryGeocoded(locationStr) {
  if (!geocodedCache || Object.keys(geocodedCache).length === 0) {
    return null
  }

  const cleanedStr = locationStr.replace(/^locations\s*/i, '').trim()
  const geo = geocodedCache[cleanedStr]

  if (!geo) {
    return null
  }

  const { city, state, stateCode, country, countryCode } = geo

  // Handle state-wide locations (city is null, e.g., "OTHER TEXAS" → "Texas")
  if (!city && state && countryCode === 'US') {
    return state
  }

  if (!city && state && countryCode === 'CA') {
    return `${state}, Canada`
  }

  // Format based on country conventions
  if (countryCode === 'US' && city && stateCode) {
    return `${city}, ${stateCode}`
  }

  if (countryCode === 'CA' && city && stateCode) {
    return `${city}, ${stateCode}, Canada`
  }

  if (countryCode === 'BR' && city && state) {
    // Avoid duplication for Rio de Janeiro, Rio de Janeiro, Brazil
    if (city.toLowerCase() === state.toLowerCase()) {
      return `${city}, Brazil`
    }
    return `${city}, ${state}, Brazil`
  }

  if (countryCode === 'GB' && city) {
    return `${city}, United Kingdom`
  }

  if (countryCode === 'IN' && city && state) {
    // Avoid duplication when city and state have the same name
    if (city.toLowerCase() === state.toLowerCase()) {
      return `${city}, India`
    }
    return `${city}, ${state}, India`
  }

  // Avoid duplication when city and state have the same name (e.g., Paris, Paris, France)
  if (city && state && country) {
    if (city.toLowerCase() === state.toLowerCase()) {
      return `${city}, ${country}`
    }
    return `${city}, ${state}, ${country}`
  }

  if (city && country) {
    return `${city}, ${country}`
  }

  if (geo.mapboxPlaceName) {
    return geo.mapboxPlaceName
  }

  return null
}

// Start loading geocoded data immediately (background load)
loadGeocodedCache()

// Italian province codes (not in standard ISO state codes)
const IT_PROVINCE_CODES = {
  'FI': 'Florence',
  'MI': 'Milan',
  'RM': 'Rome',
  'NA': 'Naples',
  'TO': 'Turin'
};

// Mexican state codes (custom codes used in data)
const MX_STATE_CODES = {
  'DF': 'Mexico City',
  'CDMX': 'Mexico City'
};

/**
 * Capitalizes the first letter of each word in a string
 */
function titleCase(str) {
  return str
    .toLowerCase()
    .split(/[\s-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Cleans up a city name by removing extra info and formatting properly
 */
function cleanCityName(city) {
  // Remove anything in parentheses (e.g., "London (Sutton)" → "London")
  city = city.replace(/\s*\([^)]*\)/g, '');

  // Remove "OTHER" prefix at the beginning (e.g., "OTHER TEXAS" → "TEXAS")
  city = city.replace(/^OTHER\s+/i, '');

  // Remove common building/facility names with hyphen
  city = city.replace(/\s*-\s*(VENTURA|RETIC|OTHER).*$/i, '');

  // Title case the result
  return titleCase(city.trim());
}

/**
 * Parses a single location string and returns formatted location with metadata
 *
 * @param {string} locationStr - Raw location string
 * @returns {Object|string|null} - Object with {formatted, metadata} or string for backward compatibility
 */
function parseLocation(locationStr, includeMetadata = false) {
  if (!locationStr) return null;

  // Remove "locations" and "Location:" prefixes and trim
  locationStr = locationStr.replace(/^locations\s*/i, '').replace(/^Location:\s*/i, '').trim();

  // If it's empty after cleanup, return null
  if (!locationStr) return null;

  // Try geocoded data first (if loaded)
  const geocoded = tryGeocoded(locationStr);
  if (geocoded) {
    if (includeMetadata) {
      // If we need metadata, we'll need to extract it from geocodedCache
      const geo = geocodedCache[locationStr];
      return {
        formatted: geocoded,
        metadata: {
          countryCode: geo.countryCode,
          countryName: geo.country,
          stateCode: geo.stateCode,
          stateName: geo.state,
          cityName: geo.city,
          coordinates: geo.coordinates,
          parsed: true,
          source: 'geocoded'
        }
      };
    }
    return geocoded;
  }

  // Check for special cases that don't need parsing
  const specialCases = [
    'Global Recruiting',
    'Gulf of Mexico',
    'Noble Interceptor'
  ];

  for (const specialCase of specialCases) {
    if (locationStr.toLowerCase().includes(specialCase.toLowerCase())) {
      if (includeMetadata) {
        return {
          formatted: specialCase,
          metadata: { special: true, originalText: specialCase }
        };
      }
      return specialCase;
    }
  }

  // Pattern 1: COUNTRY-STATE-CITY-ADDRESS
  // Examples:
  // - "IT-FI-FLORENCE-VIA FELICE MATTEUCCI 2"
  // - "US-TX-HOUSTON-2001 RANKIN ROAD"
  // - "BR-RJ-RIO DE JANEIRO-VENTURA-AV REPUBLICA DO CHILE 330"
  let locationMatch = locationStr.match(/^([A-Z]{2})-([A-Z]{2,4})-([^-]+?)(?:-(.+))?$/i);

  // Pattern 2: COUNTRY-CITY-ADDRESS (no state code)
  // Examples:
  // - "AE-ABU DHABI-AL GHAITH HOLDING TOWER, AIRPORT ROAD"
  if (!locationMatch) {
    locationMatch = locationStr.match(/^([A-Z]{2})-([^-]+?)(?:-(.+))?$/i);
    if (locationMatch) {
      // Add null for state code to keep array structure consistent
      locationMatch = [locationMatch[0], locationMatch[1], null, locationMatch[2], locationMatch[3]];
    }
  }

  if (locationMatch) {
    const [, countryCode, stateCode, cityRaw] = locationMatch;
    const city = cleanCityName(cityRaw);

    // Comprehensive country name mapping (ISO 3166-1 alpha-2)
    const countryNames = {
      // Major countries
      'US': 'United States',
      'CA': 'Canada',
      'GB': 'United Kingdom',
      'AU': 'Australia',
      'NZ': 'New Zealand',

      // Europe
      'AT': 'Austria',
      'BE': 'Belgium',
      'BG': 'Bulgaria',
      'HR': 'Croatia',
      'CY': 'Cyprus',
      'CZ': 'Czech Republic',
      'DK': 'Denmark',
      'EE': 'Estonia',
      'FI': 'Finland',
      'FR': 'France',
      'DE': 'Germany',
      'GR': 'Greece',
      'HU': 'Hungary',
      'IE': 'Ireland',
      'IT': 'Italy',
      'LV': 'Latvia',
      'LT': 'Lithuania',
      'LU': 'Luxembourg',
      'MT': 'Malta',
      'NL': 'Netherlands',
      'NO': 'Norway',
      'PL': 'Poland',
      'PT': 'Portugal',
      'RO': 'Romania',
      'SK': 'Slovakia',
      'SI': 'Slovenia',
      'ES': 'Spain',
      'SE': 'Sweden',
      'CH': 'Switzerland',

      // Americas
      'AR': 'Argentina',
      'BR': 'Brazil',
      'CL': 'Chile',
      'CO': 'Colombia',
      'MX': 'Mexico',
      'PE': 'Peru',
      'VE': 'Venezuela',

      // Asia
      'CN': 'China',
      'IN': 'India',
      'ID': 'Indonesia',
      'JP': 'Japan',
      'MY': 'Malaysia',
      'PH': 'Philippines',
      'SG': 'Singapore',
      'KR': 'South Korea',
      'TH': 'Thailand',
      'VN': 'Vietnam',

      // Middle East
      'AE': 'United Arab Emirates',
      'BH': 'Bahrain',
      'IL': 'Israel',
      'JO': 'Jordan',
      'KW': 'Kuwait',
      'OM': 'Oman',
      'QA': 'Qatar',
      'SA': 'Saudi Arabia',
      'TR': 'Turkey',

      // Africa
      'EG': 'Egypt',
      'KE': 'Kenya',
      'MA': 'Morocco',
      'NG': 'Nigeria',
      'ZA': 'South Africa'
    };

    const countryName = countryNames[countryCode?.toUpperCase()] || null;

    // US state names mapping (for detecting state-wide locations)
    const usStateNames = {
      'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
      'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
      'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
      'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
      'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
      'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
      'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
      'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
      'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
      'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
      'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
      'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
      'WI': 'Wisconsin', 'WY': 'Wyoming'
    };

    // Check if the cleaned city name matches the state name (indicates state-wide location)
    const isStateWideLocation = stateCode &&
      usStateNames[stateCode.toUpperCase()] &&
      city.toLowerCase() === usStateNames[stateCode.toUpperCase()].toLowerCase();

    // Build metadata object (only if requested)
    const metadata = includeMetadata ? {
      countryCode: countryCode ? countryCode.toUpperCase() : null,
      countryName: countryName,
      stateCode: stateCode ? stateCode.toUpperCase() : null,
      stateName: stateCode && usStateNames[stateCode.toUpperCase()] ? usStateNames[stateCode.toUpperCase()] : null,
      cityName: isStateWideLocation ? null : city,
      coordinates: null, // Not available without geocoded data
      parsed: true,
      source: 'fallback'
    } : null;

    // Format output based on country conventions
    let formatted;

    // Handle state-wide US locations (e.g., "OTHER TEXAS" → "Texas")
    if (isStateWideLocation && countryCode && countryCode.toUpperCase() === 'US') {
      formatted = city; // Just show state name (already title-cased)
    } else if (countryCode && countryCode.toUpperCase() === 'US' && stateCode) {
      // US locations: "City, ST"
      formatted = `${city}, ${stateCode.toUpperCase()}`;
    } else if (countryCode && countryCode.toUpperCase() === 'CA' && stateCode) {
      // Canadian locations: "City, AB, Canada"
      formatted = `${city}, ${stateCode.toUpperCase()}, Canada`;
    } else if (countryCode && countryCode.toUpperCase() === 'BR' && stateCode) {
      // Brazilian locations: "City, Brazil" (no state name available)
      formatted = `${city}, Brazil`;
    } else if (countryCode && stateCode && countryCode.toUpperCase() === 'MX' && MX_STATE_CODES[stateCode.toUpperCase()]) {
      // Mexican locations: "City, Mexico"
      formatted = `${city}, Mexico`;
    } else if (countryCode && stateCode && countryCode.toUpperCase() === 'IT' && IT_PROVINCE_CODES[stateCode.toUpperCase()]) {
      // Italian locations: "City, Italy"
      formatted = `${city}, Italy`;
    } else if (countryName) {
      // Other international locations: "City, Country"
      formatted = `${city}, ${countryName}`;
    } else {
      // Fallback if country not found
      formatted = city;
    }

    return includeMetadata ? { formatted, metadata } : formatted;
  }

  // Pattern 3: "City, Full State Name" (e.g., "Houston, Texas")
  const cityStateMatch = locationStr.match(/^([^,]+),\s*([A-Za-z\s]+)$/);
  if (cityStateMatch) {
    const [, cityRaw, stateOrCountryRaw] = cityStateMatch;
    const city = titleCase(cityRaw.trim());
    const stateOrCountry = titleCase(stateOrCountryRaw.trim());

    // Simple US state name to code mapping for common cases
    const usStateMap = {
      'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
      'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
      'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
      'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
      'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
      'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
      'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
      'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
      'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
      'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
      'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
      'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
      'Wisconsin': 'WI', 'Wyoming': 'WY'
    };

    const stateCode = usStateMap[stateOrCountry];
    if (stateCode) {
      // Found US state - format as "City, ST"
      const formatted = `${city}, ${stateCode}`;
      if (includeMetadata) {
        return {
          formatted,
          metadata: {
            countryCode: 'US',
            countryName: 'United States',
            stateCode: stateCode,
            stateName: stateOrCountry,
            cityName: city,
            coordinates: null,
            parsed: true,
            source: 'fallback'
          }
        };
      }
      return formatted;
    }

    // Not a US state - return as-is
    const formatted = `${city}, ${stateOrCountry}`;
    if (includeMetadata) {
      return {
        formatted,
        metadata: {
          cityName: city,
          parsed: false,
          originalText: locationStr,
          source: 'fallback'
        }
      };
    }
    return formatted;
  }

  // Pattern 4: "City, ST" (already abbreviated state or country code)
  const cityAbbrMatch = locationStr.match(/^([^,]+),\s*([A-Z]{2})$/);
  if (cityAbbrMatch) {
    const [, cityRaw, stateAbbr] = cityAbbrMatch;
    const city = titleCase(cityRaw.trim());

    // Valid US state codes
    const usStateCodes = new Set([
      'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
      'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
      'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
      'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
      'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
    ]);

    // Common international country codes (ISO 3166-1 alpha-2)
    const countryCodes = {
      'AE': 'United Arab Emirates',
      'AU': 'Australia',
      'BR': 'Brazil',
      'CA': 'Canada',
      'CN': 'China',
      'DE': 'Germany',
      'FR': 'France',
      'GB': 'United Kingdom',
      'IN': 'India',
      'IT': 'Italy',
      'JP': 'Japan',
      'MX': 'Mexico',
      'MY': 'Malaysia',
      'NL': 'Netherlands',
      'NO': 'Norway',
      'PT': 'Portugal',
      'SG': 'Singapore',
      'TR': 'Turkey',
      'US': 'United States'
    };

    if (usStateCodes.has(stateAbbr.toUpperCase())) {
      // US state
      const formatted = `${city}, ${stateAbbr.toUpperCase()}`;
      if (includeMetadata) {
        return {
          formatted,
          metadata: {
            countryCode: 'US',
            countryName: 'United States',
            stateCode: stateAbbr.toUpperCase(),
            stateName: null,
            cityName: city,
            coordinates: null,
            parsed: true,
            source: 'fallback'
          }
        };
      }
      return formatted;
    }

    // Check if it's a country code
    const countryName = countryCodes[stateAbbr.toUpperCase()];
    if (countryName) {
      const formatted = `${city}, ${countryName}`;
      if (includeMetadata) {
        return {
          formatted,
          metadata: {
            countryCode: stateAbbr.toUpperCase(),
            countryName: countryName,
            stateCode: null,
            stateName: null,
            cityName: city,
            coordinates: null,
            parsed: true,
            source: 'fallback'
          }
        };
      }
      return formatted;
    }

    // Not a recognized state or country - return as-is
    const formatted = `${city}, ${stateAbbr}`;
    if (includeMetadata) {
      return {
        formatted,
        metadata: {
          cityName: city,
          parsed: false,
          originalText: locationStr,
          source: 'fallback'
        }
      };
    }
    return formatted;
  }

  // Pattern 5: Just city name - return as-is (no library lookup)
  if (/^[A-Za-z\s]+$/.test(locationStr) && !locationStr.includes('\n')) {
    const city = titleCase(locationStr);

    // Return as-is - if this is a valid location, it should be in geocoded data
    if (includeMetadata) {
      return {
        formatted: city,
        metadata: {
          cityName: city,
          parsed: false,
          originalText: locationStr,
          source: 'fallback'
        }
      };
    }
    return city;
  }

  // If all else fails, return the original (cleaned)
  if (includeMetadata) {
    return {
      formatted: locationStr,
      metadata: { parsed: false, originalText: locationStr, source: 'fallback' }
    };
  }
  return locationStr;
}

/**
 * Main export: Parses location string(s) into human-readable format
 *
 * @param {string} location - Raw location string from job data
 * @returns {string|null} - Formatted location or null if invalid
 */
export function formatLocation(location) {
  if (!location) return null;

  // Handle multiple locations separated by newlines
  const locations = location.split('\n').filter(loc => {
    const trimmed = loc.trim();
    return trimmed && trimmed.toLowerCase() !== 'locations';
  });

  if (locations.length === 0) return null;

  // Parse each location
  const parsedLocations = locations
    .map(loc => parseLocation(loc))
    .filter(Boolean);

  if (parsedLocations.length === 0) return null;

  // If multiple locations, show the first one with indicator
  if (parsedLocations.length > 1) {
    return `${parsedLocations[0]} +${parsedLocations.length - 1} more`;
  }

  return parsedLocations[0];
}

/**
 * Gets all locations as an array (for displaying on company pages)
 *
 * @param {string} location - Raw location string from job data
 * @returns {string[]} - Array of formatted locations
 */
export function getAllLocations(location) {
  if (!location) return [];

  // Handle multiple locations separated by newlines
  const locations = location.split('\n').filter(loc => {
    const trimmed = loc.trim();
    return trimmed && trimmed.toLowerCase() !== 'locations';
  });

  // Parse each location
  return locations
    .map(loc => parseLocation(loc, false))
    .filter(Boolean);
}

/**
 * Gets location with geographic metadata (country, state, coordinates)
 *
 * @param {string} location - Raw location string from job data
 * @returns {Object|null} - Object with {formatted, metadata} or null if invalid
 *
 * Example return:
 * {
 *   formatted: "Houston, TX",
 *   metadata: {
 *     countryCode: "US",
 *     countryName: "United States",
 *     stateCode: "TX",
 *     stateName: "Texas",
 *     cityName: "Houston",
 *     coordinates: { latitude: 29.7604, longitude: -95.3698 },
 *     parsed: true
 *   }
 * }
 */
export function getLocationWithMetadata(location) {
  if (!location) return null;

  // Handle multiple locations - return first one with metadata
  const locations = location.split('\n').filter(loc => {
    const trimmed = loc.trim();
    return trimmed && trimmed.toLowerCase() !== 'locations';
  });

  if (locations.length === 0) return null;

  // Parse first location with metadata
  const result = parseLocation(locations[0], true);

  // If multiple locations, add count to metadata
  if (result && locations.length > 1) {
    result.metadata.additionalLocations = locations.length - 1;
  }

  return result;
}

/**
 * Gets all locations with metadata as an array
 *
 * @param {string} location - Raw location string from job data
 * @returns {Object[]} - Array of location objects with {formatted, metadata}
 */
export function getAllLocationsWithMetadata(location) {
  if (!location) return [];

  // Handle multiple locations separated by newlines
  const locations = location.split('\n').filter(loc => {
    const trimmed = loc.trim();
    return trimmed && trimmed.toLowerCase() !== 'locations';
  });

  // Parse each location with metadata
  return locations
    .map(loc => parseLocation(loc, true))
    .filter(Boolean);
}
