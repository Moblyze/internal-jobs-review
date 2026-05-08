// src/components/feed/OutreachDraftsPopover.jsx
import { useState } from 'react'

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const onClick = e => {
    e.stopPropagation()
    navigator.clipboard?.writeText(text || '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button onClick={onClick} title="Copy to clipboard" aria-label="Copy to clipboard"
            className="w-9 h-9 inline-flex items-center justify-center rounded bg-white border border-gray-300 text-gray-600 hover:bg-gray-50">
      {copied
        ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
        : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
      }
    </button>
  )
}

export default function OutreachDraftsPopover({ drafts }) {
  const [tab, setTab] = useState('linkedin')
  return (
    <div className="mt-3 bg-white border border-gray-200 rounded-md p-3">
      <div className="flex gap-2 mb-2">
        <button onClick={() => setTab('linkedin')} className={`text-xs font-semibold px-2.5 py-1 rounded ${tab === 'linkedin' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}>LinkedIn</button>
        <button onClick={() => setTab('email')} className={`text-xs font-semibold px-2.5 py-1 rounded ${tab === 'email' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}>Email</button>
      </div>
      {tab === 'linkedin' && (
        <div className="flex gap-2 items-start">
          <p className="text-[12.5px] leading-relaxed text-gray-700 flex-1 whitespace-pre-wrap">{drafts.linkedin_inmail || '(no draft generated)'}</p>
          <CopyButton text={drafts.linkedin_inmail} />
        </div>
      )}
      {tab === 'email' && (
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-0.5">Subject</div>
          <div className="flex gap-2 items-start mb-2">
            <p className="text-[13px] text-gray-800 flex-1">{drafts.email_subject || '(none)'}</p>
            <CopyButton text={drafts.email_subject} />
          </div>
          <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-0.5">Body</div>
          <div className="flex gap-2 items-start">
            <p className="text-[12.5px] leading-relaxed text-gray-700 flex-1 whitespace-pre-wrap">{drafts.email_body || '(none)'}</p>
            <CopyButton text={drafts.email_body} />
          </div>
        </div>
      )}
    </div>
  )
}
