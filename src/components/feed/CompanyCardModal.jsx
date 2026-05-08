// src/components/feed/CompanyCardModal.jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePdlContacts, logTelemetry, postContactFeedback, checkContactsCached } from '../../hooks/usePdlContacts'

const COMPANY_CACHE_URL = `${import.meta.env.BASE_URL || '/'}data/pdl-company-cache.json`
const FILTER_OPTIONS_URL = `${import.meta.env.BASE_URL || '/'}data/filter-options.json`
const WORKER_BASE = import.meta.env.VITE_WORKER_BASE || 'https://pdl-company-feed.jesse-82d.workers.dev'

function mapWorkerResponseToOverview(data) {
  if (!data || data._empty) return null
  return {
    website: data.website || null,
    size: data.size || null,
    employee_count: data.employee_count || null,
    founded: data.founded || null,
    location: {
      locality: data.location?.locality || null,
      country: data.location?.country || null,
    },
    ticker: data.ticker || null,
    industry: data.industry || null,
    name: data.display_name || data.name || null,
    summary: data.summary || null,
    tags: Array.isArray(data.tags) && data.tags.length > 0 ? data.tags : null,
    linkedin_url: data.linkedin_url || null,
  }
}

function letterAvatar(name) {
  return (name || '?').split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).filter(Boolean).join('')
}

