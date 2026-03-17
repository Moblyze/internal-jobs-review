import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useJobs } from '../hooks/useJobs'
import { getCompanyStats, getCompanyDetail, getATSBreakdown, loadCompanyIntelligence } from '../utils/companyData'
import { companyToSlug } from '../utils/formatters'
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

// Sort options
const SORT_OPTIONS = [
  { value: 'jobs-desc', label: 'Most Jobs' },
  { value: 'jobs-asc', label: 'Fewest Jobs' },
  { value: 'name-asc', label: 'Name A-Z' },
  { value: 'name-desc', label: 'Name Z-A' },
]

function CompaniesPage() {
  const { jobs, loading, error } = useJobs()
  const [intelligence, setIntelligence] = useState({})
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('jobs-desc')
  const [expandedCompany, setExpandedCompany] = useState(null)

  // Load company intelligence data
  useEffect(() => {
    loadCompanyIntelligence().then(setIntelligence)
  }, [])

  // Compute company stats from jobs
  const companyStats = useMemo(() => getCompanyStats(jobs), [jobs])

  // Summary metrics
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

  // Top 10 companies by active jobs
  const topCompanies = useMemo(
    () => companyStats.slice(0, 10),
    [companyStats]
  )

  // Filtered and sorted companies
  const filteredCompanies = useMemo(() => {
    let result = companyStats

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(c => {
        // Check company name
        if (c.name.toLowerCase().includes(q)) return true
        // Check brand variations from intelligence
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
        // Already sorted by getCompanyStats
        break
    }

    return result
  }, [companyStats, search, sortBy, intelligence])

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
        title="Companies Overview"
        description={`${summaryMetrics.totalCompanies} companies with ${summaryMetrics.totalActiveJobs} active job listings`}
      />

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Companies</h1>
        <p className="text-gray-600 mt-1">
          Company intelligence and job data overview
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{summaryMetrics.totalCompanies}</div>
          <div className="text-sm text-gray-600 mt-1">Companies</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-3xl font-bold text-green-600">{summaryMetrics.totalActiveJobs}</div>
          <div className="text-sm text-gray-600 mt-1">Active Jobs</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-3xl font-bold text-gray-400">{summaryMetrics.totalInactiveJobs}</div>
          <div className="text-sm text-gray-600 mt-1">Inactive Jobs</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
          <div className="text-3xl font-bold text-indigo-600">{summaryMetrics.companiesWithIntel}</div>
          <div className="text-sm text-gray-600 mt-1">Researched</div>
        </div>
      </div>

      {/* ATS Breakdown + Top Companies Row */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
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
                  <Link
                    to={`/companies/${company.slug}`}
                    className="text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors line-clamp-1"
                  >
                    {company.name}
                  </Link>
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
                <CompanyIntelPanel intel={intel} companyDetail={getCompanyDetail(company.slug, jobs)} />
              )}
            </div>
          )
        })}
      </div>

      {filteredCompanies.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-600">No companies match your search.</p>
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
