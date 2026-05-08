import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRssItems } from '../sources/rss.js'

test('parseRssItems extracts standard fields from rss-parser output', () => {
  const items = [
    {
      title: 'Saipem wins $1.6B Equinor Rosebank topsides EPC',
      link: 'https://example.com/rosebank',
      contentSnippet: 'Equinor sanctioned Rosebank Phase 2 ...',
      isoDate: '2026-05-07T11:00:00Z',
    },
  ]
  const result = parseRssItems(items, { id: 'rigzone', name: 'Rigzone' })
  assert.equal(result.length, 1)
  assert.equal(result[0].sources[0].id, 'rigzone')
  assert.equal(result[0].headline, 'Saipem wins $1.6B Equinor Rosebank topsides EPC')
  assert.equal(result[0].body, 'Equinor sanctioned Rosebank Phase 2 ...')
  assert.equal(result[0].url, 'https://example.com/rosebank')
  assert.equal(result[0].published_at, '2026-05-07T11:00:00.000Z')
})

test('parseRssItems skips items without title or link', () => {
  const items = [
    { title: '', link: 'https://x.com', contentSnippet: 'no title' },
    { title: 'no link', link: '', contentSnippet: 'no link' },
    { title: 'good', link: 'https://x.com/good', contentSnippet: 'good' },
  ]
  const result = parseRssItems(items, { id: 's', name: 'S' })
  assert.equal(result.length, 1)
  assert.equal(result[0].headline, 'good')
})
