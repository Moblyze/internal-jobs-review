// src/components/feed/BdCardExpanded.jsx
import { useEffect, useState } from 'react'
import { fetchFullEntry } from '../../hooks/useFeedData'
import OutreachDraftsPopover from './OutreachDraftsPopover'

function ChipMatched({ children, href }) {
  return (
    <a href={href} className="text-xs bg-white border border-indigo-200 text-indigo-900 px-2 py-0.5 rounded no-underline hover:bg-indigo-50">{children}</a>
  )
}
function ChipFreetext({ children }) {
  return (
    <span title="Not in site taxonomy — free-text only" className="text-xs bg-white border border-dashed border-gray-300 text-gray-500 px-2 py-0.5 rounded">{children}</span>
  )
}

function CertChip({ cert, matched }) {
  const cls = matched ? 'border-yellow-300 text-yellow-900' : 'border-dashed border-gray-300 text-gray-500'
  return <span className={`text-xs bg-white border ${cls} px-2 py-0.5 rounded`}>{cert}</span>
}

export default function BdCardExpanded({ entryId, taxonomy }) {
  const [entry, setEntry] = useState(null)
  const [showOutreach, setShowOutreach] = useState(false)
  useEffect(() => { fetchFullEntry(entryId).then(setEntry) }, [entryId])
  if (!entry) return <div className="mt-3 text-xs text-gray-400">Loading details…</div>

  const t = entry.targeting || {}
  const linkedinHref = t.boolean_search
    ? `https://www.linkedin.com/talent/search?keywords=${encodeURIComponent(t.boolean_search)}`
    : null

  const copyBoolean = (e) => {
    e.stopPropagation()
    if (!t.boolean_search) return
    navigator.clipboard?.writeText(t.boolean_search)
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-100" onClick={e => e.stopPropagation()}>
      {entry.tldr && <p className="text-sm text-gray-700 leading-relaxed mb-3">{entry.tldr}</p>}

      {/* Targeting block */}
      <div className="border border-indigo-200 bg-indigo-50/40 rounded-lg p-3 mb-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-indigo-700 mb-3">⊕ Candidate Targeting</div>

        {t.job_titles_freetext?.length > 0 && (
          <div className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-3 items-start text-[13px] mb-2">
            <div className="text-[11px] font-semibold text-gray-600 pt-1">Job titles</div>
            <div className="flex flex-wrap gap-1">
              {t.job_titles_freetext.map(jt => <ChipFreetext key={jt}>{jt}</ChipFreetext>)}
            </div>
          </div>
        )}
        {t.skills?.length > 0 && (
          <div className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-3 items-start text-[13px] mb-2">
            <div className="text-[11px] font-semibold text-gray-600 pt-1">Skills</div>
            <div className="flex flex-wrap gap-1">
              {t.skills.map(s => <ChipFreetext key={s}>{s}</ChipFreetext>)}
            </div>
          </div>
        )}
        {t.certs_freetext?.length > 0 && (
          <div className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-3 items-start text-[13px] mb-2">
            <div className="text-[11px] font-semibold text-gray-600 pt-1">Certifications</div>
            <div className="flex flex-wrap gap-1">
              {t.certs_freetext.map(c => <CertChip key={c} cert={c} matched={false} />)}
            </div>
          </div>
        )}
        {t.geo_rtw && (
          <div className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-3 items-start text-[13px] mb-2">
            <div className="text-[11px] font-semibold text-gray-600 pt-1">Geo · RTW</div>
            <div className="text-gray-700">{t.geo_rtw}</div>
          </div>
        )}
        {t.project_experience?.length > 0 && (
          <div className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-3 items-start text-[13px] mb-2">
            <div className="text-[11px] font-semibold text-gray-600 pt-1">Adjacent projects</div>
            <div className="flex flex-wrap gap-1">
              {t.project_experience.map(p => <ChipFreetext key={p}>{p}</ChipFreetext>)}
            </div>
          </div>
        )}
        {(t.yoe_band || t.seniority) && (
          <div className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-3 items-start text-[13px] mb-3">
            <div className="text-[11px] font-semibold text-gray-600 pt-1">YOE · seniority</div>
            <div className="text-gray-700">{[t.yoe_band, t.seniority].filter(Boolean).join(' · ')}</div>
          </div>
        )}

        {t.boolean_search && (
          <div className="relative bg-white border border-dashed border-indigo-200 rounded-lg p-3 pr-14 font-mono text-[11.5px] leading-relaxed text-gray-700 break-words">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-indigo-600 mb-1">Boolean search →</div>
            {t.boolean_search}
            <button title="Copy Boolean to clipboard" aria-label="Copy Boolean to clipboard" onClick={copyBoolean}
                    className="absolute top-2 right-2 w-11 h-11 inline-flex items-center justify-center rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            </button>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {linkedinHref && (
            <a href={linkedinHref} target="_blank" rel="noopener noreferrer"
               className="text-xs font-semibold bg-[#0a66c2] text-white px-3.5 py-1.5 rounded-md no-underline hover:bg-[#08549c]">
              Run search on LinkedIn ↗
            </a>
          )}
          {entry.outreach_drafts && (
            <button onClick={() => setShowOutreach(x => !x)}
                    className="text-xs font-medium bg-white text-gray-700 border border-gray-300 px-3 py-1.5 rounded-md hover:bg-gray-50 inline-flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Draft outreach
            </button>
          )}
        </div>

        {showOutreach && entry.outreach_drafts && <OutreachDraftsPopover drafts={entry.outreach_drafts} />}
      </div>

      {/* Footer meta */}
      <div className="flex flex-wrap gap-3 items-center text-xs text-gray-500 pt-2">
        {entry.contract_value_usd && <span><strong className="text-gray-700">${(entry.contract_value_usd / 1e9).toFixed(2)}B</strong> contract value</span>}
        <span className="text-gray-300">·</span>
        {entry.sources?.map(s => (
          <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{s.name} ↗</a>
        ))}
      </div>
    </div>
  )
}
