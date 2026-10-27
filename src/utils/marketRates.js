// src/utils/marketRates.js
// Helpers for the Market rates view. Values arrive in USD per day plus each cell's
// native currency (pay_rates/site_bundle.py in moblyze-ops); the period toggle
// re-expresses them with the same assumptions the extractor used, and the
// currency selector converts them client-side with the bundle's dated FX table.

/* ── display currency ─────────────────────────────────────────────── */
export const CURRENCIES = ['USD', 'GBP', 'EUR']
export const CURRENCY_SYMBOL = { USD: '$', GBP: '£', EUR: '€' }
const CURRENCY_KEY = 'market-rates-currency'
let ACTIVE = { code: 'USD', usdPer: { USD: 1 } }

// Set once per render by the page, before any figure is formatted.
export function setActiveCurrency(code, fx) {
  const usdPer = { USD: 1, ...(fx?.usd_per_unit || {}) }
  ACTIVE = { code: usdPer[code] ? code : 'USD', usdPer }
}
export function activeCurrency() { return ACTIVE.code }
export function curSym(code = ACTIVE.code) { return CURRENCY_SYMBOL[code] || `${code} ` }
// USD -> the active currency, and back (the rate check bands in USD)
export function fromUsd(v) { return v == null ? null : v / (ACTIVE.usdPer[ACTIVE.code] || 1) }
export function toUsd(v) { return v == null ? null : v * (ACTIVE.usdPer[ACTIVE.code] || 1) }
// one amount from currency `a` to `b` with the same table
export function convert(v, a, b) {
  const pa = ACTIVE.usdPer[a], pb = ACTIVE.usdPer[b]
  return v == null || !pa || !pb ? v : (v * pa) / pb
}

export function loadCurrency() {
  try {
    const v = window.localStorage.getItem(CURRENCY_KEY)
    return CURRENCIES.includes(v) ? v : 'USD'
  } catch {
    return 'USD'
  }
}
export function saveCurrency(code) {
  try { window.localStorage.setItem(CURRENCY_KEY, code) } catch { /* private window or blocked storage */ }
}

// "£1 = $1.33 · €1 = $1.12" for the dated note under the selector
export function fxNote(fx) {
  const r = fx?.usd_per_unit || {}
  return CURRENCIES.filter(c => c !== 'USD' && r[c]).map(c => `${curSym(c)}1 = $${r[c].toFixed(2)}`).join(' · ')
}

export const PERIODS = ['day', 'hour', 'month', 'year']
export const PERIOD_LABEL = { day: 'Per day', hour: 'Per hour', month: 'Per month', year: 'Per year' }
export const LEVELS = ['low', 'mid', 'high']
export const LEVEL_SHORT = { low: 'Low', mid: 'Mid', high: 'High' }
export const BAND_META = {
  in_range:     { label: 'In range',     tone: 'good',   glyph: '●' },
  near_above:   { label: 'Slightly above', tone: 'near',   glyph: '◐' },
  near_below:   { label: 'Slightly below', tone: 'near',   glyph: '◑' },
  above_market: { label: 'Above market', tone: 'above',  glyph: '▲' },
  below_market: { label: 'Below market', tone: 'below',  glyph: '▼' },
}

const DAYS_PER_YEAR = 260
const DAYS_PER_MONTH = 30.4

// usd/day -> value in `period` for a cell (hours_per_day comes from the cell's rows: 10 contract, 8 perm)
export function fromDay(usdDay, period, cell) {
  if (usdDay == null) return null
  const hpd = cell?.hours_per_day || (cell?.basis === 'perm_timebased' ? 8 : 10)
  switch (period) {
    case 'hour': return usdDay / hpd
    case 'month': return usdDay * DAYS_PER_MONTH
    case 'year': return usdDay * DAYS_PER_YEAR
    default: return usdDay
  }
}

// clean rounding steps, mirrors pay_rates/bands.py step_for
export function roundClean(v, period) {
  if (v == null) return null
  let s = 1
  if (period === 'day') s = v < 100 ? 5 : v < 1000 ? 25 : 50
  else if (period === 'hour') s = v < 100 ? 1 : 5
  else if (period === 'month') s = v < 5000 ? 50 : 100
  else if (period === 'year') s = v < 100000 ? 1000 : 5000
  return Math.round(v / s) * s
}

export function fmtMoney(v, { compact = false } = {}) {
  if (v == null) return '–'
  if (compact && Math.abs(v) >= 1000) {
    const k = v / 1000
    return `${curSym()}${k >= 100 ? Math.round(k) : k.toFixed(k >= 10 ? 0 : 1)}K`
  }
  return `${curSym()}${Math.round(v).toLocaleString('en-US')}`
}

export function unitSuffix(period) {
  return { day: '/day', hour: '/hr', month: '/mo', year: '/yr' }[period] || ''
}

