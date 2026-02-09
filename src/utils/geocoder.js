/**
 * Automatic Location Geocoding Utility
 *
 * Automatically geocodes new locations when jobs are refreshed.
 * Uses Mapbox API to get accurate coordinates and location data.
 * Updates locations-geocoded.json incrementally (only new locations).
 */

const MAPBOX_BASE_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places';
const RATE_LIMIT_DELAY = 100; // 100ms between requests (safe under 600/min limit)

/**
 * Sleep utility for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse Mapbox geocoding response into structured location data
 */
function parseMapboxResponse(feature, originalQuery) {
  const { place_name, center, context, place_type, text } = feature;

  // Extract coordinates
  const coordinates = {
    longitude: center[0],
    latitude: center[1]
  };

  // Initialize location components
  let city = null;
  let state = null;
  let stateCode = null;
  let country = null;
  let countryCode = null;

  // Extract city from place_name or text
  if (place_type.includes('place') || place_type.includes('locality')) {
    city = text;
  }

  // Parse context for additional details
  if (context && Array.isArray(context)) {
    context.forEach(item => {
      const id = item.id || '';

      if (id.startsWith('place.')) {
        city = city || item.text;
      } else if (id.startsWith('region.')) {
        state = item.text;
        // Extract state code if available
        if (item.short_code) {
          const parts = item.short_code.split('-');
          stateCode = parts.length > 1 ? parts[1].toUpperCase() : null;
        }
      } else if (id.startsWith('country.')) {
        country = item.text;
        // Country code is in short_code (e.g., "us", "gb")
        if (item.short_code) {
          countryCode = item.short_code.toUpperCase();
        }
      }
    });
  }

  // Handle case where the feature itself is a region/state
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

/**
 * Geocode a single location using Mapbox API
 */
async function geocodeLocation(locationQuery, accessToken) {
  if (!locationQuery || !accessToken) {
    return null;
  }

  try {
    // Clean up location query
    const cleanQuery = locationQuery
      .replace(/^locations\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanQuery) {
      return null;
    }

    // Build URL with proper encoding
    const encodedQuery = encodeURIComponent(cleanQuery);
    const url = `${MAPBOX_BASE_URL}/${encodedQuery}.json?access_token=${accessToken}&limit=1`;

    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Geocoding API error (${response.status}) for: ${cleanQuery}`);
      return null;
    }

    const data = await response.json();

    if (!data.features || data.features.length === 0) {
      console.warn(`No geocoding results for: ${cleanQuery}`);
      return null;
    }

    const feature = data.features[0];
    return parseMapboxResponse(feature, cleanQuery);

  } catch (error) {
    console.error(`Error geocoding: ${locationQuery}`, error.message);
    return null;
  }
}

/**
 * Extract unique locations from jobs data
 */
function extractUniqueLocations(jobs) {
  const locationSet = new Set();

  jobs.forEach(job => {
    if (job.location) {
      // Handle both simple strings and multi-line locations
      const locations = job.location.split('\n');
      locations.forEach(loc => {
        const cleaned = loc.replace(/^locations\s*/i, '').trim();
        if (cleaned && cleaned.toLowerCase() !== 'locations') {
          locationSet.add(cleaned);
        }
      });
    }
  });

  return Array.from(locationSet);
}

/**
 * Load existing geocoded data
 */
async function loadExistingGeocodedData() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/locations-geocoded.json`);
    if (!response.ok) {
      return {};
    }
    return await response.json();
  } catch (error) {
    console.warn('Could not load existing geocoded data:', error.message);
    return {};
  }
}

/**
 * Save geocoded data back to the file via Vite dev server API
 */
async function saveGeocodedData(data) {
  try {
    const response = await fetch('/api/geocode/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`Failed to save geocoded data: ${response.status}`);
    }

    const result = await response.json();
    console.log(`✅ Saved ${result.count} geocoded locations`);
    return result;
  } catch (error) {
    console.error('Error saving geocoded data:', error.message);
    console.warn('Note: Geocoding API only works in development mode (npm run dev)');
    throw error;
  }
}

/**
 * Main geocoding function - geocode new locations from jobs
 *
 * @param {Array} jobs - Array of job objects
 * @param {Function} onProgress - Optional callback for progress updates (current, total, location)
 * @returns {Object} Result with {newLocations, failed, totalGeocodedCount}
 */
export async function geocodeNewLocations(jobs, onProgress = null) {
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;

  if (!mapboxToken) {
    console.error('VITE_MAPBOX_TOKEN not found in environment');
    return { newLocations: 0, failed: 0, totalGeocodedCount: 0, error: 'Missing Mapbox token' };
  }

  try {
    // Extract unique locations from jobs
    const allLocations = extractUniqueLocations(jobs);

    // Load existing geocoded data
    const existingData = await loadExistingGeocodedData();
    const existingCount = Object.keys(existingData).length;

    // Filter out already geocoded locations
    const locationsToGeocode = allLocations.filter(loc => !existingData[loc]);

    if (locationsToGeocode.length === 0) {
      return {
        newLocations: 0,
        failed: 0,
        totalGeocodedCount: existingCount,
        message: 'All locations already geocoded'
      };
    }

    // Geocode new locations with rate limiting
    const results = { ...existingData };
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < locationsToGeocode.length; i++) {
      const location = locationsToGeocode[i];

      // Call progress callback if provided
      if (onProgress) {
        onProgress(i + 1, locationsToGeocode.length, location);
      }

      const geocoded = await geocodeLocation(location, mapboxToken);

      if (geocoded) {
        results[location] = geocoded;
        succeeded++;
      } else {
        failed++;
      }

      // Rate limiting - wait between requests (except for the last one)
      if (i < locationsToGeocode.length - 1) {
        await sleep(RATE_LIMIT_DELAY);
      }
    }

    // In a real implementation, we'd save to backend here
    // For now, we'll need to download or provide a way to save this
    await saveGeocodedData(results);

    return {
      newLocations: succeeded,
      failed,
      totalGeocodedCount: Object.keys(results).length,
      message: `Geocoded ${succeeded} new location${succeeded !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`
    };

  } catch (error) {
    console.error('Error in geocodeNewLocations:', error);
    return {
      newLocations: 0,
      failed: 0,
      totalGeocodedCount: 0,
      error: error.message
    };
  }
}

/**
 * Check if there are new locations that need geocoding
 *
 * @param {Array} jobs - Array of job objects
 * @returns {Promise<Object>} Object with {hasNewLocations, newLocationCount, totalLocations}
 */
export async function checkForNewLocations(jobs) {
  try {
    const allLocations = extractUniqueLocations(jobs);
    const existingData = await loadExistingGeocodedData();

    const newLocations = allLocations.filter(loc => !existingData[loc]);

    return {
      hasNewLocations: newLocations.length > 0,
      newLocationCount: newLocations.length,
      totalLocations: allLocations.length,
      existingGeocodedCount: Object.keys(existingData).length
    };
  } catch (error) {
    console.error('Error checking for new locations:', error);
    return {
      hasNewLocations: false,
      newLocationCount: 0,
      totalLocations: 0,
      existingGeocodedCount: 0,
      error: error.message
    };
  }
}
