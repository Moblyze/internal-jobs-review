// src/components/feed/FeedFilters.jsx
import Select from 'react-select'
import { useFilterParams } from '../../hooks/useFilterParams'
import { mzSelectStyles } from '../ui/selectStyles'
import { STAGES, normalizeStageFilter } from '../../utils/feed/phaseStage'

const compactStyles = mzSelectStyles

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

const PHASE_OPTS = STAGES.map((s, i) => ({ value: s.key, label: `${i + 1}. ${s.label}` }))

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
      <summary className="md:hidden cursor-pointer mz-field__l">Filters</summary>
      <div className="mz-filters feed-filters">
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
          placeholder="Stage"
          styles={compactStyles}
          options={PHASE_OPTS}
          value={PHASE_OPTS.filter(o => normalizeStageFilter(filters.phases || []).includes(o.value))}
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
          placeholder="Search headlines and summaries"
          className="mz-input"
          value={filters.feedSearch}
          onChange={e => setFilters({ ...filters, feedSearch: e.target.value })}
        />
      </div>
    </details>
  )
}
