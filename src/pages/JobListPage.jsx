import { useState, useMemo, useEffect } from 'react'
import InfiniteScroll from 'react-infinite-scroll-component'
import { format, formatDistanceToNow } from 'date-fns'
import { useJobs, useSiteFilters } from '../hooks/useJobs'
import { useFilterParams } from '../hooks/useFilterParams'
import { extractJobCertifications } from '../utils/certificationExtractor'
import { ALL_ENERGY_REGIONS, getRegionLocationValues } from '../utils/energyRegions'
import { PRIORITY_MARKET_SLUGS, FOCUS_MARKET_LABELS } from '../utils/focusMarkets'
import { normalizeCompanyName } from '../utils/companyNormalizer'
import { FOCUS_COMPANIES } from '../utils/focusCompanies'
import { isAgencyJob } from '../utils/agencyBlocklist'
import { normalizeEmploymentType, jobMatchesEmploymentTypes, CANONICAL_TYPES } from '../utils/employmentTypeNormalizer'
import FiltersSearchable from '../components/FiltersSearchable'
import JobCard from '../components/JobCard'
import SEO from '../components/SEO'
import ShareFilterButton from '../components/ShareFilterButton'

const JOBS_PER_PAGE = 24
const EMPTY = []

// Facets are precomputed at build time (scripts/build-site-facets.mjs) and decoded onto
// each job: job.locs (parsed locations), job.validSkills (O*NET-validated), job.roleId,
// job.isAgency, job.markets (content-matched focus markets). Fallbacks cover an older
// index without facets.
const jobIsAgency = job => (job.isAgency !== undefined ? job.isAgency : isAgencyJob(job))
const jobMatchesMarketFilter = (job, markets) =>
  markets.some(m => job.profile === m || (job.markets || EMPTY).includes(m))

