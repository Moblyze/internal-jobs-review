// Company detail: what this company is, how much it hires in our trades, where, whether we can reach
// it, then its open jobs. Built on the shared internal system (src/styles/mz-ui.css).
// Data: one small company shard (this company's current jobs with precomputed facets), never the full index.
import { useParams, Link } from 'react-router-dom'
import { useState, useEffect, useMemo } from 'react'
import { getCompanyData } from '../hooks/useJobs'
import { useFilterParams } from '../hooks/useFilterParams'
import { slugToCompany } from '../utils/formatters'
import { extractJobCertifications } from '../utils/certificationExtractor'
import { loadCompanyIntelligence } from '../utils/companyData'
import { ENERGY_ROLES } from '../utils/energyRoles'
import { EMPLOYMENT_TYPES, canonicalEmploymentType } from '../utils/employmentType'
import JobCard from '../components/JobCard'
import SEO from '../components/SEO'
import CompanyCardModal from '../components/feed/CompanyCardModal'
import { DataBasis, EmptyState, PageHeader } from '../components/ui/PageParts'
import '../company-page.css'

const PAGE_SIZE = 60
const DAY = 864e5
const FEED_BASE = `${import.meta.env.BASE_URL || '/'}data/feed/`
const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR'.split(' '))
const CA_PROVINCES = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '))
const US_STATE_NAMES = new Set(['texas', 'louisiana', 'california', 'oklahoma', 'alaska', 'new mexico', 'north dakota', 'pennsylvania', 'colorado', 'wyoming', 'ohio', 'florida', 'new york', 'virginia'])

// "Houston, TX" -> United States; "Aberdeen, United Kingdom" -> United Kingdom; "Remote" -> Remote
function countryOf(loc) {
  const parts = String(loc).split(',').map(p => p.trim()).filter(Boolean)
  const last = parts[parts.length - 1] || ''
  if (US_STATES.has(last)) return 'United States'
  if (CA_PROVINCES.has(last)) return 'Canada'
  if (US_STATE_NAMES.has(last.toLowerCase())) return 'United States'
  if (/^(usa|us|united states( of america)?)$/i.test(last)) return 'United States'
  if (/^(uk|united kingdom|england|scotland|wales)$/i.test(last)) return 'United Kingdom'
  if (/remote/i.test(last)) return 'Remote'
  if (/^(unavailable|unknown|n\/?a|tbc|tbd|various|multiple)$/i.test(last)) return 'Not stated'
  return last || 'Not stated'
}

function ago(t) {
  if (!t) return null
  const d = Math.max(0, Math.floor((Date.now() - t) / DAY))
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : `${Math.round(d / 30)} mo ago`
}

function Ranked({ rows, total, limit, unit = 'jobs' }) {
  const max = rows[0]?.[1] || 1
  const rest = rows.slice(limit).reduce((s, r) => s + r[1], 0)
  return (
    <ol className="cp-ranked">
      {rows.slice(0, limit).map(([name, n]) => (
        <li key={name}>
          <span className="cp-ranked__name">{name}</span>
          <span className="cp-ranked__bar" aria-hidden="true"><i style={{ width: `${Math.max(3, (n / max) * 100)}%` }} /></span>
          <span className="cp-ranked__n num">{n.toLocaleString('en-US')}</span>
        </li>
      ))}
      {rows.length > limit && <li className="cp-ranked__more">and {(rows.length - limit).toLocaleString('en-US')} more, {rest.toLocaleString('en-US')} {rest === 1 ? unit.replace(/s$/, '') : unit}</li>}
    </ol>
  )
}

