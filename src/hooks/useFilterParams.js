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
    const showInactive = searchParams.get('showInactive')

    return {
      companies: companies ? companies.split(',').filter(Boolean) : [],
      locations: locations ? locations.split(',').filter(Boolean) : [],
      skills: skills ? skills.split(',').filter(Boolean) : [],
      certifications: certifications ? certifications.split(',').filter(Boolean) : [],
      roles: roles ? roles.split(',').filter(Boolean) : [],
      employmentTypes: employmentTypes ? employmentTypes.split(',').filter(Boolean) : [],
      showInactive: showInactive === 'true'
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
      params.set('employmentTypes', newFilters.employmentTypes.join(','))
    }
    if (newFilters.showInactive) {
      params.set('showInactive', 'true')
    }

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
    params.set('employmentTypes', filters.employmentTypes.join(','))
  }
  if (filters.showInactive) {
    params.set('showInactive', 'true')
  }

  const queryString = params.toString()
  return queryString ? `${baseUrl}?${queryString}` : baseUrl
}
