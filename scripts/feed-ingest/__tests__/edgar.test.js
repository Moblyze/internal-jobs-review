import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEdgarHits } from '../sources/edgar.js'

test('parseEdgarHits extracts company + filing date + URL', () => {
  const hits = {
    hits: {
      hits: [
        {
          _source: {
            ciks: ['0000093410'],
            display_names: ['Chevron Corp'],
            file_date: '2026-05-06',
            form: '8-K',
            adsh: '0000093410-26-000123',
          },
          _id: '123',
        },
      ],
    },
  }
  const out = parseEdgarHits(hits)
  assert.equal(out.length, 1)
  assert.equal(out[0].source.id, 'sec_edgar_8k')
  assert.match(out[0].headline, /Chevron Corp/)
  assert.match(out[0].url, /sec\.gov/)
})

test('parseEdgarHits returns empty array for empty response', () => {
  assert.deepEqual(parseEdgarHits({ hits: { hits: [] } }), [])
  assert.deepEqual(parseEdgarHits({}), [])
})
