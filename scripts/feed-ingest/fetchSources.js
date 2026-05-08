import pLimit from 'p-limit'
import { fetchRss } from './sources/rss.js'
import { fetchEdgar } from './sources/edgar.js'
import { MAX_PARALLEL_FETCHES, FETCH_TIMEOUT_MS } from './config.js'

export const ADAPTERS = {
  rss: fetchRss,
  edgar: fetchEdgar,
}

export async function dispatchFetch(source, adapters = ADAPTERS) {
  const adapter = adapters[source.type]
  if (!adapter) throw new Error(`unknown source type: ${source.type}`)
  return adapter(source)
}

export async function fetchAllSources(sources) {
  const limit = pLimit(MAX_PARALLEL_FETCHES)
  const results = await Promise.all(
    sources
      .filter(s => s.active)
      .map(s => limit(async () => {
        const start = Date.now()
        try {
          const items = await Promise.race([
            dispatchFetch(s),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), FETCH_TIMEOUT_MS)),
          ])
          return { source: s, items, ok: true, elapsed_ms: Date.now() - start }
        } catch (err) {
          return { source: s, items: [], ok: false, error: err.message, elapsed_ms: Date.now() - start }
        }
      }))
  )
  return results
}
