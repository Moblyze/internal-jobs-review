// src/hooks/usePdlContacts.js
import { useEffect, useState } from 'react'

const WORKER_BASE = import.meta.env.VITE_WORKER_BASE || 'https://pdl-company-feed.jesse-82d.workers.dev'

export function usePdlContacts(companyName) {
  const [state, setState] = useState({ contacts: [], loading: !!companyName, error: null })
  useEffect(() => {
    if (!companyName) return
    let cancelled = false
    setState(s => ({ ...s, loading: true }))
    fetch(`${WORKER_BASE}/api/contacts/${encodeURIComponent(companyName)}`)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(data => { if (!cancelled) setState({ contacts: data.contacts || [], loading: false, error: null }) })
      .catch(err => { if (!cancelled) setState({ contacts: [], loading: false, error: String(err) }) })
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
