import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Select from 'react-select'
import { useJobs, getUniqueCompanies, getUniqueLocations, getUniqueSkills, getCertificationsWithCounts, getEnergyRoles, filterJobsByRole } from '../hooks/useJobs'
import { useFilterParams } from '../hooks/useFilterParams'
import { getAllLocationsAsync } from '../utils/locationParser'
import { createGroupedLocationOptionsWithGeodata } from '../utils/locationGeodata'
import { extractJobCertifications } from '../utils/certificationExtractor'
import { ALL_ENERGY_REGIONS, getRegionLocationValues } from '../utils/energyRegions'
import { getMarketLabel, PRIORITY_MARKET_SLUGS } from '../utils/focusMarkets'
import { getCompanyStats, getCompanyDetail, getATSBreakdown, getSourcesOverview, loadCompanyIntelligence } from '../utils/companyData'
import { companyToSlug } from '../utils/formatters'
import { normalizeCompanyName } from '../utils/companyNormalizer'
import SEO from '../components/SEO'

// ATS platform colors for badges
const ATS_COLORS = {
  'Oracle Taleo': { bg: 'bg-red-100', text: 'text-red-800' },
  'Workable': { bg: 'bg-purple-100', text: 'text-purple-800' },
  'EasyApply (GetHired)': { bg: 'bg-green-100', text: 'text-green-800' },
  'Epicor HCM': { bg: 'bg-yellow-100', text: 'text-yellow-800' },
}

function getATSColor(platform) {
  return ATS_COLORS[platform] || { bg: 'bg-gray-100', text: 'text-gray-800' }
}

// Source badge colors (teal/cyan family to distinguish from ATS badges)
const SOURCE_COLORS = {
  'direct': { bg: 'bg-teal-100', text: 'text-teal-800' },
  'jobspy': { bg: 'bg-cyan-100', text: 'text-cyan-800' },
  'adzuna': { bg: 'bg-sky-100', text: 'text-sky-800' },
  'rigzone': { bg: 'bg-emerald-100', text: 'text-emerald-800' },
  'indeed': { bg: 'bg-blue-100', text: 'text-blue-800' },
  'linkedin': { bg: 'bg-indigo-100', text: 'text-indigo-800' },
}

function getSourceColor(source) {
  return SOURCE_COLORS[source] || { bg: 'bg-slate-100', text: 'text-slate-700' }
}

// Sort options
const SORT_OPTIONS = [
  { value: 'jobs-desc', label: 'Most Jobs' },
  { value: 'jobs-asc', label: 'Fewest Jobs' },
  { value: 'name-asc', label: 'Name A-Z' },
  { value: 'name-desc', label: 'Name Z-A' },
]

// Compact react-select styles for inline filter bar
const compactSelectStyles = {
  control: (base) => ({
    ...base,
    minHeight: '34px',
    borderColor: '#d1d5db',
    '&:hover': { borderColor: '#9ca3af' },
    boxShadow: 'none',
    '&:focus-within': {
      borderColor: '#3b82f6',
      boxShadow: '0 0 0 1px #3b82f6'
    },
    fontSize: '0.8125rem',
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '0 6px',
  }),
  multiValue: (base) => ({
    ...base,
    backgroundColor: '#dbeafe',
    borderRadius: '3px',
    margin: '1px 2px',
  }),
  multiValueLabel: (base) => ({
    ...base,
    color: '#1e40af',
    fontSize: '0.75rem',
    padding: '1px 4px',
  }),
  multiValueRemove: (base) => ({
    ...base,
    color: '#1e40af',
    padding: '0 2px',
    '&:hover': {
      backgroundColor: '#93c5fd',
      color: '#1e3a8a'
    }
  }),
  placeholder: (base) => ({
    ...base,
    color: '#9ca3af',
    fontSize: '0.8125rem'
  }),
  input: (base) => ({
    ...base,
    fontSize: '0.8125rem',
    margin: '0',
    padding: '0',
  }),
  option: (base, state) => ({
    ...base,
    fontSize: '0.8125rem',
    padding: '6px 10px',
    backgroundColor: state.isSelected
      ? '#3b82f6'
      : state.isFocused
      ? '#dbeafe'
      : 'white',
    color: state.isSelected ? 'white' : '#111827',
  }),
  indicatorsContainer: (base) => ({
    ...base,
    '& > div': { padding: '4px' },
  }),
  dropdownIndicator: (base) => ({
    ...base,
    padding: '4px',
  }),
  clearIndicator: (base) => ({
    ...base,
    padding: '4px',
  }),
  groupHeading: (base) => ({
    ...base,
    fontSize: '0.7rem',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    paddingTop: '6px',
    paddingBottom: '2px'
  }),
  menu: (base) => ({
    ...base,
    zIndex: 20,
  }),
}

