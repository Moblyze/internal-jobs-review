// scripts/feed-ingest/backfill-entries.js
// Re-enrich BD-relevant entries from the last 30 days that lack the new
// phase/readiness/key_people fields. Idempotent: safe to re-run.
//
// Usage:
//   node scripts/feed-ingest/backfill-entries.js --dry-run
//   node scripts/feed-ingest/backfill-entries.js

import { writeFile } from 'fs/promises'
import { PATHS, readJson } from './config.js'
import { enrichEntry, PROMPT_VERSION } from './enrich.js'
import { deriveArchetypes } from './archetypes.js'
import { getSizeTier } from '../../src/utils/feed/sizeTier.js'

const WINDOW_DAYS = 30
const DRY_RUN = process.argv.includes('--dry-run')

function needsBackfill(entry) {
  return entry.bd_relevant !== false && !entry.phase && !entry.prompt_version
}

async function main() {
  console.log(`[backfill-entries] starting${DRY_RUN ? ' (dry run)' : ''}`)

  const [entries, taxonomy, excludedRaw, pdlCache] = await Promise.all([
    readJson(PATHS.ENTRIES),
    readJson(PATHS.TAXONOMY),
    readJson(PATHS.EXCLUDED_COUNTRIES).catch(() => ({ excluded: [] })),
    readJson(PATHS.PDL_COMPANY_CACHE).catch(() => ({})),
  ])
  const excludedSet = new Set((excludedRaw.excluded || []).map(s => s.toLowerCase()))

  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
  const candidates = entries.filter(e => {
    const t = e.ingested_at ? new Date(e.ingested_at).getTime() : 0
    return t >= cutoff && needsBackfill(e)
  })

  console.log(`[backfill-entries] ${candidates.length} entries in window need backfill`)

  if (DRY_RUN) {
    candidates.slice(0, 5).forEach(e => console.log(`  - ${e.headline?.slice(0, 80)}`))
    return
  }

  let success = 0
  let failed = 0
  const updated = new Map()
  for (const entry of candidates) {
    try {
      const reEnriched = await enrichEntry(entry, taxonomy, { excludedCountries: [...excludedSet] })
      const sizeTier = getSizeTier(reEnriched.hiring_entity?.name || reEnriched.operator?.name, pdlCache)
      reEnriched.contact_archetypes = deriveArchetypes(reEnriched.phase, reEnriched.scope, sizeTier)
      reEnriched.prompt_version = PROMPT_VERSION
      reEnriched.id = entry.id
      reEnriched.ingested_at = entry.ingested_at
      reEnriched.hash = entry.hash
      updated.set(entry.id, reEnriched)
      success++
      if (success % 25 === 0) console.log(`  ... ${success} done`)
    } catch (err) {
      console.warn(`[backfill-entries] failed: ${entry.headline?.slice(0, 60)} — ${err.message}`)
      failed++
    }
  }

  console.log(`[backfill-entries] done: ${success} ok, ${failed} failed`)

  const merged = entries.map(e => updated.get(e.id) || e)
  await writeFile(PATHS.ENTRIES, JSON.stringify(merged, null, 2))
  console.log(`[backfill-entries] wrote ${merged.length} entries`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[backfill-entries] fatal', err)
    process.exit(1)
  })
