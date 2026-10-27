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
 *   dist/data/jobs/filters.<hash>.json       precomputed filter lists (locations, skills, roles,
 *                                            top lists, counts over CURRENT jobs only)
 *   dist/data/jobs/page/KK.<hash>.json       job detail page data keyed by page slug: the full
 *                                            row plus precomputed similar jobs (FNV-1a(slug))
 *   dist/data/jobs/company/KK.<hash>.json    company page data keyed by company slug: that
 *                                            company's current jobs (FNV-1a(companySlug))
 *   .cf-r2/current/jobs-current.json.gz      full rows of current jobs (ops consumers, served
 *                                            through the Access-protected Pages Function)
 *   .cf-r2/closed/KK.json.gz                 removed/expired jobs for "closed" job pages: slug -> row
 *                                            (with description), sharded by FNV-1a(slug) % CLOSED_SHARDS,
 *                                            served by the Access-protected Pages Function
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
import { jobToSlug } from '../src/utils/formatters.js'
import { computeFacets } from './build-site-facets.mjs'

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
const CLOSED_SHARDS = 256 // removed jobs, ~1 MB raw each at 79k rows
const PAGE_SHARDS = 256 // job detail page data by slug, ~0.8 MB raw each at 50k current jobs
const COMPANY_SHARDS = 64 // company page data by company slug, ~0.3 MB raw each
const SIMILAR_LIMIT = 5
const POSTING_SCAN_CAP = 400 // similar-jobs candidate scan per shared location/skill
const MB = 1048576

const JOBS_PATH = process.env.JOBS_PATH || 'public/data/jobs.json'
const INDEX_PATH = process.env.JOBS_INDEX_PATH || 'public/data/jobs-index.json'
const FILTER_OPTIONS_PATH = process.env.FILTER_OPTIONS_PATH || 'public/data/filter-options.json'

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
const fullById = new Map(jobs.map(j => [j.id, j]))

console.log('[site-data] computing filter facets at build time')
const facetStart = Date.now()
const facets = await computeFacets(current, fullById)
console.log(`[site-data] facets: ${current.length} jobs in ${((Date.now() - facetStart) / 1000).toFixed(1)} s`)

function encodeLite(rows, rowFacets) {
  const skills = [], skillIdx = new Map()
  const companies = [], companyIdx = new Map()
  const locations = [], locationIdx = new Map()
  const locs = [], locsIdx = new Map()
  const validSkills = [], validSkillIdx = new Map()
  const roles = [], roleIdx = new Map()
  const intern = (list, map, v) => {
    if (!map.has(v)) { map.set(v, list.length); list.push(v) }
    return map.get(v)
  }
  const ids = []
  const out = rows.map((job, i) => {
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
    // Build-time facets (see build-site-facets.mjs): parsed locations, O*NET-validated
    // skills, energy role, agency flag, content-matched focus markets.
    const f = rowFacets[i]
    if (f.locs.length) e.lo = f.locs.map(v => intern(locs, locsIdx, v))
    if (f.validSkills.length) e.kv = f.validSkills.map(v => intern(validSkills, validSkillIdx, v))
    if (f.roleId) e.ro = intern(roles, roleIdx, f.roleId)
    if (f.isAgency) e.ag = 1
    if (f.markets.length) e.mk = f.markets
    return e
  })
  return { _version: 2, skills, companies, locations, locs, validSkills, roles, ids, jobs: out }
}

// "Updated" on the site means when the job DATA was built (generate-index.js stamps
// filter-options.json in the daily sync), not when this deploy ran or the browser loaded.
let filterOptions = {}
try { filterOptions = JSON.parse(fs.readFileSync(FILTER_OPTIONS_PATH, 'utf8')) } catch { /* optional */ }
const generatedAt = new Date().toISOString()
const manifest = {
  _version: 2,
  generatedAt,
  dataUpdatedAt: filterOptions._generatedAt || generatedAt,
  totalCurrent: current.length,
  index: [],
  detail: { shards: DETAIL_SHARDS, files: {} },
  page: { shards: PAGE_SHARDS, files: {} },
  company: { shards: COMPANY_SHARDS, files: {} },
  filters: null,
  closed: { shards: CLOSED_SHARDS },
}
const sizes = { index: 0, detail: 0, maxIndex: 0, maxDetail: 0 }