function CompaniesPage() {
  const { jobs, loading, error } = useJobs()
  const { filters, setFilters } = useFilterParams()
  const [intelligence, setIntelligence] = useState({})
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('jobs-desc')
  const [expandedCompany, setExpandedCompany] = useState(null)
  const MAX_COMPARE = 10

  // Derive selectedSlugs from URL-based company filter (enables shareable links)
  const selectedSlugs = useMemo(
    () => (filters.companies || []).map(name => companyToSlug(name)),
    [filters.companies]
  )

  function toggleSelection(slug) {
    // Find the company name for this slug
    const company = companyFilterOptions.find(o => companyToSlug(o.value) === slug)
    const companyName = company ? company.value : slug
    const currentCompanies = filters.companies || []

    if (currentCompanies.includes(companyName)) {
      setFilters({ ...filters, companies: currentCompanies.filter(c => c !== companyName) })
    } else if (currentCompanies.length < MAX_COMPARE) {
      setFilters({ ...filters, companies: [...currentCompanies, companyName] })
    }
  }

  // Load company intelligence data
  useEffect(() => {
    loadCompanyIntelligence().then(setIntelligence)
  }, [])

  // ── Filter data loading (mirrors JobListPage approach) ──

  // Employment types from all jobs
  const employmentTypes = useMemo(() => {
    const types = new Set()
    jobs.forEach(job => {
      if (job.employmentType) types.add(job.employmentType)
    })
    const sortOrder = ['Full-Time', 'Contractor', 'Part-Time', 'Temporary', 'Internship']
    return [...types].sort((a, b) => {
      const aIdx = sortOrder.indexOf(a)
      const bIdx = sortOrder.indexOf(b)
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b)
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })
  }, [jobs])

  // Focus market options
  const focusMarkets = useMemo(() => {
    const counts = {}
    jobs.forEach(job => {
      if (job.status === 'removed' || job.status === 'paused') return
      if (job.profile) {
        counts[job.profile] = (counts[job.profile] || 0) + 1
      }
    })
    const all = Object.entries(counts).map(([slug, count]) => ({
      slug,
      label: getMarketLabel(slug),
      count,
      isPriority: PRIORITY_MARKET_SLUGS.includes(slug),
    }))
    return all.sort((a, b) => {
      if (a.isPriority && !b.isPriority) return -1
      if (!a.isPriority && b.isPriority) return 1
      return b.count - a.count
    })
  }, [jobs])

  // Async filter data
  const [locationOptions, setLocationOptions] = useState([])
  const [skills, setSkills] = useState([])
  const [certifications, setCertifications] = useState([])
  const [validatedSkillsByJob, setValidatedSkillsByJob] = useState(new Map())

  useEffect(() => {
    if (jobs.length === 0) return
    let cancelled = false

    async function loadFilterData() {
      const [locationOptionsResult, certsResult] = await Promise.allSettled([
        createGroupedLocationOptionsWithGeodata(jobs),
        getCertificationsWithCounts(jobs),
      ])

      if (cancelled) return
      if (locationOptionsResult.status === 'fulfilled') setLocationOptions(locationOptionsResult.value)
      if (certsResult.status === 'fulfilled') setCertifications(certsResult.value)

      // Phase 2: Skills (expensive)
      try {
        const processedSkills = await getUniqueSkills(jobs)
        if (cancelled) return
        setSkills(processedSkills)

        const { initializeONet } = await import('../utils/onetClient')
        await initializeONet()
        const { filterValidSkills } = await import('../utils/skillValidator')
        const map = new Map()
        jobs.forEach(job => {
          if (job.skills && job.skills.length > 0) {
            map.set(job.id, filterValidSkills(job.skills))
          }
        })
        if (!cancelled) setValidatedSkillsByJob(map)
      } catch (err) {
        console.error('[CompaniesPage] Failed to load skills:', err)
        if (!cancelled) setSkills([])
      }
    }

    loadFilterData()
    return () => { cancelled = true }
  }, [jobs])

  // Location cache for filtering
  const [jobLocationsCacheRef, setJobLocationsCacheRef] = useState(new Map())

  useEffect(() => {
    if (jobs.length === 0) return
    let cancelled = false

    async function buildLocationCache() {
      const cache = new Map()
      for (let i = 0; i < jobs.length; i += 500) {
        const batch = jobs.slice(i, i + 500)
        await Promise.all(
          batch.map(async (job) => {
            if (job.location && !cache.has(job.location)) {
              const locs = await getAllLocationsAsync(job.location)
              cache.set(job.location, locs)
            }
          })
        )
        if (i + 500 < jobs.length) {
          await new Promise(r => setTimeout(r, 0))
        }
      }
      if (!cancelled) setJobLocationsCacheRef(cache)
    }

    buildLocationCache()
    return () => { cancelled = true }
  }, [jobs])

  // ── Apply filters to jobs BEFORE computing company stats ──
  const [filteredJobs, setFilteredJobs] = useState([])

  useEffect(() => {
    let isCancelled = false

    async function applyFilters() {
      // Expand region IDs to location values
      let expandedLocations = [...(filters.locations || [])]
      if (filters.regions && filters.regions.length > 0 && locationOptions.length > 0) {
        filters.regions.forEach(regionId => {
          const region = ALL_ENERGY_REGIONS.find(r => r.id === regionId)
          if (region) {
            const regionLocations = getRegionLocationValues(region, locationOptions)
            expandedLocations = [...expandedLocations, ...regionLocations]
          }
        })
        expandedLocations = [...new Set(expandedLocations)]
      }

      const locationCacheReady = jobLocationsCacheRef.size > 0

      if (isCancelled) return

      let result = jobs.filter((job) => {
        // Status filter
        if (!filters.showInactive && (job.status === 'removed' || job.status === 'paused')) {
          return false
        }

        // Company filter
        if (filters.companies?.length > 0 && !filters.companies.includes(normalizeCompanyName(job.company))) {
          return false
        }

        // Location filter
        if (expandedLocations.length > 0) {
          if (!locationCacheReady) return true
          const jobLocations = jobLocationsCacheRef.get(job.location) || []
          const hasLocation = expandedLocations.some(filterLoc => jobLocations.includes(filterLoc))
          if (!hasLocation) return false
        }

        // Skills filter
        if (filters.skills?.length > 0) {
          const canonicalSkills = validatedSkillsByJob.get(job.id) || job.skills || []
          const jobSkillsLower = canonicalSkills.map(s => s.toLowerCase())
          const hasSkill = filters.skills.some(skill => jobSkillsLower.includes(skill.toLowerCase()))
          if (!hasSkill) return false
        }

        // Certifications filter
        if (filters.certifications?.length > 0) {
          const jobCertifications = extractJobCertifications(job)
          const hasCertification = filters.certifications.some(cert => jobCertifications.includes(cert))
          if (!hasCertification) return false
        }

        // Employment type filter
        if (filters.employmentTypes?.length > 0) {
          if (!job.employmentType || !filters.employmentTypes.includes(job.employmentType)) {
            return false
          }
        }

        // Source filter
        if (filters.sources?.length > 0) {
          const jobSource = job.source || 'direct'
          if (!filters.sources.includes(jobSource)) return false
        }

        // Focus market filter
        if (filters.market?.length > 0) {
          if (!job.profile || !filters.market.includes(job.profile)) {
            return false
          }
        }

        return true
      })

      // Apply role filter (async)
      if (filters.roles?.length > 0) {
        result = await filterJobsByRole(result, filters.roles)
      }

      if (isCancelled) return
      setFilteredJobs(result)
    }

    applyFilters()
    return () => { isCancelled = true }
  }, [jobs, filters, locationOptions, jobLocationsCacheRef, validatedSkillsByJob])

  // ── Compute company stats from filtered jobs ──
  const companyStats = useMemo(() => getCompanyStats(filteredJobs), [filteredJobs])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (filters.market?.length > 0) ||
      (filters.certifications?.length > 0) ||
      (filters.employmentTypes?.length > 0) ||
      (filters.locations?.length > 0) ||
      (filters.regions?.length > 0) ||
      (filters.skills?.length > 0) ||
      (filters.sources?.length > 0) ||
      (filters.companies?.length > 0)
  }, [filters])

  // Unfiltered totals (for "of N" display)
  const unfilteredTotals = useMemo(() => {
    const allStats = getCompanyStats(jobs.filter(j => j.status !== 'removed' && j.status !== 'paused'))
    return {
      totalCompanies: allStats.length,
      totalActiveJobs: allStats.reduce((sum, c) => sum + c.activeJobs, 0),
      totalSources: new Set(allStats.flatMap(c => Object.keys(c.sourceCounts))).size,
    }
  }, [jobs])

  // Summary metrics (from filtered data)
  const summaryMetrics = useMemo(() => {
    const totalCompanies = companyStats.length
    const totalActiveJobs = companyStats.reduce((sum, c) => sum + c.activeJobs, 0)
    const totalInactiveJobs = companyStats.reduce((sum, c) => sum + c.inactiveJobs, 0)
    const companiesWithIntel = companyStats.filter(c => intelligence[c.slug]).length
    return { totalCompanies, totalActiveJobs, totalInactiveJobs, companiesWithIntel }
  }, [companyStats, intelligence])

  // ATS breakdown
  const atsBreakdown = useMemo(
    () => getATSBreakdown(companyStats, intelligence),
    [companyStats, intelligence]
  )

  // Sources overview across all companies
  const sourcesOverview = useMemo(
    () => getSourcesOverview(companyStats),
    [companyStats]
  )

  // Top 10 companies by active jobs
  const topCompanies = useMemo(
    () => companyStats.slice(0, 10),
    [companyStats]
  )

  // ── Source Coverage Matrix ──
  const matrixData = useMemo(() => {
    // Pick companies: selected ones, or top 10
    const matrixCompanies = selectedSlugs.length > 0
      ? companyStats.filter(c => selectedSlugs.includes(c.slug))
      : companyStats.slice(0, 10)

    if (matrixCompanies.length === 0) return null

    // Collect all sources with at least 1 job across displayed companies
    const sourceJobTotals = {}
    matrixCompanies.forEach(company => {
      Object.entries(company.sourceCounts).forEach(([source, count]) => {
        sourceJobTotals[source] = (sourceJobTotals[source] || 0) + count
      })
    })

    // Sort sources by total count descending, filter out zero-total
    const sources = Object.entries(sourceJobTotals)
      .filter(([, total]) => total > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([source]) => source)

    // Build rows
    const rows = matrixCompanies.map(company => {
      const cells = {}
      let rowTotal = 0
      sources.forEach(source => {
        const count = company.sourceCounts[source] || 0
        cells[source] = count
        rowTotal += count
      })
      return { name: company.name, slug: company.slug, cells, total: rowTotal }
    })

    // Build column totals
    const columnTotals = {}
    let grandTotal = 0
    sources.forEach(source => {
      const total = rows.reduce((sum, row) => sum + (row.cells[source] || 0), 0)
      columnTotals[source] = total
      grandTotal += total
    })

    return { sources, rows, columnTotals, grandTotal }
  }, [companyStats, selectedSlugs])

  // Filtered and sorted companies
  const filteredCompanies = useMemo(() => {
    let result = companyStats

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(c => {
        if (c.name.toLowerCase().includes(q)) return true
        const intel = intelligence[c.slug]
        if (intel && intel.brandVariations) {
          return intel.brandVariations.some(v => v.toLowerCase().includes(q))
        }
        return false
      })
    }

    // Sort
    switch (sortBy) {
      case 'jobs-asc':
        result = [...result].sort((a, b) => a.activeJobs - b.activeJobs)
        break
      case 'name-asc':
        result = [...result].sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'name-desc':
        result = [...result].sort((a, b) => b.name.localeCompare(a.name))
        break
      case 'jobs-desc':
      default:
        break
    }

    return result
  }, [companyStats, search, sortBy, intelligence])

  // ── Filter options for dropdowns ──
  const focusMarketOptions = useMemo(() =>
    focusMarkets.map(m => ({ label: `${m.label} (${m.count})`, value: m.slug })),
    [focusMarkets]
  )

  const certificationOptions = useMemo(() => {
    if (certifications.length === 0) return []
    if (typeof certifications[0] === 'object' && 'name' in certifications[0]) {
      return certifications.map(cert => ({
        label: `${cert.name} (${cert.count})`,
        value: cert.name
      }))
    }
    return certifications.map(cert => ({ label: cert, value: cert }))
  }, [certifications])

  const employmentTypeOptions = useMemo(() =>
    employmentTypes.map(type => ({ label: type, value: type })),
    [employmentTypes]
  )

  const skillOptions = useMemo(() =>
    skills.map(skill => ({ label: skill, value: skill })),
    [skills]
  )

  const sourceOptions = useMemo(() => {
    const counts = {}
    jobs.forEach(job => {
      if (job.status === 'removed' || job.status === 'paused') return
      const src = job.source || 'direct'
      counts[src] = (counts[src] || 0) + 1
    })
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ label: `${name} (${count})`, value: name }))
  }, [jobs])

  // Company filter options (from unfiltered active jobs, with normalized names)
  const companyFilterOptions = useMemo(() => {
    const counts = {}
    jobs.forEach(job => {
      if (job.status === 'removed' || job.status === 'paused') return
      if (job.company) {
        const canonical = normalizeCompanyName(job.company)
        counts[canonical] = (counts[canonical] || 0) + 1
      }
    })
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ label: `${name} (${count})`, value: name }))
  }, [jobs])

  // Selected values for react-select
  const selectedMarkets = useMemo(() =>
    (filters.market || []).map(slug => {
      const opt = focusMarketOptions.find(o => o.value === slug)
      return opt || { label: slug, value: slug }
    }),
    [filters.market, focusMarketOptions]
  )

  const selectedCertifications = useMemo(() =>
    (filters.certifications || []).map(name => {
      const opt = certificationOptions.find(o => o.value === name)
      return opt || { label: name, value: name }
    }),
    [filters.certifications, certificationOptions]
  )

  const selectedEmploymentTypes = useMemo(() =>
    (filters.employmentTypes || []).map(t => ({ label: t, value: t })),
    [filters.employmentTypes]
  )

  const selectedLocations = useMemo(() => {
    const flatOptions = locationOptions.flatMap(group => group.options || [])
    return (filters.locations || []).map(loc => {
      const fullOption = flatOptions.find(opt => opt.value === loc)
      return fullOption || { label: loc, value: loc }
    })
  }, [filters.locations, locationOptions])

  const selectedSkills = useMemo(() =>
    (filters.skills || []).map(s => ({ label: s, value: s })),
    [filters.skills]
  )

  const selectedSources = useMemo(() =>
    (filters.sources || []).map(name => {
      const opt = sourceOptions.find(o => o.value === name)
      return opt || { label: name, value: name }
    }),
    [filters.sources, sourceOptions]
  )

  const selectedCompanyFilters = useMemo(() =>
    (filters.companies || []).map(name => {
      const opt = companyFilterOptions.find(o => o.value === name)
      return opt || { label: name, value: name }
    }),
    [filters.companies, companyFilterOptions]
  )

  const handleCompanyFilterChange = (selected) => {
    const names = selected ? selected.map(o => o.value) : []
    setFilters({ ...filters, companies: names })
  }

  const activeFilterCount = useMemo(() =>
    (filters.market?.length || 0) +
    (filters.certifications?.length || 0) +
    (filters.employmentTypes?.length || 0) +
    (filters.locations?.length || 0) +
    (filters.regions?.length || 0) +
    (filters.skills?.length || 0) +
    (filters.sources?.length || 0) +
    (filters.companies?.length || 0),
    [filters]
  )

  const clearFilters = () => {
    setFilters({
      companies: [], locations: [], skills: [], certifications: [],
      roles: [], employmentTypes: [], sources: [], profiles: [],
      market: [], showInactive: filters.showInactive
    })
    // selectedSlugs derived from filters.companies — no separate state to clear
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading companies...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <h2 className="text-lg font-semibold text-red-900 mb-2">Error Loading Data</h2>
        <p className="text-red-700">{error}</p>
      </div>
    )
  }

  return (
    <div>
      <SEO
        title="Company Opportunities"
        description={`${summaryMetrics.totalCompanies} companies with ${summaryMetrics.totalActiveJobs} active job listings`}
      />

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Company Opportunities</h1>
        <p className="text-gray-600 mt-1">
          Aggregate view of job opportunities by company — filter to see matching companies and stats
        </p>
      </div>

      {/* Compact Filter Bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700">Filters</h2>
          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              Clear all ({activeFilterCount})
            </button>
          )}
        </div>
        {/* Companies filter — own row for multi-select */}
        <div className="mb-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Companies</label>
          <Select
            isMulti
            value={selectedCompanyFilters}
            onChange={handleCompanyFilterChange}
            options={companyFilterOptions}
            styles={compactSelectStyles}
            placeholder={`Select from ${companyFilterOptions.length} companies...`}
            isClearable={false}
            closeMenuOnSelect={false}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {/* Focus Market */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Focus Market</label>
            <Select
              isMulti
              value={selectedMarkets}
              onChange={(selected) => setFilters({ ...filters, market: selected ? selected.map(o => o.value) : [] })}
              options={focusMarketOptions}
              styles={compactSelectStyles}
              placeholder="All markets..."
              isClearable={false}
              closeMenuOnSelect={false}
            />
          </div>

          {/* Certifications */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Certifications</label>
            <Select
              isMulti
              value={selectedCertifications}
              onChange={(selected) => setFilters({ ...filters, certifications: selected ? selected.map(o => o.value) : [] })}
              options={certificationOptions}
              styles={compactSelectStyles}
              placeholder="All certs..."
              isClearable={false}
              closeMenuOnSelect={false}
            />
          </div>

          {/* Employment Type */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Employment Type</label>
            <Select
              isMulti
              value={selectedEmploymentTypes}
              onChange={(selected) => setFilters({ ...filters, employmentTypes: selected ? selected.map(o => o.value) : [] })}
              options={employmentTypeOptions}
              styles={compactSelectStyles}
              placeholder="All types..."
              isClearable={false}
              closeMenuOnSelect={false}
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Location / Region</label>
            <Select
              isMulti
              value={selectedLocations}
              onChange={(selected) => setFilters({ ...filters, locations: selected ? selected.map(o => o.value) : [] })}
              options={locationOptions}
              styles={compactSelectStyles}
              placeholder="All locations..."
              isClearable={false}
              closeMenuOnSelect={false}
            />
          </div>

          {/* Skills */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Skills</label>
            <Select
              isMulti
              value={selectedSkills}
              onChange={(selected) => setFilters({ ...filters, skills: selected ? selected.map(o => o.value) : [] })}
              options={skillOptions}
              styles={compactSelectStyles}
              placeholder="All skills..."
              isClearable={false}
              closeMenuOnSelect={false}
            />
          </div>

          {/* Source */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Source</label>
            <Select
              isMulti
              value={selectedSources}
              onChange={(selected) => setFilters({ ...filters, sources: selected ? selected.map(o => o.value) : [] })}
              options={sourceOptions}
              styles={compactSelectStyles}
              placeholder="All sources..."
              isClearable={false}
              closeMenuOnSelect={false}
            />
          </div>
        </div>
        {hasActiveFilters && (
          <p className="text-xs text-gray-500 mt-2">
            Showing {companyStats.length} companies with {filteredJobs.length} matching jobs (of {jobs.filter(j => j.status !== 'removed' && j.status !== 'paused').length} total)
          </p>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{summaryMetrics.totalCompanies}</div>
          <div className="text-sm text-gray-600 mt-1">Companies</div>
          {hasActiveFilters && <div className="text-xs text-gray-400">of {unfilteredTotals.totalCompanies}</div>}
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-3xl font-bold text-green-600">{summaryMetrics.totalActiveJobs}</div>
          <div className="text-sm text-gray-600 mt-1">Active Jobs</div>
          {hasActiveFilters && <div className="text-xs text-gray-400">of {unfilteredTotals.totalActiveJobs}</div>}
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-3xl font-bold text-gray-400">{summaryMetrics.totalInactiveJobs}</div>
          <div className="text-sm text-gray-600 mt-1">Inactive Jobs</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-3xl font-bold text-teal-600">{sourcesOverview.totalSources}</div>
          <div className="text-sm text-gray-600 mt-1">Job Sources</div>
          {hasActiveFilters && <div className="text-xs text-gray-400">of {unfilteredTotals.totalSources}</div>}
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-3xl font-bold text-indigo-600">{summaryMetrics.companiesWithIntel}</div>
          <div className="text-sm text-gray-600 mt-1">Researched</div>
        </div>
      </div>

      {/* Source Coverage Matrix */}
      {matrixData && matrixData.rows.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Source Coverage Matrix
              {selectedSlugs.length > 0
                ? ` (${selectedSlugs.length} selected)`
                : ' (Top 10)'}
            </h2>
            {selectedSlugs.length > 0 && (
              <button
                onClick={() => setFilters({ ...filters, companies: [] })}
                className="text-xs text-gray-500 hover:text-gray-700 font-medium"
              >
                Show top 10
              </button>
            )}
          </div>
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm border-collapse min-w-[500px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 pr-4 text-xs font-semibold text-gray-500 uppercase tracking-wider sticky left-0 bg-white z-10 min-w-[160px]">
                    Company
                  </th>
                  {matrixData.sources.map(source => {
                    const color = getSourceColor(source)
                    return (
                      <th key={source} className="text-right py-2 px-3 min-w-[80px]">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${color.bg} ${color.text}`}>
                          {source}
                        </span>
                      </th>
                    )
                  })}
                  <th className="text-right py-2 pl-3 pr-1 text-xs font-bold text-gray-700 uppercase tracking-wider min-w-[60px]">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {matrixData.rows.map(row => (
                  <tr key={row.slug} className="hover:bg-gray-50">
                    <td className="py-2 pr-4 sticky left-0 bg-white z-10">
                      <Link
                        to={`/companies/${row.slug}`}
                        className="text-sm font-medium text-gray-900 hover:text-blue-600"
                      >
                        {row.name}
                      </Link>
                    </td>
                    {matrixData.sources.map(source => {
                      const count = row.cells[source] || 0
                      const maxInColumn = matrixData.columnTotals[source] || 1
                      // Subtle intensity for non-zero cells
                      const intensity = count > 0 ? Math.max(0.05, Math.min(0.3, count / maxInColumn)) : 0
                      return (
                        <td
                          key={source}
                          className={`text-right py-2 px-3 tabular-nums ${
                            count === 0
                              ? 'bg-red-50 text-red-300'
                              : 'text-gray-900'
                          }`}
                          style={count > 0 ? { backgroundColor: `rgba(20, 184, 166, ${intensity})` } : undefined}
                        >
                          {count}
                        </td>
                      )
                    })}
                    <td className="text-right py-2 pl-3 pr-1 font-bold text-gray-900 tabular-nums">
                      {row.total}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300">
                  <td className="py-2 pr-4 text-xs font-bold text-gray-500 uppercase sticky left-0 bg-white z-10">
                    Total
                  </td>
                  {matrixData.sources.map(source => (
                    <td key={source} className="text-right py-2 px-3 font-bold text-gray-700 tabular-nums">
                      {matrixData.columnTotals[source]}
                    </td>
                  ))}
                  <td className="text-right py-2 pl-3 pr-1 font-bold text-blue-700 tabular-nums">
                    {matrixData.grandTotal}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ATS Breakdown + Sources Overview + Top Companies Row */}
      <div className="grid md:grid-cols-3 gap-6 mb-8">
        {/* ATS Platform Breakdown */}
        {atsBreakdown.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">ATS Platforms (Researched)</h2>
            <div className="space-y-3">
              {atsBreakdown.map(({ platform, count }) => {
                const color = getATSColor(platform)
                return (
                  <div key={platform} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color.bg} ${color.text}`}>
                        {platform}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-gray-700">
                      {count} {count === 1 ? 'company' : 'companies'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Sources Overview */}
        {sourcesOverview.sourceTotals.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Sources Overview</h2>
            <div className="space-y-2.5">
              {sourcesOverview.sourceTotals.map(({ source, jobCount, companyCount }) => {
                const maxJobs = sourcesOverview.sourceTotals[0]?.jobCount || 1
                const barWidth = Math.max((jobCount / maxJobs) * 100, 2)
                const color = getSourceColor(source)
                return (
                  <div key={source}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color.bg} ${color.text}`}>
                        {source}
                      </span>
                      <span className="text-xs text-gray-500">
                        {jobCount} jobs / {companyCount} {companyCount === 1 ? 'company' : 'companies'}
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className="bg-teal-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Top Companies */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Top 10 by Active Jobs</h2>
          <div className="space-y-2">
            {topCompanies.map((company, index) => {
              const maxJobs = topCompanies[0]?.activeJobs || 1
              const barWidth = Math.max((company.activeJobs / maxJobs) * 100, 2)
              const hasIntel = !!intelligence[company.slug]

              return (
                <div key={company.slug} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-5 text-right">{index + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Link
                        to={`/companies/${company.slug}`}
                        className="text-sm font-medium text-gray-900 hover:text-blue-600 truncate"
                      >
                        {company.name}
                      </Link>
                      {hasIntel && (
                        <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" title="Intelligence data available" />
                      )}
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className="bg-blue-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-medium text-gray-700 w-10 text-right">{company.activeJobs}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Search and Sort Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search companies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
        >
          {SORT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Results count */}
      <p className="text-sm text-gray-500 mb-4">
        Showing {filteredCompanies.length} of {companyStats.length} companies
        {hasActiveFilters && ' (filtered)'}
      </p>

      {/* Company Cards Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredCompanies.map(company => {
          const hasIntel = !!intelligence[company.slug]
          const intel = intelligence[company.slug]
          const isExpanded = expandedCompany === company.slug

          return (
            <div
              key={company.slug}
              className={`bg-white rounded-lg shadow-sm border transition-all ${
                hasIntel ? 'border-indigo-200 hover:border-indigo-400' : 'border-gray-200 hover:border-gray-400'
              }`}
            >
              {/* Card Header */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={selectedSlugs.includes(company.slug)}
                      onChange={() => toggleSelection(company.slug)}
                      disabled={!selectedSlugs.includes(company.slug) && selectedSlugs.length >= MAX_COMPARE}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0 cursor-pointer"
                      title={selectedSlugs.includes(company.slug) ? 'Remove from matrix' : 'Add to matrix'}
                    />
                    <Link
                      to={`/companies/${company.slug}`}
                      className="text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors line-clamp-1"
                    >
                      {company.name}
                    </Link>
                  </div>
                  {hasIntel && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800 whitespace-nowrap">
                      Researched
                    </span>
                  )}
                </div>

                {/* Intel-enriched info */}
                {intel && (
                  <div className="flex flex-wrap items-center gap-2 mb-3 text-sm text-gray-600">
                    {intel.hq && (
                      <span className="inline-flex items-center">
                        <svg className="w-3.5 h-3.5 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                        </svg>
                        {intel.hq}
                      </span>
                    )}
                    {intel.sector && (
                      <span className="text-xs text-gray-500 line-clamp-1">{intel.sector}</span>
                    )}
                  </div>
                )}

                {/* Job counts */}
                <div className="flex items-center gap-4 mb-3">
                  <div className="text-center">
                    <div className="text-xl font-bold text-green-600">{company.activeJobs}</div>
                    <div className="text-xs text-gray-500">Active</div>
                  </div>
                  {company.inactiveJobs > 0 && (
                    <div className="text-center">
                      <div className="text-xl font-bold text-gray-400">{company.inactiveJobs}</div>
                      <div className="text-xs text-gray-500">Inactive</div>
                    </div>
                  )}
                  <div className="text-center">
                    <div className="text-xl font-bold text-blue-600">{company.totalJobs}</div>
                    <div className="text-xs text-gray-500">Total</div>
                  </div>
                </div>

                {/* ATS badges */}
                {intel && intel.ats && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {intel.ats.map((ats, i) => {
                      const color = getATSColor(ats.platform)
                      return (
                        <span
                          key={i}
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color.bg} ${color.text}`}
                        >
                          {ats.platform}
                          {intel.ats.length > 1 && (
                            <span className="ml-1 opacity-70">({ats.region})</span>
                          )}
                        </span>
                      )
                    })}
                  </div>
                )}

                {/* Source badges */}
                {Object.keys(company.sourceCounts).length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {(() => {
                      const entries = Object.entries(company.sourceCounts)
                      const shown = entries.slice(0, 3)
                      const remaining = entries.length - 3
                      return (
                        <>
                          {shown.map(([source, count]) => {
                            const color = getSourceColor(source)
                            return (
                              <span
                                key={source}
                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color.bg} ${color.text}`}
                              >
                                {source} ({count})
                              </span>
                            )
                          })}
                          {remaining > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                              +{remaining} more
                            </span>
                          )}
                        </>
                      )
                    })()}
                  </div>
                )}

                {/* Employment types */}
                {company.employmentTypes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {company.employmentTypes.map(type => (
                      <span
                        key={type}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          type === 'Full-Time' ? 'bg-green-50 text-green-700'
                          : type === 'Contractor' ? 'bg-orange-50 text-orange-700'
                          : type === 'Part-Time' ? 'bg-purple-50 text-purple-700'
                          : 'bg-gray-50 text-gray-700'
                        }`}
                      >
                        {type}
                      </span>
                    ))}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                  <Link
                    to={`/companies/${company.slug}`}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    View Jobs
                  </Link>
                  {hasIntel && (
                    <button
                      onClick={() => setExpandedCompany(isExpanded ? null : company.slug)}
                      className="text-sm text-indigo-600 hover:text-indigo-700 font-medium ml-auto"
                    >
                      {isExpanded ? 'Hide Profile' : 'View Profile'}
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded Intel Section */}
              {isExpanded && intel && (
                <CompanyIntelPanel intel={intel} companyDetail={getCompanyDetail(company.slug, filteredJobs)} />
              )}
            </div>
          )
        })}
      </div>

      {filteredCompanies.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-600">No companies match your filters.</p>
        </div>
      )}

      {/* Floating Selection Bar */}
      {selectedSlugs.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-lg">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700">
                {selectedSlugs.length} selected
              </span>
              <div className="hidden sm:flex gap-1 flex-wrap">
                {selectedSlugs.slice(0, 5).map(slug => {
                  const company = companyStats.find(c => c.slug === slug)
                  return company ? (
                    <span key={slug} className="inline-flex items-center px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-medium">
                      {company.name}
                      <button
                        onClick={() => toggleSelection(slug)}
                        className="ml-1 text-blue-600 hover:text-blue-800"
                      >
                        x
                      </button>
                    </span>
                  ) : null
                })}
                {selectedSlugs.length > 5 && (
                  <span className="text-xs text-gray-500 self-center">+{selectedSlugs.length - 5} more</span>
                )}
              </div>
            </div>
            <button
              onClick={() => setFilters({ ...filters, companies: [] })}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 font-medium border border-gray-300 rounded-lg"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Expandable panel showing full company intelligence data.
 */
function CompanyIntelPanel({ intel, companyDetail }) {
  return (
    <div className="border-t border-gray-200 bg-gray-50 p-4 rounded-b-lg space-y-4">
      {/* Company Info */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Company Details</h4>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {intel.legalName && (
            <>
              <dt className="text-gray-500">Legal Name</dt>
              <dd className="text-gray-900">{intel.legalName}</dd>
            </>
          )}
          {intel.ticker && (
            <>
              <dt className="text-gray-500">Ticker</dt>
              <dd className="text-gray-900">{intel.ticker}</dd>
            </>
          )}
          {intel.website && (
            <>
              <dt className="text-gray-500">Website</dt>
              <dd>
                <a href={intel.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 truncate block">
                  {intel.website.replace(/^https?:\/\//, '')}
                </a>
              </dd>
            </>
          )}
          {intel.parentCompany && (
            <>
              <dt className="text-gray-500">Parent</dt>
              <dd className="text-gray-900">{intel.parentCompany}</dd>
            </>
          )}
          {intel.subsidiaries && intel.subsidiaries.length > 0 && (
            <>
              <dt className="text-gray-500">Subsidiaries</dt>
              <dd className="text-gray-900">{intel.subsidiaries.join(', ')}</dd>
            </>
          )}
        </dl>
      </div>

      {/* ATS Details */}
      {intel.ats && intel.ats.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">ATS Platforms</h4>
          <div className="space-y-2">
            {intel.ats.map((ats, i) => (
              <div key={i} className="flex items-center justify-between bg-white rounded p-2 text-sm">
                <div>
                  <span className="font-medium text-gray-900">{ats.platform}</span>
                  <span className="text-gray-500 ml-2">({ats.region})</span>
                </div>
                {ats.url && (
                  <a href={ats.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 text-xs">
                    Open ATS
                  </a>
                )}
              </div>
            ))}
          </div>
          {intel.careersUrl && (
            <a
              href={intel.careersUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center mt-2 text-sm text-blue-600 hover:text-blue-700"
            >
              Careers Page
              <svg className="w-3.5 h-3.5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      )}

      {/* Third-Party Board Presence */}
      {intel.thirdPartyBoards && intel.thirdPartyBoards.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">
            Job Board Presence ({intel.thirdPartyBoards.length})
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {intel.thirdPartyBoards.map((board, i) => (
              <a
                key={i}
                href={board.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-2.5 py-1 rounded bg-white border border-gray-200 text-xs text-gray-700 hover:border-blue-300 hover:text-blue-700 transition-colors"
              >
                {board.name}
                <svg className="w-3 h-3 ml-1 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Brand Variations */}
      {intel.brandVariations && intel.brandVariations.length > 1 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Brand Variations</h4>
          <div className="flex flex-wrap gap-1.5">
            {intel.brandVariations.map((brand, i) => (
              <span key={i} className="inline-flex items-center px-2 py-0.5 rounded bg-white border border-gray-200 text-xs text-gray-600">
                {brand}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Job Statistics from data */}
      {companyDetail && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Job Statistics</h4>
          <div className="grid grid-cols-3 gap-2 text-center mb-3">
            <div className="bg-white rounded p-2">
              <div className="text-lg font-bold text-green-600">{companyDetail.activeJobs}</div>
              <div className="text-xs text-gray-500">Active</div>
            </div>
            <div className="bg-white rounded p-2">
              <div className="text-lg font-bold text-gray-400">{companyDetail.inactiveJobs}</div>
              <div className="text-xs text-gray-500">Inactive</div>
            </div>
            <div className="bg-white rounded p-2">
              <div className="text-lg font-bold text-blue-600">{companyDetail.totalJobs}</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
          </div>

          {/* Top Locations */}
          {companyDetail.topLocations.length > 0 && (
            <div className="mb-2">
              <span className="text-xs font-medium text-gray-500">Top Locations:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {companyDetail.topLocations.slice(0, 5).map(({ location, count }) => (
                  <span key={location} className="inline-flex items-center px-2 py-0.5 rounded bg-white border border-gray-200 text-xs text-gray-700">
                    {location} ({count})
                  </span>
                ))}
                {companyDetail.topLocations.length > 5 && (
                  <span className="text-xs text-gray-400">+{companyDetail.topLocations.length - 5} more</span>
                )}
              </div>
            </div>
          )}

          {/* Employment Types */}
          {companyDetail.employmentTypes.length > 0 && (
            <div className="mb-2">
              <span className="text-xs font-medium text-gray-500">Employment Types:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {companyDetail.employmentTypes.map(({ type, count }) => (
                  <span key={type} className="inline-flex items-center px-2 py-0.5 rounded bg-white border border-gray-200 text-xs text-gray-700">
                    {type} ({count})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Source Breakdown */}
          {companyDetail.sources.length > 0 && (
            <div className="mt-3">
              <span className="text-xs font-medium text-gray-500">Source Breakdown:</span>
              <div className="mt-1.5 space-y-1.5">
                {companyDetail.sources.map(({ source, count }) => {
                  const maxCount = companyDetail.sources[0]?.count || 1
                  const barWidth = Math.max((count / maxCount) * 100, 3)
                  const pct = ((count / companyDetail.totalJobs) * 100).toFixed(0)
                  const color = getSourceColor(source)
                  return (
                    <div key={source}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${color.bg} ${color.text}`}>
                          {source}
                        </span>
                        <span className="text-xs text-gray-500">{count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-teal-400 h-1.5 rounded-full transition-all"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scraper Notes */}
      {intel.scraperNotes && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
          <span className="text-xs font-medium text-yellow-800">Scraper Notes:</span>
          <p className="text-xs text-yellow-700 mt-0.5">{intel.scraperNotes}</p>
        </div>
      )}

      {/* Research Date */}
      {intel.researchDate && (
        <p className="text-xs text-gray-400">
          Last researched: {intel.researchDate}
        </p>
      )}
    </div>
  )
}

export default CompaniesPage
