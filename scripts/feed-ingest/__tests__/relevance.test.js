import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  scoreEntry,
  rankHiringTargets,
  pickTopContacts,
  QUALIFY_MIN_BEST_SCORE,
} from '../../../src/utils/feed/relevance.js'

const NOW = new Date('2026-06-01T00:00:00Z').getTime()

test('scoreEntry: O&G + subsea + live_now scores high', () => {
  const { score, matched } = scoreEntry({
    subsector: 'offshore-og',
    discipline_tags: ['rov_subsea', 'drilling_operations'],
    headline: 'Subsea ROV campaign awarded on North Sea platform',
    outreach_readiness: 'live_now',
    phase: 'construction',
    contract_value_usd: 250_000_000,
    ingested_at: '2026-05-30T00:00:00Z',
  }, NOW)
  // 3 (offshore-og) + 3 (rov_subsea) + 3 (drilling) + 2 (subsea kw) + 1 (oil_gas kw: platform)
  //   + 3 (live_now) + 2 (construction) + 2 (contract>=100M) + 1 (recency<=14d) = 20
  assert.equal(score, 20)
  assert.ok(matched.includes('subsea'))
  assert.ok(matched.includes('oil_gas'))
})

test('scoreEntry: rope access caught via headline keyword (no taxonomy tag)', () => {
  const { score, matched } = scoreEntry({
    subsector: 'offshore-wind',
    discipline_tags: ['industrial_construction'],
    headline: 'IRATA rope access technicians needed for turbine blade repair',
    outreach_readiness: 'hot',
    phase: 'operating',
    ingested_at: '2026-05-29T00:00:00Z',
  }, NOW)
  assert.ok(matched.includes('rope_access'))
  // 2 (offshore-wind) + 1 (industrial_construction) + 3 (rope_access kw) + 2 (hot) + 1 (operating) + 1 (recency) = 10
  assert.equal(score, 10)
})

test('scoreEntry: low-relevance cold mining signal scores low', () => {
  const { score } = scoreEntry({
    subsector: 'mining',
    discipline_tags: ['process_plant_operations'],
    headline: 'Quarterly production update released',
    outreach_readiness: 'cold',
    phase: 'pre_sanction',
    ingested_at: '2026-01-01T00:00:00Z',
  }, NOW)
  // 1 (mining) + 1 (process_plant) + 0 + 0 + 0 + 0 = 2
  assert.equal(score, 2)
})

test('rankHiringTargets: filters to high-relevance, prefers hiring_entity, sorts by total', () => {
  const entries = [
    { hiring_entity: { name: 'Subsea7' }, subsector: 'offshore-og', discipline_tags: ['rov_subsea'],
      headline: 'Subsea diving spread mobilised', outreach_readiness: 'live_now', phase: 'construction',
      contract_value_usd: 2e9, ingested_at: '2026-05-30T00:00:00Z' },
    { operator: { name: 'Subsea7' }, subsector: 'offshore-og', discipline_tags: ['marine_offshore_ops'],
      headline: 'Second award', outreach_readiness: 'hot', phase: 'sanctioned_engineering',
      ingested_at: '2026-05-28T00:00:00Z' },
    { hiring_entity: { name: 'Sleepy Mining Co' }, subsector: 'mining', discipline_tags: ['process_plant_operations'],
      headline: 'AGM scheduled', outreach_readiness: 'cold', phase: 'pre_sanction', ingested_at: '2026-02-01T00:00:00Z' },
  ]
  const ranked = rankHiringTargets(entries, { nowMs: NOW })
  assert.equal(ranked.length, 1, 'only the high-relevance company qualifies')
  assert.equal(ranked[0].name, 'Subsea7')
  assert.equal(ranked[0].signalCount, 2, 'both Subsea7 signals aggregated')
  assert.ok(ranked[0].bestScore >= QUALIFY_MIN_BEST_SCORE)
})

test('pickTopContacts: persona priority, skips already-enriched, caps at limit', () => {
  const contacts = [
    { name: 'A Ops', persona: 'operations' },
    { name: 'B Crew', persona: 'crewing' },
    { name: 'C HasEmail', persona: 'ta', email: 'c@x.com' },
    { name: 'D TA', persona: 'ta' },
    { name: 'E HR', persona: 'hr' },
  ]
  const top = pickTopContacts(contacts, 2)
  assert.deepEqual(top.map(c => c.name), ['B Crew', 'D TA'], 'crewing then ta; C skipped (has email)')
})
