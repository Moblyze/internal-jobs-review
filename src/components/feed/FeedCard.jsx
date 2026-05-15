// src/components/feed/FeedCard.jsx
import { useState } from 'react'
import BdCardExpanded from './BdCardExpanded'
import ReadinessBadge from './ReadinessBadge'
import Stepper from './Stepper'
import { formatRelativeOrAbsolute } from '../../utils/feed/relativeTime'
import { getSizeTier } from '../../utils/feed/sizeTier'

const SUBSECTOR_PILL = {
  'offshore-og':       'bg-blue-100 text-blue-800',
  'onshore-og':        'bg-amber-100 text-amber-800',
  'offshore-wind':     'bg-teal-100 text-teal-800',
  'onshore-renewables':'bg-green-100 text-green-800',
  'nuclear':           'bg-violet-100 text-violet-800',
  'mining':            'bg-slate-100 text-slate-800',
}
const SUBSECTOR_TIP = {
  'offshore-og':         'Offshore oil & gas — deepwater + shelf production, FPSO/FSO, subsea, drilling',
  'onshore-og':          'Onshore oil & gas — pipelines, refineries, drilling, LNG terminals',
  'offshore-wind':       'Offshore wind — monopile, jacket, floating',
  'onshore-renewables':  'Onshore renewables — solar, onshore wind, BESS',
  'nuclear':             'Nuclear — PWR/BWR, SMR, refurbishment, new build',
  'mining':              'Mining — hard rock, surface, mineral processing',
}
const SIGNAL_PILL = {
  'fid':         'bg-green-100 text-green-800',
  'epc_award':   'bg-blue-100 text-blue-800',
  'tender':      'bg-amber-100 text-amber-800',
  'rig_fixture': 'bg-violet-100 text-violet-800',
  'vessel_mob':  'bg-pink-100 text-pink-800',
  'lease_round': 'bg-indigo-100 text-indigo-800',
  'replacement': 'bg-red-100 text-red-800',
  'decom':       'bg-slate-100 text-slate-800',
  'regulatory':  'bg-gray-100 text-gray-800',
}
const SIGNAL_TIP = {
  'fid':         'Final Investment Decision — project formally sanctioned; engineering ramp begins.',
  'epc_award':   'EPC contract awarded — contractor won engineering, procurement & construction scope. Engineering hires start within 1–3mo.',
  'tender':      'Tender open — operator soliciting bids; no winner yet. Long lead.',
  'rig_fixture': 'Rig fixture — drilling rig contracted to an operator for a specific campaign.',
  'vessel_mob':  'Vessel mobilization — offshore vessel/rig moving to site for active work. Immediate hiring window.',
  'lease_round': 'Lease round / block award — acreage assigned to operator. Years from active hiring.',
  'replacement': 'Contractor replacement mid-project — work re-tendering likely; near-term staffing turnover.',
  'decom':       'Decommissioning — end-of-life dismantling or plug-and-abandonment scope.',
  'regulatory':  'Regulatory milestone — permit, license, or approval that unblocks hiring.',
}

function PillSubsector({ taxonomy, id }) {
  const t = taxonomy?.subsectors.find(s => s.id === id)
  if (!t) return null
  return (
    <span
      className={`pill-tip text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${SUBSECTOR_PILL[id] || 'bg-gray-100 text-gray-800'}`}
      data-tooltip={SUBSECTOR_TIP[id]}
    >
      {t.label}
    </span>
  )
}
function PillSignal({ taxonomy, id }) {
  const t = taxonomy?.signal_types.find(s => s.id === id)
  if (!t) return null
  return (
    <span
      className={`pill-tip text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${SIGNAL_PILL[id] || 'bg-gray-100 text-gray-800'}`}
      data-tooltip={SIGNAL_TIP[id]}
    >
      ● {t.label}
    </span>
  )
}
const SIZE_LABEL = { solo: 'Solo', small: 'Small', midsize: 'Midsize', large: 'Large', mega: 'Mega', unknown: '?' }

function SizeBadge({ tier }) {
  if (!tier || tier === 'unknown') return null
  return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 ml-1" title={`Company size: ${SIZE_LABEL[tier]}`}>{SIZE_LABEL[tier]}</span>
}

function PillRegion({ region, country }) {
  if (!region && !country) return null
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"/></svg>
      {region || country}
    </span>
  )
}

export default function FeedCard({ entry, taxonomy, pdlCache, onOperatorClick, onContractorClick }) {
  const [expanded, setExpanded] = useState(false)
  const operator = entry.operator?.name
  const contractor = entry.hiring_entity?.name
  const opSlug = entry.operator?.matched_company_slug
  const conSlug = entry.hiring_entity?.matched_company_slug
  const operatorTier = getSizeTier(operator, pdlCache)
  const contractorTier = getSizeTier(contractor, pdlCache)

  return (
    <article className="feed-card bg-white border border-gray-200 rounded-lg p-4 mb-2 transition-shadow hover:shadow-md cursor-pointer" onClick={() => setExpanded(x => !x)}>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 items-start mb-2">
        <div className="flex flex-wrap gap-1.5 items-center">
          <PillSubsector taxonomy={taxonomy} id={entry.subsector} />
          <PillRegion region={entry.region} country={entry.country} />
          <PillSignal taxonomy={taxonomy} id={entry.signal_type} />
          <ReadinessBadge readiness={entry.outreach_readiness} />
        </div>
        <div className="flex flex-col items-end gap-1.5 min-w-0" onClick={e => e.stopPropagation()}>
          <span className="text-xs text-gray-400 whitespace-nowrap">
            {formatRelativeOrAbsolute(entry.ingested_at)} · {entry.sources?.[0]?.name}
          </span>
          <Stepper entry={entry} />
        </div>
      </div>
      <h3 className="text-base font-semibold leading-snug mb-1">{entry.headline}</h3>
      {entry.estimated_hiring_window && (
        <div className="text-xs italic text-gray-500 mb-1">
          Likely hiring: {entry.estimated_hiring_window}
        </div>
      )}
      <div className="flex gap-3 text-xs text-gray-500 pt-2 border-t border-gray-100 mt-2">
        <span><span className="text-gray-400">Hiring:</span> {contractor
          ? <button className="text-blue-700 font-medium hover:underline" onClick={e => { e.stopPropagation(); onContractorClick?.(conSlug, contractor, entry.id) }}>{contractor}</button>
          : <span className="text-gray-700">—</span>}
          <SizeBadge tier={contractorTier} /></span>
        <span><span className="text-gray-400">Operator:</span> {operator
          ? <button className="text-blue-700 hover:underline" onClick={e => { e.stopPropagation(); onOperatorClick?.(opSlug, operator, entry.id) }}>{operator}</button>
          : <span className="text-gray-700">—</span>}
          <SizeBadge tier={operatorTier} /></span>
        {entry.mob_window?.start && (
          <span className="ml-auto font-medium text-gray-700">
            {entry.mob_window.start}{entry.mob_window.end ? ` → ${entry.mob_window.end}` : ''}
          </span>
        )}
      </div>
      {expanded && (
        <BdCardExpanded
          entryId={entry.id}
          taxonomy={taxonomy}
          onArchetypeSearch={(fullEntry, archetype) => {
            const company = fullEntry.hiring_entity?.name || fullEntry.operator?.name
            const slug = fullEntry.hiring_entity?.matched_company_slug || fullEntry.operator?.matched_company_slug
            if (slug) onContractorClick?.(slug, company, fullEntry.id)
          }}
        />
      )}
    </article>
  )
}
