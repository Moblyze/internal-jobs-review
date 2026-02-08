/**
 * Location Parser Utility
 *
 * Parses various location formats into clean, human-readable formats.
 * Uses geocoded data from Mapbox for accurate location information.
 * Falls back to country-state-city library for non-geocoded locations.
 *
 * Handles patterns like:
 * - "locations\nIT-FI-FLORENCE-VIA FELICE MATTEUCCI 2" → "Florence, Italy"
 * - "US-TX-HOUSTON-2001 RANKIN ROAD" → "Houston, TX"
 * - "Houston" → "Houston"
 * - Multiple locations separated by newlines
 */

import { Country, State, City } from 'country-state-city'

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

  geocodedCachePromise = fetch('/data/locations-geocoded.json')
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

  // Remove common building/facility names
  city = city.replace(/\s*-\s*(VENTURA|RETIC|OTHER).*$/i, '');

  // Title case the result
  return titleCase(city.trim());
}

/**
 * Gets country data from country-state-city library
 */
function getCountryByCode(countryCode) {
  return Country.getAllCountries().find(
    country => country.isoCode.toUpperCase() === countryCode.toUpperCase()
  );
}

/**
 * Gets state/region data for a country
 */
function getStateByCode(countryCode, stateCode) {
  const states = State.getStatesOfCountry(countryCode.toUpperCase());
  return states.find(
    state => state.isoCode.toUpperCase() === stateCode.toUpperCase()
  );
}

/**
 * Finds a city by name in a country/state
 */
function findCityByName(cityName, countryCode, stateCode = null) {
  const normalizedSearch = cityName.toLowerCase().trim();

  if (stateCode) {
    const cities = City.getCitiesOfState(countryCode.toUpperCase(), stateCode.toUpperCase());
    return cities.find(city => city.name.toLowerCase() === normalizedSearch);
  } else {
    const cities = City.getCitiesOfCountry(countryCode.toUpperCase());
    return cities.find(city => city.name.toLowerCase() === normalizedSearch);
  }
}

/**
 * Parses a single location string and returns formatted location with metadata
 *
 * @param {string} locationStr - Raw location string
 * @returns {Object|string|null} - Object with {formatted, metadata} or string for backward compatibility
 */
