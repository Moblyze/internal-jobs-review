import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useJobs, getSimilarJobs, getFullJob } from '../hooks/useJobs'
import { formatDate, companyToSlug, findJobBySlug } from '../utils/formatters'
import { normalizeCompanyName } from '../utils/companyNormalizer'
import { formatJobDescription } from '../utils/contentFormatter'
import { getAllLocations } from '../utils/locationParser'
import { filterValidSkills } from '../utils/skillValidator'
import { ensureCleanText } from '../utils/htmlCleaner'
import Breadcrumbs from '../components/Breadcrumbs'
import JobCard from '../components/JobCard'
import StructuredJobDescription from '../components/StructuredJobDescription'
import EnhanceWithAIButton from '../components/EnhanceWithAIButton'
import TranslateButton from '../components/TranslateButton'

/**
 * Map app employment type values to schema.org EmploymentType values
 */
function mapEmploymentType(type) {
  if (!type) return undefined
  const mapping = {
    'Full-Time': 'FULL_TIME',
    'Part-Time': 'PART_TIME',
    'Contractor': 'CONTRACTOR',
    'Temporary': 'TEMPORARY',
    'Internship': 'INTERN',
  }
  return mapping[type] || undefined
}

/**
 * Parse a location string like "Houston, TX" into addressLocality and addressRegion
 */
function parseLocationForSchema(locationStr) {
  if (!locationStr) return null
  const parts = locationStr.split(',').map(p => p.trim())
  const address = { '@type': 'PostalAddress' }
  if (parts.length >= 2) {
    address.addressLocality = parts[0]
    address.addressRegion = parts[1]
  } else {
    address.addressLocality = parts[0]
  }
  return address
}

/**
 * Build schema.org JobPosting structured data from a job object
 */
function buildJobPostingSchema(job, locations) {
  const postedDate = job.postedDate ? new Date(job.postedDate) : null
  const postedIso = postedDate ? postedDate.toISOString().split('T')[0] : undefined

  let validThrough
  if (postedDate) {
    const expiry = new Date(postedDate)
    expiry.setDate(expiry.getDate() + 90)
    validThrough = expiry.toISOString().split('T')[0]
  }

  const schema = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description,
    datePosted: postedIso,
    validThrough,
    hiringOrganization: {
      '@type': 'Organization',
      name: job.company,
    },
  }

  const employmentType = mapEmploymentType(job.employmentType)
  if (employmentType) {
    schema.employmentType = employmentType
  }

  // Job location(s)
  if (locations && locations.length > 0) {
    const schemaLocations = locations.map(loc => ({
      '@type': 'Place',
      address: parseLocationForSchema(loc),
    }))
    schema.jobLocation = schemaLocations.length === 1 ? schemaLocations[0] : schemaLocations
  }

  // Salary
  if (job.salary) {
    schema.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: {
        '@type': 'QuantitativeValue',
        value: job.salary,
      },
    }
  }

  // Skills
  const validSkills = filterValidSkills(job.skills)
  if (validSkills.length > 0) {
    schema.skills = validSkills.join(', ')
  }

  // Direct apply URL
  if (job.url) {
    schema.url = job.url
  }

  return schema
}

