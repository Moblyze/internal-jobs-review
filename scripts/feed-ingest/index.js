// scripts/feed-ingest/index.js
import { writeFile } from 'fs/promises'
import { PATHS, readJson, TRIM_WINDOW_DAYS, DEDUPE_WINDOW_DAYS } from './config.js'
import { fetchAllSources } from './fetchSources.js'
import { dedupeAgainstExisting } from './dedupe.js'
import { enrichEntry, PROMPT_VERSION } from './enrich.js'
import { matchCompanyToSlug } from '../../src/utils/feed/companyMatcher.js'
import { runHealthCheck, updateSourceRecords } from './healthAlert.js'
import { deriveArchetypes } from './archetypes.js'
import { getSizeTier } from '../../src/utils/feed/sizeTier.js'
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
    // Phase signals — surfaced on the collapsed card (Stepper + readiness/window)
    phase: entry.phase,
    construction_subphase: entry.construction_subphase,
    lifecycle_track: entry.lifecycle_track,
    decom_stage: entry.decom_stage,
    outreach_readiness: entry.outreach_readiness,
    estimated_hiring_window: entry.estimated_hiring_window,
    // Article-extracted named people — aggregated by company in modal
    key_people: entry.key_people,
  }
}

function trimToWindow(entries, days = TRIM_WINDOW_DAYS) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return entries.filter(e => e.ingested_at && new Date(e.ingested_at).getTime() >= cutoff)
}

function trimRejectedToWindow(rejected, days = DEDUPE_WINDOW_DAYS) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return rejected.filter(r => r.rejected_at && new Date(r.rejected_at).getTime() >= cutoff)
}

async function main() {
  console.log('[feed-ingest] starting run at', new Date().toISOString())

  const excludedCountries = await readJson(PATHS.EXCLUDED_COUNTRIES).catch(() => ({ excluded: [] }))
  const excludedSet = new Set((excludedCountries.excluded || []).map(s => s.toLowerCase()))

  const [sources, taxonomy, existing, companiesData, rejectedRaw, pdlCache] = await Promise.all([
    readJson(PATHS.SOURCES),
    readJson(PATHS.TAXONOMY),
    readJson(PATHS.ENTRIES),
    readJson(PATHS.COMPANIES).catch(() => ({ companies: [] })),
    readJson(PATHS.REJECTED_HASHES).catch(() => []),
    readJson(PATHS.PDL_COMPANY_CACHE).catch(() => ({})),
  ])

  const stillValidRejected = trimRejectedToWindow(Array.isArray(rejectedRaw) ? rejectedRaw : [])
  const rejectedHashSet = new Set(stillValidRejected.map(r => r.hash))

  // 1. Fetch all sources in parallel.
  const fetchResults = await fetchAllSources(sources)
  const okCount = fetchResults.filter(r => r.ok).length
  const totalItems = fetchResults.reduce((acc, r) => acc + r.items.length, 0)
  console.log(`[feed-ingest] fetched ${okCount}/${sources.length} sources, ${totalItems} raw items`)

  // 2. Update last_seen_ok_at (fetch health) and newest_item_published_at (content
  //    freshness) for sources that returned items. The two are deliberately separate:
  //    a feed can keep returning HTTP 200 with the same aging items forever, which
  //    moves last_seen_ok_at but must not move newest_item_published_at.
  const now = new Date().toISOString()
  const nowMs = Date.parse(now)
  const updatedSources = updateSourceRecords(sources, fetchResults, now)

  // 3. Flatten and dedupe.
  const allFresh = fetchResults.flatMap(r => r.items)
  const { newEntries: dedupedNew, updatedExisting } = dedupeAgainstExisting(allFresh, existing)
  const newEntries = dedupedNew.filter(e => !rejectedHashSet.has(e.hash))
  const skippedRejected = dedupedNew.length - newEntries.length
  console.log(`[feed-ingest] ${newEntries.length} new entries, ${updatedExisting.length} merged with existing`)
  console.log(`[feed-ingest] skipped ${skippedRejected} items previously rejected`)

  // 4. Enrich new entries.
  const enriched = []
  const newlyRejected = []
  for (const ent of newEntries) {
    const e = await enrichEntry(ent, taxonomy, { excludedCountries: [...excludedSet] })
    if (e.bd_relevant === false) {
      const headline = (e.headline || ent.headline || '').slice(0, 80)
      console.log(`[feed-ingest] dropped (not BD-relevant): ${headline}`)
      newlyRejected.push({ hash: ent.hash, rejected_at: now, reason: 'not_bd_relevant', headline })
      continue
    }
    if (e.country && excludedSet.has(String(e.country).toLowerCase())) {
      const headline = (e.headline || ent.headline || '').slice(0, 80)
      console.log(`[feed-ingest] dropped (excluded country=${e.country}): ${headline}`)
      newlyRejected.push({ hash: ent.hash, rejected_at: now, reason: `excluded_country:${e.country}`, headline })
      continue
    }
    e.id = crypto.randomUUID()
    e.ingested_at = now
    e.source_published_at = ent.published_at
    e.operator = e.operator || { name: null }
    e.hiring_entity = e.hiring_entity || { name: null }
    e.operator.matched_company_slug = matchCompanyToSlug(e.operator.name, companiesData)
    e.hiring_entity.matched_company_slug = matchCompanyToSlug(e.hiring_entity.name, companiesData)
    const sizeTierForArchetypes = getSizeTier(
      e.hiring_entity?.name || e.operator?.name,
      pdlCache
    )
    e.contact_archetypes = deriveArchetypes(e.phase, e.scope, sizeTierForArchetypes)
    e.prompt_version = PROMPT_VERSION
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
  const persistedRejected = trimRejectedToWindow([...stillValidRejected, ...newlyRejected])
  await writeFile(PATHS.ENTRIES, JSON.stringify(trimmed, null, 2))
  // Filter out gated-out and BD-irrelevant entries before writing the lite file.
  // They live in entries.json (full archive) but should never render in the SPA.
  const liteRendered = trimmed
    .filter(e => e.bd_relevant !== false && e.enrichment_status !== 'gated_out' && e.headline)
    .map(liteProjection)
  await writeFile(PATHS.ENTRIES_LITE, JSON.stringify(liteRendered, null, 2))
  await writeFile(PATHS.SOURCES, JSON.stringify(updatedSources, null, 2))
  await writeFile(PATHS.REJECTED_HASHES, JSON.stringify(persistedRejected, null, 2))

  console.log(`[feed-ingest] wrote ${trimmed.length} entries, ${enriched.length} new`)

  // 8. Health alerts. Fires on state change (ok -> problem, problem -> ok, new error
  //    class) and then re-reminds at most every HEALTH_REMIND_INTERVAL_HOURS. Silence
  //    is the normal outcome. See scripts/feed-ingest/healthAlert.js.
  try {
    await runHealthCheck({ sources: updatedSources, fetchResults, nowMs })
  } catch (err) {
    // Monitoring must never be able to break ingestion. The feed data is already
    // written by this point; losing an alert is far cheaper than losing a run.
    console.error('[health] alerting failed, continuing:', err && err.message)
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[feed-ingest] fatal error', err)
    process.exit(1)
  })
