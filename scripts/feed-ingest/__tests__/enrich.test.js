import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enrichEntry, buildPrompt } from '../enrich.js'

const mockTaxonomy = {
  subsectors: [{ id: 'offshore-og', label: 'Offshore O&G' }],
  discipline_tags: [{ id: 'rov_subsea', label: 'ROV & Subsea' }],
  signal_types: [{ id: 'epc_award', label: 'EPC Award' }],
}

test('buildPrompt embeds the taxonomy values', () => {
  const p = buildPrompt({ headline: 'X', body: 'Y' }, mockTaxonomy)
  assert.match(p, /offshore-og/)
  assert.match(p, /rov_subsea/)
  assert.match(p, /epc_award/)
})

test('enrichEntry returns reduced-detail entry on JSON parse failure', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: 'not json at all' }] }),
    },
  }
  const result = await enrichEntry(
    { headline: 'h', body: 'b', source: { id: 's' } },
    mockTaxonomy,
    { client: fakeClient }
  )
  assert.equal(result.enrichment_status, 'failed')
  assert.equal(result.headline, 'h')
})

test('enrichEntry returns enriched entry on valid JSON response', async () => {
  const validResponse = {
    subsector: 'offshore-og',
    discipline_tags: ['rov_subsea'],
    signal_type: 'epc_award',
    headline: 'Saipem wins Rosebank',
    tldr: 'Equinor sanctioned Rosebank Phase 2.',
    operator: { name: 'Equinor' },
    hiring_entity: { name: 'Saipem' },
    project_name: 'Rosebank Phase 2',
    scope: ['huc'],
    targeting: { boolean_search: '("Subsea Engineer")' },
  }
  const fakeClient = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: JSON.stringify(validResponse) }] }),
    },
  }
  const result = await enrichEntry({ headline: 'h', body: 'b', source: { id: 's' } }, mockTaxonomy, { client: fakeClient })
  assert.equal(result.enrichment_status, 'ok')
  assert.equal(result.subsector, 'offshore-og')
  assert.equal(result.hiring_entity.name, 'Saipem')
})
