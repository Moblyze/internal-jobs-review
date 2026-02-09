import { useState, useMemo, useEffect } from 'react'
import InfiniteScroll from 'react-infinite-scroll-component'
import { format, formatDistanceToNow } from 'date-fns'
import { useJobs, getUniqueCompanies, getUniqueLocations, getUniqueSkills, getUniqueCertifications, getCertificationsWithCounts, getEnergyRoles, filterJobsByRole } from '../hooks/useJobs'
import { getAllLocations } from '../utils/locationParser'
import { extractJobCertifications } from '../utils/certificationExtractor'
import FiltersSearchable from '../components/FiltersSearchable'
import JobCard from '../components/JobCard'

const JOBS_PER_PAGE = 24

function JobListPage() {
  const { jobs, loading, error, lastUpdated, refresh, geocodingStatus } = useJobs()
  const [filters, setFilters] = useState({
    companies: [],
    locations: [],
    skills: [],
    certifications: [],
    roles: [],
    showInactive: false // Only show active jobs by default
  })
  const [displayedCount, setDisplayedCount] = useState(JOBS_PER_PAGE)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [currentTime, setCurrentTime] = useState(Date.now())
  const [showRefreshSuccess, setShowRefreshSuccess] = useState(false)

  // Get unique values for filters (sync)
  const companies = useMemo(() => getUniqueCompanies(jobs), [jobs])

  // State for async filter data
  const [locations, setLocations] = useState([])
  const [skills, setSkills] = useState([])
  const [certifications, setCertifications] = useState([])

  // State for roles (loaded async)
  const [roles, setRoles] = useState([])

  // Load async filter data when jobs change
  useEffect(() => {
    if (jobs.length > 0) {
      // Load locations
      getUniqueLocations(jobs).then(setLocations).catch(err => {
        console.error('Failed to load locations:', err)
        setLocations([])
      })

      // Load skills
      console.log('[JobListPage] Starting to load skills from', jobs.length, 'jobs');
      getUniqueSkills(jobs).then(processedSkills => {
        console.log('[JobListPage] Skills processed:', processedSkills.length, 'skills');
        console.log('[JobListPage] First 10 skills:', processedSkills.slice(0, 10));
        setSkills(processedSkills);
      }).catch(err => {
        console.error('[JobListPage] Failed to load skills:', err);
        console.error('[JobListPage] Error stack:', err.stack);
        setSkills([])
      })

      // Load certifications
      getCertificationsWithCounts(jobs).then(setCertifications).catch(err => {
        console.error('Failed to load certifications:', err)
        setCertifications([])
      })

      // Load roles
      getEnergyRoles(jobs).then(setRoles).catch(err => {
        console.error('Failed to load roles:', err)
        setRoles([])
      })
    }
  }, [jobs])

  // Count inactive jobs
  const inactiveJobsCount = useMemo(() => {
    return jobs.filter(job => job.status === 'removed' || job.status === 'paused').length
  }, [jobs])

  // Filter jobs (with role filtering handled asynchronously)
  const [filteredJobs, setFilteredJobs] = useState([])

  useEffect(() => {
    async function applyFilters() {
      console.log('[JobListPage] Applying filters to', jobs.length, 'jobs');
      console.log('[JobListPage] Current filters:', filters);
      let result = jobs.filter(job => {
        // Status filter (hide inactive unless toggled)
        // Only filter out jobs with explicitly inactive statuses (removed, paused)
        // Jobs with "active" or unknown statuses (like timestamps) are shown by default
        if (!filters.showInactive && (job.status === 'removed' || job.status === 'paused')) {
          return false
        }

        // Company filter
        if (filters.companies.length > 0 && !filters.companies.includes(job.company)) {
          return false
        }

        // Location filter
        if (filters.locations.length > 0) {
          const jobLocations = getAllLocations(job.location);
          const hasLocation = filters.locations.some(filterLoc =>
            jobLocations.includes(filterLoc)
          );
          if (!hasLocation) return false;
        }

        // Skills filter (job must have at least one selected skill)
        if (filters.skills.length > 0) {
          const hasSkill = filters.skills.some(skill => job.skills.includes(skill))
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

        return true
      })

      // Apply role filter (async)
      if (filters.roles && filters.roles.length > 0) {
        result = await filterJobsByRole(result, filters.roles)
      }

      console.log('[JobListPage] Filtered jobs count:', result.length);
      setFilteredJobs(result)
    }

    applyFilters()
  }, [jobs, filters])

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
        <div className="flex items-start justify-between mb-2">
          <h1 className="text-3xl font-bold text-gray-900">
            Job Opportunities
          </h1>
          {lastUpdated && (
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRefresh}
                  disabled={loading}
                  className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 border border-blue-300 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Refreshing...' : 'Refresh Jobs'}
                </button>
                {showRefreshSuccess && (
                  <span className="text-green-600 text-sm font-medium animate-fade-in">
                    ✓ Refreshed
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Last refreshed: {format(lastUpdated, 'd MMM, yyyy')} at {format(lastUpdated, 'h:mm a')} ({formatDistanceToNow(lastUpdated, { addSuffix: true, includeSeconds: false })})
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-gray-600">
            Showing {filteredJobs.length} of {jobs.length} jobs
          </p>
          {inactiveJobsCount > 0 && (
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={filters.showInactive}
                onChange={(e) => setFilters({ ...filters, showInactive: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 mr-2"
              />
              <span className="text-sm text-gray-700">Show inactive jobs ({inactiveJobsCount})</span>
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
            jobs={jobs}
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
