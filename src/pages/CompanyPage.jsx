import { useParams } from 'react-router-dom'
import { useJobs, getJobsByCompany } from '../hooks/useJobs'
import { slugToCompany } from '../utils/formatters'
import { getAllLocations } from '../utils/locationParser'
import Breadcrumbs from '../components/Breadcrumbs'
import JobCard from '../components/JobCard'

function CompanyPage() {
  const { companySlug } = useParams()
  const { jobs, loading, error } = useJobs()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading company jobs...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <h2 className="text-lg font-semibold text-red-900 mb-2">Error Loading Company</h2>
        <p className="text-red-700">{error}</p>
      </div>
    )
  }

  const companyJobs = getJobsByCompany(jobs, companySlug)
  const companyName = companyJobs.length > 0
    ? companyJobs[0].company
    : slugToCompany(companySlug)

  // Get unique locations for this company
  const allLocationArrays = companyJobs
    .map(job => getAllLocations(job.location))
    .filter(locs => locs.length > 0);

  const locations = [...new Set(allLocationArrays.flat())].sort();

  const breadcrumbItems = [
    {
      label: companyName
    }
  ]

  return (
    <div>
      <Breadcrumbs items={breadcrumbItems} />

      {/* Company Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          {companyName}
        </h1>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="text-3xl font-bold text-blue-600">{companyJobs.length}</div>
            <div className="text-sm text-gray-600 mt-1">Open Positions</div>
          </div>

          {locations.length > 0 && (
            <div className="bg-green-50 rounded-lg p-4">
              <div className="text-3xl font-bold text-green-600">{locations.length}</div>
              <div className="text-sm text-gray-600 mt-1">Locations</div>
            </div>
          )}
        </div>

        {locations.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Locations:</h3>
            <div className="flex flex-wrap gap-2">
              {locations.map((location, index) => (
                <span
                  key={index}
                  className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700"
                >
                  <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"></path>
                  </svg>
                  {location}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Jobs List */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Open Positions</h2>

        {companyJobs.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
            <p className="text-gray-600">
              No jobs found for {companyName}.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {companyJobs.map(job => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default CompanyPage
