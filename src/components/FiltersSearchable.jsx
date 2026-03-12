/**
 * Searchable Filters Component
 *
 * Industry best practice implementation following LinkedIn/Indeed patterns:
 * - Typeahead search for all filters
 * - Multi-select with visual pills
 * - Grouped locations by country
 * - Mobile-friendly design
 */

import { useState, useMemo, useEffect } from 'react'
import Select from 'react-select'
import { createGroupedLocationOptions } from '../utils/locationOptions'
import { createGroupedLocationOptionsWithGeodata, getTopLocationsFormatted } from '../utils/locationGeodata'
import { getTopCompanies, getTopLocations, getTopSkills } from '../hooks/useJobs'
import { TOP_ENERGY_REGIONS, ADDITIONAL_ENERGY_REGIONS, getRegionLocationValues } from '../utils/energyRegions'
import { PRIORITY_MARKET_SLUGS } from '../utils/focusMarkets'

/**
 * Quick select pills component for popular filter options
 */
function QuickSelectPills({ items, selectedItems, onSelect, label }) {
  const [showAll, setShowAll] = useState(false)

  // Show fewer items on mobile (3) vs desktop (5)
  const displayLimit = typeof window !== 'undefined' && window.innerWidth < 768 ? 3 : 5
  const visibleItems = showAll ? items : items.slice(0, displayLimit)
  const hasMore = items.length > displayLimit

  const handlePillClick = (item) => {
    if (selectedItems.includes(item)) {
      // Remove if already selected
      onSelect(selectedItems.filter(i => i !== item))
    } else {
      // Add to selection
      onSelect([...selectedItems, item])
    }
  }

  if (items.length === 0) return null

  return (
    <div className="mb-2">
      <div className="flex flex-wrap gap-2">
        {visibleItems.map((item) => {
          const isSelected = selectedItems.includes(item)
          return (
            <button
              key={item}
              onClick={() => handlePillClick(item)}
              className={`
                px-3 py-1.5 rounded-full text-xs font-medium transition-all
                ${isSelected
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                }
              `}
              title={isSelected ? `Remove ${item}` : `Add ${item}`}
            >
              {item}
            </button>
          )
        })}
        {hasMore && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="px-3 py-1.5 rounded-full text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50"
          >
            +{items.length - displayLimit} more
          </button>
        )}
        {hasMore && showAll && (
          <button
            onClick={() => setShowAll(false)}
            className="px-3 py-1.5 rounded-full text-xs font-medium text-gray-600 hover:text-gray-700 hover:bg-gray-100"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Energy region pills component for major global energy regions
 * Styled consistently with other filter pills (gray theme)
 *
 * Uses region IDs in the filter state instead of expanding all locations.
 * This keeps URLs clean and improves performance.
 */
function EnergyRegionPills({ regions, selectedRegions, onRegionSelect, label }) {
  const [showAll, setShowAll] = useState(false)

  // Show 5 regions initially, expandable
  const displayLimit = 5
  const visibleRegions = showAll ? regions : regions.slice(0, displayLimit)
  const hasMore = regions.length > displayLimit

  const handleRegionClick = (region) => {
    const isSelected = selectedRegions.includes(region.id)

    if (isSelected) {
      // Remove region
      onRegionSelect(selectedRegions.filter(id => id !== region.id))
    } else {
      // Add region
      onRegionSelect([...selectedRegions, region.id])
    }
  }

  if (regions.length === 0) return null

  return (
    <div className="mb-2">
      <div className="flex flex-wrap gap-1.5">
        {visibleRegions.map((region) => {
          const isSelected = selectedRegions.includes(region.id)

          return (
            <button
              key={region.id}
              onClick={() => handleRegionClick(region)}
              className={`
                px-2.5 py-1 rounded-full text-xs font-medium transition-all
                ${isSelected
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                }
              `}
              title={
                isSelected
                  ? `Remove ${region.name} region`
                  : `Select ${region.name} - ${region.description}`
              }
            >
              {region.name}
            </button>
          )
        })}
        {hasMore && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="px-2.5 py-1 rounded-full text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50"
          >
            +{regions.length - displayLimit} more
          </button>
        )}
        {hasMore && showAll && (
          <button
            onClick={() => setShowAll(false)}
            className="px-2.5 py-1 rounded-full text-xs font-medium text-gray-600 hover:text-gray-700 hover:bg-gray-100"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Focus market pills with priority market highlighting
 * Priority markets (NOW active) get an accent ring and "Priority" badge
 */
function FocusMarketPills({ markets, selectedSlugs, onSelect }) {
  const [showAll, setShowAll] = useState(false)

  // Show fewer items on mobile (3) vs desktop (5)
  const displayLimit = typeof window !== 'undefined' && window.innerWidth < 768 ? 3 : 5
  const visibleMarkets = showAll ? markets : markets.slice(0, displayLimit)
  const hasMore = markets.length > displayLimit

  const handlePillClick = (slug) => {
    if (selectedSlugs.includes(slug)) {
      onSelect(selectedSlugs.filter(s => s !== slug))
    } else {
      onSelect([...selectedSlugs, slug])
    }
  }

  if (markets.length === 0) return null

  return (
    <div className="mb-2">
      <div className="flex flex-wrap gap-2">
        {visibleMarkets.map((market) => {
          const isSelected = selectedSlugs.includes(market.slug)
          const isPriority = market.isPriority

          return (
            <button
              key={market.slug}
              onClick={() => handlePillClick(market.slug)}
              className={`
                px-3 py-1.5 rounded-full text-xs font-medium transition-all inline-flex items-center gap-1
                ${isSelected
                  ? isPriority
                    ? 'bg-amber-600 text-white hover:bg-amber-700 ring-1 ring-amber-400'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                  : isPriority
                    ? 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-300'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                }
              `}
              title={
                isSelected
                  ? `Remove ${market.label}`
                  : `Filter by ${market.label} (${market.count} jobs)${isPriority ? ' — Priority market' : ''}`
              }
            >
              {market.label}
              {isPriority && !isSelected && (
                <span className="text-[10px] font-semibold text-amber-600 uppercase">NOW</span>
              )}
            </button>
          )
        })}
        {hasMore && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="px-3 py-1.5 rounded-full text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50"
          >
            +{markets.length - displayLimit} more
          </button>
        )}
        {hasMore && showAll && (
          <button
            onClick={() => setShowAll(false)}
            className="px-3 py-1.5 rounded-full text-xs font-medium text-gray-600 hover:text-gray-700 hover:bg-gray-100"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  )
}

function FiltersSearchable({ filters, onFilterChange, companies, locations, skills, certifications, roles = [], employmentTypes = [], jobs = [], sources = [], profiles = [], focusMarkets = [] }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [locationOptions, setLocationOptions] = useState([])
  const [topLocationsFormatted, setTopLocationsFormatted] = useState([])
  const [topCompanies, setTopCompanies] = useState([])
  const [topSkills, setTopSkills] = useState([])

  // Combine top 5 and additional regions
  const allEnergyRegions = useMemo(
    () => [...TOP_ENERGY_REGIONS, ...ADDITIONAL_ENERGY_REGIONS],
    []
  )

  // Load async filter data on mount
  useEffect(() => {
    async function loadFilterData() {
      try {
        // Use geocoded data for location grouping - pass jobs to extract raw locations
        const options = await createGroupedLocationOptionsWithGeodata(jobs)
        setLocationOptions(options)

        // Get formatted top locations
        const topLocs = await getTopLocationsFormatted(jobs, 10)
        setTopLocationsFormatted(topLocs)

        // Get top companies - show all since we have a manageable number
        const companies = await getTopCompanies(jobs, 50)
        setTopCompanies(companies)

        const skills = await getTopSkills(jobs, 10)
        setTopSkills(skills)
      } catch (error) {
        console.error('Error loading filter data:', error)
        // Fallback to old method
        setLocationOptions(createGroupedLocationOptions(locations))
        getTopLocations(jobs, 10).then(setTopLocationsFormatted).catch(console.error)
        getTopCompanies(jobs, 50).then(setTopCompanies).catch(console.error)
        getTopSkills(jobs, 10).then(setTopSkills).catch(console.error)
      }
    }
    loadFilterData()
  }, [jobs, locations])

  // Create options for react-select
  const companyOptions = useMemo(() =>
    companies.map(company => ({ label: company, value: company })),
    [companies]
  )

  const skillOptions = useMemo(() =>
    skills.map(skill => ({ label: skill, value: skill })),
    [skills]
  )

  const certificationOptions = useMemo(() => {
    // Handle both old format (array of strings) and new format (array of {name, count})
    if (certifications.length === 0) return []

    // Check if new format with counts
    if (typeof certifications[0] === 'object' && 'name' in certifications[0]) {
      return certifications.map(cert => ({
        label: `${cert.name} (${cert.count} ${cert.count === 1 ? 'job' : 'jobs'})`,
        value: cert.name
      }))
    }

    // Fallback to old format
    return certifications.map(cert => ({ label: cert, value: cert }))
  }, [certifications])

  const employmentTypeOptions = useMemo(() =>
    employmentTypes.map(type => ({ label: type, value: type })),
    [employmentTypes]
  )

  const roleOptions = useMemo(() => {
    if (roles.length === 0) return []

    return roles.map(role => ({
      label: `${role.label} (${role.count})`,
      value: role.id
    }))
  }, [roles])

  const sourceOptions = useMemo(() =>
    sources.map(s => ({ label: `${s.name} (${s.count})`, value: s.name })),
    [sources]
  )

  const profileOptions = useMemo(() =>
    profiles.map(p => ({ label: `${p.name} (${p.count})`, value: p.name })),
    [profiles]
  )

  const focusMarketOptions = useMemo(() =>
    focusMarkets.map(m => ({
      label: `${m.label} (${m.count})`,
      value: m.slug,
    })),
    [focusMarkets]
  )

  // Convert selected values to react-select format
  const selectedCompanies = useMemo(() =>
    (filters.companies || []).map(c => ({ label: c, value: c })),
    [filters.companies]
  )

  const selectedLocations = useMemo(() => {
    // Find the full option objects for selected locations
    const flatOptions = locationOptions.flatMap(group => group.options || [])
    return (filters.locations || [])
      .map(loc => {
        // Try to find the full option object first
        const fullOption = flatOptions.find(opt => opt.value === loc)
        if (fullOption) {
          return fullOption
        }
        // Fallback: create a simple option object if not found in options yet
        // This ensures selections are preserved even when options are still loading
        return { label: loc, value: loc }
      })
      .filter(Boolean)
  }, [filters.locations, locationOptions])

  const selectedSkills = useMemo(() =>
    (filters.skills || []).map(s => ({ label: s, value: s })),
    [filters.skills]
  )

  const selectedCertifications = useMemo(() => {
    // Find matching options to preserve the count display
    return (filters.certifications || [])
      .map(certName => {
        const fullOption = certificationOptions.find(opt => opt.value === certName)
        // Fallback to simple option if not found (preserves selection while options load)
        return fullOption || { label: certName, value: certName }
      })
      .filter(Boolean)
  }, [filters.certifications, certificationOptions])

  const selectedEmploymentTypes = useMemo(() =>
    (filters.employmentTypes || []).map(t => ({ label: t, value: t })),
    [filters.employmentTypes]
  )

  const selectedRoles = useMemo(() => {
    return (filters.roles || [])
      .map(roleId => {
        const fullOption = roleOptions.find(opt => opt.value === roleId)
        // Fallback to simple option if not found (preserves selection while options load)
        return fullOption || { label: roleId, value: roleId }
      })
      .filter(Boolean)
  }, [filters.roles, roleOptions])

  const selectedSources = useMemo(() => {
    return (filters.sources || [])
      .map(name => {
        const fullOption = sourceOptions.find(opt => opt.value === name)
        return fullOption || { label: name, value: name }
      })
      .filter(Boolean)
  }, [filters.sources, sourceOptions])

  const selectedProfiles = useMemo(() => {
    return (filters.profiles || [])
      .map(name => {
        const fullOption = profileOptions.find(opt => opt.value === name)
        return fullOption || { label: name, value: name }
      })
      .filter(Boolean)
  }, [filters.profiles, profileOptions])

  const selectedMarkets = useMemo(() => {
    return (filters.market || [])
      .map(slug => {
        const fullOption = focusMarketOptions.find(opt => opt.value === slug)
        return fullOption || { label: slug, value: slug }
      })
      .filter(Boolean)
  }, [filters.market, focusMarketOptions])

  // Custom styles matching Tailwind theme
  const selectStyles = {
    control: (base) => ({
      ...base,
      minHeight: '42px',
      borderColor: '#d1d5db',
      '&:hover': { borderColor: '#9ca3af' },
      boxShadow: 'none',
      '&:focus-within': {
        borderColor: '#3b82f6',
        boxShadow: '0 0 0 1px #3b82f6'
      }
    }),
    multiValue: (base) => ({
      ...base,
      backgroundColor: '#dbeafe',
      borderRadius: '4px'
    }),
    multiValueLabel: (base) => ({
      ...base,
      color: '#1e40af',
      fontSize: '0.875rem'
    }),
    multiValueRemove: (base) => ({
      ...base,
      color: '#1e40af',
      '&:hover': {
        backgroundColor: '#93c5fd',
        color: '#1e3a8a'
      }
    }),
    placeholder: (base) => ({
      ...base,
      color: '#9ca3af',
      fontSize: '0.875rem'
    }),
    input: (base) => ({
      ...base,
      fontSize: '0.875rem'
    }),
    option: (base, state) => {
      return {
        ...base,
        fontSize: '0.875rem',
        backgroundColor: state.isSelected
          ? '#3b82f6'
          : state.isFocused
          ? '#dbeafe'
          : 'white',
        color: state.isSelected ? 'white' : '#111827',
        '&:active': {
          backgroundColor: '#3b82f6'
        }
      }
    },
    groupHeading: (base) => ({
      ...base,
      fontSize: '0.75rem',
      fontWeight: '600',
      color: '#6b7280',
      textTransform: 'uppercase',
      paddingTop: '8px',
      paddingBottom: '4px'
    })
  }

  const handleCompanyChange = (selected) => {
    onFilterChange({
      ...filters,
      companies: selected ? selected.map(opt => opt.value) : []
    })
  }

  const handleLocationChange = (selected) => {
    onFilterChange({
      ...filters,
      locations: selected ? selected.map(opt => opt.value) : []
    })
  }

  const handleSkillChange = (selected) => {
    onFilterChange({
      ...filters,
      skills: selected ? selected.map(opt => opt.value) : []
    })
  }

  const handleCertificationChange = (selected) => {
    onFilterChange({
      ...filters,
      certifications: selected ? selected.map(opt => opt.value) : []
    })
  }

  const handleEmploymentTypeChange = (selected) => {
    onFilterChange({
      ...filters,
      employmentTypes: selected ? selected.map(opt => opt.value) : []
    })
  }

  const handleRoleChange = (selected) => {
    onFilterChange({
      ...filters,
      roles: selected ? selected.map(opt => opt.value) : []
    })
  }

  const handleSourceChange = (selected) => {
    onFilterChange({
      ...filters,
      sources: selected ? selected.map(opt => opt.value) : []
    })
  }

  const handleProfileChange = (selected) => {
    onFilterChange({
      ...filters,
      profiles: selected ? selected.map(opt => opt.value) : []
    })
  }

  const handleMarketChange = (selected) => {
    onFilterChange({
      ...filters,
      market: selected ? selected.map(opt => opt.value) : []
    })
  }

  const clearFilters = () => {
    onFilterChange({ companies: [], locations: [], skills: [], certifications: [], roles: [], employmentTypes: [], sources: [], profiles: [], market: [], showInactive: filters.showInactive })
  }

  const activeFilterCount =
    (filters.companies?.length || 0) +
    (filters.locations?.length || 0) +
    (filters.skills?.length || 0) +
    (filters.certifications?.length || 0) +
    (filters.roles?.length || 0) +
    (filters.employmentTypes?.length || 0) +
    (filters.sources?.length || 0) +
    (filters.profiles?.length || 0) +
    (filters.market?.length || 0)

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
        <div className="flex items-center gap-3">
          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
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
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Company
          </label>
          <QuickSelectPills
            items={topCompanies}
            selectedItems={filters.companies || []}
            onSelect={(newCompanies) => onFilterChange({ ...filters, companies: newCompanies })}
            label="Popular companies"
          />
          {companies.length > 10 && (
            <Select
              isMulti
              value={selectedCompanies}
              onChange={handleCompanyChange}
              options={companyOptions}
              styles={selectStyles}
              placeholder={`Filter ${companyOptions.length} companies...`}
              isClearable={false}
              closeMenuOnSelect={false}
              className="text-sm"
            />
          )}
          {selectedCompanies.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              {selectedCompanies.length} {selectedCompanies.length === 1 ? 'company' : 'companies'} selected
            </p>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-gray-200 my-4"></div>

        {/* Employment Type Filter */}
        {employmentTypeOptions.length > 0 && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Employment Type
              </label>
              <QuickSelectPills
                items={employmentTypes}
                selectedItems={filters.employmentTypes || []}
                onSelect={(newTypes) => onFilterChange({ ...filters, employmentTypes: newTypes })}
                label="Employment types"
              />
              {employmentTypeOptions.length > 5 && (
                <Select
                  isMulti
                  value={selectedEmploymentTypes}
                  onChange={handleEmploymentTypeChange}
                  options={employmentTypeOptions}
                  styles={selectStyles}
                  placeholder={`Filter ${employmentTypeOptions.length} employment types...`}
                  isClearable={false}
                  closeMenuOnSelect={false}
                  className="text-sm"
                />
              )}
              {selectedEmploymentTypes.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {selectedEmploymentTypes.length} {selectedEmploymentTypes.length === 1 ? 'type' : 'types'} selected
                </p>
              )}
            </div>
            {/* Divider */}
            <div className="border-t border-gray-200 my-4"></div>
          </>
        )}

        {/* Location Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Location
          </label>

          {/* Energy Region Pills */}
          <EnergyRegionPills
            regions={allEnergyRegions}
            selectedRegions={filters.regions || []}
            onRegionSelect={(newRegions) => onFilterChange({ ...filters, regions: newRegions })}
            label="Popular regions"
          />

          {/* Location Search Dropdown */}
          <Select
            isMulti
            value={selectedLocations}
            onChange={handleLocationChange}
            options={locationOptions}
            styles={selectStyles}
            placeholder={`Filter ${locationOptions.reduce((sum, group) => sum + (group.options?.length || 0), 0)} locations...`}
            isClearable={false}
            closeMenuOnSelect={false}
            className="text-sm"
          />
          {selectedLocations.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              {selectedLocations.length} {selectedLocations.length === 1 ? 'location' : 'locations'} selected
            </p>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-gray-200 my-4"></div>

        {/* Skills Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Skills
          </label>
          <QuickSelectPills
            items={topSkills}
            selectedItems={filters.skills || []}
            onSelect={(newSkills) => onFilterChange({ ...filters, skills: newSkills })}
            label="Popular skills"
          />
          <Select
            isMulti
            value={selectedSkills}
            onChange={handleSkillChange}
            options={skillOptions}
            styles={selectStyles}
            placeholder={`Filter ${skillOptions.length} skills...`}
            isClearable={false}
            closeMenuOnSelect={false}
            className="text-sm"
          />
          {selectedSkills.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              {selectedSkills.length} {selectedSkills.length === 1 ? 'skill' : 'skills'} selected
            </p>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-gray-200 my-4"></div>

        {/* Role Filter */}
        {roleOptions.length > 0 && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Role
              </label>
              <Select
                isMulti
                value={selectedRoles}
                onChange={handleRoleChange}
                options={roleOptions}
                styles={selectStyles}
                placeholder={`Filter by ${roleOptions.length} roles...`}
                isClearable={false}
                closeMenuOnSelect={false}
                className="text-sm"
              />
              {selectedRoles.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {selectedRoles.length} {selectedRoles.length === 1 ? 'role' : 'roles'} selected
                </p>
              )}
            </div>
            {/* Divider */}
            <div className="border-t border-gray-200 my-4"></div>
          </>
        )}

        {/* Certifications Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Certifications
          </label>
          <Select
            isMulti
            value={selectedCertifications}
            onChange={handleCertificationChange}
            options={certificationOptions}
            styles={selectStyles}
            placeholder={`Filter ${certificationOptions.length} certifications...`}
            isClearable={false}
            closeMenuOnSelect={false}
            className="text-sm"
          />
          {selectedCertifications.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              {selectedCertifications.length} {selectedCertifications.length === 1 ? 'certification' : 'certifications'} selected
            </p>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-gray-200 my-4"></div>

        {/* Source Filter */}
        {sourceOptions.length > 0 && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Source
              </label>
              <Select
                isMulti
                value={selectedSources}
                onChange={handleSourceChange}
                options={sourceOptions}
                styles={selectStyles}
                placeholder={`Filter by ${sourceOptions.length} sources...`}
                isClearable={false}
                closeMenuOnSelect={false}
                className="text-sm"
              />
              {selectedSources.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {selectedSources.length} {selectedSources.length === 1 ? 'source' : 'sources'} selected
                </p>
              )}
            </div>
            {/* Divider */}
            <div className="border-t border-gray-200 my-4"></div>
          </>
        )}

        {/* Focus Market Filter */}
        {focusMarketOptions.length > 0 && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Focus Market
              </label>
              <FocusMarketPills
                markets={focusMarkets}
                selectedSlugs={filters.market || []}
                onSelect={(newMarkets) => onFilterChange({ ...filters, market: newMarkets })}
              />
              {focusMarketOptions.length > 5 && (
                <Select
                  isMulti
                  value={selectedMarkets}
                  onChange={handleMarketChange}
                  options={focusMarketOptions}
                  styles={selectStyles}
                  placeholder={`Filter by ${focusMarketOptions.length} markets...`}
                  isClearable={false}
                  closeMenuOnSelect={false}
                  className="text-sm"
                />
              )}
              {selectedMarkets.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {selectedMarkets.length} {selectedMarkets.length === 1 ? 'market' : 'markets'} selected
                </p>
              )}
            </div>
            {/* Divider */}
            <div className="border-t border-gray-200 my-4"></div>
          </>
        )}

        {/* Profile Filter */}
        {profileOptions.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search Profile
            </label>
            <Select
              isMulti
              value={selectedProfiles}
              onChange={handleProfileChange}
              options={profileOptions}
              styles={selectStyles}
              placeholder={`Filter by ${profileOptions.length} profiles...`}
              isClearable={false}
              closeMenuOnSelect={false}
              className="text-sm"
            />
            {selectedProfiles.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {selectedProfiles.length} {selectedProfiles.length === 1 ? 'profile' : 'profiles'} selected
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default FiltersSearchable
