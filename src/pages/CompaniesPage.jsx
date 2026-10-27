import { useState, useMemo, useEffect, Component } from 'react'
import { Link } from 'react-router-dom'
import Select from 'react-select'
import { useJobs, useSiteFilters } from '../hooks/useJobs'
import { useFilterParams } from '../hooks/useFilterParams'
import { extractJobCertifications } from '../utils/certificationExtractor'
import { ALL_ENERGY_REGIONS, getRegionLocationValues } from '../utils/energyRegions'
import { getMarketLabel, PRIORITY_MARKET_SLUGS } from '../utils/focusMarkets'
import { getCompanyStats, getCompanyDetail, loadCompanyIntelligence } from '../utils/companyData'
import { companyToSlug } from '../utils/formatters'
import { normalizeCompanyName } from '../utils/companyNormalizer'
import SEO from '../components/SEO'
import { DataBasis, EmptyState, PageHeader, fmtUpdated } from '../components/ui/PageParts'
import { mzSelectStyles as compactSelectStyles } from '../components/ui/selectStyles'
import '../companies.css'

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
const EMPTY_LIST = []
// Render companies a page at a time: all ~6,800 at once was 130,000 DOM nodes and a ~5 s block
const COMPANIES_PAGE_SIZE = 60

const SORT_OPTIONS = [
  { value: 'trade-desc', label: 'Most trade jobs' },
  { value: 'recent-desc', label: 'Most new in 30 days' },
  { value: 'reach-desc', label: 'Contacts ready first' },
  { value: 'jobs-desc', label: 'Most open jobs' },
  { value: 'name-asc', label: 'Name A-Z' },
]
const DAY = 864e5
const FEED_BASE = `${import.meta.env.BASE_URL || '/'}data/feed/`

