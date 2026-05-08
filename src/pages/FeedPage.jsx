// src/pages/FeedPage.jsx
import { useState, useMemo } from 'react'
import SEO from '../components/SEO'
import FeedFilters from '../components/feed/FeedFilters'
import FeedCard from '../components/feed/FeedCard'
import CompanyCardModal from '../components/feed/CompanyCardModal'
import ComingSoonSection from '../components/feed/ComingSoonSection'
import { useFeedData } from '../hooks/useFeedData'
import { useFilterParams } from '../hooks/useFilterParams'

const TIME_DAYS = { '7d': 7, '30d': 30, '90d': 90, 'all': 999999 }

function applyFilters(entries, filters) {
  const cutoff = Date.now() - (TIME_DAYS[filters.timeRange] || 30) * 24 * 60 * 60 * 1000
  const q = (filters.feedSearch || '').toLowerCase()
  return entries.filter(e => {
    if (e.ingested_at && new Date(e.ingested_at).getTime() < cutoff) return false
    if (filters.subsectors.length && !filters.subsectors.includes(e.subsector)) return false
    if (filters.disciplines.length && !filters.disciplines.some(d => (e.discipline_tags || []).includes(d))) return false
    if (filters.signals.length && !filters.signals.includes(e.signal_type)) return false
    if (q && !((e.headline || '').toLowerCase().includes(q))) return false
    return true
  })
}

export default function FeedPage() {
  const { entries, taxonomy, loading, error } = useFeedData()
  const { filters, setFilters } = useFilterParams()
  const [companyModal, setCompanyModal] = useState(null)

  const filtered = useMemo(() => applyFilters(entries, filters), [entries, filters])

  return (
    <>
      <SEO title="Feed — Moblyze Jobs" description="BD intelligence feed for energy-industry recruiters" />
      <div className="space-y-4">
        <header className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Feed</h1>
          <span className="text-sm text-gray-500">{filtered.length} entries</span>
        </header>

        <FeedFilters taxonomy={taxonomy} />

        {loading && <div className="text-sm text-gray-500">Loading…</div>}
        {error && <div className="text-sm text-red-600">Failed to load feed: {error}</div>}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-sm text-gray-500 py-8 text-center">No entries match the current filters.</div>
        )}

        {!loading && !error && filtered.map(entry => (
          <FeedCard
            key={entry.id}
            entry={entry}
            taxonomy={taxonomy}
            onOperatorClick={(slug, name) => setCompanyModal({ slug, name })}
            onContractorClick={(slug, name) => setCompanyModal({ slug, name })}
          />
        ))}

        {!loading && filters.timeRange !== 'all' && (
          <button
            onClick={() => setFilters({ ...filters, timeRange: filters.timeRange === '30d' ? '90d' : 'all' })}
            className="text-sm text-blue-600 hover:underline mt-4"
          >
            View older →
          </button>
        )}
      </div>

      <ComingSoonSection />

      {companyModal && (
        <CompanyCardModal
          slug={companyModal.slug}
          name={companyModal.name}
          onClose={() => setCompanyModal(null)}
        />
      )}
    </>
  )
}
