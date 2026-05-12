// src/components/feed/FeedFilters.jsx
import Select from 'react-select'
import { useFilterParams } from '../../hooks/useFilterParams'

const compactStyles = {
  control: (b) => ({ ...b, minHeight: '34px', borderColor: '#d1d5db', boxShadow: 'none', fontSize: '0.8125rem' }),
  multiValue: (b) => ({ ...b, backgroundColor: '#dbeafe' }),
  multiValueLabel: (b) => ({ ...b, color: '#1e40af', fontSize: '0.75rem' }),
  placeholder: (b) => ({ ...b, color: '#9ca3af', fontSize: '0.8125rem' }),
}

const TIME_OPTS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All' },
]

const READINESS_OPTS = [
  { value: 'live_now', label: 'Live now' },
  { value: 'hot',      label: 'Hot' },
  { value: 'warming',  label: 'Warming' },
  { value: 'cold',     label: 'Cold' },
]

const PHASE_OPTS = [
  { value: 'construction',           label: 'Construction' },
  { value: 'sanctioned_engineering', label: 'Sanctioned engineering' },
  { value: 'pre_sanction',           label: 'Pre-sanction' },
  { value: 'operating',              label: 'Operating' },
]

const SORT_OPTS = [
  { value: 'recent',    label: 'Most recent' },
  { value: 'readiness', label: 'Readiness (hottest first)' },
]

export default function FeedFilters({ taxonomy }) {
  const { filters, setFilters } = useFilterParams()

  const subsectorOptions = (taxonomy?.subsectors || []).map(s => ({ value: s.id, label: s.label }))
  const disciplineOptions = (taxonomy?.discipline_tags || []).map(d => ({ value: d.id, label: d.label }))
  const signalOptions = (taxonomy?.signal_types || []).map(s => ({ value: s.id, label: s.label }))

  return (
    <details open>
      <summary className="md:hidden cursor-pointer text-sm text-gray-700 mb-2">Filters</summary>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-2 mb-4">
        <Select
          isMulti
          placeholder="Subsector"
          styles={compactStyles}
          options={subsectorOptions}
          value={subsectorOptions.filter(o => filters.subsectors.includes(o.value))}
          onChange={vs => setFilters({ ...filters, subsectors: vs.map(v => v.value) })}
        />
        <Select
          isMulti
          placeholder="Discipline"
          styles={compactStyles}
          options={disciplineOptions}
          value={disciplineOptions.filter(o => filters.disciplines.includes(o.value))}
          onChange={vs => setFilters({ ...filters, disciplines: vs.map(v => v.value) })}
        />
        <Select
          isMulti
          placeholder="Signal type"
          styles={compactStyles}
          options={signalOptions}
          value={signalOptions.filter(o => filters.signals.includes(o.value))}
          onChange={vs => setFilters({ ...filters, signals: vs.map(v => v.value) })}
        />
        <Select
          isMulti
          placeholder="Readiness"
          styles={compactStyles}
          options={READINESS_OPTS}
          value={READINESS_OPTS.filter(o => (filters.readiness || []).includes(o.value))}
          onChange={vs => setFilters({ ...filters, readiness: vs.map(v => v.value) })}
        />
        <Select
          isMulti
          placeholder="Phase"
          styles={compactStyles}
          options={PHASE_OPTS}
          value={PHASE_OPTS.filter(o => (filters.phases || []).includes(o.value))}
          onChange={vs => setFilters({ ...filters, phases: vs.map(v => v.value) })}
        />
        <Select
          placeholder="Sort"
          styles={compactStyles}
          options={SORT_OPTS}
          value={SORT_OPTS.find(o => o.value === (filters.sort || 'recent'))}
          onChange={v => setFilters({ ...filters, sort: v.value })}
        />
        <Select
          placeholder="Time range"
          styles={compactStyles}
          options={TIME_OPTS}
          value={TIME_OPTS.find(o => o.value === filters.timeRange)}
          onChange={v => setFilters({ ...filters, timeRange: v.value })}
        />
        <input
          type="search"
          placeholder="Search headlines + summary"
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          value={filters.feedSearch}
          onChange={e => setFilters({ ...filters, feedSearch: e.target.value })}
        />
      </div>
    </details>
  )
}
