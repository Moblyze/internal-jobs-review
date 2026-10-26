// src/hooks/usePdlContacts.js
import { useEffect, useState } from 'react'

const WORKER_BASE = import.meta.env.VITE_WORKER_BASE || 'https://pdl-company-feed.moblyze-ops.workers.dev'

export function usePdlContacts(companyName) {
  const [state, setState] = useState({
    contacts: [], loading: !!companyName, error: null,
    errorCode: null, errorMessage: null, cached: undefined,
  })
  useEffect(() => {
    if (!companyName) return
    let cancelled = false
    setState(s => ({ ...s, loading: true }))
    fetch(`${WORKER_BASE}/api/contacts/${encodeURIComponent(companyName)}`)
      .then(r => r.ok
        ? r.json()
        : r.status === 403
          ? Promise.resolve({ contacts: [], error: 'origin_not_allowed', message: 'BD feed not authorized from this origin.' })
          : Promise.reject(`HTTP ${r.status}`))
      .then(data => {
        if (cancelled) return
        if (data.error === 'daily_cap' || data.error === 'credits_exhausted' || data.error === 'origin_not_allowed') {
          setState({
            contacts: data.contacts || [],
            loading: false,
            error: data.error,
            errorCode: data.error,
            errorMessage: data.message || data.error,
            cached: !!data.cached,
          })
          return
        }
        setState({
          contacts: data.contacts || [],
          loading: false,
          error: null,
          errorCode: null,
          errorMessage: null,
          cached: !!data.cached,
        })
      })
      .catch(err => { if (!cancelled) setState({ contacts: [], loading: false, error: String(err), errorCode: 'network', errorMessage: String(err), cached: undefined }) })
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

// Per-contact enrichment: hits the Worker's /api/person/enrich which tries Hunter
// first (1 credit, by domain+name) and falls back to PDL Person Enrichment
// (1 credit, by LinkedIn URL). Returns { email, phone, source, confidence, cached, error }.
export function enrichPerson({ linkedin_url, name, company, domain } = {}) {
  if (!name || !company) return Promise.resolve({ email: null, phone: null, source: null, error: 'bad_request' })
  return fetch(`${WORKER_BASE}/api/person/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkedin_url: linkedin_url || null, name, company, domain: domain || null }),
  })
    .then(r => r.json())
    .catch(err => ({ email: null, phone: null, source: null, error: String(err?.message || err) }))
}

// Cache-only lookup: hits /api/person/enrich with cache_only:true so it returns an
// already-cached enrichment if present, or { miss: true } if not — and spends ZERO
// credits either way. Safe to call automatically on mount to auto-show cached contacts.
export function lookupCachedPerson({ linkedin_url, name, company, domain } = {}) {
  if (!name || !company) return Promise.resolve({ miss: true })
  return fetch(`${WORKER_BASE}/api/person/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkedin_url: linkedin_url || null, name, company, domain: domain || null, cache_only: true }),
  })
    .then(r => r.json())
    .catch(() => ({ email: null, phone: null, source: null, miss: true }))
}
