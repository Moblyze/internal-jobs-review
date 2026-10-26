// src/utils/marketRates.js
// Helpers for the Market rates view. All values arrive in USD per day from
// pay_rates/site_bundle.py (moblyze-ops); the period toggle re-expresses them
// with the same assumptions the extractor used.

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
    return `$${k >= 100 ? Math.round(k) : k.toFixed(k >= 10 ? 0 : 1)}K`
  }
  return `$${Math.round(v).toLocaleString('en-US')}`
}

export function unitSuffix(period) {
  return { day: '/day', hour: '/hr', month: '/mo', year: '/yr' }[period] || ''
}

// A cell's stats in a given period: p25/median/p75 cleanly rounded, plus whether it is a conversion.
export function cellStats(cell, period) {
  const native = cell.unit
  const p = period || native
  const conv = p !== native
  const u = cell.usd_day
  return {
    period: p,
    converted: conv,
    p25: roundClean(fromDay(u.range_lo, p, cell), p),
    median: roundClean(fromDay(u.median, p, cell), p),
    p75: roundClean(fromDay(u.range_hi, p, cell), p),
    p25Raw: fromDay(u.range_lo, p, cell),
    medianRaw: fromDay(u.median, p, cell),
    p75Raw: fromDay(u.range_hi, p, cell),
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
// $425/day, $36/hr, $6,700/mo, $100k/yr. Values are rounded with roundClean first.
export const PERIOD_SUFFIX = { day: '/day', hour: '/hr', month: '/mo', year: '/yr' }
export function fmtAmount(v, period) {
  if (v == null || isNaN(v)) return '–'
  const r = roundClean(v, period)
  if (period === 'year') {
    const k = r / 1000
    return `$${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`
  }
  return `$${Math.round(r).toLocaleString('en-US')}`
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