// display unit -> per day, mirrors pay_rates/bands.py UNITS (hour is always the 8-hour permanent basis)
const UNIT_PER_DAY = { day: 1, year: 260, month: 30.4, hour: 1 / 8 }

// A cell figure per day in the active currency: from the cell's native-currency value when the
// bundle carries one (converted through the FX table), else from usd_day.
export function dayInActive(cell, key) {
  const n = cell.native
  const mult = UNIT_PER_DAY[cell.unit]
  if (n && n[key] != null && mult && ACTIVE.usdPer[n.currency]) return convert(n[key] / mult, n.currency, ACTIVE.code)
  return fromUsd(cell.usd_day[key])
}

// A cell's stats in a given period and the active currency: p25/median/p75 cleanly rounded,
// plus whether it is a period conversion.
export function cellStats(cell, period) {
  const native = cell.unit
  const p = period || native
  const conv = p !== native
  const lo = fromDay(dayInActive(cell, 'range_lo'), p, cell)
  const med = fromDay(dayInActive(cell, 'median'), p, cell)
  const hi = fromDay(dayInActive(cell, 'range_hi'), p, cell)
  return {
    period: p,
    converted: conv,
    currency: ACTIVE.code,
    p25: roundClean(lo, p),
    median: roundClean(med, p),
    p75: roundClean(hi, p),
    p25Raw: lo,
    medianRaw: med,
    p75Raw: hi,
  }
}

export function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00Z')
  if (isNaN(d)) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function fmtMonth(ym) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// Band a value (usd/day) against a cell's typical range. Mirrors pay_rates/bands.py.
export function bandOf(usdDayMin, usdDayMax, cell, tol = 0.1) {
  const lo = cell.usd_day.range_lo, hi = cell.usd_day.range_hi
  const mid = (usdDayMin + usdDayMax) / 2
  if (mid >= lo && mid <= hi) return 'in_range'
  if (mid < lo) return mid >= lo * (1 - tol) ? 'near_below' : 'below_market'
  return mid <= hi * (1 + tol) ? 'near_above' : 'above_market'
}

// "nice" axis max for a set of values
export function niceMax(v) {
  if (!v || v <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * exp
}

// Display formatting used across the redesigned view:
// $425/day, $36/hr, $6,700/mo, $100k/yr (or £ / € in the active currency). Values are rounded
// with roundClean first.
export const PERIOD_SUFFIX = { day: '/day', hour: '/hr', month: '/mo', year: '/yr' }
export function fmtAmount(v, period) {
  if (v == null || isNaN(v)) return '–'
  const r = roundClean(v, period)
  if (period === 'year') {
    const k = r / 1000
    return `${curSym()}${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`
  }
  return `${curSym()}${Math.round(r).toLocaleString('en-US')}`
}
export function fmtRate(v, period) {
  if (v == null || isNaN(v)) return '–'
  return `${fmtAmount(v, period)}${PERIOD_SUFFIX[period] || ''}`
}
export function fmtRange(lo, hi, period) {
  if (lo == null || hi == null) return '–'
  if (roundClean(lo, period) === roundClean(hi, period)) return fmtRate(lo, period)
  return `${fmtAmount(lo, period)}-${fmtRate(hi, period)}`
}

// Axis domain for range plots (not bar lengths, so a non-zero start is honest):
// pads the data a little and snaps both ends to a nice step, `ticks` intervals.
export function niceDomain(lo, hi, ticks = 4) {
  const a = Math.max(0, lo * 0.85), b = hi * 1.08
  const raw = (b - a) / ticks || 1
  const exp = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / exp
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp
  const min = Math.floor(a / step) * step
  let max = Math.ceil(b / step) * step
  const n = Math.round((max - min) / step)
  return { min, max, ticks: n }
}

// 23 -> "23rd percentile"
export function ordinal(n) {
  const v = n % 100
  const s = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')
  return `${n}${s}`
}

export const LEVEL_FLOOR_N = 11 // n at or below this is too thin to show an experience range

const LEVEL_ORDER = ['low', 'mid', 'high']

// Experience cells that should read "Needs more data" instead of a range:
// 1) n is at the floor (10-11), or
// 2) the level's band tops out below the next-lower published level's median (inverted).
// Works on usd_day so it is unit independent. Returns { suppressed, reason }.
export function levelCellStatus(levels, level) {
  const lc = levels?.[level]
  if (!lc) return { suppressed: true, reason: 'missing' }
  if (lc.n <= LEVEL_FLOOR_N) return { suppressed: true, reason: 'thin' }
  const idx = LEVEL_ORDER.indexOf(level)
  for (let i = idx - 1; i >= 0; i--) {
    const lower = levels[LEVEL_ORDER[i]]
    if (!lower) continue
    if (lc.usd_day.range_hi < lower.usd_day.median) return { suppressed: true, reason: 'inverted' }
    break
  }
  return { suppressed: false, reason: null }
}
