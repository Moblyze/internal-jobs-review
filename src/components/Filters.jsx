import { useState } from 'react'
import Select from 'react-select'

function Filters({ filters, onFilterChange, companies, locations, skills }) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Transform arrays into react-select format
  const companyOptions = companies.map(c => ({ value: c, label: c }))
  const locationOptions = locations.map(l => ({ value: l, label: l }))
  const skillOptions = skills.map(s => ({ value: s, label: s }))

  // Transform selected values into react-select format
  const selectedCompanies = (filters.companies || []).map(c => ({ value: c, label: c }))
  const selectedLocations = (filters.locations || []).map(l => ({ value: l, label: l }))
  const selectedSkills = (filters.skills || []).map(s => ({ value: s, label: s }))

  const handleSelectChange = (filterType, selectedOptions) => {
    const values = selectedOptions ? selectedOptions.map(opt => opt.value) : []
    onFilterChange({ ...filters, [filterType]: values })
  }

  const clearFilters = () => {
    onFilterChange({ companies: [], locations: [], skills: [] })
  }

  const activeFilterCount =
    (filters.companies?.length || 0) +
    (filters.locations?.length || 0) +
    (filters.skills?.length || 0)

  // Custom styles for react-select to match Tailwind theme
  const customStyles = {
    control: (base, state) => ({
      ...base,
      minHeight: '38px',
      borderColor: state.isFocused ? '#3b82f6' : '#d1d5db',
      boxShadow: state.isFocused ? '0 0 0 1px #3b82f6' : 'none',
      '&:hover': {
        borderColor: state.isFocused ? '#3b82f6' : '#9ca3af'
      }
    }),
    multiValue: (base) => ({
      ...base,
      backgroundColor: '#dbeafe',
    }),
    multiValueLabel: (base) => ({
      ...base,
      color: '#1e40af',
      fontSize: '0.875rem'
    }),
    multiValueRemove: (base) => ({
      ...base,
      color: '#1e40af',
      ':hover': {
        backgroundColor: '#3b82f6',
        color: 'white',
      },
    }),
    placeholder: (base) => ({
      ...base,
      fontSize: '0.875rem',
      color: '#9ca3af'
    }),
    input: (base) => ({
      ...base,
      fontSize: '0.875rem'
    }),
    option: (base, state) => ({
      ...base,
      fontSize: '0.875rem',
      backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
      color: state.isSelected ? 'white' : '#374151'
    })
  }

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
            <label className="block font-medium text-gray-900 mb-2">
              Company
            </label>
            <Select
              isMulti
              options={companyOptions}
              value={selectedCompanies}
              onChange={(selected) => handleSelectChange('companies', selected)}
              placeholder="Search companies..."
              styles={customStyles}
              classNamePrefix="react-select"
              isClearable={false}
            />
          </div>
        )}

        {/* Location Filter */}
        {locations.length > 0 && (
          <div>
            <label className="block font-medium text-gray-900 mb-2">
              Location
            </label>
            <Select
              isMulti
              options={locationOptions}
              value={selectedLocations}
              onChange={(selected) => handleSelectChange('locations', selected)}
              placeholder="Search locations..."
              styles={customStyles}
              classNamePrefix="react-select"
              isClearable={false}
            />
            {selectedLocations.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {selectedLocations.length} location{selectedLocations.length !== 1 ? 's' : ''} selected
              </p>
            )}
          </div>
        )}

        {/* Skills Filter */}
        {skills.length > 0 && (
          <div>
            <label className="block font-medium text-gray-900 mb-2">
              Skills
            </label>
            <Select
              isMulti
              options={skillOptions}
              value={selectedSkills}
              onChange={(selected) => handleSelectChange('skills', selected)}
              placeholder="Search skills..."
              styles={customStyles}
              classNamePrefix="react-select"
              isClearable={false}
            />
            {selectedSkills.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {selectedSkills.length} skill{selectedSkills.length !== 1 ? 's' : ''} selected
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default Filters
