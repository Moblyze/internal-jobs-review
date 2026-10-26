#!/usr/bin/env node
// Make dist/ deployable to Cloudflare Pages (25 MiB per-file limit, 20k files).
// Moves every oversize / non-site file out of dist/ into .cf-r2/ (gzipped when it
// is a data file the SPA needs), ready for `wrangler r2 object put` into the
// private bucket. Keep PRIVATE_KEYS in sync with functions/data/[[path]].js.
import { readdirSync, statSync, mkdirSync, rmSync, createReadStream, createWriteStream, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'

const DIST = 'dist'
const OUT = '.cf-r2'
const LIMIT = 24 * 1024 * 1024 // stay under Pages' 25 MiB

// Served from R2 by the Pages Function (relative to dist/data/)
const SERVED_FROM_R2 = new Set(['jobs.json', 'jobs-index.json', 'jobs-index-lite.json', 'feed/decision_makers.json'])
// Never ship: backups, scratch data, GitHub-Pages-only SPA trick, people-data
const DROP = [/\.backup/i, /backup-/i, /^data\/batches\//, /^data\/jobs\.sample\.json$/, /^404\.html$/, /^data\/feed\/decision_makers\.json$/]

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
let moved = 0, dropped = 0
for (const file of walk(DIST)) {
  const rel = relative(DIST, file)
  const dataRel = rel.startsWith('data/') ? rel.slice(5) : null
  if (dataRel && SERVED_FROM_R2.has(dataRel) && dataRel !== 'feed/decision_makers.json') {
    const dest = join(OUT, dataRel + '.gz')
    mkdirSync(dirname(dest), { recursive: true })
    await pipeline(createReadStream(file), createGzip({ level: 9 }), createWriteStream(dest))
    rmSync(file); moved++
    console.log(`[cf-prepare] -> R2 ${dataRel}.gz (${(statSync(dest).size / 1048576).toFixed(1)} MiB gz)`)
    continue
  }
  if (DROP.some(re => re.test(rel))) { rmSync(file); dropped++; console.log(`[cf-prepare] dropped ${rel}`); continue }
  if (statSync(file).size > LIMIT) {
    console.error(`[cf-prepare] FAIL: ${rel} is ${(statSync(file).size / 1048576).toFixed(1)} MiB, over the Pages limit and not routed to R2`)
    process.exit(1)
  }
}
const files = walk(DIST).length
console.log(`[cf-prepare] ${moved} to R2, ${dropped} dropped, ${files} files remain in dist/`)
if (files > 20000) { console.error('[cf-prepare] FAIL: over 20,000 files'); process.exit(1) }
if (existsSync(join(DIST, 'data/feed/decision_makers.json'))) { console.error('[cf-prepare] FAIL: people-data still in dist/'); process.exit(1) }
