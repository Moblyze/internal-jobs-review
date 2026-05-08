import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchCompanyToSlug } from '../../../src/utils/feed/companyMatcher.js'

const companiesData = {
  companies: [
    { name: 'Saipem', count: 76 },
    { name: 'Equinor', count: 45 },
    { name: 'AECOM', count: 200 },
  ],
}

test('matchCompanyToSlug returns slug for exact match', () => {
  assert.equal(matchCompanyToSlug('Saipem', companiesData), 'saipem')
})

test('matchCompanyToSlug handles case + whitespace variance', () => {
  assert.equal(matchCompanyToSlug('  saipem  ', companiesData), 'saipem')
  assert.equal(matchCompanyToSlug('SAIPEM', companiesData), 'saipem')
})

test('matchCompanyToSlug handles common entity-suffix variants', () => {
  // Suffix-stripping is in companyNormalizer.js — verify we use it.
  assert.equal(matchCompanyToSlug('Saipem SpA', companiesData), 'saipem')
  assert.equal(matchCompanyToSlug('AECOM, Inc.', companiesData), 'aecom')
})

test('matchCompanyToSlug returns null on no match', () => {
  assert.equal(matchCompanyToSlug('Random Co LLC', companiesData), null)
  assert.equal(matchCompanyToSlug('', companiesData), null)
  assert.equal(matchCompanyToSlug(null, companiesData), null)
})