for (let i = 0, n = 0; i < current.length; i += INDEX_CHUNK, n++) {
  const buf = Buffer.from(JSON.stringify(encodeLite(current.slice(i, i + INDEX_CHUNK), facets.perJob.slice(i, i + INDEX_CHUNK))))
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
// ── 2b. Filters file (every count over CURRENT jobs only) ───────────────────
{
  const pass = k => (Array.isArray(filterOptions[k]) ? filterOptions[k] : [])
  const filtersFile = {
    _version: 1,
    dataUpdatedAt: manifest.dataUpdatedAt,
    totalCurrent: current.length,
    companies: pass('companies'),
    employmentTypes: pass('employmentTypes'),
    sources: pass('sources'),
    profiles: pass('profiles'),
    focusMarkets: pass('focusMarkets'),
    certifications: pass('certifications'),
    ...facets.filters,
  }
  const buf = Buffer.from(JSON.stringify(filtersFile))
  const name = `filters.${hash8(buf)}.json`
  writeFile(path.join(OUT_DATA, 'jobs', name), buf)
  manifest.filters = name
  console.log(`[site-data] filters: ${mb(buf.length)} raw, appReady ${filtersFile.appReadyCount} of ${current.length} current`)
}

// ── 2c. Job page shards (by slug) with precomputed similar jobs ──────────────
// A job page used to download the whole 17 MB index to find one row and score
// "similar jobs" against all 50K. Now it fetches one ~0.8 MB shard.
const listRow = (job, f) => {
  const r = { id: job.id, title: job.title, company: job.company, location: job.location, status: job.status || 'active' }
  if (job.employmentType) r.employmentType = job.employmentType
  if (job.salary) r.salary = job.salary
  if (job.postedDate) r.postedDate = job.postedDate
  if (job.appReady) r.appReady = true
  if (job.source) r.source = job.source
  if (job.profile) r.profile = job.profile
  if (f) {
    r.locs = f.locs
    r.validSkills = f.validSkills
    if (f.roleId) r.roleId = f.roleId
  }
  return r
}
{
  const canon = current.map(j => facets.normalizeCompanyName(j.company))
  const byCompany = new Map()
  const byLoc = new Map(), bySkill = new Map()
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v) }
  current.forEach((j, i) => {
    push(byCompany, canon[i], i)
    for (const l of facets.perJob[i].locs) push(byLoc, l, i)
    for (const s of j.skills || []) push(bySkill, s, i)
  })
  // Mirrors getSimilarJobs: same company first (index order), then other companies scored
  // 2 for a shared location + 1 per shared skill. Candidate scans are capped per posting
  // list so a 5,000-job city does not make this quadratic.
  const similarFor = i => {
    const out = []
    for (const k of byCompany.get(canon[i])) {
      if (k !== i) out.push(k)
      if (out.length >= SIMILAR_LIMIT) return out
    }
    const score = new Map()
    for (const l of facets.perJob[i].locs) {
      const list = byLoc.get(l) || []
      for (let n = 0; n < list.length && n < POSTING_SCAN_CAP; n++) {
        const k = list[n]
        if (canon[k] !== canon[i] && !score.has(k)) score.set(k, 2)
      }
    }
    for (const s of current[i].skills || []) {
      const list = bySkill.get(s) || []
      for (let n = 0; n < list.length && n < POSTING_SCAN_CAP; n++) {
        const k = list[n]
        if (canon[k] !== canon[i]) score.set(k, (score.get(k) || 0) + 1)
      }
    }
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
    for (const [k] of ranked) {
      out.push(k)
      if (out.length >= SIMILAR_LIMIT) break
    }
    return out
  }

  const pages = Array.from({ length: PAGE_SHARDS }, () => ({}))
  let pageCount = 0
  current.forEach((j, i) => {
    const slug = jobToSlug(j.company, j.title)
    if (!slug) return
    const shard = pages[jobShardIndex(slug, PAGE_SHARDS)]
    if (shard[slug]) return // findJobBySlug semantics: first match wins
    const full = fullById.get(j.id) || {}
    const row = listRow(j, facets.perJob[i])
    row.skills = j.skills || []
    if (j.extractedCertifications?.length) row.extractedCertifications = j.extractedCertifications
    if (full.description) row.description = full.description
    if (full.structuredDescription) row.structuredDescription = full.structuredDescription
    if (full.url) row.url = full.url
    shard[slug] = { job: row, similar: similarFor(i).map(k => listRow(current[k])) }
    pageCount++
  })
  let maxPage = 0
  pages.forEach((obj, i) => {
    const buf = Buffer.from(JSON.stringify(obj))
    const key = shardKey(i, PAGE_SHARDS)
    const name = `${key}.${hash8(buf)}.json`
    writeFile(path.join(OUT_DATA, 'jobs', 'page', name), buf)
    manifest.page.files[key] = name
    maxPage = Math.max(maxPage, buf.length)
  })
  console.log(`[site-data] page: ${pageCount} slugs in ${PAGE_SHARDS} shards, largest ${mb(maxPage)}`)

  // ── 2d. Company page shards (by company slug) ──────────────────────────────
  const companies = Array.from({ length: COMPANY_SHARDS }, () => ({}))
  current.forEach((j, i) => {
    if (!canon[i]) return
    const slug = facets.companyToSlug(canon[i])
    if (!slug) return
    const shard = companies[jobShardIndex(slug, COMPANY_SHARDS)]
    if (!shard[slug]) shard[slug] = { name: canon[i], jobs: [] }
    const row = listRow(j, facets.perJob[i])
    row.skills = j.skills || []
    if (j.extractedCertifications?.length) row.extractedCertifications = j.extractedCertifications
    if (j.descriptionPreview) row.descriptionPreview = j.descriptionPreview.substring(0, 100)
    shard[slug].jobs.push(row)
  })
  let maxCompany = 0
  companies.forEach((obj, i) => {
    const buf = Buffer.from(JSON.stringify(obj))
    const key = shardKey(i, COMPANY_SHARDS)
    const name = `${key}.${hash8(buf)}.json`
    writeFile(path.join(OUT_DATA, 'jobs', 'company', name), buf)
    manifest.company.files[key] = name
    maxCompany = Math.max(maxCompany, buf.length)
  })
  console.log(`[site-data] company: ${COMPANY_SHARDS} shards, largest ${mb(maxCompany)}`)
}

