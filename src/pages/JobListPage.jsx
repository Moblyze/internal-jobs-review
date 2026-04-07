import { useState, useMemo, useEffect } from 'react'
import InfiniteScroll from 'react-infinite-scroll-component'
import { format, formatDistanceToNow } from 'date-fns'
import { useJobs, useFilterOptions, getUniqueCompanies, getUniqueLocations, getUniqueSkills, getUniqueCertifications, getCertificationsWithCounts, getEnergyRoles, filterJobsByRole } from '../hooks/useJobs'
import { useFilterParams } from '../hooks/useFilterParams'
import { getAllLocationsAsync } from '../utils/locationParser'
import { createGroupedLocationOptionsWithGeodata } from '../utils/locationGeodata'
import { extractJobCertifications } from '../utils/certificationExtractor'
import { ALL_ENERGY_REGIONS, getRegionLocationValues } from '../utils/energyRegions'
import { getMarketLabel, PRIORITY_MARKET_SLUGS, FOCUS_MARKET_LABELS } from '../utils/focusMarkets'
import { jobMatchesMarkets, jobMatchesMarketContent, CONTENT_MATCHED_MARKETS } from '../utils/marketContentMatcher'
import { normalizeCompanyName } from '../utils/companyNormalizer'
import { FOCUS_COMPANIES } from '../utils/focusCompanies'
import { isAgencyJob } from '../utils/agencyBlocklist'
import { normalizeEmploymentType, jobMatchesEmploymentTypes, CANONICAL_TYPES } from '../utils/employmentTypeNormalizer'
import FiltersSearchable from '../components/FiltersSearchable'
import JobCard from '../components/JobCard'
import SEO from '../components/SEO'
import ShareFilterButton from '../components/ShareFilterButton'

const JOBS_PER_PAGE = 24

