import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { decodeLiteIndex } from '../../src/utils/liteIndexDecoder.js'
import { jobShardIndex, shardKey } from '../../src/utils/jobShard.js'

const SCRIPT = path.resolve('scripts/build-site-data.mjs')
const row = (id, o = {}) => ({
  id, title: `Title ${id}`, company: 'Acme', location: 'Houston, TX', status: 'active',
  skills: ['Welding', 'NDT'], description: `<p>Long description for ${id}</p>`,
  structuredDescription: null, url: `https://x.test/${id}`, scrapedAt: '2026-10-05T00:00:00Z', ...o,
})

function build(jobs, extraArgs = [], env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitedata-'))
  const jp = path.join(dir, 'jobs.json'), ip = path.join(dir, 'index.json')
  fs.writeFileSync(jp, JSON.stringify(jobs))
  const index = jobs.map(({ description, structuredDescription, ...r }) => ({ ...r, descriptionPreview: 'Long description' }))
  fs.writeFileSync(ip, JSON.stringify(index))
  const out = path.join(dir, 'out'), r2 = path.join(dir, 'r2')
  execFileSync('node', [SCRIPT, '--out-dir', out, '--r2-dir', r2, ...extraArgs], {
    env: { ...process.env, JOBS_PATH: jp, JOBS_INDEX_PATH: ip, ...env }, stdio: 'pipe',
  })
  return { out, r2 }
}

test('shard routing is stable and in range', () => {
  for (const id of ['a', 'altrad-sparrows-https---easyapply-co-job-x', 'é-ünï']) {
    const i = jobShardIndex(id, 256)
    assert.equal(i, jobShardIndex(id, 256))
    assert.ok(i >= 0 && i < 256)
  }
  assert.equal(shardKey(10, 256), '0a')
  assert.equal(shardKey(255, 256), 'ff')
})

test('site ships current jobs only; detail is fetchable per job; archive keeps everything', () => {
  const jobs = [row('a'), row('b'), row('c', { status: 'removed', scrapedAt: '2026-09-01T00:00:00Z' })]
  const { out, r2 } = build(jobs)
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'jobs-manifest.json')))
  assert.equal(manifest.totalCurrent, 2)
  const decoded = manifest.index.flatMap(({ file }) =>
    decodeLiteIndex(JSON.parse(fs.readFileSync(path.join(out, 'jobs', file)))))
  assert.deepEqual(decoded.map(j => j.id).sort(), ['a', 'b'])
  assert.deepEqual(decoded[0].skills, ['Welding', 'NDT'])
  // content-hashed names
  assert.match(manifest.index[0].file, /^index-00\.[0-9a-f]{8}\.json$/)
  // detail via the same routing the SPA uses
  const key = shardKey(jobShardIndex('a', manifest.detail.shards), manifest.detail.shards)
  const shard = JSON.parse(fs.readFileSync(path.join(out, 'jobs/detail', manifest.detail.files[key])))
  assert.equal(shard.a.url, 'https://x.test/a')
  assert.match(shard.a.description, /Long description for a/)
  assert.equal(shard.c, undefined)
  // archive holds active + removed, by month
  const read = f => zlib.gunzipSync(fs.readFileSync(path.join(r2, 'archive/jobs', f))).toString().trim().split('\n').map(JSON.parse)
  assert.deepEqual(read('2026-10.jsonl.gz').map(r => r.id).sort(), ['a', 'b'])
  assert.deepEqual(read('2026-09.jsonl.gz').map(r => r.id), ['c'])
  const cur = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(r2, 'current/jobs-current.json.gz'))))
  assert.equal(cur.length, 2)
})

test('archive merge never drops a row that left the Sheet', () => {
  const prior = fs.mkdtempSync(path.join(os.tmpdir(), 'prior-'))
  fs.writeFileSync(path.join(prior, '2026-10.jsonl.gz'),
    zlib.gzipSync(JSON.stringify(row('gone', { status: 'removed' })) + '\n'))
  const { r2 } = build([row('a')], ['--prior-archive', prior])
  const ids = zlib.gunzipSync(fs.readFileSync(path.join(r2, 'archive/jobs/2026-10.jsonl.gz')))
    .toString().trim().split('\n').map(l => JSON.parse(l).id).sort()
  assert.deepEqual(ids, ['a', 'gone'])
})

test('same id twice with different urls are both archived', () => {
  const { r2 } = build([row('d', { url: 'https://x.test/1' }), row('d', { url: 'https://x.test/2' })])
  const lines = zlib.gunzipSync(fs.readFileSync(path.join(r2, 'archive/jobs/2026-10.jsonl.gz'))).toString().trim().split('\n')
  assert.equal(lines.length, 2)
})

test('closed jobs are served by slug from the archive shards; current slugs excluded', async () => {
  const { jobToSlug } = await import('../../src/utils/formatters.js')
  const jobs = [
    row('a'),
    row('old', { status: 'removed', title: 'Old Role', sourceCheckedAt: '2026-09-02T00:00:00Z' }),
    row('olde', { status: 'removed', title: 'Old Role', sourceCheckedAt: '2026-09-09T00:00:00Z' }),
    row('a2', { status: 'removed', title: 'Title a' }), // slug still current -> not closed
  ]
  const { r2 } = build(jobs)
  const slug = jobToSlug('Acme', 'Old Role')
  const key = shardKey(jobShardIndex(slug, 256), 256)
  const shard = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(r2, 'closed', `${key}.json.gz`))))
  assert.equal(shard[slug].id, 'olde') // newest sighting wins
  assert.equal(shard[slug].lastSeen, '2026-09-09T00:00:00Z')
  assert.match(shard[slug].description, /Long description for olde/)
  const all = fs.readdirSync(path.join(r2, 'closed')).flatMap(f =>
    Object.keys(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(r2, 'closed', f))))))
  assert.ok(!all.includes(jobToSlug('Acme', 'Title a')))
})

test('Pages Function serves closed shards from R2 with gzip, 404s when absent', async () => {
  const { onRequestGet } = await import('../../functions/data/[[path]].js')
  const env = { PRIVATE_DATA: { get: async k => (k === 'closed/ab.json.gz' ? { body: 'x', httpEtag: '"e"', etag: 'e' } : null) } }
  const ok = await onRequestGet({ request: {}, params: { path: ['closed', 'ab.json'] }, env, next: () => 'next' })
  assert.equal(ok.headers.get('Content-Encoding'), 'gzip')
  const miss = await onRequestGet({ request: {}, params: { path: ['closed', 'cd.json'] }, env, next: () => 'next' })
  assert.equal(miss.status, 404)
  assert.equal(await onRequestGet({ request: {}, params: { path: ['closed', '../x.json'] }, env, next: () => 'next' }), 'next')
})
