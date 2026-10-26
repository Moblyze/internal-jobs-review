#!/usr/bin/env node
// Final gate before `wrangler pages deploy`: run AFTER vite build and
// scripts/build-site-data.mjs. Removes non-site files from dist/ and FAILS the build if
// any file is over Pages' 25 MiB per-file limit, there are over 20k files, or people-data
// is still in dist/. R2 staging (.cf-r2/) is produced by build-site-data.mjs.
import { readdirSync, statSync, rmSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const DIST = 'dist'
const LIMIT = 24 * 1024 * 1024 // stay under Pages' 25 MiB

// Never ship: the full corpus (it goes to the R2 archive via build-site-data.mjs; the SPA
// reads the sharded files instead), backups, scratch data, the GitHub-Pages-only SPA
// trick, people-data.
const DROP = [
  /^data\/jobs\.json$/, /^data\/jobs-index\.json$/, /^data\/jobs-index-lite\.json$/,
  /\.backup/i, /backup-/i, /^data\/batches\//, /^data\/jobs\.sample\.json$/, /^404\.html$/,
  /^data\/feed\/decision_makers\.json$/,
]

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
}

let dropped = 0
for (const file of walk(DIST)) {
  const rel = relative(DIST, file)
  if (DROP.some(re => re.test(rel))) { rmSync(file); dropped++; console.log(`[cf-prepare] dropped ${rel}`); continue }
  if (statSync(file).size > LIMIT) {
    console.error(`[cf-prepare] FAIL: ${rel} is ${(statSync(file).size / 1048576).toFixed(1)} MiB, over the Pages limit`)
    process.exit(1)
  }
}
const files = walk(DIST).length
console.log(`[cf-prepare] ${dropped} dropped, ${files} files remain in dist/`)
if (files > 20000) { console.error('[cf-prepare] FAIL: over 20,000 files'); process.exit(1) }
if (existsSync(join(DIST, 'data/feed/decision_makers.json'))) { console.error('[cf-prepare] FAIL: people-data still in dist/'); process.exit(1) }
