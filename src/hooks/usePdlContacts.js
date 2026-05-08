// src/hooks/usePdlContacts.js
import { useEffect, useState } from 'react'

const WORKER_BASE = import.meta.env.VITE_WORKER_BASE || 'https://pdl-company-feed.jesse-82d.workers.dev'

export function usePdlContacts(companyName) {
  const [state, setState] = useState({ contacts: [], loading: !!companyName, error: null, cached: undefined })
  useEffect(() => {
    if (!companyName) return
    let cancelled = false
    setState(s => ({ ...s, loading: true }))
    fetch(`${WORKER_BASE}/api/contacts/${encodeURIComponent(companyName)}`)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(data => { if (!cancelled) setState({ contacts: data.contacts || [], loading: false, error: null, cached: !!data.cached }) })
      .catch(err => { if (!cancelled) setState({ contacts: [], loading: false, error: String(err), cached: undefined }) })
    return () => { cancelled = true }
  }, [companyName])
  return state
}

export function logTelemetry(event) {
  fetch(`${WORKER_BASE}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...event, ts: Date.now() }),
  }).catch(() => {})
}

export function postContactFeedback(payload) {
  return fetch(`${WORKER_BASE}/api/feedback/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {})
}

// Pre-flight: returns true if contacts for this company are KV-cached on the Worker.
// Never burns PDL credits — just checks KV existence. Used by the modal to decide
// whether to auto-show contacts (cached, free) or display the explicit button (uncached).
export function checkContactsCached(companyName) {
  if (!companyName) return Promise.resolve(false)
  return fetch(`${WORKER_BASE}/api/contacts/${encodeURIComponent(companyName)}/cached`)
    .then(r => r.ok ? r.json() : { cached: false })
    .then(data => !!data.cached)
    .catch(() => false)
}
