import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enrichEntry, buildPrompt, buildGatePrompt, parseGateJson } from '../enrich.js'

const mockTaxonomy = {
  subsectors: [{ id: 'offshore-og', label: 'Offshore O&G' }],
  discipline_tags: [{ id: 'rov_subsea', label: 'ROV & Subsea' }],
  signal_types: [{ id: 'epc_award', label: 'EPC Award' }],
}

const validSonnetResponse = {
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
  bd_relevant: true,
  bd_relevance_reason: 'EPC/SURF contract award naming Equinor and Saipem for Rosebank Phase 2',
}

// A client that returns different responses for different models, and tracks calls.
function makeFakeClient({ gateText, sonnetText, gateError, sonnetError }) {
  const calls = []
  return {
    calls,
    messages: {
      create: async ({ model }) => {
        calls.push(model)
        if (model.includes('haiku')) {
          if (gateError) throw new Error(gateError)
          // Production code prefills the assistant turn with '{', so the API
          // returns the continuation. Strip a leading '{' from gateText so
          // tests can keep using full-JSON strings.
          const text = typeof gateText === 'string' && gateText.startsWith('{')
            ? gateText.slice(1)
            : gateText
          return { content: [{ type: 'text', text }] }
        }
        if (sonnetError) throw new Error(sonnetError)
        return { content: [{ type: 'text', text: sonnetText }] }
      },
    },
  }
}

test('buildPrompt embeds the taxonomy values', () => {
  const p = buildPrompt({ headline: 'X', body: 'Y' }, mockTaxonomy, [])
  assert.match(p, /offshore-og/)
  assert.match(p, /rov_subsea/)
  assert.match(p, /epc_award/)
})

test('buildPrompt embeds the geo exclusion hint when present', () => {
  const p = buildPrompt({ headline: 'X', body: 'Y' }, mockTaxonomy, ['china', 'russia'])
  assert.match(p, /GEO HINT/)
  assert.match(p, /china/)
  assert.match(p, /russia/)
})

test('buildPrompt omits GEO HINT when no exclusions provided', () => {
  const p = buildPrompt({ headline: 'X', body: 'Y' }, mockTaxonomy, [])
  assert.doesNotMatch(p, /GEO HINT/)
})

test('buildGatePrompt embeds BD criteria and article + omits taxonomy', () => {
  const p = buildGatePrompt({ headline: 'X', body: 'Y', source: { name: 'src' } }, [])
  assert.match(p, /BD RELEVANCE CRITERIA/)
  assert.match(p, /INCLUDE/)
  assert.match(p, /EXCLUDE/)
  assert.match(p, /Headline: X/)
  // Gate prompt should NOT include taxonomy ids — it's a thin yes/no.
  assert.doesNotMatch(p, /offshore-og/)
  assert.doesNotMatch(p, /OUTPUT SCHEMA/)
})

test('buildGatePrompt embeds geo exclusion hint when present', () => {
  const p = buildGatePrompt({ headline: 'X', body: 'Y' }, ['china'])
  assert.match(p, /GEO HINT/)
  assert.match(p, /china/)
})

test('enrichEntry: gate rejects → Sonnet NOT called, status = gated_out', async () => {
  const client = makeFakeClient({
    gateText: JSON.stringify({ bd_relevant: false, reason: 'Earnings report, no project named' }),
    sonnetText: JSON.stringify(validSonnetResponse),
  })
  const result = await enrichEntry(
    { headline: 'Exxon beats estimates', body: 'b', source: { id: 's' } },
    mockTaxonomy,
    { client }
  )
  assert.equal(result.enrichment_status, 'gated_out')
  assert.equal(result.bd_relevant, false)
  assert.equal(result.bd_relevance_reason, 'Earnings report, no project named')
  assert.equal(result.headline, 'Exxon beats estimates')
  assert.equal(client.calls.length, 1)
  assert.match(client.calls[0], /haiku/)
})

test('enrichEntry: gate accepts → Sonnet IS called, status = ok', async () => {
  const client = makeFakeClient({
    gateText: JSON.stringify({ bd_relevant: true, reason: 'Names operator and contractor' }),
    sonnetText: JSON.stringify(validSonnetResponse),
  })
  const result = await enrichEntry(
    { headline: 'Saipem wins Rosebank', body: 'b', source: { id: 's' } },
    mockTaxonomy,
    { client }
  )
  assert.equal(result.enrichment_status, 'ok')
  assert.equal(result.subsector, 'offshore-og')
  assert.equal(result.hiring_entity.name, 'Saipem')
  assert.equal(client.calls.length, 2)
  assert.match(client.calls[0], /haiku/)
  assert.match(client.calls[1], /sonnet/)
})

test('enrichEntry: malformed gate JSON falls through to Sonnet (assume relevant)', async () => {
  const client = makeFakeClient({
    gateText: 'not valid json',
    sonnetText: JSON.stringify(validSonnetResponse),
  })
  const result = await enrichEntry(
    { headline: 'h', body: 'b', source: { id: 's' } },
    mockTaxonomy,
    { client }
  )
  assert.equal(result.enrichment_status, 'ok')
  assert.equal(result.subsector, 'offshore-og')
  assert.equal(client.calls.length, 2)
})

