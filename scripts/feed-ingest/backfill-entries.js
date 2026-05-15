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
  if (entry.bd_relevant === false) return false
  // v1: entries never enriched for phase
  if (!entry.phase && !entry.prompt_version) return true
  // v1.2: any entry missing lifecycle_track (everything pre-v1.2). One pass
  //       fills both lifecycle_track and decom_stage on decom-flagged entries.
  if (!entry.lifecycle_track && entry.prompt_version !== 'phase-targeting-v1.2') return true
  return false
}

async function main() {
  console.log(`[backfill-entries] starting${DRY_RUN ? ' (dry run)' : ''}`)

  if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
    console.error('[backfill-entries] ANTHROPIC_API_KEY not set — refusing to run.')
    console.error('[backfill-entries] Pass via env or run in GH Actions where secrets.ANTHROPIC_API_KEY is wired.')
    process.exit(2)
  }

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
  let skipped = 0
  const updated = new Map()
  for (const entry of candidates) {
    try {
      // Skip the Haiku gate in backfill mode — these entries were already
      // classified bd_relevant by a prior Sonnet pass; the gate is for new
      // RSS items where we have no prior judgment, not for re-enrichment.
      const reEnriched = await enrichEntry(entry, taxonomy, { excludedCountries: [...excludedSet], skipGate: true })
      // Don't overwrite a good entry with a failed-enrichment stub. Skip and
      // keep the original. This protects against API auth failures, rate
      // limits, or any transient model error that would otherwise null out
      // the entry's existing tldr/subsector/operator fields.
      if (reEnriched.enrichment_status === 'failed') {
        console.warn(`[backfill-entries] skipped (enrichment failed): ${entry.headline?.slice(0, 60)}`)
        skipped++
        continue
      }
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

  console.log(`[backfill-entries] done: ${success} ok, ${skipped} skipped, ${failed} failed`)

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