function ContactCard({ p, companyName, entryId }) {
  const [feedback, setFeedback] = useState(null) // null | 'up' | 'down'
  const lvl = (p.job_title_levels || [])[0]
  const lvlClass = { cxo: 'bg-fuchsia-100 text-fuchsia-800', vp: 'bg-violet-100 text-violet-800', director: 'bg-yellow-100 text-yellow-800', manager: 'bg-blue-100 text-blue-800' }[lvl] || 'bg-gray-100 text-gray-700'

  function handleFeedback(signal) {
    if (feedback === signal) return // no toggle-off
    setFeedback(signal)
    postContactFeedback({
      company: companyName,
      contact_id: p.id || p.linkedin_url || null,
      contact_title: p.job_title || null,
      signal,
      entry_id: entryId || null,
    })
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 flex gap-3 items-start">
      <div className="w-10 h-10 rounded-md bg-indigo-100 text-indigo-700 font-semibold text-sm inline-flex items-center justify-center shrink-0">{letterAvatar(p.full_name)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">{p.full_name}</span>
          {lvl && <span className={`text-[10px] font-semibold uppercase tracking-wider ${lvlClass} px-1.5 py-0.5 rounded`}>{lvl}</span>}
        </div>
        <div className="text-[13px] text-gray-700">{p.job_title}</div>
        <div className="text-xs text-gray-500 mt-1 flex gap-2.5 flex-wrap items-center">
          {p.location_name && <span className="inline-flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"/></svg>
            {p.location_name}
          </span>}
        </div>
      </div>
      <div className="flex gap-1 self-center shrink-0">
        <button title={p.work_email ? 'Copy work email' : 'Email not available'} disabled={!p.work_email} onClick={() => p.work_email && navigator.clipboard?.writeText(p.work_email)}
                className={`w-9 h-9 rounded-md inline-flex items-center justify-center border ${p.work_email ? 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50' : 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed'}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>
        </button>
        <button
          title="Mark as relevant target"
          onClick={() => handleFeedback('up')}
          className={`w-9 h-9 rounded-md inline-flex items-center justify-center border ${feedback === 'up' ? 'bg-green-100 text-green-800 border-green-300' : 'bg-white border-gray-300 text-gray-400 hover:text-gray-600'}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
        </button>
        <button
          title="Mark as wrong target"
          onClick={() => handleFeedback('down')}
          className={`w-9 h-9 rounded-md inline-flex items-center justify-center border ${feedback === 'down' ? 'bg-red-100 text-red-800 border-red-300' : 'bg-white border-gray-300 text-gray-400 hover:text-gray-600'}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
        </button>
        {p.linkedin_url && (
          <a href={p.linkedin_url.startsWith('http') ? p.linkedin_url : `https://${p.linkedin_url}`} target="_blank" rel="noopener noreferrer" title="Open LinkedIn profile"
             className="w-9 h-9 rounded-md inline-flex items-center justify-center bg-white border border-gray-300 text-[#0a66c2] hover:bg-blue-50">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 0h-14C2.24 0 0 2.24 0 5v14c0 2.76 2.24 5 5 5h14c2.76 0 5-2.24 5-5V5c0-2.76-2.24-5-5-5zM8 19H5V8h3v11zM6.5 6.73c-.97 0-1.75-.79-1.75-1.75 0-.97.78-1.75 1.75-1.75s1.75.78 1.75 1.75c0 .96-.78 1.75-1.75 1.75zM20 19h-3v-5.6c0-1.34-.03-3.07-1.87-3.07-1.87 0-2.16 1.46-2.16 2.97V19h-3V8h2.88v1.5h.04c.4-.76 1.38-1.56 2.84-1.56 3.04 0 3.6 2 3.6 4.6V19z"/></svg>
          </a>
        )}
      </div>
    </div>
  )
}

export default function CompanyCardModal({ slug, name, entryId, onClose }) {
  const [overview, setOverview] = useState(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewEmpty, setOverviewEmpty] = useState(false)
  const [activeJobs, setActiveJobs] = useState(0)
  const [revealContacts, setRevealContacts] = useState(false)
  const { contacts, loading: contactsLoading, error: contactsError, cached: contactsCached } = usePdlContacts(revealContacts ? name : null)

  useEffect(() => {
    if (!name) return
    setOverview(null)
    setOverviewEmpty(false)
    setOverviewLoading(false)
    setRevealContacts(false)
    // Pre-flight: if contacts are already KV-cached, auto-show (free).
    // Otherwise leave revealContacts=false so the user clicks the explicit button.
    checkContactsCached(name).then(isCached => { if (isCached) setRevealContacts(true) })
    Promise.all([fetch(COMPANY_CACHE_URL).then(r => r.json()).catch(() => ({})),
                 fetch(FILTER_OPTIONS_URL).then(r => r.json()).catch(() => ({}))])
      .then(([cache, filterOpts]) => {
        const localHit = cache?.[name] || cache?.[name.toLowerCase()] || null
        const c = (filterOpts.companies || []).find(c => c.name?.toLowerCase() === name.toLowerCase())
        setActiveJobs(c?.count || 0)

        if (localHit) {
          setOverview(localHit)
        } else {
          // Local cache miss — try live Worker fetch
          setOverviewLoading(true)
          fetch(`${WORKER_BASE}/api/company/${encodeURIComponent(name)}`)
            .then(r => r.json())
            .then(data => {
              const mapped = mapWorkerResponseToOverview(data)
              setOverview(mapped)
              setOverviewEmpty(!mapped)
              setOverviewLoading(false)
            })
            .catch(() => {
              setOverview(null)
              setOverviewEmpty(true)
              setOverviewLoading(false)
            })
        }
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
            <div className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 mb-2">Overview · via PDL</div>
            {overviewLoading && <div className="text-xs text-gray-400 mb-3">Loading company data…</div>}
            {!overviewLoading && overviewEmpty && !overview && (
              <div className="text-xs text-gray-400 mb-3 italic">No PDL company data available.</div>
            )}
            <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
              {overview?.size && <div>
                <div className="text-[10px] uppercase font-semibold text-gray-400">Headcount</div>
                <div className="font-semibold">{overview.employee_count ? overview.employee_count.toLocaleString() : overview.size}</div>
                {overview.employee_count && <div className="text-[10px] text-gray-400">{overview.size} range</div>}
              </div>}
              {overview?.founded && <div><div className="text-[10px] uppercase font-semibold text-gray-400">Founded</div><div className="font-semibold">{overview.founded}</div></div>}
              {overview?.location?.locality && <div><div className="text-[10px] uppercase font-semibold text-gray-400">HQ</div><div className="font-medium">{overview.location.locality}{overview.location.country ? `, ${overview.location.country}` : ''}</div></div>}
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
            {activeJobs > 0 && (
              <Link to={`/?companies=${encodeURIComponent(name)}`} className="block bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-blue-700 no-underline hover:bg-indigo-100">
                <div className="text-2xl font-bold">{activeJobs}</div>
                <div className="text-xs">active jobs on site · view →</div>
              </Link>
            )}
          </div>

          {/* Contacts */}
          <div className="flex-1 p-5 bg-gray-50 min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 mb-1">Hiring decision-makers</div>
            {revealContacts && !contactsLoading && (
              <div className="text-xs text-gray-500 mb-1">Operations &amp; engineering managers · {contacts.length} returned</div>
            )}
            {revealContacts && contactsCached === true && (
              <div className="text-[11px] text-gray-400 mb-3">Loaded from cache · 0 credits</div>
            )}
            {revealContacts && contactsCached === false && (
              <div className="text-[11px] text-gray-400 mb-3">Live fetch · ~5 credits used</div>
            )}
            {!revealContacts && (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <button
                  onClick={() => setRevealContacts(true)}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors"
                >
                  Show contacts (~5 PDL credits)
                </button>
                <span className="text-[11px] text-gray-400">Skipped if cached</span>
              </div>
            )}
            {revealContacts && contactsLoading && <div className="text-sm text-gray-500">Loading…</div>}
            {revealContacts && contactsError && <div className="text-sm text-gray-400 italic">PDL contacts unavailable for this company.</div>}
            {revealContacts && !contactsLoading && !contactsError && contacts.length === 0 && <div className="text-sm text-gray-500 italic">No PDL contacts available for this company.</div>}
            {revealContacts && (
              <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
                {contacts.map(c => <ContactCard key={c.id || c.linkedin_url} p={c} companyName={name} entryId={entryId} />)}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2 bg-gray-50 border-t border-gray-200 text-[11px] text-gray-500 shrink-0">
          <span>Contact data via <strong>People Data Labs</strong> · refreshed monthly · B2B contact only</span>
          <a href={`mailto:engineering@moblyze.me?subject=Report incorrect PDL data for ${name}`} className="text-gray-500 underline">Report incorrect contact</a>
        </div>
      </div>
    </div>
  )
}
