import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useJobs, getJobById, getSimilarJobs } from '../hooks/useJobs'
import { formatDate, companyToSlug } from '../utils/formatters'
import { formatJobDescription } from '../utils/contentFormatter'
import { formatLocation } from '../utils/locationParser'
import { filterValidSkills } from '../utils/skillValidator'
import Breadcrumbs from '../components/Breadcrumbs'
import JobCard from '../components/JobCard'
import StructuredJobDescription from '../components/StructuredJobDescription'

function JobDetailPage() {
  const { jobId } = useParams()
  const { jobs, loading, error } = useJobs()

  // State must be declared before any conditional returns (React hooks rule)
  const [descriptionView, setDescriptionView] = useState('ai')

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

  const job = getJobById(jobs, jobId)

  if (!job) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
        <h2 className="text-lg font-semibold text-yellow-900 mb-2">Job Not Found</h2>
        <p className="text-yellow-700">The job you're looking for doesn't exist.</p>
      </div>
    )
  }

  const similarJobs = getSimilarJobs(jobs, job, 5)

  // Format job description into structured content blocks
  const formattedDescription = formatJobDescription(job.description)
  const formattedLocation = formatLocation(job.location)

  // Check if job has AI-structured description
  const hasStructuredDescription = job.structuredDescription &&
    job.structuredDescription.sections &&
    job.structuredDescription.sections.length > 0

  const breadcrumbItems = [
    {
      label: job.company,
      href: `/companies/${companyToSlug(job.company)}`
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
          <a
            href={`/companies/${companyToSlug(job.company)}`}
            className="text-blue-600 hover:text-blue-700 font-medium text-lg"
          >
            {job.company}
          </a>

          {formattedLocation && (
            <div className="flex items-center text-gray-600">
              <svg className="w-5 h-5 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"></path>
              </svg>
              {formattedLocation}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
          {job.postedDate && (
            <div className="flex items-center">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"></path>
              </svg>
              Posted {formatDate(job.postedDate)}
            </div>
          )}

          {job.salary && (
            <div className="flex items-center font-medium text-green-600">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z"></path>
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd"></path>
              </svg>
              {job.salary}
            </div>
          )}
        </div>
      </div>

      {/* Job Description */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Job Description</h2>

          {/* Toggle Button and Badge */}
          {hasStructuredDescription && (
            <div className="flex items-center gap-3">
              {/* Version Badge */}
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
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
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                {descriptionView === 'ai' ? 'View Original' : 'View AI-Structured'}
              </button>
            </div>
          )}
        </div>

        {/* Description Content */}
        {descriptionView === 'ai' && hasStructuredDescription ? (
          <StructuredJobDescription description={job.structuredDescription} />
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
              <p className="text-gray-700 whitespace-pre-wrap">{job.description}</p>
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