test('enrichEntry: gate API error falls through to Sonnet', async () => {
  const client = makeFakeClient({
    gateError: 'rate limited',
    sonnetText: JSON.stringify(validSonnetResponse),
  })
  const result = await enrichEntry(
    { headline: 'h', body: 'b', source: { id: 's' } },
    mockTaxonomy,
    { client }
  )
  assert.equal(result.enrichment_status, 'ok')
  assert.equal(client.calls.length, 2)
})

test('enrichEntry: Sonnet JSON parse failure returns reduced-detail entry', async () => {
  const client = makeFakeClient({
    gateText: JSON.stringify({ bd_relevant: true, reason: 'ok' }),
    sonnetText: 'not json at all',
  })
  const result = await enrichEntry(
    { headline: 'h', body: 'b', source: { id: 's' } },
    mockTaxonomy,
    { client }
  )
  assert.equal(result.enrichment_status, 'failed')
  assert.equal(result.headline, 'h')
})

test('enrichEntry: backward-compatible single-mock client (no model branching) still works', async () => {
  // Mirrors the original test style: same response for every call. Gate sees
  // valid Sonnet JSON (which contains bd_relevant: true), passes through.
  const fakeClient = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: JSON.stringify(validSonnetResponse) }] }),
    },
  }
  const result = await enrichEntry(
    { headline: 'h', body: 'b', source: { id: 's' } },
    mockTaxonomy,
    { client: fakeClient }
  )
  assert.equal(result.enrichment_status, 'ok')
  assert.equal(result.subsector, 'offshore-og')
})

test('parseGateJson: plain valid JSON', () => {
  const r = parseGateJson('{"bd_relevant": true, "reason": "x"}')
  assert.deepEqual(r, { bd_relevant: true, reason: 'x' })
})

test('parseGateJson: stripped json code fence', () => {
  const r = parseGateJson('```json\n{"bd_relevant": false, "reason": "y"}\n```')
  assert.deepEqual(r, { bd_relevant: false, reason: 'y' })
})

test('parseGateJson: prose before and after JSON', () => {
  const r = parseGateJson('Sure, here it is: {"bd_relevant": true, "reason": "z"} — let me know!')
  assert.deepEqual(r, { bd_relevant: true, reason: 'z' })
})

test('parseGateJson: irrecoverable garbage returns null', () => {
  assert.equal(parseGateJson('totally not json'), null)
  assert.equal(parseGateJson(''), null)
  assert.equal(parseGateJson(null), null)
})

test('enrichEntry: new schema fields land on successful Sonnet response', async () => {
  const sonnetPayload = {
    ...validSonnetResponse,
    phase: 'sanctioned_engineering',
    phase_evidence: 'EPC contract just awarded',
    outreach_readiness: 'hot',
    estimated_hiring_window: '3-6mo',
    key_people: [
      { name: 'John Doe', title: 'Project Director', company: 'Saipem', hiring_relevance: 'likely_decision_maker' },
      { name: 'Jane Roe', title: 'CEO', company: 'Equinor', hiring_relevance: 'context_only' },
    ],
  }
  const client = makeFakeClient({
    gateText: JSON.stringify({ bd_relevant: true, reason: 'EPC award' }),
    sonnetText: JSON.stringify(sonnetPayload),
  })
  const result = await enrichEntry(
    { headline: 'Saipem wins Rosebank', body: 'b', source: { id: 's' } },
    mockTaxonomy,
    { client }
  )
  assert.equal(result.phase, 'sanctioned_engineering')
  assert.equal(result.outreach_readiness, 'hot')
  assert.equal(result.estimated_hiring_window, '3-6mo')
  assert.equal(result.key_people.length, 2)
  assert.equal(result.key_people[0].hiring_relevance, 'likely_decision_maker')
})

test('enrichEntry: missing optional new fields default to undefined, not error', async () => {
  const client = makeFakeClient({
    gateText: JSON.stringify({ bd_relevant: true, reason: 'ok' }),
    sonnetText: JSON.stringify(validSonnetResponse),
  })
  const result = await enrichEntry(
    { headline: 'h', body: 'b', source: { id: 's' } },
    mockTaxonomy,
    { client }
  )
  assert.equal(result.enrichment_status, 'ok')
  assert.equal(result.phase, undefined)
  assert.equal(result.key_people, undefined)
})

test('buildPrompt embeds the new phase/readiness rules and the key_people guidance', () => {
  const p = buildPrompt({ headline: 'X', body: 'Y' }, mockTaxonomy, [])
  assert.match(p, /PROJECT PHASE/)
  assert.match(p, /OUTREACH READINESS/)
  assert.match(p, /CONSISTENCY RULE/)
  assert.match(p, /KEY PEOPLE/)
  assert.match(p, /sanctioned_engineering/)
  assert.match(p, /likely_decision_maker/)
})

test('enrichEntry: skipGate option bypasses Haiku and calls Sonnet directly', async () => {
  const client = makeFakeClient({
    gateText: JSON.stringify({ bd_relevant: false, reason: 'should not be consulted' }),
    sonnetText: JSON.stringify({ ...validSonnetResponse, phase: 'construction' }),
  })
  const result = await enrichEntry(
    { headline: 'Saipem hookup work', body: 'b', source: { id: 's' } },
    mockTaxonomy,
    { client, skipGate: true }
  )
  assert.equal(result.enrichment_status, 'ok')
  assert.equal(result.phase, 'construction')
  // Only the Sonnet call should have been made
  assert.equal(client.calls.length, 1)
  assert.match(client.calls[0], /sonnet/)
})
