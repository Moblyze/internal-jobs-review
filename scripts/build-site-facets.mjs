/**
 * Build-time filter facets for the jobs site.
 *
 * The Jobs and Companies pages used to rebuild their filters in the browser on every load:
 * four location-parsing passes, two O*NET skill-validation passes and energy-role matching
 * over every current job (about 50 s of main-thread CPU at 50K jobs). None of it changes
 * between builds, so it runs here once, using the SAME src/utils modules the SPA uses
 * (bundled with esbuild so `import.meta.env` and `fetch` work under Node).
 *
 * computeFacets(currentRows, fullById) returns
 *   perJob[i]  { locs, validSkills, roleId, isAgency, markets } aligned with currentRows
 *   filters    the precomputed filter lists (see build-site-data.mjs for the file shape)
 *   helpers    normalizeCompanyName, companyToSlug (for company shards)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = process.env.FACETS_DATA_DIR || path.join(ROOT, 'public/data')

const ENTRY = `
export { getAllLocationsAsync } from './src/utils/locationParser.js'
export { createGroupedLocationOptionsWithGeodata, getTopLocationsFormatted } from './src/utils/locationGeodata.js'
export { initializeONet } from './src/utils/onetClient.js'
export { filterValidSkills } from './src/utils/skillValidator.js'
export { getEnergyRole, ENERGY_ROLES } from './src/utils/energyRoles.js'
export { matchEnergyRole } from './src/utils/energyJobMatcher.js'
export { isAgencyJob } from './src/utils/agencyBlocklist.js'
export { jobMatchesMarketContent, CONTENT_MATCHED_MARKETS } from './src/utils/marketContentMatcher.js'
export { normalizeCompanyName } from './src/utils/companyNormalizer.js'
export { companyToSlug } from './src/utils/formatters.js'
export { getUniqueSkills, getTopSkills } from './src/hooks/useJobs.js'
`

/** Serve `${BASE_URL}data/<file>` from the local data dir, like the static site would. */
function installNodeShims() {
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts) => {
    const m = /^\/data\/(.+)$/.exec(String(url))
    if (!m) return realFetch(url, opts)
    const file = path.join(DATA_DIR, m[1])
    if (!fs.existsSync(file)) return new Response('not found', { status: 404 })
    return new Response(fs.readFileSync(file), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (!globalThis.localStorage) {
    const store = new Map()
    globalThis.localStorage = {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
      key: i => [...store.keys()][i] ?? null,
      get length() { return store.size },
    }
  }
  return () => { globalThis.fetch = realFetch }
}

async function loadSiteUtils() {
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'site-facets-')), 'utils.mjs')
  await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'facets-entry.js', loader: 'js' },
    bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error',
    define: { 'import.meta.env': JSON.stringify({ BASE_URL: '/', DEV: false, PROD: true }) },
  })
  return import(pathToFileURL(outfile).href)
}

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')) } catch { return fallback }
}

/** Keep only the metadata fields the region filter reads (energyRegions.getRegionLocationValues). */
function slimLocationOptions(groups) {
  return groups.map(g => ({
    label: g.label,
    options: g.options.map(o => ({
      label: o.label,
      value: o.value,
      searchText: o.searchText,
      metadata: { countryCode: o.metadata?.countryCode || null, stateCode: o.metadata?.stateCode || null },
    })),
  }))
}

export async function computeFacets(currentRows, fullById = new Map()) {
  const restore = installNodeShims()
  const log = console.log
  console.log = () => {} // the shared utils log per call; keep the build log readable
  try {
    const u = await loadSiteUtils()
    await u.initializeONet()
    const mappings = readJson('job-occupations.json', {})

    const roleOf = job => {
      let roleId = null
      const mapping = mappings[job.id]
      if (mapping) {
        if (mapping.role_id) roleId = mapping.role_id
        else if (mapping.onet_code) roleId = u.getEnergyRole(mapping.onet_code).id
      }
      if (!roleId) {
        const kw = u.matchEnergyRole(job.title, '')
        if (kw) roleId = kw.roleId
      }
      return roleId && u.ENERGY_ROLES[roleId] ? roleId : null
    }

    const perJob = []
    const roleCounts = {}
    const locCounts = new Map()
    const contentMarketCounts = {}
    let agencyCount = 0
    for (const job of currentRows) {
      const locs = await u.getAllLocationsAsync(job.location)
      const validSkills = u.filterValidSkills(job.skills || [])
      const roleId = roleOf(job)
      const isAgency = u.isAgencyJob(job)
      const full = fullById.get(job.id)
      const contentJob = { title: job.title, description: full?.description || job.descriptionPreview || '' }
      const markets = u.CONTENT_MATCHED_MARKETS.filter(slug => u.jobMatchesMarketContent(contentJob, slug))
      perJob.push({ locs, validSkills, roleId, isAgency, markets })
      if (roleId) roleCounts[roleId] = (roleCounts[roleId] || 0) + 1
      for (const l of locs) locCounts.set(l, (locCounts.get(l) || 0) + 1)
      for (const m of markets) contentMarketCounts[m] = (contentMarketCounts[m] || 0) + 1
      if (isAgency) agencyCount++
    }

    const roles = Object.entries(roleCounts)
      .map(([id, count]) => ({
        id, label: u.ENERGY_ROLES[id].label, count,
        icon: u.ENERGY_ROLES[id].icon, category: u.ENERGY_ROLES[id].category,
      }))
      .sort((a, b) => (a.id === 'other' ? 1 : b.id === 'other' ? -1 : b.count - a.count))

    const locationOptions = slimLocationOptions(await u.createGroupedLocationOptionsWithGeodata(currentRows))
    const filters = {
      locations: [...locCounts.keys()].sort(),
      locationOptions,
      topLocations: await u.getTopLocationsFormatted(currentRows, 10),
      skills: await u.getUniqueSkills(currentRows),
      topSkills: await u.getTopSkills(currentRows, 10),
      roles,
      contentMarketCounts,
      agencyCount,
      appReadyCount: currentRows.filter(j => j.appReady).length,
    }
    return { perJob, filters, normalizeCompanyName: u.normalizeCompanyName, companyToSlug: u.companyToSlug }
  } finally {
    console.log = log
    restore()
  }
}
