// scripts/feed-ingest/dedupe-existing.js
// One-shot: collapses entries.json by hash. Keeps the most-recent entry per
// hash (latest enrichment) and merges in `sources` from older duplicates so
// no source attribution is lost.
//
// Usage:
//   node scripts/feed-ingest/dedupe-existing.js --dry-run
//   node scripts/feed-ingest/dedupe-existing.js

import { writeFile } from 'fs/promises'
import { PATHS, readJson } from './config.js'

const DRY_RUN = process.argv.includes('--dry-run')

function mergeSources(target, source) {
  const targetSources = Array.isArray(target.sources) ? [...target.sources] : []
  const ids = new Set(targetSources.map(s => s.id))
  for (const s of source.sources || []) {
    if (s?.id && !ids.has(s.id)) {
      targetSources.push(s)
      ids.add(s.id)
    }
  }
  return targetSources
}

async function main() {
  console.log(`[dedupe-existing] starting${DRY_RUN ? ' (dry run)' : ''}`)

  const entries = await readJson(PATHS.ENTRIES)
  console.log(`[dedupe-existing] read ${entries.length} entries`)

  // Group by hash; entries without a hash get a synthetic per-id bucket so they're not lost.
  const byHash = new Map()
  let noHashCount = 0
  for (const e of entries) {
    const key = e.hash || `__nohash__:${e.id || Math.random()}`
    if (!e.hash) noHashCount++
    if (!byHash.has(key)) byHash.set(key, [])
    byHash.get(key).push(e)
  }
  console.log(`[dedupe-existing] ${byHash.size} unique hashes (${noHashCount} entries without hash)`)

  const collapsed = []
  let mergedSourceCount = 0
  for (const [, group] of byHash) {
    if (group.length === 1) {
      collapsed.push(group[0])
      continue
    }
    // Sort by ingested_at desc; pick the most recent (latest enrichment) as the keeper.
    const sorted = group.slice().sort((a, b) =>
      new Date(b.ingested_at || 0) - new Date(a.ingested_at || 0)
    )
    const keeper = { ...sorted[0] }
    // Merge sources from all duplicates into the keeper.
    let allSources = Array.isArray(keeper.sources) ? [...keeper.sources] : []
    const sourceIds = new Set(allSources.map(s => s?.id).filter(Boolean))
    for (let i = 1; i < sorted.length; i++) {
      for (const s of sorted[i].sources || []) {
        if (s?.id && !sourceIds.has(s.id)) {
          allSources.push(s)
          sourceIds.add(s.id)
          mergedSourceCount++
        }
      }
    }
    keeper.sources = allSources
    collapsed.push(keeper)
  }

  // Sort by ingested_at desc to match the live pipeline's output order
  collapsed.sort((a, b) => new Date(b.ingested_at || 0) - new Date(a.ingested_at || 0))

  console.log(`[dedupe-existing] collapsed ${entries.length} → ${collapsed.length} entries (merged ${mergedSourceCount} extra sources)`)

  if (DRY_RUN) {
    console.log('[dedupe-existing] dry run; no writes')
    return
  }

  await writeFile(PATHS.ENTRIES, JSON.stringify(collapsed, null, 2))
  console.log(`[dedupe-existing] wrote ${collapsed.length} entries`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[dedupe-existing] fatal', err)
    process.exit(1)
  })
