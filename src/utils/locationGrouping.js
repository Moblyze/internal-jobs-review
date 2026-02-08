/**
 * Location Grouping Utility
 *
 * Provides hierarchical grouping of locations by country and region.
 * Works with parsed location strings from locationParser.js.
 */

/**
 * Extracts region/state from a parsed location string
 *
 * @param {string} locationStr - Formatted location string (e.g., "Houston, TX" or "Florence, Italy")
 * @returns {object} - { region, country, city, fullLocation }
 */
export function parseLocationRegion(locationStr) {
  if (!locationStr) return null;

  // Handle special cases that don't have regions
  const specialCases = ['Global Recruiting', 'Gulf of Mexico', 'Noble Interceptor'];
  if (specialCases.includes(locationStr)) {
    return {
      region: 'Other',
      country: 'Other',
      city: locationStr,
      fullLocation: locationStr
    };
  }

  // Pattern 1: "City, State" (US without country)
  // Example: "Houston, TX" or "Anchorage, AK"
  const usStateMatch = locationStr.match(/^([^,]+),\s*([A-Z]{2})$/);
  if (usStateMatch) {
    const [, city, state] = usStateMatch;
    return {
      region: state,
      country: 'United States',
      city: city.trim(),
      fullLocation: locationStr
    };
  }

  // Pattern 2: "City, Province, Canada"
  // Example: "Calgary, AB, Canada"
  const canadaMatch = locationStr.match(/^([^,]+),\s*([A-Z]{2}),\s*Canada$/);
  if (canadaMatch) {
    const [, city, province] = canadaMatch;
    return {
      region: province,
      country: 'Canada',
      city: city.trim(),
      fullLocation: locationStr
    };
  }

  // Pattern 3: "City, State, Brazil"
  // Example: "Rio De Janeiro, Rio de Janeiro, Brazil"
  const brazilMatch = locationStr.match(/^([^,]+),\s*([^,]+),\s*Brazil$/);
  if (brazilMatch) {
    const [, city, state] = brazilMatch;
    return {
      region: state.trim(),
      country: 'Brazil',
      city: city.trim(),
      fullLocation: locationStr
    };
  }

  // Pattern 4: "City, Country" (international without state/province)
  // Example: "Florence, Italy" or "Aberdeen, United Kingdom"
  const internationalMatch = locationStr.match(/^([^,]+),\s*(.+)$/);
  if (internationalMatch) {
    const [, city, country] = internationalMatch;
    return {
      region: null, // No region for international locations
      country: country.trim(),
      city: city.trim(),
      fullLocation: locationStr
    };
  }

  // Pattern 5: Single word (simple city name)
  // Example: "Houston" or "Aberdeen"
  if (/^[A-Za-z\s]+$/.test(locationStr)) {
    return {
      region: null,
      country: 'Unknown',
      city: locationStr.trim(),
      fullLocation: locationStr
    };
  }

  // Fallback
  return {
    region: null,
    country: 'Unknown',
    city: locationStr,
    fullLocation: locationStr
  };
}

/**
 * Groups locations by country and region for hierarchical display
 *
 * @param {string[]} locations - Array of formatted location strings
 * @returns {object} - Hierarchical structure: { "United States": { "TX": ["Houston, TX", ...], ... }, ... }
 */
export function groupLocationsByRegion(locations) {
  const grouped = {};

  locations.forEach(location => {
    const parsed = parseLocationRegion(location);
    if (!parsed) return;

    const { country, region, fullLocation } = parsed;

    // Initialize country if not exists
    if (!grouped[country]) {
      grouped[country] = {};
    }

    // For locations without regions (most international), use country as the group
    const groupKey = region || 'Cities';

    // Initialize region if not exists
    if (!grouped[country][groupKey]) {
      grouped[country][groupKey] = [];
    }

    // Add location if not already present
    if (!grouped[country][groupKey].includes(fullLocation)) {
      grouped[country][groupKey].push(fullLocation);
    }
  });

  // Sort locations within each region
  Object.keys(grouped).forEach(country => {
    Object.keys(grouped[country]).forEach(region => {
      grouped[country][region].sort();
    });
  });

  return grouped;
}

/**
 * Gets all locations under a region (e.g., all TX locations)
 *
 * @param {string[]} allLocations - Array of all formatted location strings
 * @param {string} country - Country name (e.g., "United States")
 * @param {string} region - Region name (e.g., "TX")
 * @returns {string[]} - Array of locations in that region
 */
export function getLocationsInRegion(allLocations, country, region) {
  return allLocations.filter(location => {
    const parsed = parseLocationRegion(location);
    if (!parsed) return false;
    return parsed.country === country && parsed.region === region;
  });
}
