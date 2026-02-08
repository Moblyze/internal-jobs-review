/**
 * Location Options for React-Select
 *
 * Creates searchable dropdown options with hierarchical grouping
 * Uses Mapbox geocoded data via locationParser for accurate country/state/city metadata
 * Groups by "Country - State/Province" (react-select supports one level of grouping)
 */

import { getAllLocationsWithMetadata } from './locationParser.js'

/**
 * Creates react-select grouped options using geocoded metadata
 * Group structure: "Country - State" (e.g., "United States - Texas")
 *
 * @param {string[]} rawLocations - Array of raw location strings from job data
 * @returns {Array} - React-select grouped options
 */
export function createGroupedLocationOptions(rawLocations) {
  // Get all location metadata
  const locationDataMap = new Map()

  rawLocations.forEach(rawLocation => {
    const locationsWithMeta = getAllLocationsWithMetadata(rawLocation)
    locationsWithMeta.forEach(locData => {
      // Use formatted location as key to prevent duplicates
      if (!locationDataMap.has(locData.formatted)) {
        locationDataMap.set(locData.formatted, locData)
      }
    })
  })

  // Build groups by "Country - State"
  const groups = {}

  locationDataMap.forEach((locData) => {
    const { formatted, metadata } = locData

    // Handle special cases (vessels, global recruiting, etc.)
    if (metadata.special) {
      const groupKey = 'Other'
      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push({
        label: formatted,
        value: formatted,
        searchText: formatted.toLowerCase()
      })
      return
    }

    // Handle locations without parsed metadata (fallback)
    if (!metadata.parsed || !metadata.countryName) {
      const groupKey = 'Other'
      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push({
        label: formatted,
        value: formatted,
        searchText: formatted.toLowerCase()
      })
      return
    }

    // Build group key: "Country" or "Country - State"
    const country = metadata.countryName
    const state = metadata.stateName || metadata.stateCode

    let groupKey
    if (state) {
      groupKey = `${country} - ${state}`
    } else {
      groupKey = country
    }

    // Initialize group if needed
    if (!groups[groupKey]) {
      groups[groupKey] = []
    }

    // Add location to group
    const city = metadata.cityName || formatted
    groups[groupKey].push({
      label: formatted,
      value: formatted,
      searchText: `${country} ${state || ''} ${city}`.toLowerCase(),
      metadata // Keep for potential future use
    })
  })

  // Sort group keys
  // Priority: US states first (alphabetically), then other countries (alphabetically), then Other
  const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
    const aIsUS = a.startsWith('United States')
    const bIsUS = b.startsWith('United States')
    const aIsOther = a === 'Other'
    const bIsOther = b === 'Other'

    if (aIsOther) return 1
    if (bIsOther) return -1
    if (aIsUS && !bIsUS) return -1
    if (!aIsUS && bIsUS) return 1
    return a.localeCompare(b)
  })

  // Build react-select grouped options
  const options = sortedGroupKeys.map(groupKey => {
    const cities = groups[groupKey]

    // Sort cities alphabetically
    cities.sort((a, b) => a.label.localeCompare(b.label))

    return {
      label: groupKey,
      options: cities
    }
  })

  return options
}
