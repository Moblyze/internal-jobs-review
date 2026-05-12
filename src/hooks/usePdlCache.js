import { useEffect, useState } from 'react'

const PDL_CACHE_URL = `${import.meta.env.BASE_URL || '/'}data/pdl-company-cache.json`

let cachedPromise = null

function loadCache() {
  if (cachedPromise) return cachedPromise
  cachedPromise = fetch(PDL_CACHE_URL)
    .then(r => (r.ok ? r.json() : {}))
    .catch(() => ({}))
  return cachedPromise
}

export function usePdlCache() {
  const [cache, setCache] = useState({})
  useEffect(() => {
    let mounted = true
    loadCache().then(c => { if (mounted) setCache(c || {}) })
    return () => { mounted = false }
  }, [])
  return cache
}
