// scripts/build-contact-coverage.js
//
// Produces public/data/feed/contact_coverage.json — a per-company COUNT of how
// many decision-makers we've identified and how many we currently have contact
// info (a cached work email) for. The feed cards read this to show a small
// "N identified · M reachable" badge at a glance.
//
// IMPORTANT: this file holds COUNTS ONLY — never names, emails, or phones. The
// actual contact details stay behind the origin-gated Worker (CONTACTS KV) and
// are never written into the public static build.
//
// "Has contact info" is resolved per contact via the Worker's free `cache_only`
// lookup (zero credit spend) so the count reflects the live cache — including
// everything the relevance prewarm and live recruiter clicks have enriched.
//
// Runs in CI (feed-ingest) and is committed with the rest of public/data/feed/.

import { readFile, writeFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DECISION_MAKERS_PATH = resolve(ROOT, 'public/data/feed/decision_makers.json')
const ENTRIES_LITE_PATH = resolve(ROOT, 'public/data/feed/entries-lite.json')
const OUT_PATH = resolve(ROOT, 'public/data/feed/contact_coverage.json')

const WORKER_BASE = process.env.PDL_COMPANY_FEED_BASE || 'https://pdl-company-feed.jesse-82d.workers.dev'
const ORIGIN = process.env.PREWARM_ORIGIN || 'https://moblyze.github.io'
const CONCURRENCY = 6
const PER_REQUEST_TIMEOUT_MS = 20_000

// Free, zero-spend cache check — returns true if the Worker already has an email
// cached for this person.
async function hasCachedEmail({ name, company, linkedin_url }) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${WORKER_BASE}/api/person/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ name, company, linkedin_url: linkedin_url || null, domain: null, cache_only: true }),
      signal: controller.signal,
    })
    if (!res.ok) return false
    const data = await res.json()
    return !!data.email
  } catch {
    return false
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
      results[i] = await worker(items[i])
    }
  })
  await Promise.all(runners)
  return results
}

async function main() {
  const [decisionMakers, entries] = await Promise.all([
    readFile(DECISION_MAKERS_PATH, 'utf-8').then(JSON.parse).catch(() => ({})),
    readFile(ENTRIES_LITE_PATH, 'utf-8').then(JSON.parse).catch(() => []),
  ])

  // Only compute for companies that actually appear in the feed (keeps the file
  // small and the cache checks bounded). Map lowercased → proper-case name so the
  // cache key matches what the prewarm used.
  const feedNames = new Map()
  for (const e of entries) {
    for (const k of ['hiring_entity', 'operator']) {
      const nm = e?.[k]?.name
      if (nm && typeof nm === 'string') feedNames.set(nm.toLowerCase(), nm)
    }
  }

  // Flatten to one cache check per contact, tally per company.
  const checks = []
  const coverage = {}
  for (const [key, dm] of Object.entries(decisionMakers)) {
    if (!feedNames.has(key)) continue
    const contacts = Array.isArray(dm?.contacts) ? dm.contacts : []
    if (contacts.length === 0) continue
    coverage[key] = { identified: contacts.length, with_email: 0 }
    const company = feedNames.get(key) || key
    for (const c of contacts) {
      if (c.email) { coverage[key].with_email++; continue }  // already known statically
      checks.push({ key, name: c.name, company, linkedin_url: c.linkedin_url || c.source_url || null })
    }
  }

  console.log(`[coverage] ${Object.keys(coverage).length} feed companies · ${checks.length} cache checks`)
  const found = await runWithConcurrency(checks, CONCURRENCY, async (chk) => {
    const ok = await hasCachedEmail(chk)
    if (ok) coverage[chk.key].with_email++
    return ok
  })

  const totalWith = Object.values(coverage).reduce((a, c) => a + c.with_email, 0)
  const totalIdent = Object.values(coverage).reduce((a, c) => a + c.identified, 0)
  await writeFile(OUT_PATH, JSON.stringify(coverage, null, 2) + '\n')
  console.log(`[coverage] wrote ${OUT_PATH} · ${totalIdent} identified · ${totalWith} with contact info · ${found.filter(Boolean).length} cache hits`)
}

main().catch(err => { console.error('[coverage] fatal', err); process.exit(1) })
