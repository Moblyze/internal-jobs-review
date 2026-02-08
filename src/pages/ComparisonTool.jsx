import { useState } from 'react'
import { useJobs, getJobById } from '../hooks/useJobs'
import StructuredJobDescription from '../components/StructuredJobDescription'

function ComparisonTool() {
  const [jobUrl, setJobUrl] = useState('')
  const [selectedJob, setSelectedJob] = useState(null)
  const { jobs, loading } = useJobs()

  const handleSubmit = (e) => {
    e.preventDefault()

    // Extract job ID from URL or use direct ID
    let jobId = jobUrl.trim()

    // If it's a full URL, extract the job ID
    if (jobId.includes('/jobs/')) {
      const parts = jobId.split('/jobs/')
      jobId = parts[1] || parts[0]
    }

    // Remove any trailing slashes or query params
    jobId = jobId.split('?')[0].split('#')[0].replace(/\/$/, '')

    // Find the job
    const job = getJobById(jobs, jobId)
    setSelectedJob(job)
  }

  const handleClear = () => {
    setJobUrl('')
    setSelectedJob(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading jobs...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[1800px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Job Description Comparison Tool
        </h1>
        <p className="text-gray-600">
          Paste any job URL or ID to see before/after AI formatting
        </p>
      </div>

      {/* Input Form */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
        <form onSubmit={handleSubmit} className="flex gap-4">
          <input
            type="text"
            value={jobUrl}
            onChange={(e) => setJobUrl(e.target.value)}
            placeholder="Paste job URL or ID (e.g., http://localhost:5176/jobs/baker-hughes-...)"
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            type="submit"
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Compare
          </button>
          {selectedJob && (
            <button
              type="button"
              onClick={handleClear}
              className="px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              Clear
            </button>
          )}
        </form>

        {selectedJob === null && jobUrl && (
          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800">
              <strong>Job not found.</strong> Please check the URL or ID and try again.
            </p>
          </div>
        )}
      </div>

      {/* Comparison View */}
      {selectedJob && (
        <div>
          {/* Job Info */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {selectedJob.title}
            </h2>
            <p className="text-lg text-blue-600 font-medium mb-2">
              {selectedJob.company}
            </p>
            {selectedJob.location && (
              <p className="text-gray-600">
                📍 {selectedJob.location}
              </p>
            )}
            {selectedJob.structuredDescription && (
              <div className="mt-4 inline-flex items-center px-3 py-1 bg-green-100 text-green-800 text-sm font-medium rounded-full">
                ✓ AI-Processed
              </div>
            )}
            {!selectedJob.structuredDescription && (
              <div className="mt-4 inline-flex items-center px-3 py-1 bg-gray-100 text-gray-800 text-sm font-medium rounded-full">
                ⚠️ Not yet processed
              </div>
            )}
          </div>

          {/* Side-by-Side Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* BEFORE */}
            <div>
              <div className="bg-red-50 border-2 border-red-200 rounded-t-lg px-6 py-3">
                <h3 className="text-lg font-bold text-red-900 flex items-center">
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
                  </svg>
                  BEFORE (Raw Text Blob)
                </h3>
              </div>
              <div className="bg-white border-2 border-red-200 border-t-0 rounded-b-lg p-6 max-h-[800px] overflow-y-auto">
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">
                    {selectedJob.description}
                  </pre>
                </div>
              </div>
            </div>

            {/* AFTER */}
            <div>
              <div className="bg-green-50 border-2 border-green-200 rounded-t-lg px-6 py-3">
                <h3 className="text-lg font-bold text-green-900 flex items-center">
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  AFTER (AI-Structured)
                </h3>
              </div>
              <div className="bg-white border-2 border-green-200 border-t-0 rounded-b-lg p-6 max-h-[800px] overflow-y-auto">
                {selectedJob.structuredDescription ? (
                  <StructuredJobDescription
                    description={selectedJob.structuredDescription}
                    collapsible={false}
                  />
                ) : (
                  <div className="text-center py-12">
                    <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    <h4 className="text-lg font-semibold text-gray-900 mb-2">
                      Not Yet Processed
                    </h4>
                    <p className="text-gray-600 mb-4">
                      This job hasn't been processed with AI yet.
                    </p>
                    <p className="text-sm text-gray-500">
                      Run: <code className="bg-gray-100 px-2 py-1 rounded">npm run process-descriptions</code>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Key Improvements Callout */}
          {selectedJob.structuredDescription && (
            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h4 className="text-lg font-semibold text-blue-900 mb-3 flex items-center">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                Key Improvements
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex items-start">
                  <svg className="w-5 h-5 text-green-600 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-blue-800">Clear semantic sections (Role, Responsibilities, Requirements)</span>
                </div>
                <div className="flex items-start">
                  <svg className="w-5 h-5 text-green-600 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-blue-800">Scannable bullet points for easy reading</span>
                </div>
                <div className="flex items-start">
                  <svg className="w-5 h-5 text-green-600 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-blue-800">Mobile-friendly formatting</span>
                </div>
                <div className="flex items-start">
                  <svg className="w-5 h-5 text-green-600 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-blue-800">Removed marketing fluff and redundancy</span>
                </div>
                <div className="flex items-start">
                  <svg className="w-5 h-5 text-green-600 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-blue-800">Separated required vs preferred qualifications</span>
                </div>
                <div className="flex items-start">
                  <svg className="w-5 h-5 text-green-600 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-blue-800">Highlighted benefits and company context</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Links */}
      {!selectedJob && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Start</h3>
          <div className="space-y-2 text-sm">
            <p className="text-gray-700">
              <strong>Sample jobs to try:</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 text-gray-600 ml-4">
              <li>
                <button
                  onClick={() => setJobUrl('baker-hughes-https---bakerhughes-wd5-myworkdayjobs-com-en-us-bakerhughes-job-ae-abu-dhabi-al-ghaith-holding-tower-airport-road-supply-chain-localization-leader-r156427')}
                  className="text-blue-600 hover:underline"
                >
                  Supply Chain Localization Leader
                </button>
              </li>
              <li>
                <button
                  onClick={() => setJobUrl('baker-hughes-https---bakerhughes-wd5-myworkdayjobs-com-en-us-bakerhughes-job-us-tx-other-texas-cdl-delivery---treater-driver-r160748')}
                  className="text-blue-600 hover:underline"
                >
                  CDL Delivery / Treater Driver
                </button>
              </li>
            </ul>
            <p className="text-gray-600 mt-4">
              <strong>Tip:</strong> You can paste any job URL from your jobs site or just the job ID.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default ComparisonTool