function JobDetailPage() {
  const { jobSlug } = useParams()
  const { jobs, loading, error } = useJobs()
  const [searchParams] = useSearchParams()
  const searchString = searchParams.toString()

  // State must be declared before any conditional returns (React hooks rule)
  const [descriptionView, setDescriptionView] = useState('ai')
  const [similarJobs, setSimilarJobs] = useState([])
  const [clientEnhancement, setClientEnhancement] = useState(null)
  const [translatedDescription, setTranslatedDescription] = useState(null)
  const [fullJob, setFullJob] = useState(null)

  // Find job before useEffect (but after hooks)
  const indexJob = !loading && !error ? findJobBySlug(jobs, jobSlug) : null

  // Load full job data (with description) on demand for detail view
  useEffect(() => {
    if (indexJob) {
      getFullJob(indexJob).then(setFullJob).catch(err => {
        console.error('Failed to load full job data:', err)
        setFullJob(indexJob) // Fallback to index data
      })
    }
  }, [indexJob])

  // Use full job if loaded, otherwise fall back to index data
  const job = fullJob || indexJob

  // Load similar jobs when job changes - MUST be before conditional returns
  useEffect(() => {
    if (job && jobs) {
      getSimilarJobs(jobs, job, 5).then(setSimilarJobs).catch(err => {
        console.error('Failed to load similar jobs:', err)
        setSimilarJobs([])
      })
    }
  }, [jobs, job])

  // Inject schema.org JobPosting structured data
  useEffect(() => {
    if (!job) return

    const locations = getAllLocations(job.location)
    const schema = buildJobPostingSchema(job, locations)
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.setAttribute('data-schema', 'job-posting')
    script.textContent = JSON.stringify(schema)
    document.head.appendChild(script)

    return () => {
      document.head.removeChild(script)
    }
  }, [job])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading job details...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <h2 className="text-lg font-semibold text-red-900 mb-2">Error Loading Job</h2>
        <p className="text-red-700">{error}</p>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
        <h2 className="text-lg font-semibold text-yellow-900 mb-2">Job Not Found</h2>
        <p className="text-yellow-700">The job you're looking for doesn't exist.</p>
      </div>
    )
  }

  // Format job description into structured content blocks
  const formattedDescription = formatJobDescription(job.description)
  const locations = getAllLocations(job.location)

  // Check if job has AI-structured description (from jobs.json or client enhancement)
  const structuredDescription = clientEnhancement || job.structuredDescription
  const hasStructuredDescription = structuredDescription &&
    structuredDescription.sections &&
    structuredDescription.sections.length > 0

  // Handler for when AI enhancement completes
  const handleEnhanced = (newStructuredDescription) => {
    setClientEnhancement(newStructuredDescription)
    setDescriptionView('ai') // Auto-switch to AI view
  }

  const displayCompany = normalizeCompanyName(job.company)
  const breadcrumbItems = [
    {
      label: displayCompany,
      href: `/companies/${companyToSlug(displayCompany)}`
    },
    {
      label: job.title
    }
  ]

  return (
    <div>
      <Breadcrumbs items={breadcrumbItems} />

      {/* Job Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          {job.title}
        </h1>

        <div className="flex flex-wrap items-center gap-4 mb-4">
          <Link
            to={`/companies/${companyToSlug(displayCompany)}${searchString ? `?${searchString}` : ''}`}
            className="text-blue-600 hover:text-blue-700 font-medium text-lg"
          >
            {displayCompany}
          </Link>

          {locations.length > 0 && (
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
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
          {job.employmentType && (
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              job.employmentType === 'Contractor'
                ? 'bg-orange-100 text-orange-800'
                : job.employmentType === 'Full-Time'
                ? 'bg-green-100 text-green-800'
                : job.employmentType === 'Part-Time'
                ? 'bg-purple-100 text-purple-800'
                : job.employmentType === 'Temporary'
                ? 'bg-yellow-100 text-yellow-800'
                : job.employmentType === 'Internship'
                ? 'bg-teal-100 text-teal-800'
                : 'bg-gray-100 text-gray-800'
            }`}>
              {job.employmentType}
            </span>
          )}

          {job.postedDate && (
            <div className="flex items-center">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"></path>
              </svg>
              Posted {formatDate(job.postedDate)}
            </div>
          )}

          {job.salary && (
            <div className="flex items-center text-green-600 font-medium">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path d="M8.16 5.314l4.897-1.596A1 1 0 0114.82 4.62l1.07 6.263c.08.471-.122.92-.564 1.15l-6.693 3.695a1 1 0 01-1.466-.756l-1.068-6.263a1 1 0 01.997-1.195z"></path>
              </svg>
              {job.salary}
            </div>
          )}
        </div>
      </div>

      {/* Job Description */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-gray-900 whitespace-nowrap">Job Description</h2>
            <TranslateButton text={job.description} onTranslated={setTranslatedDescription} />
          </div>

          {/* Toggle Button and Badge OR Enhance Button */}
          {hasStructuredDescription ? (
            <div className="flex items-center gap-2">
              {/* Version Badge */}
              <span className={`inline-flex items-center px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs font-medium ${
                descriptionView === 'ai'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {descriptionView === 'ai' ? (
                  <>
                    <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                    </svg>
                    AI Enhanced
                  </>
                ) : (
                  <>Original</>
                )}
              </span>

              {/* Toggle Button */}
              <button
                onClick={() => setDescriptionView(descriptionView === 'ai' ? 'original' : 'ai')}
                className="inline-flex items-center px-2.5 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors whitespace-nowrap"
              >
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                {descriptionView === 'ai' ? 'View Original' : 'View AI-Structured'}
              </button>
            </div>
          ) : (
            <EnhanceWithAIButton job={job} onEnhanced={handleEnhanced} />
          )}
        </div>

        {/* Description Content */}
        {translatedDescription ? (
          <div className="prose prose-sm max-w-none text-gray-700">
            <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{translatedDescription}</p>
          </div>
        ) : descriptionView === 'ai' && hasStructuredDescription ? (
          <StructuredJobDescription description={structuredDescription} />
        ) : (
          <div className="prose prose-sm max-w-none text-gray-700">
            {formattedDescription.length > 0 ? (
              formattedDescription.map((block, index) => {
                switch (block.type) {
                  case 'header':
                    return (
                      <h3 key={index} className="text-lg font-semibold text-gray-900 mt-6 mb-3 first:mt-0">
                        {block.content}
                      </h3>
                    )
                  case 'list':
                    return (
                      <ul key={index} className="list-disc list-inside space-y-2 my-4 ml-2">
                        {block.items.map((item, itemIndex) => (
                          <li key={itemIndex} className="text-gray-700 leading-relaxed">
                            {item}
                          </li>
                        ))}
                      </ul>
                    )
                  case 'paragraph':
                    return (
                      <p key={index} className="text-gray-700 leading-relaxed my-3">
                        {block.content}
                      </p>
                    )
                  default:
                    return null
                }
              })
            ) : (
              <p className="text-gray-700 whitespace-pre-wrap">{ensureCleanText(job.description)}</p>
            )}
          </div>
        )}

        {(() => {
          const validSkills = filterValidSkills(job.skills);
          if (validSkills.length === 0) return null;

          return (
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Required Skills</h3>
              <div className="flex flex-wrap gap-2">
                {validSkills.map((skill, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          );
        })()}

        <div className="mt-6 pt-6 border-t border-gray-200">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            View Original Posting
            <svg className="ml-2 -mr-1 w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd"></path>
            </svg>
          </a>
        </div>
      </div>

      {/* Similar Jobs */}
      {similarJobs.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Similar Jobs</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {similarJobs.map(similarJob => (
              <JobCard key={similarJob.id} job={similarJob} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default JobDetailPage
