// scripts/prewarm-contacts.js
//
// Relevance-gated contact prewarm. Pre-fills the pdl-company-feed Worker's
// CONTACTS KV with work emails for the people most worth reaching, so that when
// a recruiter opens a card in the SPA the contact is already there (Feature A
// auto-displays it — no click, no wait).
//
// Discipline:
//   - Targets only GENUINELY high-relevance employers/projects, ranked by
//     src/utils/feed/relevance.js (oil & gas, subsea, rope access weighted up).
//   - Enriches only the top 2 decision-makers per company (crew-hiring personas
//     first), skipping anyone who already has an email.
//   - free_only:true → Hunter + GetProspect free tiers ONLY. PDL (paid) is never
//     touched here. The free tiers' own monthly limits are the hard cost ceiling;
//     once exhausted they return misses, never charges.
//   - Idempotent: already-cached contacts return cached:true and cost nothing,
//     so re-runs are nearly free.
//   - Per-run cap (PREWARM_MAX_PER_RUN) paces spend so a single run can't drain
//     the month's free pool that live recruiter clicks also draw from.
//
// Usage:
//   npm run prewarm-contacts                 # live run
//   npm run prewarm-contacts -- --dry-run    # print the ranked plan, spend nothing
//   npm run prewarm-contacts -- --max 10     # cap lookups this run
//   npm run prewarm-contacts -- --limit 5    # only the top 5 companies

import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { rankHiringTargets, pickTopContacts } from '../src/utils/feed/relevance.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const ENTRIES_LITE_PATH = resolve(ROOT, 'public/data/feed/entries-lite.json')
const DECISION_MAKERS_PATH = resolve(ROOT, 'public/data/feed/decision_makers.json')

const WORKER_BASE = process.env.PDL_COMPANY_FEED_BASE || 'https://pdl-company-feed.jesse-82d.workers.dev'
const ORIGIN = process.env.PREWARM_ORIGIN || 'https://moblyze.github.io'
const CONTACTS_PER_COMPANY = Number(process.env.PREWARM_CONTACTS_PER_COMPANY || 2)
const MAX_PER_RUN = Number(process.env.PREWARM_MAX_PER_RUN || 25)
const PER_REQUEST_TIMEOUT_MS = 45_000

function parseArgs() {
  const args = { dryRun: false, max: MAX_PER_RUN, limit: null }
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--max') args.max = parseInt(process.argv[++i], 10) || MAX_PER_RUN
    else if (a === '--limit') args.limit = parseInt(process.argv[++i], 10) || null
  }
  return args
}

