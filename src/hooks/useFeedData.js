// src/hooks/useFeedData.js
import { useEffect, useState } from 'react'

const LITE_URL = `${import.meta.env.BASE_URL || '/'}data/feed/entries-lite.json`
const FULL_URL = `${import.meta.env.BASE_URL || '/'}data/feed/entries.json`
const TAXONOMY_URL = `${import.meta.env.BASE_URL || '/'}data/feed/taxonomy.json`

export function useFeedData() {
  const [state, setState] = useState({ entries: [], taxonomy: null, loading: true, error: null })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [entriesRes, taxRes] = await Promise.all([
          fetch(LITE_URL),
          fetch(TAXONOMY_URL),
        ])
        if (!entriesRes.ok || !taxRes.ok) throw new Error('feed data fetch failed')
        const [entries, taxonomy] = await Promise.all([entriesRes.json(), taxRes.json()])
        if (!cancelled) setState({ entries, taxonomy, loading: false, error: null })
      } catch (err) {
        if (!cancelled) setState({ entries: [], taxonomy: null, loading: false, error: err.message })
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return state
}

const fullEntryCache = new Map()
export async function fetchFullEntry(id) {
  if (fullEntryCache.has(id)) return fullEntryCache.get(id)
  const all = await fetch(FULL_URL).then(r => r.json())
  for (const e of all) fullEntryCache.set(e.id, e)
  return fullEntryCache.get(id) || null
}