function JobListPage() {
  const { jobs, loading, error, lastUpdated, refresh, geocodingStatus } = useJobs()
  const siteFilters = useSiteFilters()
  const { filters, setFilters } = useFilterParams()
  const [displayedCount, setDisplayedCount] = useState(JOBS_PER_PAGE)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [, setCurrentTime] = useState(Date.now())
  const [showRefreshSuccess, setShowRefreshSuccess] = useState(false)

  // ── Filter lists: all precomputed, over current jobs only ─────────────────
  const companies = useMemo(
    () => (siteFilters?.companies || EMPTY).map(c => c.name).sort(),
    [siteFilters]
  )

  // Employment types: normalize raw values into canonical categories
  const employmentTypes = useMemo(() => {
    const canonicalCounts = {}
    ;(siteFilters?.employmentTypes || EMPTY).forEach(({ name, count }) => {
      const normalized = normalizeEmploymentType(name)
      if (normalized) canonicalCounts[normalized] = (canonicalCounts[normalized] || 0) + count
    })
    return CANONICAL_TYPES.filter(t => canonicalCounts[t] > 0)
  }, [siteFilters])

  const sources = siteFilters?.sources || EMPTY
  const searchProfiles = siteFilters?.profiles || EMPTY
  const locations = siteFilters?.locations || EMPTY
  const locationOptions = siteFilters?.locationOptions || EMPTY
  const skills = siteFilters?.skills || EMPTY
  const certifications = siteFilters?.certifications || EMPTY
  const roles = siteFilters?.roles || EMPTY
  const topLocations = siteFilters?.topLocations || EMPTY
  const topSkills = siteFilters?.topSkills || EMPTY

  // Focus markets: every defined market, profile counts merged with content-matched counts
  const focusMarkets = useMemo(() => {
    const counts = {}
    ;(siteFilters?.focusMarkets || EMPTY).forEach(m => { counts[m.slug] = m.count })
    Object.entries(siteFilters?.contentMarketCounts || {}).forEach(([slug, n]) => {
      counts[slug] = Math.max(counts[slug] || 0, n)
    })
    return Object.entries(FOCUS_MARKET_LABELS)
      .map(([slug, label]) => ({ slug, label, count: counts[slug] || 0, isPriority: PRIORITY_MARKET_SLUGS.includes(slug) }))
      .sort((a, b) => {
        if (a.isPriority && !b.isPriority) return -1
        if (!a.isPriority && b.isPriority) return 1
        return b.count - a.count
      })
  }, [siteFilters])

  // Top companies: focus companies that exist in the data
  const precomputedTopCompanies = useMemo(() => {
    const companySet = new Set(companies)
    return FOCUS_COMPANIES.filter(c => companySet.has(c))
  }, [companies])

  // The site ships current jobs only (removed rows live in the R2 archive)
  const inactiveJobsCount = useMemo(
    () => jobs.filter(job => job.status === 'removed' || job.status === 'paused').length,
    [jobs]
  )

  // App Ready: current jobs only (filter-options.json counted removed jobs too)
  const appReadyCount = useMemo(() => {
    if (siteFilters?.appReadyCount !== undefined) return siteFilters.appReadyCount
    return jobs.filter(j => j.appReady).length
  }, [siteFilters, jobs])

  const agencyJobsCount = useMemo(() => {
    if (siteFilters?.agencyCount !== undefined) return siteFilters.agencyCount
    return jobs.filter(jobIsAgency).length
  }, [siteFilters, jobs])

  // ── Filtering: synchronous, over precomputed facets ─────────────────────────
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

    return jobs.filter(job => {
      if (!filters.showInactive && (job.status === 'removed' || job.status === 'paused')) return false

      // Agency filter: OFF = hide agency jobs, ON = show ONLY agency jobs
      if (Boolean(filters.showAgencyJobs) !== jobIsAgency(job)) return false

      if (companySet && !companySet.has(normalizeCompanyName(job.company))) return false

      if (locSet && !(job.locs || EMPTY).some(l => locSet.has(l))) return false

      if (skillSet) {
        const canonical = job.validSkills || job.skills || EMPTY
        if (!canonical.some(s => skillSet.has(s.toLowerCase()))) return false
      }

      if (filters.certifications?.length > 0) {
        const jobCertifications = extractJobCertifications(job)
        if (!filters.certifications.some(cert => jobCertifications.includes(cert))) return false
      }

      if (filters.employmentTypes?.length > 0 && !jobMatchesEmploymentTypes(job, filters.employmentTypes)) return false

      if (filters.sources?.length > 0 && !filters.sources.includes(job.source || 'direct')) return false

      if (filters.profiles?.length > 0 && (!job.profile || !filters.profiles.includes(job.profile))) return false

      if (filters.market?.length > 0 && !jobMatchesMarketFilter(job, filters.market)) return false

      if (filters.appReadyOnly && !job.appReady) return false

      if (roleSet && !roleSet.has(job.roleId)) return false

      return true
    })
  }, [jobs, filters, locationOptions])

  // Paginated jobs for display
  const visibleJobs = useMemo(() => {
    return filteredJobs.slice(0, displayedCount)
  }, [filteredJobs, displayedCount])

  // Reset pagination when filters change
  useEffect(() => {
    setDisplayedCount(JOBS_PER_PAGE)
  }, [filters])

  // Update current time every minute to refresh "time ago" display
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now())
    }, 60000) // Update every 60 seconds

    return () => clearInterval(interval)
  }, [])

  // Handle scroll for back to top button
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 500)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const loadMoreJobs = () => {
    setDisplayedCount(prev => Math.min(prev + JOBS_PER_PAGE, filteredJobs.length))
  }

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Generate SEO-friendly title and description based on active filters
  const seoTitle = useMemo(() => {
    const parts = []
    if (filters.roles?.length > 0) {
      parts.push(filters.roles.slice(0, 2).join(', '))
    }
    if (filters.locations?.length > 0) {
      parts.push(filters.locations.slice(0, 2).join(', '))
    }
    if (parts.length > 0) {
      return `${parts.join(' - ')} Jobs`
    }
    return 'Job Opportunities'
  }, [filters])

  const seoDescription = useMemo(() => {
    const parts = [`${filteredJobs.length} jobs available`]
    if (filters.companies?.length > 0) {
      parts.push(`at ${filters.companies.slice(0, 3).join(', ')}`)
    }
    if (filters.locations?.length > 0) {
      parts.push(`in ${filters.locations.slice(0, 3).join(', ')}`)
    }
    if (filters.skills?.length > 0) {
      parts.push(`requiring ${filters.skills.slice(0, 3).join(', ')}`)
    }
    return parts.join(' ')
  }, [filters, filteredJobs.length])

  const handleRefresh = async () => {
    console.log('[JobListPage] Refresh button clicked - triggering data refresh');
    setShowRefreshSuccess(false);
    await refresh();
    // Show success indicator
    setShowRefreshSuccess(true);
    setTimeout(() => setShowRefreshSuccess(false), 3000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading jobs...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <h2 className="text-lg font-semibold text-red-900 mb-2">Error Loading Jobs</h2>
        <p className="text-red-700">{error}</p>
        <p className="text-sm text-red-600 mt-2">Make sure to run `npm run export-jobs` first.</p>
      </div>
    )
  }

  return (
    <div>
      <SEO
        title={seoTitle}
        description={seoDescription}
      />

      {/* Geocoding Status Notification */}
      {geocodingStatus && (
        <div className={`mb-4 rounded-lg p-4 border ${
          geocodingStatus.type === 'success'
            ? 'bg-green-50 border-green-200 text-green-800'
            : geocodingStatus.type === 'error'
            ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
            : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          {geocodingStatus.type === 'geocoding' && (
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              <div>
                <p className="font-medium">Geocoding new locations...</p>
                {geocodingStatus.current && (
                  <p className="text-sm mt-1">
                    {geocodingStatus.current} of {geocodingStatus.total}: {geocodingStatus.location?.substring(0, 50)}
                  </p>
                )}
              </div>
            </div>
          )}
          {geocodingStatus.type === 'success' && (
            <div>
              <p className="font-medium">✓ {geocodingStatus.message}</p>
              {geocodingStatus.failed > 0 && (
                <p className="text-sm mt-1">{geocodingStatus.failed} locations could not be geocoded</p>
              )}
            </div>
          )}
          {geocodingStatus.type === 'error' && (
            <p className="font-medium">⚠ {geocodingStatus.message}</p>
          )}
        </div>
      )}

      <div className="mb-6">
        <div className="mb-2">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Job Opportunities
            </h1>
            {lastUpdated && (
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <button
                  onClick={handleRefresh}
                  disabled={loading}
                  className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 border border-blue-300 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {loading ? 'Refreshing...' : 'Refresh'}
                </button>
                {showRefreshSuccess && (
                  <span className="text-green-600 text-sm font-medium animate-fade-in">
                    ✓
                  </span>
                )}
              </div>
            )}
          </div>
          {lastUpdated && (
            <p className="text-xs text-gray-500 mt-1">
              Data updated {format(lastUpdated, 'MMM d, yyyy')} at {format(lastUpdated, 'h:mm a')} ({formatDistanceToNow(lastUpdated, { addSuffix: true, includeSeconds: false })})
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-gray-600">
            Showing {filteredJobs.length} of {jobs.length} jobs
            {filters.showAgencyJobs && agencyJobsCount > 0 && (
              <span className="text-orange-600 ml-1">(agency jobs only)</span>
            )}
          </p>
          {(filters.companies?.length > 0 || filters.locations?.length > 0 || filters.skills?.length > 0 || filters.certifications?.length > 0 || filters.roles?.length > 0 || filters.employmentTypes?.length > 0 || filters.sources?.length > 0 || filters.profiles?.length > 0 || filters.market?.length > 0) && (
            <ShareFilterButton />
          )}
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <label className="inline-flex items-center cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={filters.appReadyOnly || false}
                onChange={(e) => setFilters({ ...filters, appReadyOnly: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
            </div>
            <span className="ml-2 text-sm font-medium text-gray-700">App Ready ({appReadyCount})</span>
          </label>
          {agencyJobsCount > 0 && (
            <label className="inline-flex items-center cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={filters.showAgencyJobs || false}
                  onChange={(e) => setFilters({ ...filters, showAgencyJobs: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"></div>
              </div>
              <span className="ml-2 text-sm font-medium text-gray-700">
                {filters.showAgencyJobs ? `Showing Agency Jobs Only (${agencyJobsCount})` : `Show Agency Jobs (${agencyJobsCount})`}
              </span>
            </label>
          )}
          {inactiveJobsCount > 0 && (
            <label className="inline-flex items-center cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={filters.showInactive || false}
                  onChange={(e) => setFilters({ ...filters, showInactive: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
              </div>
              <span className="ml-2 text-sm font-medium text-gray-700">Include Inactive ({inactiveJobsCount})</span>
            </label>
          )}
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-4 lg:gap-6">
        {/* Filters Sidebar */}
        <div className="lg:col-span-1">
          <FiltersSearchable
            filters={filters}
            onFilterChange={setFilters}
            companies={companies}
            locations={locations}
            skills={skills}
            certifications={certifications}
            roles={roles}
            employmentTypes={employmentTypes}
            sources={sources}
            profiles={searchProfiles}
            focusMarkets={focusMarkets}
            jobs={jobs}
            precomputedLocationOptions={locationOptions}
            precomputedTopCompanies={precomputedTopCompanies}
            precomputedTopLocations={topLocations}
            precomputedTopSkills={topSkills}
          />
        </div>

        {/* Job List */}
        <div className="lg:col-span-3">
          {filteredJobs.length === 0 && jobs.length > 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
              <p className="text-gray-600">
                No jobs match your filters. Try adjusting your criteria.
              </p>
            </div>
          ) : (
            <InfiniteScroll
              dataLength={visibleJobs.length}
              next={loadMoreJobs}
              hasMore={visibleJobs.length < filteredJobs.length}
              loader={
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                    <p className="text-sm text-gray-600">Loading more jobs...</p>
                  </div>
                </div>
              }
              endMessage={
                visibleJobs.length > JOBS_PER_PAGE && (
                  <div className="text-center py-6 text-gray-500 text-sm">
                    You've reached the end of the list
                  </div>
                )
              }
            >
              <div className="grid gap-4 md:grid-cols-2">
                {visibleJobs.map(job => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            </InfiniteScroll>
          )}
        </div>
      </div>

      {/* Back to Top Button */}
      {showBackToTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-8 right-8 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-3 shadow-lg transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 z-50"
          aria-label="Back to top"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      )}
    </div>
  )
}

export default JobListPage
