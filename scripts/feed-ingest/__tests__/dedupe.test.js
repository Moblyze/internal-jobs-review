import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeHash, dedupeAgainstExisting } from '../dedupe.js'

test('computeHash normalizes whitespace, case, and punctuation', () => {
  const a = computeHash({ headline: 'Saipem wins!! Rosebank EPC', project_name: 'Rosebank Phase 2', operator: { name: 'Equinor' } })
  const b = computeHash({ headline: 'saipem    wins rosebank epc', project_name: 'rosebank phase 2', operator: { name: 'EQUINOR' } })
  assert.equal(a, b)
})

test('dedupeAgainstExisting merges source links into existing entries (matches by stored hash)', () => {
  // The fresh item is dedupe-hashed from its raw RSS shape (no project_name,
  // no operator). The stored entry's hash must equal that — recomputing from
  // the post-enriched entry would mismatch because the LLM rewrites the
  // headline during enrichment.
  const freshItem = { headline: 'Saipem Rosebank', sources: [{ id: 'rigzone', url: 'r1' }] }
  const freshHash = computeHash(freshItem)
  const existing = [{
    id: 'ent1',
    hash: freshHash,
    headline: 'Saipem Awarded Rosebank EPC',  // LLM cleaned/changed
    project_name: 'Rosebank',
    operator: { name: 'Equinor' },
    sources: [{ id: 'upstream', url: 'u1' }],
    ingested_at: new Date().toISOString(),
  }]
  const { newEntries, updatedExisting } = dedupeAgainstExisting([freshItem], existing)
  assert.equal(newEntries.length, 0)
  assert.equal(updatedExisting.length, 1)
  assert.equal(updatedExisting[0].sources.length, 2)
  assert.deepEqual(updatedExisting[0].sources.map(s => s.id).sort(), ['rigzone', 'upstream'])
})

test('dedupeAgainstExisting falls back to computeHash when stored hash absent (legacy entries)', () => {
  const existing = [{
    id: 'ent_legacy',
    // no .hash field — pre-fix entry
    headline: 'Saipem wins rosebank',
    project_name: 'Rosebank',
    operator: { name: 'Equinor' },
    sources: [{ id: 'upstream', url: 'u1' }],
    ingested_at: new Date().toISOString(),
  }]
  const fresh = [{ headline: 'Saipem wins rosebank', project_name: 'Rosebank', operator: { name: 'Equinor' }, sources: [{ id: 'rigzone', url: 'r1' }] }]
  const { newEntries, updatedExisting } = dedupeAgainstExisting(fresh, existing)
  assert.equal(newEntries.length, 0)
  assert.equal(updatedExisting.length, 1)
})

test('dedupeAgainstExisting keeps entries with no match', () => {
  const existing = [{ hash: 'h1', sources: [] }]
  const fresh = [{ headline: 'New event', project_name: 'New project', operator: { name: 'New op' }, sources: [{ id: 's', url: 'u' }] }]
  const { newEntries } = dedupeAgainstExisting(fresh, existing)
  assert.equal(newEntries.length, 1)
})
