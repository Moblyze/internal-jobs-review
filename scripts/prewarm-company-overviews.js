// scripts/prewarm-company-overviews.js
//
// Pre-warms the pdl-company-feed Worker's COMPANIES KV cache by calling
// /api/company/<name> for every distinct hiring_entity/operator in
// entries.json. The Worker handles the cascade (Wikidata → EDGAR → … →
// WebSearch → Apollo) and caches the result for 1 year, so by the time a
// human clicks a card in the SPA the overview is already there — no
// modal-open latency, even for entities that need the 8s WebSearch tier.
//
// Designed to run after feed-ingest in CI:
//   - Idempotent: companies already in cache return cached:true and cost
//     nothing.
//   - Concurrency-limited so we don't hammer the Worker.
//   - Logs miss/hit/source so the GH Actions output shows what the cascade
//     actually resolved each new company to.
//
// Triggers:
//   npm run prewarm-company-overviews
//   npm run prewarm-company-overviews -- --limit 5         # cap for testing
//   npm run prewarm-company-overviews -- --only "Acme,Foo" # specific names

import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const ENTRIES_PATH = resolve(ROOT, 'public/data/feed/entries.json')

const WORKER_BASE = process.env.PDL_COMPANY_FEED_BASE || 'https://pdl-company-feed.moblyze-ops.workers.dev'
const ORIGIN = process.env.PREWARM_ORIGIN || 'https://moblyze.github.io'
const CONCURRENCY = 3
const PER_REQUEST_TIMEOUT_MS = 45_000

function parseArgs() {
  const args = { limit: null, only: null }
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (a === '--limit') args.limit = parseInt(process.argv[++i], 10) || null
    else if (a === '--only') args.only = process.argv[++i]
  }
  return args
}

function collectFeedCompanies(entries) {
  const names = new Set()
  for (const e of entries) {
    for (const k of ['hiring_entity', 'operator']) {
      const v = e?.[k]
      if (v && typeof v === 'object' && typeof v.name === 'string' && v.name.trim()) {
        names.add(v.name.trim())
      }
    }
  }
  return [...names]
}

async function fetchCompany(name) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS)
  try {
    const url = `${WORKER_BASE}/api/company/${encodeURIComponent(name)}`
    const res = await fetch(url, { headers: { Origin: ORIGIN }, signal: controller.signal })
    if (!res.ok) return { name, error: `http_${res.status}` }
    const data = await res.json()
    if (data._empty) return { name, source: 'none', cached: !!data.cached }
    return { name, source: data._source || '?', cached: !!data.cached }
  } catch (err) {
    return { name, error: err.message || String(err) }
  } finally {
    clearTimeout(t)
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

async function main() {
  const args = parseArgs()
  const entries = JSON.parse(await readFile(ENTRIES_PATH, 'utf-8'))
  let companies = collectFeedCompanies(entries)
  if (args.only) {
    const onlySet = new Set(args.only.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
    companies = companies.filter(c => onlySet.has(c.toLowerCase()))
  }
  if (args.limit && companies.length > args.limit) companies = companies.slice(0, args.limit)

  console.log(`[prewarm-co] worker=${WORKER_BASE}`)
  console.log(`[prewarm-co] processing ${companies.length} companies`)
  if (companies.length === 0) return

  const startedAt = Date.now()
  const results = await runWithConcurrency(companies, CONCURRENCY, async (name, i) => {
    const t0 = Date.now()
    process.stdout.write(`[prewarm-co] (${i + 1}/${companies.length}) ${name} … `)
    const r = await fetchCompany(name)
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    if (r.error) console.log(`error (${r.error}) · ${dt}s`)
    else if (r.cached) console.log(`cache hit · ${r.source} · ${dt}s`)
    else console.log(`fresh · ${r.source} · ${dt}s`)
    return r
  })

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  const bySource = {}
  let errors = 0
  for (const r of results) {
    if (r?.error) { errors++; continue }
    bySource[r.source] = (bySource[r.source] || 0) + 1
  }
  console.log(`[prewarm-co] done · ${elapsed}s total`)
  console.log(`[prewarm-co] by source:`, bySource)
  if (errors) console.log(`[prewarm-co] errors: ${errors}`)
}

main().catch(err => { console.error('[prewarm-co] fatal', err); process.exit(1) })
