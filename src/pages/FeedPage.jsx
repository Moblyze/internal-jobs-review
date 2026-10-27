// src/pages/FeedPage.jsx
import { useState, useMemo, useEffect } from 'react'
import SEO from '../components/SEO'
import { DataBasis, EmptyState, PageHeader } from '../components/ui/PageParts'
import '../feed.css'
import FeedFilters from '../components/feed/FeedFilters'
import FeedCard from '../components/feed/FeedCard'
import CompanyCardModal from '../components/feed/CompanyCardModal'
import ComingSoonSection from '../components/feed/ComingSoonSection'
import { useFeedData } from '../hooks/useFeedData'
import { useFilterParams } from '../hooks/useFilterParams'
import { usePdlCache } from '../hooks/usePdlCache'

const TIME_DAYS = { '7d': 7, '30d': 30, '90d': 90, 'all': 999999 }
const READINESS_RANK = { live_now: 4, hot: 3, warming: 2, cold: 1 }
const readinessKey = (e) => READINESS_RANK[e.outreach_readiness] || 0

function applyFilters(entries, filters) {
  const cutoff = Date.now() - (TIME_DAYS[filters.timeRange] || 30) * 24 * 60 * 60 * 1000
  const q = (filters.feedSearch || '').toLowerCase()
  let filtered = entries.filter(e => {
    if (e.ingested_at && new Date(e.ingested_at).getTime() < cutoff) return false
    if (filters.subsectors.length && !filters.subsectors.includes(e.subsector)) return false
    if (filters.disciplines.length && !filters.disciplines.some(d => (e.discipline_tags || []).includes(d))) return false
    if (filters.signals.length && !filters.signals.includes(e.signal_type)) return false
    if (filters.readiness?.length && !filters.readiness.includes(e.outreach_readiness)) return false
    if (filters.phases?.length && !filters.phases.includes(e.phase)) return false
    if (q && !((e.headline || '').toLowerCase().includes(q))) return false
    return true
  })

  if (filters.sort === 'readiness') {
    filtered = filtered.slice().sort((a, b) => {
      const diff = readinessKey(b) - readinessKey(a)
      if (diff !== 0) return diff
      return new Date(b.ingested_at) - new Date(a.ingested_at)
    })
  }
  return filtered
}

export default function FeedPage() {
  const { entries, taxonomy, loading, error } = useFeedData()
  const { filters, setFilters } = useFilterParams()
  const pdlCache = usePdlCache()
  const [companyModal, setCompanyModal] = useState(null)

  // Per-company contact-coverage counts (counts only, no PII). Drives the small
  // "N identified · M reachable" badge on each card. Best-effort: cards render
  // fine without it.
  const [coverage, setCoverage] = useState({})
  useEffect(() => {
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL || '/'}data/feed/contact_coverage.json`)
      .then(r => r.ok ? r.json() : {})
      .then(data => { if (!cancelled) setCoverage(data || {}) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => applyFilters(entries, filters), [entries, filters])
  const sourceCount = useMemo(() => new Set(entries.flatMap(e => (e.sources || []).map(s => s.id || s.name))).size, [entries])
  const newest = useMemo(() => {
    const t = Math.max(0, ...entries.map(e => Date.parse(e.ingested_at || '') || 0))
    if (!t) return null
    const h = Math.round((Date.now() - t) / 36e5)
    return h < 1 ? 'under an hour ago' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)} days ago`
  }, [entries])

  return (
    <>
      <SEO title="Feed" description="BD intelligence feed for energy-industry recruiters" />
      <div className="mz feed">
        <PageHeader
          title="Feed"
          sub="Project, contract and investment news that points to hiring, with who is hiring and whether we can reach them."
        />
        {!loading && !error && (
          <DataBasis parts={[
            <><b className="num">{entries.length}</b> signals{sourceCount ? <> from <b className="num">{sourceCount}</b> sources</> : null}</>,
            newest && `Newest ${newest}`,
            filtered.length !== entries.length && <><b className="num">{filtered.length}</b> match these filters</>,
          ]} />
        )}

        <FeedFilters taxonomy={taxonomy} />

        {loading && <EmptyState title="Loading the feed…" />}
        {error && <EmptyState title="The feed did not load">{error}</EmptyState>}

        {!loading && !error && filtered.length === 0 && (
          <EmptyState title="No signals match">Widen the time range or clear a filter.</EmptyState>
        )}

        {!loading && !error && filtered.map(entry => (
          <FeedCard
            key={entry.id}
            entry={entry}
            taxonomy={taxonomy}
            pdlCache={pdlCache}
            coverage={coverage}
            onOperatorClick={(slug, name, entryId) => setCompanyModal({ slug, name, entryId })}
            onContractorClick={(slug, name, entryId) => setCompanyModal({ slug, name, entryId })}
          />
        ))}

      </div>

      <ComingSoonSection />

      {companyModal && (
        <CompanyCardModal
          slug={companyModal.slug}
          name={companyModal.name}
          entryId={companyModal.entryId}
          onClose={() => setCompanyModal(null)}
        />
      )}
    </>
  )
}
