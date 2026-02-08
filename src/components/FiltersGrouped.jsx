import { useState } from 'react'
import { getLocationsInRegion } from '../utils/locationGrouping'

function FiltersGrouped({ filters, onFilterChange, companies, groupedLocations, allLocations, skills }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [expandedCountries, setExpandedCountries] = useState({})
  const [expandedRegions, setExpandedRegions] = useState({})

  const handleFilterToggle = (filterType, value) => {
    const currentValues = filters[filterType] || []
    const newValues = currentValues.includes(value)
      ? currentValues.filter(v => v !== value)
      : [...currentValues, value]

    onFilterChange({ ...filters, [filterType]: newValues })
  }

  const handleRegionToggle = (country, region) => {
    // Get all locations in this region
    const locationsInRegion = getLocationsInRegion(allLocations, country, region)

    // Check if all locations in region are already selected
    const currentLocations = filters.locations || []
    const allSelected = locationsInRegion.every(loc => currentLocations.includes(loc))

    let newLocations
    if (allSelected) {
      // Deselect all locations in region
      newLocations = currentLocations.filter(loc => !locationsInRegion.includes(loc))
    } else {
      // Select all locations in region
      newLocations = [...new Set([...currentLocations, ...locationsInRegion])]
    }

    onFilterChange({ ...filters, locations: newLocations })
  }

  const toggleCountry = (country) => {
    setExpandedCountries({
      ...expandedCountries,
      [country]: !expandedCountries[country]
    })
  }

  const toggleRegion = (country, region) => {
    const key = `${country}-${region}`
    setExpandedRegions({
      ...expandedRegions,
      [key]: !expandedRegions[key]
    })
  }

  const isRegionSelected = (country, region) => {
    const locationsInRegion = getLocationsInRegion(allLocations, country, region)
    const currentLocations = filters.locations || []
    return locationsInRegion.every(loc => currentLocations.includes(loc))
  }

  const isRegionPartiallySelected = (country, region) => {
    const locationsInRegion = getLocationsInRegion(allLocations, country, region)
    const currentLocations = filters.locations || []
    const selectedCount = locationsInRegion.filter(loc => currentLocations.includes(loc)).length
    return selectedCount > 0 && selectedCount < locationsInRegion.length
  }

  const clearFilters = () => {
    onFilterChange({ companies: [], locations: [], skills: [] })
  }

  const activeFilterCount =
    (filters.companies?.length || 0) +
    (filters.locations?.length || 0) +
    (filters.skills?.length || 0)

  const sortedCountries = Object.keys(groupedLocations).sort()

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
        <div className="flex items-center gap-3">
          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              Clear all ({activeFilterCount})
            </button>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="md:hidden text-sm text-gray-600"
          >
            {isExpanded ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <div className={`space-y-4 ${isExpanded ? 'block' : 'hidden'} md:block`}>
        {/* Company Filter */}
        {companies.length > 0 && (
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Company</h3>
            <div className="space-y-2">
              {companies.map(company => (
                <label key={company} className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.companies?.includes(company) || false}
                    onChange={() => handleFilterToggle('companies', company)}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">{company}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Location Filter - Hierarchical */}
        {sortedCountries.length > 0 && (
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Location</h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {sortedCountries.map(country => {
                const regions = groupedLocations[country]
                const sortedRegions = Object.keys(regions).sort()
                const isCountryExpanded = expandedCountries[country]

                return (
                  <div key={country} className="border-l-2 border-gray-200 pl-2">
                    {/* Country Header */}
                    <button
                      onClick={() => toggleCountry(country)}
                      className="flex items-center w-full text-left hover:bg-gray-50 rounded px-2 py-1"
                    >
                      <span className="text-gray-600 mr-2">
                        {isCountryExpanded ? '▼' : '▶'}
                      </span>
                      <span className="font-medium text-sm text-gray-900">{country}</span>
                    </button>

                    {/* Regions */}
                    {isCountryExpanded && (
                      <div className="ml-4 mt-1 space-y-1">
                        {sortedRegions.map(region => {
                          const locations = regions[region]
                          const regionKey = `${country}-${region}`
                          const isRegionExpanded = expandedRegions[regionKey]
                          const regionSelected = isRegionSelected(country, region)
                          const regionPartial = isRegionPartiallySelected(country, region)

                          return (
                            <div key={regionKey} className="border-l-2 border-gray-100 pl-2">
                              {/* Region Header with Checkbox */}
                              <div className="flex items-center">
                                <label className="flex items-center flex-1 cursor-pointer hover:bg-gray-50 rounded px-2 py-1">
                                  <input
                                    type="checkbox"
                                    checked={regionSelected}
                                    ref={input => {
                                      if (input) {
                                        input.indeterminate = regionPartial
                                      }
                                    }}
                                    onChange={() => handleRegionToggle(country, region)}
                                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                  />
                                  <span className="ml-2 text-sm text-gray-700 font-medium">
                                    {region === 'Cities' ? 'All Cities' : region}
                                  </span>
                                  <span className="ml-1 text-xs text-gray-500">
                                    ({locations.length})
                                  </span>
                                </label>
                                {locations.length > 1 && (
                                  <button
                                    onClick={() => toggleRegion(country, region)}
                                    className="px-2 py-1 text-gray-500 hover:bg-gray-50 rounded"
                                  >
                                    {isRegionExpanded ? '▼' : '▶'}
                                  </button>
                                )}
                              </div>

                              {/* Individual Locations */}
                              {isRegionExpanded && locations.length > 1 && (
                                <div className="ml-4 mt-1 space-y-1">
                                  {locations.map(location => (
                                    <label key={location} className="flex items-center cursor-pointer hover:bg-gray-50 rounded px-2 py-1">
                                      <input
                                        type="checkbox"
                                        checked={filters.locations?.includes(location) || false}
                                        onChange={() => handleFilterToggle('locations', location)}
                                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                      />
                                      <span className="ml-2 text-sm text-gray-600">{location}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Skills Filter */}
        {skills.length > 0 && (
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Skills</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {skills.map(skill => (
                <label key={skill} className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.skills?.includes(skill) || false}
                    onChange={() => handleFilterToggle('skills', skill)}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">{skill}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default FiltersGrouped
