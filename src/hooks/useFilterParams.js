import { useSearchParams } from 'react-router-dom'
import { useCallback, useMemo } from 'react'

/**
 * Custom hook for managing filter state via URL parameters
 *
 * Supports multiple values per filter using pipe-separated strings (|)
 * Uses pipe delimiter to avoid conflicts with commas in location names (e.g., "Houston, TX")
 * Automatically syncs with URL and provides clean URLs (removes empty params)
 *
 * @returns {Object} { filters, setFilters, resetFilters }
 */
export function useFilterParams() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Parse URL params into filters object
  const filters = useMemo(() => {
    const companies = searchParams.get('companies')
    const locations = searchParams.get('locations')
    const regions = searchParams.get('regions')
    const skills = searchParams.get('skills')
    const certifications = searchParams.get('certifications')
    const roles = searchParams.get('roles')
    const employmentTypes = searchParams.get('employmentTypes')
    const sources = searchParams.get('sources')
    const profiles = searchParams.get('profiles')
    const market = searchParams.get('market')
    const showInactive = searchParams.get('showInactive')
    const appReadyOnly = searchParams.get('appReadyOnly')
    const showAgencyJobs = searchParams.get('showAgencyJobs')
    const subsectors = searchParams.get('subsectors')
    const disciplines = searchParams.get('disciplines')
    const signals = searchParams.get('signals')
    const timeRange = searchParams.get('timeRange') || '30d'
    const feedSearch = searchParams.get('q') || ''

    // Parse using pipe delimiter (|) only — consistent with serialization
    // No comma fallback: values like "Helix Energy Solutions Group, Inc"
    // contain commas that must NOT be treated as delimiters
    const splitParam = (val) => {
      if (!val) return []
      return val.split('|').filter(Boolean)
    }

    return {
      companies: splitParam(companies),
      locations: splitParam(locations),
      skills: splitParam(skills),
      certifications: splitParam(certifications),
      roles: splitParam(roles),
      employmentTypes: splitParam(employmentTypes),
      sources: splitParam(sources),
      profiles: splitParam(profiles),
      market: splitParam(market),
      showInactive: showInactive === 'true',
      appReadyOnly: appReadyOnly === 'true',
      showAgencyJobs: showAgencyJobs === 'true',
      subsectors: splitParam(subsectors),
      disciplines: splitParam(disciplines),
      signals: splitParam(signals),
      timeRange,
      feedSearch,
    }
  }, [searchParams])

  // Update URL params when filters change
  const setFilters = useCallback((newFilters) => {
    const params = new URLSearchParams()

    // Add non-empty filter arrays to URL
    // Use pipe (|) as delimiter to avoid conflicts with commas in location names
    if (newFilters.companies?.length > 0) {
      params.set('companies', newFilters.companies.join('|'))
    }
    if (newFilters.locations?.length > 0) {
      params.set('locations', newFilters.locations.join('|'))
    }
    if (newFilters.regions?.length > 0) {
      params.set('regions', newFilters.regions.join('|'))
    }
    if (newFilters.skills?.length > 0) {
      params.set('skills', newFilters.skills.join('|'))
    }
    if (newFilters.certifications?.length > 0) {
      params.set('certifications', newFilters.certifications.join('|'))
    }
    if (newFilters.roles?.length > 0) {
      params.set('roles', newFilters.roles.join('|'))
    }
    if (newFilters.employmentTypes?.length > 0) {
      params.set('employmentTypes', newFilters.employmentTypes.join('|'))
    }
    if (newFilters.sources?.length > 0) {
      params.set('sources', newFilters.sources.join('|'))
    }
    if (newFilters.profiles?.length > 0) {
      params.set('profiles', newFilters.profiles.join('|'))
    }
    if (newFilters.market?.length > 0) {
      params.set('market', newFilters.market.join('|'))
    }
    if (newFilters.showInactive) {
      params.set('showInactive', 'true')
    }
    if (newFilters.appReadyOnly) {
      params.set('appReadyOnly', 'true')
    }
    if (newFilters.showAgencyJobs) {
      params.set('showAgencyJobs', 'true')
    }
    if (newFilters.subsectors?.length) params.set('subsectors', newFilters.subsectors.join('|'))
    if (newFilters.disciplines?.length) params.set('disciplines', newFilters.disciplines.join('|'))
    if (newFilters.signals?.length) params.set('signals', newFilters.signals.join('|'))
    if (newFilters.timeRange && newFilters.timeRange !== '30d') params.set('timeRange', newFilters.timeRange)
    if (newFilters.feedSearch) params.set('q', newFilters.feedSearch)

    // Update URL and create a new history entry so back button works
    setSearchParams(params)
  }, [setSearchParams])

  // Reset all filters (clears URL params)
  const resetFilters = useCallback(() => {
    setSearchParams({})
  }, [setSearchParams])

  return {
    filters,
    setFilters,
    resetFilters
  }
}

/**
 * Encode a filter value for URL use
 * Handles special characters and ensures URL safety
 */
export function encodeFilterValue(value) {
  return encodeURIComponent(value)
}

/**
 * Decode a filter value from URL
 */
export function decodeFilterValue(value) {
  return decodeURIComponent(value)
}

/**
 * Build a shareable URL with current filters
 * Useful for generating links with pre-applied filters
 */
export function buildFilterUrl(baseUrl, filters) {
  const params = new URLSearchParams()

  // Use pipe (|) as delimiter to avoid conflicts with commas in location names
  if (filters.companies?.length > 0) {
    params.set('companies', filters.companies.join('|'))
  }
  if (filters.locations?.length > 0) {
    params.set('locations', filters.locations.join('|'))
  }
  if (filters.regions?.length > 0) {
    params.set('regions', filters.regions.join('|'))
  }
  if (filters.skills?.length > 0) {
    params.set('skills', filters.skills.join('|'))
  }
  if (filters.certifications?.length > 0) {
    params.set('certifications', filters.certifications.join('|'))
  }
  if (filters.roles?.length > 0) {
    params.set('roles', filters.roles.join('|'))
  }
  if (filters.employmentTypes?.length > 0) {
    params.set('employmentTypes', filters.employmentTypes.join('|'))
  }
  if (filters.sources?.length > 0) {
    params.set('sources', filters.sources.join('|'))
  }
  if (filters.profiles?.length > 0) {
    params.set('profiles', filters.profiles.join('|'))
  }
  if (filters.market?.length > 0) {
    params.set('market', filters.market.join('|'))
  }
  if (filters.showInactive) {
    params.set('showInactive', 'true')
  }
  if (filters.appReadyOnly) {
    params.set('appReadyOnly', 'true')
  }
  if (filters.showAgencyJobs) {
    params.set('showAgencyJobs', 'true')
  }

  const queryString = params.toString()
  return queryString ? `${baseUrl}?${queryString}` : baseUrl
}
