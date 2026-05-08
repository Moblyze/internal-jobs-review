// scripts/feed-ingest/index.js
import { writeFile } from 'fs/promises'
import { PATHS, readJson, TRIM_WINDOW_DAYS } from './config.js'
import { fetchAllSources } from './fetchSources.js'
import { dedupeAgainstExisting } from './dedupe.js'
import { enrichEntry } from './enrich.js'
import { matchCompanyToSlug } from '../../src/utils/feed/companyMatcher.js'
import { findStaleSources, postHealthAlert } from './healthAlert.js'
import crypto from 'crypto'

function liteProjection(entry) {
  return {
    id: entry.id,
    ingested_at: entry.ingested_at,
    sources: entry.sources,
    subsector: entry.subsector,
    discipline_tags: entry.discipline_tags,
    signal_type: entry.signal_type,
    region: entry.region,
    country: entry.country,
    headline: entry.headline,
    operator: entry.operator,
    hiring_entity: entry.hiring_entity,
    project_name: entry.project_name,
    mob_window: entry.mob_window,
    contract_value_usd: entry.contract_value_usd,
  }
}

function trimToWindow(entries, days = TRIM_WINDOW_DAYS) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return entries.filter(e => e.ingested_at && new Date(e.ingested_at).getTime() >= cutoff)
}

async function main() {
  console.log('[feed-ingest] starting run at', new Date().toISOString())

  const excludedCountries = await readJson(PATHS.EXCLUDED_COUNTRIES).catch(() => ({ excluded: [] }))
  const excludedSet = new Set((excludedCountries.excluded || []).map(s => s.toLowerCase()))

  const [sources, taxonomy, existing, companiesData] = await Promise.all([
    readJson(PATHS.SOURCES),
    readJson(PATHS.TAXONOMY),
    readJson(PATHS.ENTRIES),
    readJson(PATHS.COMPANIES).catch(() => ({ companies: [] })),
  ])

  // 1. Fetch all sources in parallel.
  const fetchResults = await fetchAllSources(sources)
  const okCount = fetchResults.filter(r => r.ok).length
  const totalItems = fetchResults.reduce((acc, r) => acc + r.items.length, 0)
  console.log(`[feed-ingest] fetched ${okCount}/${sources.length} sources, ${totalItems} raw items`)

  // 2. Update last_seen_ok_at for sources that returned non-empty.
  const now = new Date().toISOString()
  const updatedSources = sources.map(src => {
    const r = fetchResults.find(f => f.source.id === src.id)
    return r && r.ok && r.items.length > 0 ? { ...src, last_seen_ok_at: now } : src
  })

  // 3. Flatten and dedupe.
  const allFresh = fetchResults.flatMap(r => r.items)
  const { newEntries, updatedExisting } = dedupeAgainstExisting(allFresh, existing)
  console.log(`[feed-ingest] ${newEntries.length} new entries, ${updatedExisting.length} merged with existing`)

  // 4. Enrich new entries.
  const enriched = []
  for (const ent of newEntries) {
    const e = await enrichEntry(ent, taxonomy, { excludedCountries: [...excludedSet] })
    if (e.bd_relevant === false) {
      console.log(`[feed-ingest] dropped (not BD-relevant): ${(e.headline || ent.headline || '').slice(0, 80)}`)
      continue
    }
    if (e.country && excludedSet.has(String(e.country).toLowerCase())) {
      console.log(`[feed-ingest] dropped (excluded country=${e.country}): ${e.headline?.slice(0, 80)}`)
      continue
    }
    e.id = crypto.randomUUID()
    e.ingested_at = now
    e.source_published_at = ent.published_at
    e.operator = e.operator || { name: null }
    e.hiring_entity = e.hiring_entity || { name: null }
    e.operator.matched_company_slug = matchCompanyToSlug(e.operator.name, companiesData)
    e.hiring_entity.matched_company_slug = matchCompanyToSlug(e.hiring_entity.name, companiesData)
    enriched.push(e)
  }

  // 5. Merge updated-existing back in (replacing originals).
  const updatedHashes = new Set(updatedExisting.map(e => e.hash))
  const finalAll = [
    ...existing.filter(e => !updatedHashes.has(e.hash)),
    ...updatedExisting,
    ...enriched,
  ]

  // 6. Trim to 90d.
  const trimmed = trimToWindow(finalAll)
  trimmed.sort((a, b) => new Date(b.ingested_at) - new Date(a.ingested_at))

  // 7. Write.
  await writeFile(PATHS.ENTRIES, JSON.stringify(trimmed, null, 2))
  await writeFile(PATHS.ENTRIES_LITE, JSON.stringify(trimmed.map(liteProjection), null, 2))
  await writeFile(PATHS.SOURCES, JSON.stringify(updatedSources, null, 2))

  console.log(`[feed-ingest] wrote ${trimmed.length} entries, ${enriched.length} new`)

  // 8. Health alerts.
  const stale = findStaleSources(updatedSources)
  if (stale.length > 0) {
    await postHealthAlert(stale, process.env.SLACK_WEBHOOK_URL)
    console.log(`[feed-ingest] posted health alert: ${stale.length} stale source(s)`)
  }
}

main().catch(err => {
  console.error('[feed-ingest] fatal error', err)
  process.exit(1)
})