writeFile(path.join(OUT_DATA, 'jobs-manifest.json'), JSON.stringify(manifest))
console.log(`[site-data] index: ${manifest.index.length} shards, ${mb(sizes.index)} raw total, largest ${mb(sizes.maxIndex)}`)
console.log(`[site-data] detail: ${DETAIL_SHARDS} shards, ${detailCount} jobs, ${mb(sizes.detail)} raw total, largest ${mb(sizes.maxDetail)}`)

// ── 3. R2 outputs: current rows for ops consumers + the full archive ─────────
if (!NO_ARCHIVE) {
  fs.rmSync(R2_DIR, { recursive: true, force: true })
  const gz = buf => zlib.gzipSync(buf, { level: 9 })

  // Closed jobs: one row per slug (the page URL is company+title, not id), newest sighting
  // wins, and a slug that is still current never appears here (current takes precedence).
  const currentSlugs = new Set(current.map(j => jobToSlug(j.company, j.title)))
  const closedShards = Array.from({ length: CLOSED_SHARDS }, () => ({}))
  let closedCount = 0
  for (const r of indexRows) {
    if (isCurrent(r)) continue
    const slug = jobToSlug(r.company, r.title)
    if (!slug || currentSlugs.has(slug)) continue
    const full = fullById.get(r.id) || {}
    const seen = r.sourceCheckedAt || r.statusChangedDate || r.scrapedAt || ''
    const row = {
      id: r.id, title: r.title, company: r.company, location: r.location, status: r.status,
      skills: r.skills || [], employmentType: r.employmentType, salary: r.salary, postedDate: r.postedDate,
      lastSeen: seen, url: full.url, description: full.description,
      structuredDescription: full.structuredDescription || undefined,
    }
    const shard = closedShards[jobShardIndex(slug, CLOSED_SHARDS)]
    if (!shard[slug]) closedCount++
    if (!shard[slug] || String(seen) > String(shard[slug].lastSeen)) shard[slug] = row
  }
  closedShards.forEach((obj, i) =>
    writeFile(path.join(R2_DIR, 'closed', `${shardKey(i, CLOSED_SHARDS)}.json.gz`), gz(Buffer.from(JSON.stringify(obj)))))
  console.log(`[site-data] closed: ${closedCount} slugs in ${CLOSED_SHARDS} shards`)

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
