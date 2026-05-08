import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findStaleSources } from '../healthAlert.js'

test('findStaleSources flags >48h-silent active sources', () => {
  const now = new Date('2026-05-07T12:00:00Z').getTime()
  const sources = [
    { id: 'a', active: true, last_seen_ok_at: '2026-05-07T11:00:00Z' },
    { id: 'b', active: true, last_seen_ok_at: '2026-05-04T10:00:00Z' },
    { id: 'c', active: false, last_seen_ok_at: null },
    { id: 'd', active: true, last_seen_ok_at: null },
  ]
  const stale = findStaleSources(sources, now).map(s => s.id)
  assert.deepEqual(stale.sort(), ['b', 'd'])
})
