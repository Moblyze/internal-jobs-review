// scripts/feed-ingest/index.js
import { PATHS, readJson } from './config.js'

async function main() {
  console.log('[feed-ingest] starting run at', new Date().toISOString())

  const sources = await readJson(PATHS.SOURCES)
  console.log(`[feed-ingest] loaded ${sources.length} sources`)

  const taxonomy = await readJson(PATHS.TAXONOMY)
  console.log(
    `[feed-ingest] taxonomy: ${taxonomy.subsectors.length} subsectors, ` +
    `${taxonomy.discipline_tags.length} disciplines, ` +
    `${taxonomy.signal_types.length} signal types`
  )

  console.log('[feed-ingest] (skeleton — fetch/dedupe/enrich/write happen in later tasks)')
}

main().catch(err => {
  console.error('[feed-ingest] fatal error', err)
  process.exit(1)
})
