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

export default function FeedFilters({ taxonomy }) {
  const { filters, setFilters } = useFilterParams()

  const subsectorOptions = (taxonomy?.subsectors || []).map(s => ({ value: s.id, label: s.label }))
  const disciplineOptions = (taxonomy?.discipline_tags || []).map(d => ({ value: d.id, label: d.label }))
  const signalOptions = (taxonomy?.signal_types || []).map(s => ({ value: s.id, label: s.label }))

  return (
    <details className="md:open">
      <summary className="md:hidden cursor-pointer text-sm text-gray-700 mb-2">Filters</summary>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-4">
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
