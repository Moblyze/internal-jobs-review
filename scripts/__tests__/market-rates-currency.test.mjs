// Currency selector math for the Market Rates page (src/utils/marketRates.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bandOf, cellStats, convert, fmtRate, setActiveCurrency, toUsd } from '../../src/utils/marketRates.js'

const data = JSON.parse(readFileSync(new URL('../../public/data/market_rates.json', import.meta.url)))

test('bundle carries a dated FX table and native values on every cell', () => {
  assert.ok(data.fx?.date && data.fx.usd_per_unit.USD === 1)
  for (const c of ['USD', 'GBP', 'EUR']) assert.ok(data.fx.usd_per_unit[c] > 0)
  for (const cell of data.cells) {
    assert.ok(cell.native?.currency && data.fx.usd_per_unit[cell.native.currency], cell.id)
    for (const lv of Object.values(cell.levels)) if (lv) assert.ok(lv.native?.currency, cell.id)
  }
})

test('bundle never names the first-party source', () => {
  const t = JSON.stringify(data).toLowerCase()
  for (const w of ['first_party', 'first-party', 'first party', 'placement', 'jab', 'bullhorn']) assert.equal(t.includes(w), false, w)
})

test('USD view matches usd_day; GBP and EUR views are the same money', () => {
  const cell = data.cells.find(c => c.basis === 'contract_day' && c.native.currency === 'GBP') || data.cells[0]
  setActiveCurrency('USD', data.fx)
  const usd = cellStats(cell, 'day')
  assert.ok(Math.abs(usd.medianRaw - cell.usd_day.median) < 0.01)
  for (const cur of ['GBP', 'EUR']) {
    setActiveCurrency(cur, data.fx)
    const s = cellStats(cell, 'day')
    assert.ok(Math.abs(s.medianRaw * data.fx.usd_per_unit[cur] - cell.usd_day.median) < 0.01, cur)
    assert.ok(fmtRate(s.median, 'day').startsWith(cur === 'GBP' ? '£' : '€'))
  }
  setActiveCurrency('USD', data.fx)
})

test('rate check bands the same rate identically in every currency', () => {
  const cell = data.cells.find(c => c.basis === 'contract_day')
  for (const usdRate of [cell.usd_day.range_lo * 0.7, cell.usd_day.median, cell.usd_day.range_hi * 1.05, cell.usd_day.range_hi * 1.5]) {
    const bands = ['USD', 'GBP', 'EUR'].map(cur => {
      setActiveCurrency(cur, data.fx)
      const typed = convert(usdRate, 'USD', cur) // what a reader would type in that currency
      return bandOf(toUsd(typed), toUsd(typed), cell)
    })
    assert.equal(new Set(bands).size, 1, String(bands))
  }
  setActiveCurrency('USD', data.fx)
})

test('unknown currency falls back to USD', () => {
  setActiveCurrency('XYZ', data.fx)
  assert.ok(fmtRate(100, 'day').startsWith('$'))
})