async function enrichPerson({ name, company, linkedin_url, names, mode }) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS)
  try {
    // 'pattern' mode derives ONLY from a known domain pattern — $0, no Hunter/GP/PDL,
    // no harvest. 'free' mode is the full free-tier cascade + one-shot harvest.
    const payload = mode === 'pattern'
      // free_only is belt-and-suspenders: pattern_only already short-circuits before
      // any provider, but if a Worker without pattern_only support is ever live, free_only
      // still guarantees the paid PDL tier is never hit by these extra derivations.
      ? { name, company, linkedin_url: linkedin_url || null, domain: null, pattern_only: true, free_only: true }
      : { name, company, linkedin_url: linkedin_url || null, domain: null, free_only: true, allow_harvest: true, names: names || [] }
    const res = await fetch(`${WORKER_BASE}/api/person/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!res.ok) return { error: `http_${res.status}` }
    return await res.json()
  } catch (err) {
    return { error: err.message || String(err) }
  } finally {
    clearTimeout(t)
  }
}

async function main() {
  const args = parseArgs()
  const [entries, decisionMakers] = await Promise.all([
    readFile(ENTRIES_LITE_PATH, 'utf-8').then(JSON.parse).catch(() => []),
    readFile(DECISION_MAKERS_PATH, 'utf-8').then(JSON.parse).catch(() => ({})),
  ])

  let ranked = rankHiringTargets(entries)
  if (args.limit) ranked = ranked.slice(0, args.limit)

  // Build the worklist per high-relevance company we have decision-makers for:
  //   - top-N contacts → 'free' mode (Hunter/GetProspect free tiers + one-shot harvest)
  //   - every OTHER decision-maker still needing an email → 'pattern' mode, which
  //     derives for free from the company's known pattern (and is a no-op miss if
  //     no pattern exists yet). This captures the rest of a company at $0 once a
  //     single confirmed email has established the pattern.
  const worklist = []
  for (const company of ranked) {
    const dm = decisionMakers[company.name.toLowerCase()]
    const top = pickTopContacts(dm?.contacts, CONTACTS_PER_COMPANY)
    const topKeys = new Set(top.map(c => c.source_url || c.name))
    const dmNames = (dm?.contacts || []).map(c => c.name).filter(Boolean)
    for (const c of top) {
      worklist.push({
        mode: 'free',
        company: company.name,
        score: company.totalScore,
        matched: company.matched,
        name: c.name,
        persona: c.persona || 'other',
        linkedin_url: c.linkedin_url || c.source_url || null,
        names: dmNames,
      })
    }
    for (const c of (dm?.contacts || [])) {
      if (!c || !c.name || c.email) continue
      if (topKeys.has(c.source_url || c.name)) continue
      worklist.push({
        mode: 'pattern',
        company: company.name,
        name: c.name,
        persona: c.persona || 'other',
        linkedin_url: c.linkedin_url || c.source_url || null,
      })
    }
  }

  console.log(`[prewarm-contacts] worker=${WORKER_BASE}`)
  console.log(`[prewarm-contacts] ${ranked.length} high-relevance companies → ${worklist.length} contacts needing email (cap ${args.max}/run, ${CONTACTS_PER_COMPANY}/company)`)
  console.log('')
  console.log('  Rank  Score  Company                              Subsectors / signals')
  ranked.slice(0, 25).forEach((c, i) => {
    const why = [c.subsectors.join(','), c.matched.length ? `[${c.matched.join(',')}]` : ''].filter(Boolean).join(' ')
    console.log(`  ${String(i + 1).padStart(4)}  ${String(c.totalScore).padStart(5)}  ${c.name.slice(0, 35).padEnd(35)}  ${why || '—'}`)
  })
  console.log('')

  const freeCount = worklist.filter(w => w.mode === 'free').length
  const patternCount = worklist.length - freeCount

  if (args.dryRun) {
    console.log(`[prewarm-contacts] --dry-run: ${freeCount} free-tier lookups (cap ${args.max}) + ${patternCount} pattern-only derivations (free):`)
    worklist.slice(0, args.max + patternCount).forEach((w, i) => {
      console.log(`  ${String(i + 1).padStart(3)}. [${w.mode === 'pattern' ? 'patt' : 'free'}] ${w.name} (${w.persona}) @ ${w.company}`)
    })
    return
  }

  let attempted = 0   // real free-tier lookups (cache misses) — paced against the cap
  let found = 0, cachedHits = 0, misses = 0, skippedNoDomain = 0, derivedFree = 0, stopped = null

  for (const w of worklist) {
    const isPattern = w.mode === 'pattern'
    // The per-run cap and the cap-stop apply ONLY to free-tier lookups. Pattern
    // derivations are $0, so they always run regardless of the cap.
    if (!isPattern && attempted >= args.max) { stopped = 'per_run_cap'; break }
    const r = await enrichPerson(w)

    if (r.error === 'daily_cap') { if (isPattern) continue; stopped = 'free_caps_exhausted'; break }
    if (r.error) { console.log(`  · ${w.name} @ ${w.company} → error (${r.error})`); continue }

    if (isPattern) {
      if (r.cached && r.email) { cachedHits++; continue }
      if (r.email) { derivedFree++; console.log(`  ◇ ${w.name} @ ${w.company} → ${r.email} (pattern, free)`) }
      continue
    }

    // No domain to search on (company website not cached yet) — costs nothing and
    // doesn't count against the cap; a later run retries once the domain is known.
    if (r.skipped) { skippedNoDomain++; continue }

    if (r.cached) { cachedHits++; if (r.email) console.log(`  ✓ ${w.name} @ ${w.company} → cached ${r.email}`); continue }

    attempted++
    if (r.email || r.phone) {
      found++
      console.log(`  ★ ${w.name} @ ${w.company} → ${r.email || r.phone} (${r.source})`)
    } else {
      misses++
      console.log(`  · ${w.name} @ ${w.company} → no contact found`)
    }
  }

  console.log('')
  console.log(`[prewarm-contacts] done · ${found} new emails · ${derivedFree} derived free (pattern) · ${cachedHits} already cached · ${misses} no-result · ${skippedNoDomain} skipped (no domain) · ${attempted} free lookups spent`)
  if (stopped === 'per_run_cap') console.log(`[prewarm-contacts] stopped at per-run cap (${args.max}); remaining targets will be picked up next run.`)
  if (stopped === 'free_caps_exhausted') console.log(`[prewarm-contacts] stopped: free enrichment caps reached for today. PDL (paid) is intentionally not used here.`)
}

main().catch(err => { console.error('[prewarm-contacts] fatal', err); process.exit(1) })