function parseLocation(locationStr, includeMetadata = false) {
  if (!locationStr) return null;

  // Remove "locations" prefix and trim
  locationStr = locationStr.replace(/^locations\s*/i, '').trim();

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

    // Get country data from library
    const country = getCountryByCode(countryCode);
    const countryName = country ? country.name : null;

    // Get state data from library (if stateCode exists)
    const state = stateCode ? getStateByCode(countryCode, stateCode) : null;

    // Try to find city in library for coordinates
    const cityData = findCityByName(city, countryCode, stateCode);

    // Build metadata object (only if requested)
    const metadata = includeMetadata ? {
      countryCode: countryCode.toUpperCase(),
      countryName: countryName,
      stateCode: stateCode ? stateCode.toUpperCase() : null,
      stateName: state ? state.name : null,
      cityName: city,
      coordinates: cityData ? {
        latitude: parseFloat(cityData.latitude),
        longitude: parseFloat(cityData.longitude)
      } : null,
      parsed: true
    } : null;

    // Format output based on country conventions
    let formatted;

    if (countryCode.toUpperCase() === 'US' && state) {
      // US locations: "City, ST"
      formatted = `${city}, ${state.isoCode}`;
    } else if (countryCode.toUpperCase() === 'CA' && state) {
      // Canadian locations: "City, AB, Canada"
      formatted = `${city}, ${state.isoCode}, Canada`;
    } else if (countryCode.toUpperCase() === 'BR' && state) {
      // Brazilian locations: "City, State, Brazil"
      formatted = `${city}, ${state.name}, Brazil`;
    } else if (countryCode.toUpperCase() === 'MX' && MX_STATE_CODES[stateCode.toUpperCase()]) {
      // Mexican locations: "City, Mexico"
      formatted = `${city}, Mexico`;
    } else if (countryCode.toUpperCase() === 'IT' && IT_PROVINCE_CODES[stateCode.toUpperCase()]) {
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
    const stateOrCountry = stateOrCountryRaw.trim();

    // Try to find US state by name
    const usStates = State.getStatesOfCountry('US');
    const usState = usStates.find(s => s.name.toLowerCase() === stateOrCountry.toLowerCase());

    if (usState) {
      // Found US state - format as "City, ST"
      const formatted = `${city}, ${usState.isoCode}`;
      const cityData = findCityByName(city, 'US', usState.isoCode);

      if (includeMetadata) {
        return {
          formatted,
          metadata: {
            countryCode: 'US',
            countryName: 'United States',
            stateCode: usState.isoCode,
            stateName: usState.name,
            cityName: city,
            coordinates: cityData ? {
              latitude: parseFloat(cityData.latitude),
              longitude: parseFloat(cityData.longitude)
            } : null,
            parsed: true
          }
        };
      }
      return formatted;
    }

    // Not a US state - assume it's "City, Country"
    const countries = Country.getAllCountries();
    const country = countries.find(c => c.name.toLowerCase() === stateOrCountry.toLowerCase());

    if (country) {
      const formatted = `${city}, ${country.name}`;
      const cityData = findCityByName(city, country.isoCode);

      if (includeMetadata) {
        return {
          formatted,
          metadata: {
            countryCode: country.isoCode,
            countryName: country.name,
            stateCode: null,
            stateName: null,
            cityName: city,
            coordinates: cityData ? {
              latitude: parseFloat(cityData.latitude),
              longitude: parseFloat(cityData.longitude)
            } : null,
            parsed: true
          }
        };
      }
      return formatted;
    }
  }

  // Pattern 4: "City, ST" (already abbreviated state)
  const cityAbbrMatch = locationStr.match(/^([^,]+),\s*([A-Z]{2})$/);
  if (cityAbbrMatch) {
    const [, cityRaw, stateAbbr] = cityAbbrMatch;
    const city = titleCase(cityRaw.trim());

    // Check if it's a US state abbreviation
    const usState = getStateByCode('US', stateAbbr);
    if (usState) {
      const formatted = `${city}, ${stateAbbr}`;
      const cityData = findCityByName(city, 'US', stateAbbr);

      if (includeMetadata) {
        return {
          formatted,
          metadata: {
            countryCode: 'US',
            countryName: 'United States',
            stateCode: stateAbbr,
            stateName: usState.name,
            cityName: city,
            coordinates: cityData ? {
              latitude: parseFloat(cityData.latitude),
              longitude: parseFloat(cityData.longitude)
            } : null,
            parsed: true
          }
        };
      }
      return formatted;
    }
  }

  // Pattern 5: Just city name - try to find in library
  if (/^[A-Za-z\s]+$/.test(locationStr) && !locationStr.includes('\n')) {
    const city = titleCase(locationStr);

    // Try to find in US cities first (most common)
    const usCities = City.getCitiesOfCountry('US');
    const usCity = usCities.find(c => c.name.toLowerCase() === city.toLowerCase());

    if (usCity) {
      // Found in US - get state info
      const state = getStateByCode('US', usCity.stateCode);
      if (state) {
        const formatted = `${city}, ${state.isoCode}`;

        if (includeMetadata) {
          return {
            formatted,
            metadata: {
              countryCode: 'US',
              countryName: 'United States',
              stateCode: state.isoCode,
              stateName: state.name,
              cityName: city,
              coordinates: {
                latitude: parseFloat(usCity.latitude),
                longitude: parseFloat(usCity.longitude)
              },
              parsed: true
            }
          };
        }
        return formatted;
      }
    }

    // Try UK cities (common for energy/oil industry)
    const ukCities = City.getCitiesOfCountry('GB');
    const ukCity = ukCities.find(c => c.name.toLowerCase() === city.toLowerCase());

    if (ukCity) {
      const formatted = `${city}, United Kingdom`;

      if (includeMetadata) {
        return {
          formatted,
          metadata: {
            countryCode: 'GB',
            countryName: 'United Kingdom',
            stateCode: null,
            stateName: null,
            cityName: city,
            coordinates: {
              latitude: parseFloat(ukCity.latitude),
              longitude: parseFloat(ukCity.longitude)
            },
            parsed: true
          }
        };
      }
      return formatted;
    }

    // Couldn't find city - return as-is
    if (includeMetadata) {
      return {
        formatted: city,
        metadata: {
          cityName: city,
          parsed: false,
          originalText: locationStr
        }
      };
    }
    return city;
  }

  // If all else fails, return the original (cleaned)
  if (includeMetadata) {
    return {
      formatted: locationStr,
      metadata: { parsed: false, originalText: locationStr }
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