function JobListPage() {
  const { jobs, loading, error, lastUpdated, refresh, geocodingStatus } = useJobs()
  const filterOptions = useFilterOptions()
  const { filters, setFilters } = useFilterParams()
  const [displayedCount, setDisplayedCount] = useState(JOBS_PER_PAGE)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [currentTime, setCurrentTime] = useState(Date.now())
  const [showRefreshSuccess, setShowRefreshSuccess] = useState(false)

  // ── Pre-computed filter options (instant from filter-options.json) ─────────
  // These are available before jobs finish loading, making filters interactive immediately.

  // Companies: use pre-computed list, fall back to runtime computation
  const companies = useMemo(() => {
    if (filterOptions?.companies) {
      return filterOptions.companies.map(c => c.name).sort()
    }
    return getUniqueCompanies(jobs)
  }, [filterOptions, jobs])

  // Employment types: normalize raw values into canonical categories
  const employmentTypes = useMemo(() => {
    // Aggregate counts from pre-computed or runtime data
    const source = filterOptions?.employmentTypes
      ? filterOptions.employmentTypes
      : (() => {
          const counts = {}
          jobs.forEach(job => {
            if (job.status === 'removed' || job.status === 'paused') return
            if (job.employmentType) {
              counts[job.employmentType] = (counts[job.employmentType] || 0) + 1
            }
          })
          return Object.entries(counts).map(([name, count]) => ({ name, count }))
        })()

    // Consolidate into canonical types
    const canonicalCounts = {}
    source.forEach(({ name, count }) => {
      const normalized = normalizeEmploymentType(name)
      if (normalized) {
        canonicalCounts[normalized] = (canonicalCounts[normalized] || 0) + count
      }
    })

    // Return in canonical order, only types that have jobs
    return CANONICAL_TYPES.filter(t => canonicalCounts[t] > 0)
  }, [filterOptions, jobs])

  // Sources: use pre-computed, fall back to runtime
  const sources = useMemo(() => {
    if (filterOptions?.sources) return filterOptions.sources
    const counts = {}
    jobs.forEach(job => {
      if (job.status === 'removed' || job.status === 'paused') return
      const src = job.source || 'direct'
      counts[src] = (counts[src] || 0) + 1
    })
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [filterOptions, jobs])

  // Search profiles: use pre-computed, fall back to runtime
  const searchProfiles = useMemo(() => {
    if (filterOptions?.profiles) return filterOptions.profiles
    const counts = {}
    jobs.forEach(job => {
      if (job.status === 'removed' || job.status === 'paused') return
      if (job.profile) {
        counts[job.profile] = (counts[job.profile] || 0) + 1
      }
    })
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [filterOptions, jobs])

  // Focus markets: ensure all defined markets appear, with content-based counts
  const focusMarkets = useMemo(() => {
    const activeJobs = jobs.filter(j => j.status !== 'removed' && j.status !== 'paused')

    // Build profile-based counts from pre-computed or runtime data
    const counts = {}
    if (filterOptions?.focusMarkets) {
      filterOptions.focusMarkets.forEach(m => { counts[m.slug] = m.count })
    } else {
      activeJobs.forEach(job => {
        if (job.profile) {
          counts[job.profile] = (counts[job.profile] || 0) + 1
        }
      })
    }

    // For content-matched markets, count jobs matching by content (not just profile)
    CONTENT_MATCHED_MARKETS.forEach(slug => {
      const contentCount = activeJobs.filter(job => jobMatchesMarketContent(job, slug)).length
      // Use the higher of profile count and content count
      counts[slug] = Math.max(counts[slug] || 0, contentCount)
    })

    // Include all defined focus markets
    const all = Object.entries(FOCUS_MARKET_LABELS).map(([slug, label]) => ({
      slug,
      label,
      count: counts[slug] || 0,
      isPriority: PRIORITY_MARKET_SLUGS.includes(slug),
    }))

    return all.sort((a, b) => {
      if (a.isPriority && !b.isPriority) return -1
      if (!a.isPriority && b.isPriority) return 1
      return b.count - a.count
    })
  }, [filterOptions, jobs])

  // Certifications: use pre-computed, fall back to async loading
  const precomputedCertifications = useMemo(() => {
    if (filterOptions?.certifications) {
      return filterOptions.certifications
    }
    return null
  }, [filterOptions])

  // Top companies: show focus companies that exist in the data
  const precomputedTopCompanies = useMemo(() => {
    const companySet = new Set(companies)
    return FOCUS_COMPANIES.filter(c => companySet.has(c))
  }, [companies])

  // Inactive job count: use pre-computed or compute from jobs
  const inactiveJobsCount = useMemo(() => {
    if (filterOptions?.totalInactive !== undefined) return filterOptions.totalInactive
    return jobs.filter(job => job.status === 'removed' || job.status === 'paused').length
  }, [filterOptions, jobs])

  // App-ready count: use pre-computed or compute from jobs
  const appReadyCount = useMemo(() => {
    if (filterOptions?.appReadyCount !== undefined) return filterOptions.appReadyCount
    return jobs.filter(j => j.appReady).length
  }, [filterOptions, jobs])

  // Agency jobs count: active jobs from blocked recruitment agencies
  const agencyJobsCount = useMemo(() => {
    return jobs.filter(j => j.status !== 'removed' && j.status !== 'paused' && isAgencyJob(j)).length
  }, [jobs])

  // ── Async filter data (locations, skills, roles — still need runtime computation) ──

  const [locations, setLocations] = useState([])
  const [locationOptions, setLocationOptions] = useState([])
  const [skills, setSkills] = useState([])
  const [certifications, setCertifications] = useState([])
  // Precomputed map of job ID -> validated canonical skill names for consistent filter matching
  const [validatedSkillsByJob, setValidatedSkillsByJob] = useState(new Map())

  // State for roles (loaded async)
  const [roles, setRoles] = useState([])

  // State for top items that require async computation
  const [topLocations, setTopLocations] = useState([])
  const [topSkills, setTopSkills] = useState([])

  // Show jobs immediately -- set filteredJobs from jobs before filters load
  const [filtersReady, setFiltersReady] = useState(false)

  // Initialize certifications from pre-computed data if available
  useEffect(() => {
    if (precomputedCertifications && certifications.length === 0) {
      setCertifications(precomputedCertifications)
    }
  }, [precomputedCertifications])

  // Load async filter data when jobs change (non-blocking -- jobs render immediately)
  useEffect(() => {
    if (jobs.length === 0) return

    let cancelled = false

    async function loadFilterData() {
      // Phase 1: Fast filters (locations, roles) -- unblock rendering quickly
      // Note: certifications now come from pre-computed filter-options.json
      const [locationOptionsResult, locationsResult, rolesResult] = await Promise.allSettled([
        createGroupedLocationOptionsWithGeodata(jobs),
        getUniqueLocations(jobs),
        getEnergyRoles(jobs),
      ])

      if (cancelled) return

      if (locationOptionsResult.status === 'fulfilled') {
        setLocationOptions(locationOptionsResult.value)
        // Derive top locations from the grouped options (no extra computation)
        const { getTopLocationsFormatted } = await import('../utils/locationGeodata')
        getTopLocationsFormatted(jobs, 10).then(locs => {
          if (!cancelled) setTopLocations(locs)
        })
      }
      if (locationsResult.status === 'fulfilled') setLocations(locationsResult.value)
      if (rolesResult.status === 'fulfilled') setRoles(rolesResult.value)

      // If certifications weren't pre-computed, load them async
      if (!precomputedCertifications) {
        try {
          const certsResult = await getCertificationsWithCounts(jobs)
          if (!cancelled) setCertifications(certsResult)
        } catch (err) {
          console.error('[JobListPage] Failed to load certifications:', err)
        }
      }

      // Phase 2: Expensive skills processing (does not block filter display)
      try {
        console.log('[JobListPage] Starting to load skills from', jobs.length, 'jobs')
        const processedSkills = await getUniqueSkills(jobs)
        if (cancelled) return

        console.log('[JobListPage] Skills processed:', processedSkills.length, 'skills')
        setSkills(processedSkills)

        // Build per-job validated skills map so filter uses same canonical names as dropdown
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

        // Get top skills (uses already-loaded O*NET cache)
        const { getTopSkills: getTopSkillsFn } = await import('../hooks/useJobs')
        const ts = await getTopSkillsFn(jobs, 10)
        if (!cancelled) setTopSkills(ts)
      } catch (err) {
        console.error('[JobListPage] Failed to load skills:', err)
        if (!cancelled) setSkills([])
      }

      if (!cancelled) setFiltersReady(true)
    }

    loadFilterData()

    return () => { cancelled = true }
  }, [jobs, precomputedCertifications])

  // Filter jobs (with role filtering handled asynchronously)
  const [filteredJobs, setFilteredJobs] = useState([])

  // Pre-computed map of job.location -> parsed locations array (built once, used by filter)
  const [jobLocationsCacheRef, setJobLocationsCacheRef] = useState(new Map())

  // Build location cache when jobs load (runs once, not on every filter change)
  useEffect(() => {
    if (jobs.length === 0) return
    let cancelled = false

    async function buildLocationCache() {
      const cache = new Map()
      // Process in batches of 500 to avoid blocking main thread
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
        // Yield to main thread between batches
        if (i + 500 < jobs.length) {
          await new Promise(r => setTimeout(r, 0))
        }
      }
      if (!cancelled) {
        setJobLocationsCacheRef(cache)
      }
    }

    buildLocationCache()
    return () => { cancelled = true }
  }, [jobs])

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
        // Deduplicate
        expandedLocations = [...new Set(expandedLocations)]
      }

      // Use pre-built location cache (no async re-parsing per filter change)
      const locationCacheReady = jobLocationsCacheRef.size > 0

      // Check if this effect was cancelled while async work was happening
      if (isCancelled) {
        return
      }

      let result = jobs.filter((job) => {
        // Status filter (hide inactive unless toggled)
        if (!filters.showInactive && (job.status === 'removed' || job.status === 'paused')) {
          return false
        }

        // Agency filter: OFF = hide agency jobs, ON = show ONLY agency jobs
        const jobIsAgency = isAgencyJob(job)
        if (filters.showAgencyJobs && !jobIsAgency) {
          return false
        }
        if (!filters.showAgencyJobs && jobIsAgency) {
          return false
        }

        // Company filter (compare against normalized name so variants match)
        if (filters.companies.length > 0 && !filters.companies.includes(normalizeCompanyName(job.company))) {
          return false
        }

        // Location filter (includes expanded regions)
        if (expandedLocations.length > 0) {
          if (!locationCacheReady) return true // Don't filter by location until cache is ready
          const jobLocations = jobLocationsCacheRef.get(job.location) || []
          const hasLocation = expandedLocations.some(filterLoc =>
            jobLocations.includes(filterLoc)
          )
          if (!hasLocation) return false
        }

        // Skills filter (uses precomputed canonical names for consistent matching)
        if (filters.skills.length > 0) {
          const canonicalSkills = validatedSkillsByJob.get(job.id) || job.skills || []
          const jobSkillsLower = canonicalSkills.map(s => s.toLowerCase())
          const hasSkill = filters.skills.some(skill => jobSkillsLower.includes(skill.toLowerCase()))
          if (!hasSkill) return false
        }

        // Certifications filter (job must have at least one selected certification)
        if (filters.certifications.length > 0) {
          const jobCertifications = extractJobCertifications(job)
          const hasCertification = filters.certifications.some(cert =>
            jobCertifications.includes(cert)
          )
          if (!hasCertification) return false
        }

        // Employment type filter (compares against normalized canonical types)
        if (filters.employmentTypes?.length > 0) {
          if (!jobMatchesEmploymentTypes(job, filters.employmentTypes)) {
            return false
          }
        }

        // Source filter (jobs without source field are "direct")
        if (filters.sources?.length > 0) {
          const jobSource = job.source || 'direct'
          if (!filters.sources.includes(jobSource)) {
            return false
          }
        }

        // Profile filter (only aggregator jobs have profiles)
        if (filters.profiles?.length > 0) {
          if (!job.profile || !filters.profiles.includes(job.profile)) {
            return false
          }
        }

        // Focus market filter (matches by profile or content)
        if (filters.market?.length > 0) {
          if (!jobMatchesMarkets(job, filters.market)) {
            return false
          }
        }

        // App-ready filter (jobs suitable for seeding in the mobile app)
        if (filters.appReadyOnly && !job.appReady) {
          return false
        }

        return true
      })

      // Apply role filter (async)
      if (filters.roles && filters.roles.length > 0) {
        result = await filterJobsByRole(result, filters.roles)
      }

      // Check again after async role filtering
      if (isCancelled) {
        return
      }

      setFilteredJobs(result)
    }

    applyFilters()

    // Cleanup function to cancel this effect if filters change before it completes
    return () => {
      isCancelled = true
    }
  }, [jobs, filters, locationOptions, jobLocationsCacheRef, validatedSkillsByJob])

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
              Updated {format(lastUpdated, 'd MMM, yyyy')} at {format(lastUpdated, 'h:mm a')} ({formatDistanceToNow(lastUpdated, { addSuffix: true, includeSeconds: false })})
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