function ago(t) {
  if (!t) return null
  const d = Math.max(0, Math.floor((Date.now() - t) / DAY))
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d} days ago`
  const m = Math.round(d / 30)
  return m < 12 ? `${m} mo ago` : `${Math.round(m / 12)} yr ago`
}

// The one next step a row suggests, from what we already know (no lookups, no credits).
function nextStep(x, cov, sig) {
  if (cov?.with_email > 0) return { label: 'Start outreach', why: `${cov.with_email} contact${cov.with_email === 1 ? '' : 's'} with email`, tone: 'teal' }
  if (cov?.identified > 0) return { label: 'Find an email', why: `${cov.identified} contact${cov.identified === 1 ? '' : 's'} named, no email yet`, tone: 'warn' }
  if (sig > 0) return { label: 'Find a contact', why: 'In recent project news', tone: 'plain' }
  if ((x?.recent || 0) >= 5) return { label: 'Find a contact', why: 'Hiring now', tone: 'plain' }
  return { label: 'Watch', why: x?.newest ? 'No new jobs lately' : 'No posting dates yet', tone: 'quiet' }
}


function CompaniesPage() {
  const { jobs, loading, error } = useJobs()
  // Precomputed at build time over current jobs (scripts/build-site-data.mjs)
  const filterOptions = useSiteFilters()
  const [shownCompanies, setShownCompanies] = useState(COMPANIES_PAGE_SIZE)
  const { filters, setFilters } = useFilterParams()
  const [intelligence, setIntelligence] = useState({})
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('trade-desc')
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

  // ── Filter data loading (uses pre-computed filter-options.json when available) ──

  // Employment types: use pre-computed, fall back to runtime
  const employmentTypes = useMemo(() => {
    if (filterOptions?.employmentTypes) {
      const sortOrder = ['Full-Time', 'Contractor', 'Part-Time', 'Temporary', 'Internship']
      return filterOptions.employmentTypes
        .map(et => et.name)
        .sort((a, b) => {
          const aIdx = sortOrder.indexOf(a)
          const bIdx = sortOrder.indexOf(b)
          if (aIdx === -1 && bIdx === -1) return a.localeCompare(b)
          if (aIdx === -1) return 1
          if (bIdx === -1) return -1
          return aIdx - bIdx
        })
    }
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
  }, [filterOptions, jobs])

  // Focus market options: use pre-computed, fall back to runtime
  const focusMarkets = useMemo(() => {
    if (filterOptions?.focusMarkets) return filterOptions.focusMarkets
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
  }, [filterOptions, jobs])

  // Filter lists: precomputed (no runtime location parsing or skill validation)
  const locationOptions = filterOptions?.locationOptions || EMPTY_LIST
  const skills = filterOptions?.skills || EMPTY_LIST
  const certifications = filterOptions?.certifications || EMPTY_LIST

  // ── Apply filters to jobs BEFORE computing company stats (sync, over build-time facets) ──
  const filteredJobs = useMemo(() => {
    let expandedLocations = [...(filters.locations || [])]
    if (filters.regions?.length > 0 && locationOptions.length > 0) {
      filters.regions.forEach(regionId => {
        const region = ALL_ENERGY_REGIONS.find(r => r.id === regionId)
        if (region) expandedLocations.push(...getRegionLocationValues(region, locationOptions))
      })
    }
    const locSet = expandedLocations.length > 0 ? new Set(expandedLocations) : null
    const skillSet = filters.skills?.length > 0 ? new Set(filters.skills.map(s => s.toLowerCase())) : null
    const companySet = filters.companies?.length > 0 ? new Set(filters.companies) : null
    const roleSet = filters.roles?.length > 0 ? new Set(filters.roles) : null

    return jobs.filter((job) => {
      if (!filters.showInactive && (job.status === 'removed' || job.status === 'paused')) return false
      if (companySet && !companySet.has(normalizeCompanyName(job.company))) return false
      if (locSet && !(job.locs || EMPTY_LIST).some(l => locSet.has(l))) return false
      if (skillSet && !(job.validSkills || job.skills || EMPTY_LIST).some(s => skillSet.has(s.toLowerCase()))) return false
      if (filters.certifications?.length > 0) {
        const jobCertifications = extractJobCertifications(job)
        if (!filters.certifications.some(cert => jobCertifications.includes(cert))) return false
      }
      if (filters.employmentTypes?.length > 0 && (!job.employmentType || !filters.employmentTypes.includes(job.employmentType))) return false
      if (filters.sources?.length > 0 && !filters.sources.includes(job.source || 'direct')) return false
      if (filters.market?.length > 0 && (!job.profile || !filters.market.includes(job.profile))) return false
      if (roleSet && !roleSet.has(job.roleId)) return false
      return true
    })
  }, [jobs, filters, locationOptions])

  // Reset the rendered company count when the result set changes
  useEffect(() => { setShownCompanies(COMPANIES_PAGE_SIZE) }, [filters, search, sortBy])

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
    try {
      const allStats = getCompanyStats(jobs.filter(j => j.status !== 'removed' && j.status !== 'paused'))
      return {
        totalCompanies: allStats.length,
        totalActiveJobs: allStats.reduce((sum, c) => sum + (c.activeJobs || 0), 0),
        totalSources: new Set(allStats.flatMap(c => Object.keys(c.sourceCounts || {}))).size,
      }
    } catch (err) {
      console.error('[CompaniesPage] Error computing unfilteredTotals:', err)
      return { totalCompanies: 0, totalActiveJobs: 0, totalSources: 0 }
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

  // Per-company signals for the list: trade jobs, trades, freshness, where (one pass over filtered jobs)
  const roleLabels = useMemo(() => Object.fromEntries((filterOptions?.roles || []).map(r => [r.id, r.label])), [filterOptions])
  const companyExtras = useMemo(() => {
    const cutoff = Date.now() - 30 * DAY
    const slugOf = new Map()
    const m = {}
    for (const job of filteredJobs) {
      if (!job.company || job.status === 'removed' || job.status === 'paused') continue
      let slug = slugOf.get(job.company)
      if (slug === undefined) { slug = companyToSlug(normalizeCompanyName(job.company)) || null; slugOf.set(job.company, slug) }
      if (!slug) continue
      const e = m[slug] || (m[slug] = { trade: 0, roles: {}, recent: 0, newest: 0, locs: {}, agency: 0, n: 0 })
      e.n++
      if (job.roleId && job.roleId !== 'other') { e.trade++; e.roles[job.roleId] = (e.roles[job.roleId] || 0) + 1 }
      const t = job.postedDate ? Date.parse(job.postedDate) : NaN
      if (t) { if (t > e.newest) e.newest = t; if (t >= cutoff) e.recent++ }
      const loc = (job.locs && job.locs[0]) || job.location
      if (loc) e.locs[loc] = (e.locs[loc] || 0) + 1
      if (job.isAgency) e.agency++
    }
    return m
  }, [filteredJobs])

  // Contact coverage (counts only, no PII) and recent feed signals, both static files: nothing is looked up or spent here
  const [reach, setReach] = useState({ coverage: {}, signals: {} })
  useEffect(() => {
    let off = false
    Promise.all([
      fetch(`${FEED_BASE}contact_coverage.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
      fetch(`${FEED_BASE}entries-lite.json`).then(r => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([coverage, entries]) => {
      const signals = {}
      for (const e of Array.isArray(entries) ? entries : []) {
        const names = new Set([e.operator?.name, e.hiring_entity?.name].filter(Boolean))
        for (const n of names) {
          const slug = companyToSlug(normalizeCompanyName(n))
          if (slug) signals[slug] = (signals[slug] || 0) + 1
        }
      }
      if (!off) setReach({ coverage: coverage || {}, signals })
    })
    return () => { off = true }
  }, [])

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
      case 'trade-desc':
        result = [...result].sort((a, b) => (companyExtras[b.slug]?.trade || 0) - (companyExtras[a.slug]?.trade || 0) || b.activeJobs - a.activeJobs)
        break
      case 'reach-desc': {
        const score = c => { const v = reach.coverage[c.name.toLowerCase()]; return v ? 1000 * (v.with_email || 0) + (v.identified || 0) : 0 }
        result = [...result].sort((a, b) => score(b) - score(a) || (companyExtras[b.slug]?.trade || 0) - (companyExtras[a.slug]?.trade || 0))
        break
      }
      case 'recent-desc':
        result = [...result].sort((a, b) => (companyExtras[b.slug]?.recent || 0) - (companyExtras[a.slug]?.recent || 0) || b.activeJobs - a.activeJobs)
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
  }, [companyStats, search, sortBy, intelligence, companyExtras, reach])

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
      <div className="mz co"><EmptyState title="Loading companies…">Reading the current job index.</EmptyState></div>
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

  const multi = (key, label, value, options, placeholder) => (
    <label className="mz-field" key={key}>
      <span className="mz-field__l">{label}</span>
      <Select
        isMulti
        value={value}
        onChange={(selected) => setFilters({ ...filters, [key]: selected ? selected.map(o => o.value) : [] })}
        options={options}
        styles={compactSelectStyles}
        placeholder={placeholder}
        isClearable={false}
        closeMenuOnSelect={false}
      />
    </label>
  )
  const openJobs = unfilteredTotals.totalActiveJobs
  const shown = filteredCompanies.slice(0, shownCompanies)

  return (
    <div className="mz co">
      <SEO
        title="Companies"
        description={`${summaryMetrics.totalCompanies} companies with ${summaryMetrics.totalActiveJobs} open jobs`}
      />
      <PageHeader
        title="Companies"
        sub="Who is hiring in our trades, how recently, where, and whether we can reach them."
      />
      <DataBasis parts={[
        <><b className="num">{openJobs.toLocaleString('en-US')}</b> open jobs from <b className="num">{unfilteredTotals.totalCompanies.toLocaleString('en-US')}</b> companies</>,
        fmtUpdated(filterOptions?.dataUpdatedAt),
      ]} />

      <div className="mz-filters co-filters">
        <label className="mz-field co-search">
          <span className="mz-field__l">Search</span>
          <input className="mz-input" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Company name" />
        </label>
        {multi('market', 'Focus market', selectedMarkets, focusMarketOptions, 'All markets')}
        {multi('locations', 'Location or region', selectedLocations, locationOptions, 'Anywhere')}
        {multi('certifications', 'Certification', selectedCertifications, certificationOptions, 'Any')}
        {multi('employmentTypes', 'Employment type', selectedEmploymentTypes, employmentTypeOptions, 'Any')}
        {multi('skills', 'Skill', selectedSkills, skillOptions, 'Any')}
        {multi('sources', 'Source', selectedSources, sourceOptions, 'All sources')}
      </div>

      <div className="mz-toolbar">
        <span>
          Showing <b className="num">{Math.min(shownCompanies, filteredCompanies.length).toLocaleString('en-US')}</b> of <b className="num">{filteredCompanies.length.toLocaleString('en-US')}</b> companies
          {hasActiveFilters && <> with <b className="num">{filteredJobs.length.toLocaleString('en-US')}</b> matching jobs</>}
          {activeFilterCount > 0 && <> · <button type="button" className="mz-link" onClick={clearFilters}>Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}</button></>}
        </span>
        <label className="mz-field co-sort">
          <span className="sr-only">Sort</span>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort companies">
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>

      {filteredCompanies.length === 0 ? (
        <EmptyState title="No companies match">Try a wider location or clear a filter.</EmptyState>
      ) : (
        <div className="co-list" role="list">
          <div className="co-row co-row--head" aria-hidden="true">
            <span>Company</span><span>Trade jobs open</span><span>Activity</span><span>Where</span><span>Reach</span><span>Next step</span>
          </div>
          {shown.map(company => {
            const x = companyExtras[company.slug] || { trade: 0, roles: {}, recent: 0, newest: 0, locs: {}, agency: 0, n: 0 }
            const intel = intelligence[company.slug]
            const cov = reach.coverage[company.name.toLowerCase()] || null
            const sig = reach.signals[company.slug] || 0
            const step = nextStep(x, cov, sig)
            const trades = Object.entries(x.roles).sort((a, b) => b[1] - a[1])
            const locs = Object.entries(x.locs).sort((a, b) => b[1] - a[1])
            const isAgency = x.n > 0 && x.agency / x.n > 0.5
            const isExpanded = expandedCompany === company.slug
            return (
              <div key={company.slug} className="co-item" role="listitem">
                <div className="co-row">
                  <div className="co-name">
                    <Link to={`/companies/${company.slug}`} className="co-name__a">{company.name}</Link>
                    <span className="co-name__meta">
                      {intel?.hq || (isAgency ? 'Staffing agency' : null)}
                      {intel?.sector && <span className="co-name__sector">{intel.sector}</span>}
                    </span>
                    {intel && (
                      <button type="button" className="mz-link co-name__more" onClick={() => setExpandedCompany(isExpanded ? null : company.slug)}>
                        {isExpanded ? 'Hide profile' : 'Profile'}
                      </button>
                    )}
                  </div>

                  <div className="co-cell co-trade">
                    <span className="co-label">Trade jobs open</span>
                    <span className="co-big num">{x.trade.toLocaleString('en-US')}</span>
                    <span className="co-sub num">of {company.activeJobs.toLocaleString('en-US')} open</span>
                    {trades.length > 0 && (
                      <span className="co-tags">
                        {trades.slice(0, 2).map(([id, n]) => <span key={id} className="mz-tag">{roleLabels[id] || id} <span className="num">{n}</span></span>)}
                        {trades.length > 2 && <span className="co-more">+{trades.length - 2} more</span>}
                      </span>
                    )}
                  </div>

                  <div className="co-cell">
                    <span className="co-label">Activity</span>
                    {x.recent > 0
                      ? <span className="co-strong num">+{x.recent.toLocaleString('en-US')} new in 30 days</span>
                      : <span className="co-quiet">None new in 30 days</span>}
                    {x.newest > 0 && <span className="co-sub">Newest {ago(x.newest)}</span>}
                  </div>

                  <div className="co-cell">
                    <span className="co-label">Where</span>
                    {locs.length === 0 ? <span className="co-quiet">Not stated</span> : (
                      <>
                        <span className="co-loc">{locs[0][0]}</span>
                        {locs[1] && <span className="co-sub">{locs[1][0]}</span>}
                        {locs.length > 2 && <span className="co-sub">and {(locs.length - 2).toLocaleString('en-US')} other location{locs.length - 2 === 1 ? '' : 's'}</span>}
                      </>
                    )}
                  </div>

                  <div className="co-cell">
                    <span className="co-label">Reach</span>
                    {cov ? (
                      <span className="co-strong num">{cov.identified} contact{cov.identified === 1 ? '' : 's'}<span className="co-sub-inline"> · {cov.with_email} with email</span></span>
                    ) : <span className="co-quiet">No contacts yet</span>}
                    {sig > 0 && <Link to="/feed" className="co-sub co-signal">{sig} project signal{sig === 1 ? '' : 's'} in the feed</Link>}
                  </div>

                  <div className={`co-cell co-next co-next--${step.tone}`}>
                    <span className="co-label">Next step</span>
                    <Link to={`/companies/${company.slug}`} className="co-next__a">{step.label}<span aria-hidden="true"> →</span></Link>
                    <span className="co-sub">{step.why}</span>
                  </div>
                </div>
                {isExpanded && intel && (
                  <div className="co-intel">
                    <CompanyIntelPanel intel={intel} companyDetail={getCompanyDetail(company.slug, filteredJobs)} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {filteredCompanies.length > shownCompanies && (
        <div className="co-more-wrap">
          <button type="button" className="mz-btn mz-btn--quiet" onClick={() => setShownCompanies(n => n + COMPANIES_PAGE_SIZE)}>
            Show more companies ({(filteredCompanies.length - shownCompanies).toLocaleString('en-US')} remaining)
          </button>
        </div>
      )}

      <p className="co-foot">
        Trade jobs are open jobs matched to a Moblyze trade. Activity counts jobs with a posting date in the last 30 days. Contact counts come from the BD feed's saved lookups; nothing on this page looks anyone up.
      </p>
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

class CompaniesErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[CompaniesPage] Error caught by boundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <h2 className="text-lg font-semibold text-red-900 mb-2">Something went wrong</h2>
          <p className="text-red-700 mb-4">{this.state.error?.message || 'An unexpected error occurred'}</p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload() }}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Reload Page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function CompaniesPageWithBoundary() {
  return (
    <CompaniesErrorBoundary>
      <CompaniesPage />
    </CompaniesErrorBoundary>
  )
}

export default CompaniesPageWithBoundary
