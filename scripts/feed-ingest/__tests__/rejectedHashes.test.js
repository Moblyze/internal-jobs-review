import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, copyFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { computeHash, dedupeAgainstExisting } from '../dedupe.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../../..')

test('items whose hash is in rejected_hashes.json are skipped in dedupe', () => {
  const fresh = [
    { headline: 'BP awards Saipem Tortue Phase 3', project_name: 'Tortue', operator: { name: 'BP' }, sources: [{ id: 'rigzone', url: 'r1' }] },
    { headline: 'Equinor signs new contract', project_name: 'Johan', operator: { name: 'Equinor' }, sources: [{ id: 'rigzone', url: 'r2' }] },
  ]
  const rejectedHash = computeHash(fresh[0])
  const rejectedSet = new Set([rejectedHash])

  const { newEntries } = dedupeAgainstExisting(fresh, [])
  assert.equal(newEntries.length, 2)

  const filtered = newEntries.filter(e => !rejectedSet.has(e.hash))
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].headline, 'Equinor signs new contract')
})

test('newly-dropped items get persisted to rejected_hashes.json', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'feed-ingest-rej-'))
  const feedDir = join(tmp, 'public/data/feed')
  await mkdir(feedDir, { recursive: true })

  await writeFile(join(feedDir, 'entries.json'), '[]')
  await writeFile(join(feedDir, 'sources.json'), JSON.stringify([
    { id: 'test-src', url: 'http://example.test/rss', type: 'rss', last_seen_ok_at: null },
  ]))
  await copyFile(join(ROOT, 'public/data/feed/taxonomy.json'), join(feedDir, 'taxonomy.json'))
  await writeFile(join(feedDir, 'excluded_countries.json'), JSON.stringify({ excluded: ['russia'] }))
  await writeFile(join(feedDir, 'rejected_hashes.json'), '[]')

  const companiesDir = join(tmp, 'public/data')
  await writeFile(join(companiesDir, 'companies.json'), JSON.stringify({ companies: [] }))

  const freshItem = {
    headline: 'Some irrelevant news item',
    project_name: 'Irrelevant',
    operator: { name: 'NoOne' },
    sources: [{ id: 'test-src', url: 'http://example.test/x' }],
    published_at: new Date().toISOString(),
  }
  const expectedHash = computeHash(freshItem)

  const now = new Date().toISOString()
  const newlyRejected = [
    { hash: expectedHash, rejected_at: now, reason: 'not_bd_relevant', headline: freshItem.headline },
  ]
  await writeFile(join(feedDir, 'rejected_hashes.json'), JSON.stringify(newlyRejected, null, 2))

  const persisted = JSON.parse(await readFile(join(feedDir, 'rejected_hashes.json'), 'utf-8'))
  assert.equal(persisted.length, 1)
  assert.equal(persisted[0].hash, expectedHash)
  assert.equal(persisted[0].reason, 'not_bd_relevant')
  assert.ok(persisted[0].rejected_at)
  assert.equal(persisted[0].headline, 'Some irrelevant news item')
})

test('expired rejected entries (>30d) are dropped on read', () => {
  const DEDUPE_WINDOW_DAYS = 30
  const cutoff = Date.now() - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const oldDate = new Date(cutoff - 24 * 60 * 60 * 1000).toISOString()
  const recentDate = new Date().toISOString()
  const rejected = [
    { hash: 'old', rejected_at: oldDate, reason: 'not_bd_relevant', headline: 'old' },
    { hash: 'new', rejected_at: recentDate, reason: 'not_bd_relevant', headline: 'new' },
  ]
  const valid = rejected.filter(r => r.rejected_at && new Date(r.rejected_at).getTime() >= cutoff)
  assert.equal(valid.length, 1)
  assert.equal(valid[0].hash, 'new')
})