function CompanyPage() {
  const { companySlug } = useParams()
  const { filters } = useFilterParams()
  const [data, setData] = useState({ slug: null, company: null, done: false, error: null })
  const [shown, setShown] = useState(PAGE_SIZE)
  const [trade, setTrade] = useState('all')
  const [showAllLocs, setShowAllLocs] = useState(false)
  const [intel, setIntel] = useState(null)
  const [coverage, setCoverage] = useState(null)
  const [signals, setSignals] = useState([])
  const [contactsOpen, setContactsOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setData({ slug: companySlug, company: null, done: false, error: null })
    setShown(PAGE_SIZE); setTrade('all'); setShowAllLocs(false)
    getCompanyData(companySlug)
      .then(company => { if (!cancelled) setData({ slug: companySlug, company, done: true, error: null }) })
      .catch(err => { if (!cancelled) setData({ slug: companySlug, company: null, done: true, error: err.message }) })
    return () => { cancelled = true }
  }, [companySlug])

  const companyJobs = data.company?.jobs || []
  const companyName = data.company?.name || slugToCompany(companySlug)

  // Small side files: research notes, saved-contact counts (no PII), feed mentions. Nothing here looks anyone up.
  useEffect(() => {
    if (!companyName) return
    let off = false
    const lname = companyName.toLowerCase()
    loadCompanyIntelligence().then(all => { if (!off) setIntel(all?.[companySlug] || null) }).catch(() => {})
    fetch(`${FEED_BASE}contact_coverage.json`).then(r => (r.ok ? r.json() : {})).then(c => { if (!off) setCoverage(c?.[lname] || null) }).catch(() => {})
    fetch(`${FEED_BASE}entries-lite.json`).then(r => (r.ok ? r.json() : [])).then(list => {
      if (off || !Array.isArray(list)) return
      setSignals(list.filter(e => e?.hiring_entity?.name?.toLowerCase() === lname || e?.operator?.name?.toLowerCase() === lname)
        .sort((a, b) => new Date(b.ingested_at || 0) - new Date(a.ingested_at || 0)))
    }).catch(() => {})
    return () => { off = true }
  }, [companyName, companySlug])

  const summary = useMemo(() => {
    const roles = {}, locs = {}, countries = {}, types = {}
    let tradeJobs = 0, recent = 0, newest = 0
    const cutoff = Date.now() - 30 * DAY
    for (const j of companyJobs) {
      if (j.roleId && j.roleId !== 'other') { tradeJobs++; roles[j.roleId] = (roles[j.roleId] || 0) + 1 }
      const jl = j.locs?.length ? j.locs : (j.location ? [j.location] : [])
      for (const l of jl) if (countryOf(l) !== 'Not stated') locs[l] = (locs[l] || 0) + 1
      const c = jl.length ? countryOf(jl[0]) : 'Not stated'
      countries[c] = (countries[c] || 0) + 1
      const et = canonicalEmploymentType(j.employmentType)
      types[et] = (types[et] || 0) + 1
      const t = j.postedDate ? Date.parse(j.postedDate) : NaN
      if (t) { if (t > newest) newest = t; if (t >= cutoff) recent++ }
    }
    const sort = o => Object.entries(o).sort((a, b) => b[1] - a[1])
    return {
      tradeJobs, recent, newest,
      roles: sort(roles).map(([id, n]) => [ENERGY_ROLES[id]?.label || id, n, id]),
      locs: sort(locs), countries: sort(countries).filter(([c]) => c !== 'Not stated'),
      types: EMPLOYMENT_TYPES.filter(t => types[t]).map(t => [t, types[t]]),
    }
  }, [companyJobs])

  const filteredJobs = useMemo(() => {
    let result = companyJobs
    if (trade !== 'all') result = result.filter(j => j.roleId === trade)
    if (filters.locations?.length > 0) result = result.filter(job => filters.locations.some(l => (job.locs || []).includes(l)))
    if (filters.skills?.length > 0) {
      const wanted = new Set(filters.skills.map(s => s.toLowerCase()))
      result = result.filter(job => (job.validSkills || job.skills || []).some(s => wanted.has(s.toLowerCase())))
    }
    if (filters.certifications?.length > 0) {
      result = result.filter(job => filters.certifications.some(cert => extractJobCertifications(job).includes(cert)))
    }
    if (filters.roles?.length > 0) result = result.filter(job => filters.roles.includes(job.roleId))
    return result
  }, [companyJobs, filters, trade])

  if (!data.done) return <div className="mz cp"><EmptyState title="Loading company…">Reading this company's open jobs.</EmptyState></div>
  if (data.error) return <div className="mz cp"><EmptyState title="This company did not load">{data.error}</EmptyState></div>

  const n = companyJobs.length
  const urlFiltered = filters.locations?.length > 0 || filters.skills?.length > 0 || filters.certifications?.length > 0 || filters.roles?.length > 0
  const sub = [intel?.sector, intel?.hq].filter(Boolean).join(' · ') || null

  return (
    <div className="mz cp">
      <SEO title={`${companyName}: ${n} open jobs`} description={`${n} open jobs at ${companyName}. Top locations: ${summary.locs.slice(0, 5).map(l => l[0]).join(', ')}`} />
      <nav className="cp-crumb"><Link to="/companies">Companies</Link><span aria-hidden="true"> / </span><span>{companyName}</span></nav>
      <PageHeader title={companyName} sub={sub} right={intel?.website && <a className="mz-btn mz-btn--quiet" href={intel.website} target="_blank" rel="noopener noreferrer">Website ↗</a>} />
      <DataBasis parts={[
        <><b className="num">{n.toLocaleString('en-US')}</b> open job{n === 1 ? '' : 's'}</>,
        <><b className="num">{summary.recent.toLocaleString('en-US')}</b> posted in the last 30 days</>,
        summary.newest ? `Newest ${ago(summary.newest)}` : null,
      ]} />

      {n === 0 ? <EmptyState title="No open jobs right now">This company has no current jobs in the index.</EmptyState> : (
        <>
          <div className="cp-grid">
            <section className="cp-block" aria-labelledby="cp-trades-h">
              <h2 id="cp-trades-h" className="cp-block__h">Hiring in our trades</h2>
              <p className="cp-big num">{summary.tradeJobs.toLocaleString('en-US')}<small> of {n.toLocaleString('en-US')} open jobs</small></p>
              {summary.roles.length > 0
                ? <Ranked rows={summary.roles} limit={6} />
                : <p className="cp-quiet">None of the open jobs match a Moblyze trade yet.</p>}
            </section>

            <section className="cp-block" aria-labelledby="cp-where-h">
              <h2 id="cp-where-h" className="cp-block__h">Where they hire</h2>
              <p className="cp-big num">{summary.locs.length.toLocaleString('en-US')}<small> location{summary.locs.length === 1 ? '' : 's'} in {summary.countries.length.toLocaleString('en-US')} {summary.countries.length === 1 ? 'country' : 'countries'}</small></p>
              {summary.countries.length > 1 && <Ranked rows={summary.countries} limit={4} />}
              <h3 className="cp-block__h3">Top locations</h3>
              <Ranked rows={summary.locs} limit={5} />
              {summary.locs.length > 5 && (
                <button type="button" className="mz-link cp-all" onClick={() => setShowAllLocs(v => !v)}>{showAllLocs ? 'Hide the full list' : `Show all ${summary.locs.length.toLocaleString('en-US')} locations`}</button>
              )}
            </section>

            <section className="cp-block" id="contacts" aria-labelledby="cp-contacts-h">
              <h2 id="cp-contacts-h" className="cp-block__h">Contacts</h2>
              {coverage && coverage.identified > 0 ? (
                <>
                  <p className="cp-big num">{coverage.identified}<small> on file{coverage.with_email > 0 ? `, ${coverage.with_email} with email` : ', no email yet'}</small></p>
                  <button type="button" className="mz-btn" onClick={() => setContactsOpen(true)}>Open contacts</button>
                </>
              ) : <p className="cp-quiet">No contacts on file yet.</p>}
              {signals.length > 0 && (
                <>
                  <h3 className="cp-block__h3">In the feed</h3>
                  <ul className="cp-signals">
                    {signals.slice(0, 3).map(e => <li key={e.id}><Link to="/feed">{e.headline}</Link></li>)}
                  </ul>
                </>
              )}
              {summary.types.length > 0 && (
                <>
                  <h3 className="cp-block__h3">Employment type</h3>
                  <p className="cp-types">{summary.types.map(([t, c]) => <span key={t} className="mz-tag">{t} <span className="num">{c.toLocaleString('en-US')}</span></span>)}</p>
                </>
              )}
            </section>
          </div>

          {showAllLocs && (
            <section className="mz-sec cp-alllocs" aria-label="All locations">
              <ul>{summary.locs.map(([l, c]) => <li key={l}><span>{l}</span><span className="num">{c}</span></li>)}</ul>
            </section>
          )}

          <section className="mz-sec" aria-labelledby="cp-jobs-h">
            <div className="cp-jobs-head">
              <h2 id="cp-jobs-h" className="mz-sec__h">Open jobs <span className="cp-count num">{filteredJobs.length.toLocaleString('en-US')}</span></h2>
              {summary.roles.length > 0 && (
                <label className="mz-field cp-trade">
                  <span className="sr-only">Trade</span>
                  <select value={trade} onChange={e => { setTrade(e.target.value); setShown(PAGE_SIZE) }} aria-label="Filter by trade">
                    <option value="all">All jobs ({n.toLocaleString('en-US')})</option>
                    {summary.roles.map(([label, c, id]) => <option key={id} value={id}>{label} ({c})</option>)}
                  </select>
                </label>
              )}
            </div>
            {urlFiltered && <p className="mz-sec__sub">Filtered by the link you followed.</p>}
            {filteredJobs.length === 0
              ? <EmptyState title="No jobs match">Choose all jobs or another trade.</EmptyState>
              : (
                <div className="cp-jobs">
                  {filteredJobs.slice(0, shown).map(job => <JobCard key={job.id} job={job} />)}
                </div>
              )}
            {filteredJobs.length > shown && (
              <div className="cp-more">
                <button type="button" className="mz-btn mz-btn--quiet" onClick={() => setShown(s => s + PAGE_SIZE)}>Show more ({(filteredJobs.length - shown).toLocaleString('en-US')} remaining)</button>
              </div>
            )}
          </section>
        </>
      )}
      {contactsOpen && <CompanyCardModal slug={companySlug} name={companyName} onClose={() => setContactsOpen(false)} />}
    </div>
  )
}

export default CompanyPage
