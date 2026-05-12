import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pdlSizeToTier, getSizeTier } from '../../../src/utils/feed/sizeTier.js'

test('pdlSizeToTier: boundary cases', () => {
  assert.equal(pdlSizeToTier('1-10'),       'solo')
  assert.equal(pdlSizeToTier('11-50'),      'small')
  assert.equal(pdlSizeToTier('51-200'),     'small')
  assert.equal(pdlSizeToTier('201-500'),    'midsize')
  assert.equal(pdlSizeToTier('501-1000'),   'midsize')
  assert.equal(pdlSizeToTier('1001-5000'),  'large')
  assert.equal(pdlSizeToTier('5001-10000'), 'large')
  assert.equal(pdlSizeToTier('10001+'),     'mega')
})

test('pdlSizeToTier: null/undefined/garbage → unknown', () => {
  assert.equal(pdlSizeToTier(null),         'unknown')
  assert.equal(pdlSizeToTier(undefined),    'unknown')
  assert.equal(pdlSizeToTier(''),           'unknown')
  assert.equal(pdlSizeToTier('5 employees'),'unknown')
})

test('getSizeTier: case-insensitive key match', () => {
  const cache = { 'Saipem': { size: '5001-10000' }, 'Equinor': { size: '10001+' } }
  assert.equal(getSizeTier('saipem', cache),  'large')
  assert.equal(getSizeTier('SAIPEM', cache),  'large')
  assert.equal(getSizeTier('Equinor', cache), 'mega')
})

test('getSizeTier: missing company → unknown', () => {
  const cache = { 'Saipem': { size: '5001-10000' } }
  assert.equal(getSizeTier('NotInCache', cache), 'unknown')
})

test('getSizeTier: empty inputs → unknown', () => {
  assert.equal(getSizeTier(null, {}), 'unknown')
  assert.equal(getSizeTier('Saipem', null), 'unknown')
  assert.equal(getSizeTier('', {}), 'unknown')
})

test('getSizeTier: company in cache but no size field → unknown', () => {
  const cache = { 'Saipem': { name: 'saipem' } }  // no size
  assert.equal(getSizeTier('Saipem', cache), 'unknown')
})
