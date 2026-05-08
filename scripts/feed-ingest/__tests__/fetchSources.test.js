import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchFetch } from '../fetchSources.js'

test('dispatchFetch routes by source.type', async () => {
  const calls = []
  const adapters = {
    rss: async (src) => { calls.push(['rss', src.id]); return [{ headline: 'rss-result' }] },
    edgar: async (src) => { calls.push(['edgar', src.id]); return [{ headline: 'edgar-result' }] },
  }
  const r1 = await dispatchFetch({ id: 'a', type: 'rss', url: 'x' }, adapters)
  const r2 = await dispatchFetch({ id: 'b', type: 'edgar', url: 'y' }, adapters)
  assert.deepEqual(calls, [['rss', 'a'], ['edgar', 'b']])
  assert.equal(r1[0].headline, 'rss-result')
  assert.equal(r2[0].headline, 'edgar-result')
})

test('dispatchFetch throws on unknown source.type', async () => {
  await assert.rejects(
    () => dispatchFetch({ id: 'x', type: 'unknown' }, {}),
    /unknown source type/
  )
})
