#!/usr/bin/env node
/**
 * Build the data artifacts for the Cloudflare Pages site and the private R2 bucket.
 *
 * Source of truth stays public/data/jobs.json (full corpus, every field, active +
 * removed) and public/data/jobs-index.json (deduped, company-normalized list rows,
 * written by generate-index.js). Neither file is shipped to the browser any more.
 *
 * Outputs
 *   dist/data/jobs-manifest.json             tiny, revalidated on every load
 *   dist/data/jobs/index-NN.<hash>.json      CURRENT jobs only, dictionary-encoded list rows
 *                                            (what the list/filter UI renders), content-hashed
 *   dist/data/jobs/detail/KK.<hash>.json     description + structuredDescription + url per job,
 *                                            sharded by FNV-1a(id) % DETAIL_SHARDS, content-hashed
 *   .cf-r2/current/jobs-current.json.gz      full rows of current jobs (ops consumers, served
 *                                            through the Access-protected Pages Function)
 *   .cf-r2/archive/jobs/YYYY-MM.jsonl.gz     FULL corpus, all fields, active + removed, one file
 *                                            per month of first sighting (scrapedAt, else
 *                                            postedDate); merged with the prior archive so rows
 *                                            that later disappear from the Sheet are never lost
 *
 * Flags
 *   --out-dir <dir>        where the site files go (default dist/data). For local dev use
 *                          public/data (gitignored paths jobs/ and jobs-manifest.json).
 *   --r2-dir <dir>         R2 staging dir (default .cf-r2)
 *   --prior-archive <dir>  directory holding previously uploaded archive/jobs/*.jsonl.gz to merge
 *   --no-archive           skip the R2 outputs (dev)
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { jobShardIndex, shardKey } from '../src/utils/jobShard.js'

const arg = (name, def) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : def
}
const OUT_DATA = arg('--out-dir', 'dist/data')
const R2_DIR = arg('--r2-dir', '.cf-r2')
const PRIOR = arg('--prior-archive', null)
const NO_ARCHIVE = process.argv.includes('--no-archive')

const INDEX_CHUNK = 12500 // list rows per index shard
const DETAIL_SHARDS = 256 // ~0.6 MB raw each at 50k current jobs
const MB = 1048576

const JOBS_PATH = process.env.JOBS_PATH || 'public/data/jobs.json'
const INDEX_PATH = process.env.JOBS_INDEX_PATH || 'public/data/jobs-index.json'

const isCurrent = j => j.status !== 'removed' && j.status !== 'paused'
const hash8 = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8)
const writeFile = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
}
const mb = n => (n / MB).toFixed(2) + ' MiB'

console.log('[site-data] reading', JOBS_PATH, 'and', INDEX_PATH)
const jobs = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf8'))
const indexRows = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'))
if (!Array.isArray(jobs) || jobs.length === 0) throw new Error('jobs.json empty or not an array (LFS pointer?)')
if (!Array.isArray(indexRows) || indexRows.length === 0) throw new Error('jobs-index.json empty (run generate-index first)')

// ── 1. Current-jobs list index, dictionary encoded, sharded ──────────────────
const current = indexRows.filter(isCurrent)
function encodeLite(rows) {
  const skills = [], skillIdx = new Map()
  const companies = [], companyIdx = new Map()
  const locations = [], locationIdx = new Map()
  const intern = (list, map, v) => {
    if (!map.has(v)) { map.set(v, list.length); list.push(v) }
    return map.get(v)
  }
  const ids = []
  const out = rows.map(job => {
    ids.push(job.id)
    const e = {
      t: job.title,
      c: job.company ? intern(companies, companyIdx, job.company) : -1,
      l: job.location ? intern(locations, locationIdx, job.location) : -1,
    }
    if (job.status && job.status !== 'active') e.s = job.status
    if (job.skills && job.skills.length) e.k = job.skills.map(s => intern(skills, skillIdx, s))
    if (job.employmentType) e.e = job.employmentType
    if (job.source) e.sr = job.source
    if (job.profile) e.p = job.profile
    if (job.appReady) e.a = 1
    if (job.extractedCertifications && job.extractedCertifications.length) e.cr = job.extractedCertifications
    if (job.descriptionPreview) e.d = job.descriptionPreview.substring(0, 100)
    if (job.salary) e.sa = job.salary
    if (job.postedDate) e.pd = job.postedDate
    return e
  })
  return { _version: 1, skills, companies, locations, ids, jobs: out }
}

const manifest = {
  _version: 1,
  generatedAt: new Date().toISOString(),
  totalCurrent: current.length,
  index: [],
  detail: { shards: DETAIL_SHARDS, files: {} },
}
const sizes = { index: 0, detail: 0, maxIndex: 0, maxDetail: 0 }

for (let i = 0, n = 0; i < current.length; i += INDEX_CHUNK, n++) {
  const buf = Buffer.from(JSON.stringify(encodeLite(current.slice(i, i + INDEX_CHUNK))))
  const name = `index-${String(n).padStart(2, '0')}.${hash8(buf)}.json`
  writeFile(path.join(OUT_DATA, 'jobs', name), buf)
  manifest.index.push({ file: name, count: Math.min(INDEX_CHUNK, current.length - i) })
  sizes.index += buf.length
  sizes.maxIndex = Math.max(sizes.maxIndex, buf.length)
}

// ── 2. Detail shards (description etc. fetched on demand) ────────────────────
const currentIds = new Set(current.map(j => j.id))
const shards = Array.from({ length: DETAIL_SHARDS }, () => ({}))
let detailCount = 0
for (const j of jobs) {
  if (!currentIds.has(j.id)) continue
  const d = {}
  if (j.description) d.description = j.description
  if (j.structuredDescription) d.structuredDescription = j.structuredDescription
  if (j.url) d.url = j.url
  shards[jobShardIndex(j.id, DETAIL_SHARDS)][j.id] = d
  detailCount++
}
shards.forEach((obj, i) => {
  const buf = Buffer.from(JSON.stringify(obj))
  const key = shardKey(i, DETAIL_SHARDS)
  const name = `${key}.${hash8(buf)}.json`
  writeFile(path.join(OUT_DATA, 'jobs', 'detail', name), buf)
  manifest.detail.files[key] = name
  sizes.detail += buf.length
  sizes.maxDetail = Math.max(sizes.maxDetail, buf.length)
})
writeFile(path.join(OUT_DATA, 'jobs-manifest.json'), JSON.stringify(manifest))
console.log(`[site-data] index: ${manifest.index.length} shards, ${mb(sizes.index)} raw total, largest ${mb(sizes.maxIndex)}`)
console.log(`[site-data] detail: ${DETAIL_SHARDS} shards, ${detailCount} jobs, ${mb(sizes.detail)} raw total, largest ${mb(sizes.maxDetail)}`)

// ── 3. R2 outputs: current rows for ops consumers + the full archive ─────────
if (!NO_ARCHIVE) {
  fs.rmSync(R2_DIR, { recursive: true, force: true })
  const gz = buf => zlib.gzipSync(buf, { level: 9 })

  const currentRows = jobs.filter(isCurrent)
  writeFile(path.join(R2_DIR, 'current', 'jobs-current.json.gz'), gz(Buffer.from(JSON.stringify(currentRows))))

  const monthOf = j => {
    const m = /^(\d{4}-\d{2})/.exec(String(j.scrapedAt || j.postedDate || ''))
    return m ? m[1] : 'undated'
  }
  // Row identity for the archive is id + url: jobs.json can carry the same id twice.
  const rowKey = r => `${r.id}\u0000${r.url || ''}`
  const byMonth = new Map()
  for (const j of jobs) {
    const m = monthOf(j)
    if (!byMonth.has(m)) byMonth.set(m, new Map())
    byMonth.get(m).set(rowKey(j), j)
  }
  let merged = 0
  for (const [m, rows] of byMonth) {
    const prior = PRIOR && path.join(PRIOR, `${m}.jsonl.gz`)
    if (prior && fs.existsSync(prior)) {
      for (const line of zlib.gunzipSync(fs.readFileSync(prior)).toString('utf8').split('\n')) {
        if (!line) continue
        const row = JSON.parse(line)
        if (!rows.has(rowKey(row))) { rows.set(rowKey(row), row); merged++ } // keep rows that left the Sheet
      }
    }
    const body = [...rows.values()].map(r => JSON.stringify(r)).join('\n') + '\n'
    writeFile(path.join(R2_DIR, 'archive', 'jobs', `${m}.jsonl.gz`), gz(Buffer.from(body)))
  }
  console.log(`[site-data] archive: ${byMonth.size} month files, ${merged} rows carried over from the prior archive`)
  for (const f of fs.readdirSync(path.join(R2_DIR, 'archive/jobs')).sort())
    console.log(`  archive/jobs/${f} ${mb(fs.statSync(path.join(R2_DIR, 'archive/jobs', f)).size)}`)
  console.log(`  current/jobs-current.json.gz ${mb(fs.statSync(path.join(R2_DIR, 'current/jobs-current.json.gz')).size)}`)
}
