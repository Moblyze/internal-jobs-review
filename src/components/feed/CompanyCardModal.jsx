// src/components/feed/CompanyCardModal.jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { logTelemetry, postContactFeedback, enrichPerson } from '../../hooks/usePdlContacts'

const FILTER_OPTIONS_URL = `${import.meta.env.BASE_URL || '/'}data/filter-options.json`
const DECISION_MAKERS_URL = `${import.meta.env.BASE_URL || '/'}data/feed/decision_makers.json`
const ENTRIES_LITE_URL = `${import.meta.env.BASE_URL || '/'}data/feed/entries-lite.json`
const WORKER_BASE = import.meta.env.VITE_WORKER_BASE || 'https://pdl-company-feed.jesse-82d.workers.dev'

const PERSONA_LABELS = {
  ta: 'TA',
  hr: 'HR',
  operations: 'OPS',
  project: 'PRJ',
  crewing: 'CRW',
  other: 'OTH',
}
const PERSONA_LABELS_FULL = {
  ta: 'Talent Acquisition',
  hr: 'HR',
  operations: 'Operations',
  project: 'Project',
  crewing: 'Crewing',
  other: 'Other',
}
const PERSONA_BADGE_CLASS = {
  ta: 'bg-violet-100 text-violet-800',
  hr: 'bg-blue-100 text-blue-800',
  operations: 'bg-green-100 text-green-800',
  project: 'bg-amber-100 text-amber-800',
  crewing: 'bg-teal-100 text-teal-800',
  other: 'bg-gray-100 text-gray-700',
}

const COMPANY_SOURCE_NAMES = {
  wikidata: 'Wikidata',
  edgar: 'SEC EDGAR',
  companies_house: 'Companies House',
  gleif: 'GLEIF',
  brreg: 'Brønnøysundregistrene',
  epa_frs: 'EPA FRS',
  opencorporates: 'OpenCorporates',
  pdl: 'PDL',
  websearch: 'AI web research',
}

const SLUG_OVERRIDES = {
  'offshore-og': 'Offshore O&G',
  'onshore-og': 'Onshore O&G',
  'onshore-renewables': 'Onshore Renewables',
  'mining': 'Mining',
  'nuclear': 'Nuclear',
  'united_states': 'United States',
  'united_kingdom': 'United Kingdom',
  'united_arab_emirates': 'United Arab Emirates',
  'czech_republic': 'Czech Republic',
  'papua_new_guinea': 'Papua New Guinea',
}

function prettySlug(s) {
  if (!s || typeof s !== 'string') return ''
  if (SLUG_OVERRIDES[s]) return SLUG_OVERRIDES[s]
  return s.replace(/_and_/g, ' & ').replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function daysAgo(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms) || ms < 0) return ''
  const d = Math.floor(ms / (1000 * 60 * 60 * 24))
  if (d < 1) return 'today'
  if (d === 1) return '1d ago'
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  return mo === 1 ? '1mo ago' : `${mo}mo ago`
}

const US_STATE_ABBREV = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
  'District of Columbia': 'DC',
}

function formatHq(loc) {
  if (!loc) return null
  const city = loc.locality || null
  const region = loc.region || null
  const country = loc.country || null
  const isUS = country === 'United States' || country === 'US' || country === 'USA'
  const regionDisplay = isUS && region ? (US_STATE_ABBREV[region] || region) : region
  // US: "Houston, TX" (drop the redundant "United States")
  // Non-US with region: "Aberdeen, Scotland, United Kingdom"
  // Non-US no region: "Paris, France"
  if (isUS) {
    return [city, regionDisplay].filter(Boolean).join(', ') || null
  }
  return [city, regionDisplay, country].filter(Boolean).join(', ') || null
}

function mapWorkerResponseToOverview(data) {
  if (!data || data._empty) return null
  return {
    website: data.website || null,
    size: data.size || null,
    employee_count: data.employee_count || null,
    founded: data.founded || null,
    location: {
      locality: data.location?.locality || null,
      region: data.location?.region || null,
      country: data.location?.country || null,
    },
    ticker: data.ticker || null,
    industry: data.industry || null,
    name: data.display_name || data.name || null,
    summary: data.summary || null,
    tags: Array.isArray(data.tags) && data.tags.length > 0 ? data.tags : null,
    linkedin_url: data.linkedin_url || null,
    _source: typeof data._source === 'string' ? data._source : null,
  }
}

