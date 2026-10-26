import test from 'node:test'
import assert from 'node:assert/strict'
import { levelCellStatus, ordinal } from '../../src/utils/marketRates.js'

const cell = (n, lo, med, hi) => ({ n, usd_day: { range_lo: lo, median: med, range_hi: hi } })

test('healthy ascending levels all show', () => {
  const lv = { low: cell(30, 200, 250, 300), mid: cell(40, 280, 330, 380), high: cell(25, 350, 420, 500) }
  for (const l of ['low', 'mid', 'high']) assert.equal(levelCellStatus(lv, l).suppressed, false)
})

test('senior band below mid-level median is suppressed as inverted', () => {
  const lv = { low: cell(30, 200, 250, 300), mid: cell(40, 380, 420, 470), high: cell(25, 350, 360, 375) }
  assert.deepEqual(levelCellStatus(lv, 'high'), { suppressed: true, reason: 'inverted' })
  assert.equal(levelCellStatus(lv, 'mid').suppressed, false)
})

test('n at the floor (10 and 11) is suppressed, 12 shows', () => {
  for (const n of [10, 11]) assert.equal(levelCellStatus({ low: cell(n, 200, 250, 300) }, 'low').reason, 'thin')
  assert.equal(levelCellStatus({ low: cell(12, 200, 250, 300) }, 'low').suppressed, false)
})

test('compares against nearest published lower level when mid is missing', () => {
  const lv = { low: cell(30, 300, 400, 450), high: cell(25, 250, 300, 350) }
  assert.equal(levelCellStatus(lv, 'high').reason, 'inverted')
})

test('ordinal words', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 98].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '98th'])
})