function letterAvatar(name) {
  // Strip nicknames/parentheticals/punctuation; take first letter of first two real word tokens.
  const tokens = (name || '?')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean)
  return tokens.slice(0, 2).map(t => t[0].toUpperCase()).join('') || '?'
}

function AgentContactCard({ p, companyName, entryId, companyDomain }) {
  const [feedback, setFeedback] = useState(null)
  const [enriched, setEnriched] = useState(null) // { email, phone, source, confidence, cached } | null
  const [enriching, setEnriching] = useState(false)
  const [enrichError, setEnrichError] = useState(null) // 'daily_cap' | 'credits_exhausted' | 'not_found' | 'error' | null
  const persona = (p.persona || 'other').toLowerCase()
  const badgeClass = PERSONA_BADGE_CLASS[persona] || PERSONA_BADGE_CLASS.other
  const personaLabel = PERSONA_LABELS[persona] || persona
  const personaLabelFull = PERSONA_LABELS_FULL[persona] || persona

  const effectiveEmail = enriched?.email || p.email
  const effectivePhone = enriched?.phone || p.phone

  async function handleFindContact() {
    if (enriching) return
    setEnriching(true)
    setEnrichError(null)
    const linkedin = p.source_url && /linkedin\.com/i.test(p.source_url) ? p.source_url : null
    const result = await enrichPerson({ linkedin_url: linkedin, name: p.name, company: companyName, domain: companyDomain })
    setEnriching(false)
    if (result?.error) {
      setEnrichError(result.error === 'daily_cap' || result.error === 'credits_exhausted' ? result.error : 'error')
      return
    }
    if (!result?.email && !result?.phone) {
      setEnrichError('not_found')
      return
    }
    setEnriched(result)
  }

  function handleFeedback(signal) {
    if (feedback === signal) return
    setFeedback(signal)
    postContactFeedback({
      company: companyName,
      contact_id: p.source_url || p.name || null,
      contact_title: p.title || null,
      signal,
      entry_id: entryId || null,
      source: 'agent',
    })
  }

  const linkedinUrl = p.source_url && /linkedin\.com/i.test(p.source_url) ? p.source_url : null
  const sourceUrl = p.source_url || null

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">{p.name}</span>
          <span title={personaLabelFull} className={`text-[10px] font-semibold uppercase tracking-wider ${badgeClass} px-1.5 py-0.5 rounded shrink-0`}>{personaLabel}</span>
        </div>
        <div className="text-[13px] text-gray-700">{p.title}</div>
        {(effectiveEmail || effectivePhone || p.location) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
            {effectiveEmail && (
              <a href={`mailto:${effectiveEmail}`} className="text-blue-700 hover:underline inline-flex items-center gap-1 min-w-0 max-w-full">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>
                <span className="truncate">{effectiveEmail}</span>
                {enriched?.source === 'hunter' && enriched?.confidence !== null && enriched?.confidence !== undefined && (
                  <span className="text-[10px] text-gray-400 shrink-0">({enriched.confidence}% via Hunter)</span>
                )}
                {enriched?.source === 'pdl' && (
                  <span className="text-[10px] text-gray-400 shrink-0">(via PDL)</span>
                )}
              </a>
            )}
            {effectivePhone && (
              <a href={`tel:${effectivePhone}`} className="text-gray-700 hover:underline inline-flex items-center gap-1 shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                {effectivePhone}
              </a>
            )}
            {p.location && (
              <span className="text-gray-500 inline-flex items-center gap-1 shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                {p.location}
              </span>
            )}
          </div>
        )}
        {!effectiveEmail && (
          <div className="mt-1 text-[11px]">
            {!enriching && !enrichError && (
              <button
                onClick={handleFindContact}
                title="Looks up work email + direct phone via Hunter Email Finder (1 credit). Falls back to PDL Person Enrichment if Hunter has no match. Cached 90 days; re-tried after 24h if no contact info found."
                className="text-blue-700 hover:underline"
              >
                Find contact info →
              </button>
            )}
            {enriching && <span className="text-gray-400">Looking up contact info…</span>}
            {enrichError === 'not_found' && <span className="text-gray-400 italic">No contact info found.</span>}
            {enrichError === 'daily_cap' && <span className="text-amber-700">Daily lookup cap reached — try tomorrow.</span>}
            {enrichError === 'credits_exhausted' && <span className="text-red-700">Credits exhausted.</span>}
            {enrichError === 'error' && (
              <button
                onClick={handleFindContact}
                title="Looks up work email + direct phone via Hunter Email Finder (1 credit). Falls back to PDL Person Enrichment if Hunter has no match. Cached 90 days; re-tried after 24h if no contact info found."
                className="text-blue-700 hover:underline"
              >
                Lookup failed — retry
              </button>
            )}
          </div>
        )}
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            {linkedinUrl && (
              <a href={linkedinUrl.startsWith('http') ? linkedinUrl : `https://${linkedinUrl}`} target="_blank" rel="noopener noreferrer" title="Open LinkedIn profile"
                 className="text-[12px] text-[#0a66c2] hover:underline inline-flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0"><path d="M19 0h-14C2.24 0 0 2.24 0 5v14c0 2.76 2.24 5 5 5h14c2.76 0 5-2.24 5-5V5c0-2.76-2.24-5-5-5zM8 19H5V8h3v11zM6.5 6.73c-.97 0-1.75-.79-1.75-1.75 0-.97.78-1.75 1.75-1.75s1.75.78 1.75 1.75c0 .96-.78 1.75-1.75 1.75zM20 19h-3v-5.6c0-1.34-.03-3.07-1.87-3.07-1.87 0-2.16 1.46-2.16 2.97V19h-3V8h2.88v1.5h.04c.4-.76 1.38-1.56 2.84-1.56 3.04 0 3.6 2 3.6 4.6V19z"/></svg>
                LinkedIn ↗
              </a>
            )}
            {sourceUrl && !linkedinUrl && (
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-blue-700 hover:underline">
                Source ↗
              </a>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              title="Mark as relevant target"
              onClick={() => handleFeedback('up')}
              className={`inline-flex items-center justify-center transition-colors ${feedback === 'up' ? 'text-green-600' : 'text-gray-300 hover:text-gray-500'}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
            </button>
            <button
              title="Mark as wrong target"
              onClick={() => handleFeedback('down')}
              className={`inline-flex items-center justify-center transition-colors ${feedback === 'down' ? 'text-red-600' : 'text-gray-300 hover:text-gray-500'}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CompanyCardModal({ slug, name, entryId, onClose }) {
  const [overview, setOverview] = useState(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewEmpty, setOverviewEmpty] = useState(false)
  const [noPublicRecords, setNoPublicRecords] = useState(false)
  const [activeJobs, setActiveJobs] = useState(0)
  const [agentContacts, setAgentContacts] = useState([])
  const [bdSignals, setBdSignals] = useState([])
  const [countries, setCountries] = useState([])
  const [subsectors, setSubsectors] = useState([])

  useEffect(() => {
    if (!name) return
    setOverview(null)
    setOverviewEmpty(false)
    setNoPublicRecords(false)
    setOverviewLoading(false)
    setAgentContacts([])
    setBdSignals([])
    setCountries([])
    setSubsectors([])
    setOverviewLoading(true)
    Promise.all([fetch(FILTER_OPTIONS_URL).then(r => r.json()).catch(() => ({})),
                 fetch(DECISION_MAKERS_URL).then(r => r.json()).catch(() => ({})),
                 fetch(ENTRIES_LITE_URL).then(r => r.json()).catch(() => [])])
      .then(([filterOpts, decisionMakers, entriesLite]) => {
        const dmEntry = decisionMakers?.[name?.toLowerCase()] || null
        setAgentContacts(Array.isArray(dmEntry?.contacts) ? dmEntry.contacts : [])
        const c = (filterOpts.companies || []).find(c => c.name?.toLowerCase() === name.toLowerCase())
        setActiveJobs(c?.count || 0)

        const lname = name?.toLowerCase()
        const matching = (Array.isArray(entriesLite) ? entriesLite : [])
          .filter(e => e?.hiring_entity?.name?.toLowerCase() === lname || e?.operator?.name?.toLowerCase() === lname)
          .sort((a, b) => new Date(b.ingested_at || 0) - new Date(a.ingested_at || 0))
        setBdSignals(matching)
        setCountries([...new Set(matching.map(e => e.country).filter(Boolean))])
        setSubsectors([...new Set(matching.map(e => e.subsector).filter(Boolean))])
      })
    // Always hit the Worker for company overview — the cascade (Wikidata/EDGAR/
    // Companies House/GLEIF/Brreg/EPA FRS → PDL backstop) is the source of truth.
    // Worker caches results in KV for 90d, so subsequent opens are instant.
    fetch(`${WORKER_BASE}/api/company/${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(data => {
        const mapped = mapWorkerResponseToOverview(data)
        setOverview(mapped)
        setOverviewEmpty(!mapped)
        setNoPublicRecords(data?.error === 'no_public_records')
        setOverviewLoading(false)
      })
      .catch(() => {
        setOverview(null)
        setOverviewEmpty(true)
        setOverviewLoading(false)
      })
    logTelemetry({ type: 'company_card_open', company: name, slug })
  }, [name])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!name) return null
  const domain = overview?.website || `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`
  const logoUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 border-b border-gray-200 shrink-0">
          <div className="w-10 h-10 rounded-md bg-white border border-gray-200 inline-flex items-center justify-center overflow-hidden">
            <img src={logoUrl} alt={`${name} logo`} className="w-full h-full object-contain p-1" onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}/>
            <div className="hidden w-full h-full bg-indigo-100 text-indigo-700 font-bold text-lg items-center justify-center">{letterAvatar(name)}</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold">{name}</h3>
              {overview?.industry && <span className="text-[10px] font-semibold uppercase tracking-wider bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{overview.industry}</span>}
            </div>
            <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-1">
              {overview?.website && <a href={`https://${overview.website}`} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{overview.website} ↗</a>}
              {overview?.linkedin_url && <>
                <span className="text-gray-300">·</span>
                <a href={overview.linkedin_url.startsWith('http') ? overview.linkedin_url : `https://${overview.linkedin_url}`} target="_blank" rel="noopener noreferrer" title="LinkedIn company page" className="inline-flex items-center gap-0.5 text-[#0a66c2] hover:underline">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 0h-14C2.24 0 0 2.24 0 5v14c0 2.76 2.24 5 5 5h14c2.76 0 5-2.24 5-5V5c0-2.76-2.24-5-5-5zM8 19H5V8h3v11zM6.5 6.73c-.97 0-1.75-.79-1.75-1.75 0-.97.78-1.75 1.75-1.75s1.75.78 1.75 1.75c0 .96-.78 1.75-1.75 1.75zM20 19h-3v-5.6c0-1.34-.03-3.07-1.87-3.07-1.87 0-2.16 1.46-2.16 2.97V19h-3V8h2.88v1.5h.04c.4-.76 1.38-1.56 2.84-1.56 3.04 0 3.6 2 3.6 4.6V19z"/></svg>
                  LinkedIn ↗
                </a>
              </>}
              {slug && <><span className="text-gray-300">·</span> <Link to={`/companies/${slug}`} className="text-blue-700 hover:underline">Moblyze Jobs ↗</Link></>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-md inline-flex items-center justify-center text-gray-500 hover:bg-gray-200">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col md:flex-row overflow-y-auto">
          {/* Overview */}
          <div className="md:w-[360px] shrink-0 p-5 bg-white md:border-r border-gray-100">
            <div className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 mb-2">
              Overview{overview?._source && COMPANY_SOURCE_NAMES[overview._source]
                ? ` · via ${COMPANY_SOURCE_NAMES[overview._source]}`
                : ''}
            </div>
            {overviewLoading && <div className="text-xs text-gray-400 mb-3">Loading company data…</div>}
            {!overviewLoading && noPublicRecords && !overview && (
              <div className="text-xs text-gray-500 mb-3 italic">No public records found for this company.</div>
            )}
            {!overviewLoading && overviewEmpty && !noPublicRecords && !overview && (
              <div className="text-xs text-gray-400 mb-3 italic">No public company data available.</div>
            )}
            <div className="grid grid-cols-[3fr_2fr] gap-x-3 gap-y-2 mb-4 text-sm">
              {overview?.size && <div>
                <div className="text-[10px] uppercase font-semibold text-gray-400">Headcount</div>
                <div className="font-semibold">{overview.employee_count ? overview.employee_count.toLocaleString() : overview.size}</div>
                {overview.employee_count && <div className="text-[10px] text-gray-400">{overview.size} range</div>}
              </div>}
              {overview?.founded && <div><div className="text-[10px] uppercase font-semibold text-gray-400">Founded</div><div className="font-semibold">{overview.founded}</div></div>}
              {overview?.location?.locality && <div><div className="text-[10px] uppercase font-semibold text-gray-400">HQ</div><div className="font-medium">{formatHq(overview.location)}</div></div>}
              <div>
                <div className="text-[10px] uppercase font-semibold text-gray-400">Live jobs</div>
                {activeJobs > 0 ? (
                  <Link to={`/?companies=${encodeURIComponent(name)}`} className="font-semibold text-blue-700 hover:underline inline-flex items-center gap-0.5">
                    {activeJobs.toLocaleString()} ↗
                  </Link>
                ) : (
                  <div className="font-medium text-gray-300">—</div>
                )}
              </div>
              {overview?.ticker && <div><div className="text-[10px] uppercase font-semibold text-gray-400">Ticker</div><div className="font-semibold">{overview.ticker.toUpperCase()}</div></div>}
            </div>
            {overview?.summary && (
              <div className="mb-3">
                <div className="text-[10px] uppercase font-semibold text-gray-400 mb-1">About</div>
                <p className="text-xs text-gray-500 italic leading-relaxed line-clamp-3">{overview.summary}</p>
              </div>
            )}
            {overview?.tags && (
              <div className="mb-3 flex flex-wrap gap-1">
                {overview.tags.map(tag => (
                  <span key={tag} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{tag}</span>
                ))}
              </div>
            )}
            {bdSignals.length > 0 && (
              <div className="mb-1">
                <div className="text-[10px] uppercase font-semibold text-gray-400 mb-1.5">Recent BD signals ({bdSignals.length})</div>
                {(countries.length > 0 || subsectors.length > 0) && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {countries.map(c => (
                      <span key={`c-${c}`} className="text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full">{prettySlug(c)}</span>
                    ))}
                    {subsectors.map(s => (
                      <span key={`s-${s}`} className="text-[10px] bg-violet-50 text-violet-800 border border-violet-200 px-2 py-0.5 rounded-full">{prettySlug(s)}</span>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-2 max-h-[280px] overflow-y-auto pr-1">
                  {bdSignals.slice(0, 8).map(e => (
                    <div key={e.id} className="text-xs border-l-2 border-indigo-200 pl-2">
                      <div className="text-[10px] text-gray-400 flex items-center gap-1.5 flex-wrap">
                        <span>{daysAgo(e.ingested_at)}</span>
                        {e.country && <><span className="text-gray-300">·</span><span>{prettySlug(e.country)}</span></>}
                        {e.phase && <><span className="text-gray-300">·</span><span>{prettySlug(e.phase)}</span></>}
                      </div>
                      <div className="text-gray-700 leading-snug line-clamp-2">{e.headline}</div>
                    </div>
                  ))}
                  {bdSignals.length > 8 && (
                    <div className="text-[10px] text-gray-400 italic">+ {bdSignals.length - 8} more</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Contacts */}
          <div className="flex-1 p-5 bg-gray-50 min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 mb-1">Hiring decision-makers</div>

            {agentContacts.length > 0 ? (
              <>
                <div className="text-xs text-gray-500 mb-2">{agentContacts.length} contact{agentContacts.length === 1 ? '' : 's'}</div>
                <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto pr-1">
                  {agentContacts.map((c, i) => (
                    <AgentContactCard key={c.source_url || `${c.name}-${i}`} p={c} companyName={name} entryId={entryId} companyDomain={overview?.website || null} />
                  ))}
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-500 italic py-6">No decision-makers discovered yet for this company.</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center px-5 py-2 bg-gray-50 border-t border-gray-200 text-[11px] text-gray-500 shrink-0">
          <span>Contacts: AI-discovered from public sources · email/phone enriched on demand via Hunter or PDL</span>
        </div>
      </div>
    </div>
  )
}
