// src/pages/MarketRatesV2Page.jsx
// "Moblyze Market Rates": answers one question first, "what does a <role> in <region> typically
// earn, and how does a given rate compare?" Lookup and answer on the left, rate check on the right, then how
// the number shifts by experience and region, then the common roles in that region.
// Internal preview. v1 stays at /market-rates/v1.
// Reads /data/market_rates.json (pay_rates/site_bundle.py in moblyze-ops).
import { useEffect, useMemo, useRef, useState } from 'react'
import SEO from '../components/SEO'
import { DataBasis, PageHeader, fmtUpdated } from '../components/ui/PageParts'
import { CURRENCIES, bandOf, cellStats, convert, curSym, fxNote, levelCellStatus, loadCurrency, ordinal, fmtAmount, fmtDate, fmtRange, fmtRate, niceDomain, saveCurrency, setActiveCurrency, toUsd } from '../utils/marketRates'
import '../market-rates-v2.css'

const DATA_URL = `${import.meta.env.BASE_URL || '/'}data/market_rates.json`
const EDITION = 'Q4 2026'
const LEVEL_NAME = { low: 'Early career', mid: 'Mid-level', high: 'Senior' }
const LEVEL_YRS = { low: 'under 5 yrs', mid: '5 to 9 yrs', high: '10+ yrs' }
const UNIT_BASIS = { day: 'contract_day', hour: 'perm_timebased', year: 'salary_equiv', month: 'seafarer_month' }
const UNIT_LABEL = { day: 'Day rate', hour: 'Hourly', year: 'Salary', month: 'Monthly' }
const UNIT_LONG = { day: 'Contract day rates', hour: 'Hourly rates on permanent jobs', year: 'Annual salaries', month: 'Monthly seafarer wages' }
const UNIT_WORD = { day: 'a day', hour: 'an hour', year: 'a year', month: 'a month' }
const BASIS_NOUN = { contract_day: 'contract day rate', perm_timebased: 'hourly rate', salary_equiv: 'annual salary', seafarer_month: 'monthly seafarer wage' }
const REGION_NAME = { US: 'United States', UK: 'United Kingdom', Canada: 'Canada', Asia: 'Asia', 'Middle East': 'Middle East', 'Europe (other)': 'Europe', 'Unknown/Worldwide': 'Worldwide / unstated' }
const regionName = r => REGION_NAME[r] || r
const IN_THE = new Set(['US', 'UK', 'Middle East'])
const inRegion = r => r === 'Unknown/Worldwide' ? 'worldwide or unstated locations' : `${IN_THE.has(r) ? 'the ' : ''}${regionName(r)}`
const STATUS = {
  in_range: { label: 'Within the typical range', tone: 'ok' },
  near_below: { label: 'Slightly below the typical range', tone: 'warn' },
  near_above: { label: 'Slightly above the typical range', tone: 'up' },
  below_market: { label: 'Below the typical range', tone: 'low' },
  above_market: { label: 'Above the typical range', tone: 'up' },
}
const START = { role: 'electrician', region: 'US', level: 'all', unit: 'day', rate: '320' }
const COMMON_ROWS = 10

/* ── data helpers ─────────────────────────────────────────────────── */
function useMarketRates() {
  const [s, set] = useState({ data: null, error: null })
  useEffect(() => {
    let off = false
    fetch(DATA_URL).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => !off && set({ data: d, error: null })).catch(e => !off && set({ data: null, error: e.message }))
    return () => { off = true }
  }, [])
  return s
}

// Low-count rule: exact job and employer counts show only when a number rests on EXACT_MIN_JOBS+ jobs
// from EXACT_MIN_EMPLOYERS+ employers. Below that a band shows ("25+ jobs"), and below the lowest band
// a "Limited data" tag, never a small number.
const EXACT_MIN_JOBS = 50, EXACT_MIN_EMPLOYERS = 10
export function countView(n, employers) {
  if (n >= EXACT_MIN_JOBS && employers >= EXACT_MIN_EMPLOYERS) return { exact: true, jobs: n.toLocaleString('en-US'), employers: employers.toLocaleString('en-US'), short: n.toLocaleString('en-US') }
  const band = n >= 100 ? '100+' : n >= 50 ? '50+' : n >= 25 ? '25+' : null
  return { exact: false, band, short: band || 'Limited' }
}

// Confidence from deduped observations (n) and distinct employers, the stricter of the two wins.
export function confidenceOf(n, employers) {
  if (n >= 50 && employers >= 15) return 'High'
  if (n >= 20 && employers >= 6) return 'Medium'
  return 'Limited'
}

// Estimated percentile of v inside a cell, piecewise linear through P25 / P50 / P75,
// tails extended at the slope of the nearest segment, clamped to P2..P98. Uses the unrounded
// stats, so the same money gets the same percentile in every display currency.
function percentileOf(v, st) {
  const { p25Raw: a, medianRaw: m, p75Raw: b } = st
  const lowSeg = Math.max(m - a, m * 0.04), hiSeg = Math.max(b - m, m * 0.04)
  let p
  if (v <= a) p = 25 - ((a - v) / lowSeg) * 25
  else if (v <= m) p = 25 + ((v - a) / Math.max(m - a, 1e-9)) * 25
  else if (v <= b) p = 50 + ((v - m) / Math.max(b - m, 1e-9)) * 25
  else p = 75 + ((v - b) / hiSeg) * 25
  return Math.round(Math.max(2, Math.min(98, p)))
}

function dateSpan(a, b) {
  if (!a) return fmtDate(b)
  const A = new Date(a + 'T00:00:00Z'), B = new Date((b || a) + 'T00:00:00Z')
  const md = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  if (A.getUTCFullYear() === B.getUTCFullYear()) return `${md(A)}-${md(B)}, ${B.getUTCFullYear()}`
  return `${fmtDate(a)}-${fmtDate(b)}`
}

function monthSpan(a, b) {
  const m = iso => new Date(iso + 'T00:00:00Z')
  const A = m(a), B = m(b)
  const mon = d => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return A.getUTCFullYear() === B.getUTCFullYear()
    ? `${mon(A)}-${mon(B)} ${B.getUTCFullYear()}`
    : `${mon(A)} ${A.getUTCFullYear()}-${mon(B)} ${B.getUTCFullYear()}`
}

function fmtExact(v, unit) {
  const sfx = { day: '/day', hour: '/hr', month: '/mo', year: '/yr' }[unit] || ''
  return `${curSym()}${v.toLocaleString('en-US', { maximumFractionDigits: unit === 'hour' ? 2 : 0 })}${sfx}`
}

function plural(role) {
  const l = role.role_label
  if (/(Master|Officer|Engineer|Technician|Inspector|Electrician|Operator|Pilot|Supervisor|Welder|Rigger|Fitter|Mechanic|Driver|Manager|Foreman|Hand|Planner|Coordinator|Designer|Surveyor|Diver|Controller|Specialist|Lead|Superintendent)$/.test(l)) return `${l}s`
  return `${l} roles`
}

// The basis this page leans on: the bundle's data_basis when present, else what the cells carry.
function dataBasis(data) {
  const db = data.counts?.data_basis
  if (db?.jobs) return { jobs: db.jobs, employers: db.employers, from: db.first_seen_from, to: db.first_seen_to }
  const jobs = data.cells.reduce((s, c) => s + (c.n_dedup ?? c.n ?? 0), 0)
  const to = data.cells.reduce((m, c) => (c.first_seen_max && c.first_seen_max > m ? c.first_seen_max : m), '')
  return { jobs, employers: null, from: null, to: to || null }
}

// The cell to benchmark against: the level cell when it publishes, else the role x region cell.
function resolveCell(data, role, region, unit, level) {
  const base = data.cells.find(c => c.role === role && c.region === region && c.basis === UNIT_BASIS[unit])
  if (!base) return null
  const lv = level !== 'all' && !levelCellStatus(base.levels, level).suppressed ? base.levels[level] : null
  return { base, cell: lv || base, levelUsed: lv ? level : 'all', levelMissing: level !== 'all' && !lv }
}

/* ── small pieces ─────────────────────────────────────────────────── */
function CurrencyPicker({ value, onChange, fx }) {
  return (
    <div className="mr3-cur">
      <div className="mr3-cur__seg" role="radiogroup" aria-label="Display currency">
        {CURRENCIES.map(c => (
          <button key={c} type="button" role="radio" aria-checked={value === c} className={`mr3-cur__opt${value === c ? ' is-on' : ''}`} onClick={() => onChange(c)}>
            <span aria-hidden="true">{curSym(c)}</span>{c}
          </button>
        ))}
      </div>
      {fx && <span className="mr3-cur__fx num">ECB rates, {fmtDate(fx.date)}: {fxNote(fx)}</span>}
    </div>
  )
}

function Select({ label, value, onChange, children, wide }) {
  return (
    <label className={`mr3-field${wide ? ' mr3-field--wide' : ''}`}>
      <span className="mr3-field__l">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>{children}</select>
    </label>
  )
}

function Band({ st, dom, marker, markerLabel, size = 'md' }) {
  const pct = v => Math.max(0, Math.min(100, ((v - dom.min) / (dom.max - dom.min)) * 100))
  const lo = pct(st.p25Raw), hi = pct(st.p75Raw), med = pct(st.medianRaw)
  return (
    <div className={`mr3-band mr3-band--${size}`}>
      <div className="mr3-band__track" />
      <div className="mr3-band__iqr" style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%` }} />
      <div className="mr3-band__med" style={{ left: `${med}%` }} />
      {marker != null && (
        <div className="mr3-band__you" style={{ left: `${pct(marker)}%` }}>
          {markerLabel && <span className={`mr3-band__youlabel num${pct(marker) > 70 ? ' is-right' : pct(marker) < 30 ? ' is-left' : ''}`}>{markerLabel}</span>}
        </div>
      )}
    </div>
  )
}

function Axis({ dom, period }) {
  const step = (dom.max - dom.min) / dom.ticks
  return (
    <div className="mr3-axis" aria-hidden="true">
      {Array.from({ length: dom.ticks + 1 }, (_, i) => (
        <span key={i} className="num" style={{ left: `${(i / dom.ticks) * 100}%` }}>{fmtAmount(dom.min + i * step, period)}</span>
      ))}
    </div>
  )
}

/* ── the answer: what does this role typically earn ───────────────── */
function Answer({ r, unit, region, onDetail }) {
  const st = cellStats(r.cell, unit)
  const dom = niceDomain(st.p25Raw, st.p75Raw, 4)
  const conf = confidenceOf(r.cell.n, r.cell.employers)
  const cv = countView(r.cell.n, r.cell.employers)
  const lvl = r.levelUsed === 'all' ? '' : `${LEVEL_NAME[r.levelUsed].toLowerCase()} `
  return (
    <section className="mr3-answer" aria-labelledby="mr3-answer-h">
      <h2 id="mr3-answer-h" className="mr3-answer__q">{lvl ? `${LEVEL_NAME[r.levelUsed]} ${plural(r.base)}` : plural(r.base)} in {inRegion(region)} typically earn</h2>
      <p className="mr3-answer__big num">{fmtAmount(st.median, unit)}<small>{{ day: '/day', hour: '/hr', month: '/mo', year: '/yr' }[unit]}</small></p>
      <p className="mr3-answer__range">
        Median {BASIS_NOUN[r.base.basis]}. Most jobs pay <b className="num">{fmtAmount(st.p25, unit)} to {fmtAmount(st.p75, unit)}</b> {UNIT_WORD[unit]}.
        {st.converted && <span className="mr3-answer__conv"> Converted from {BASIS_NOUN[r.base.basis]}s.</span>}
      </p>
      <div className="mr3-answer__plot">
        <Band st={st} dom={dom} size="lg" />
        <Axis dom={dom} period={unit} />
      </div>
      {r.levelMissing && <p className="mr3-note">Not enough jobs state this experience level here yet, so this covers all levels.</p>}
      <p className="mr3-prov">
        {cv.exact
          ? <><span className="num">{cv.jobs} jobs</span> from <span className="num">{cv.employers} employers</span>, </>
          : cv.band ? <>Based on <span className="num">{cv.band} jobs</span>, </> : null}
        {cv.exact || cv.band ? 'first seen' : 'First seen'} {dateSpan(r.cell.first_seen_min || r.base.first_seen_min, r.cell.first_seen_max || r.base.first_seen_max)}.
        {cv.exact || cv.band
          ? <span className={`mr3-conf mr3-conf--${conf.toLowerCase()}`} title="How many jobs and employers back this number.">{conf} confidence</span>
          : <span className="mr3-conf mr3-conf--limited" title="Fewer jobs back this number, so treat it as a guide.">Limited data</span>}
        <button type="button" className="mr3-link" onClick={() => onDetail(r)}>How it's built</button>
      </p>
    </section>
  )
}

/* ── the check: how does a rate compare ───────────────────────────── */
function RateCheck({ r, unit, rate, setRate }) {
  const st = cellStats(r.cell, unit)
  const v = parseFloat(String(rate).replace(/[^0-9.]/g, ''))
  const ok = isFinite(v) && v > 0
  const dom = niceDomain(Math.min(st.p25Raw, ok ? v : Infinity) * 0.95, Math.max(st.p75Raw, ok ? v : 0) * 1.03, 4)
  const pctl = ok ? percentileOf(v, st) : null
  const diff = ok ? (v - st.medianRaw) / st.medianRaw : 0
  // banding runs on the cell's USD/day range, so the typed rate goes back to USD per day first
  const dayV = ok ? toUsd(unit === 'day' ? v : unit === 'hour' ? v * (r.cell.hours_per_day || (r.cell.basis === 'perm_timebased' ? 8 : 10)) : unit === 'year' ? v / 260 : v / 30.4) : null
  const band = ok ? bandOf(dayV, dayV, r.cell) : null
  const pctAbs = Math.round(Math.abs(diff) * 100)
  const gap = ok ? Math.abs(st.median - v) : 0
  return (
    <section className="mr3-check" aria-labelledby="mr3-check-h">
      <h2 id="mr3-check-h">Compare a rate</h2>
      <label className="mr3-rate">
        <span className="mr3-rate__cur" aria-hidden="true">{curSym()}</span>
        <input inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} aria-label={`Rate to check, ${UNIT_WORD[unit].replace(/^an? /, 'per ')}`} />
        <span className="mr3-rate__unit">{{ day: 'per day', hour: 'per hour', month: 'per month', year: 'per year' }[unit]}</span>
      </label>
      <div aria-live="polite">
        {ok ? (
          <>
            <p className={`mr3-verdict mr3-verdict--${STATUS[band].tone}`}>{STATUS[band].label}</p>
            <p className="mr3-verdict__line">
              {pctAbs === 0 ? <>Right at the median of <b className="num">{fmtRate(st.median, unit)}</b>.</> : <><b className="num">{fmtExact(v, unit)}</b> is <b className="num">{pctAbs}% {diff < 0 ? 'under' : 'over'}</b> the median of <b className="num">{fmtRate(st.median, unit)}</b>.</>}
              {diff < -0.02 && <> Adding <b className="num">{fmtRate(gap, unit)}</b> reaches it.</>}
            </p>
            <div className="mr3-check__plot">
              <Band st={st} dom={dom} marker={v} markerLabel={fmtExact(v, unit)} />
              <Axis dom={dom} period={unit} />
            </div>
            <div className="mr3-legend"><span><i className="mr3-key mr3-key--iqr" />Middle half of jobs</span><span><i className="mr3-key mr3-key--med" />Median</span><span><i className="mr3-key mr3-key--you" />This rate</span></div>
            <p className="mr3-pctl">Pays more than roughly {pctl}% of these jobs ({ordinal(pctl)} percentile).</p>
          </>
        ) : <p className="mr3-empty">Enter a rate to compare it with the market.</p>}
      </div>
    </section>
  )
}

/* ── how it shifts: experience and region ─────────────────────────── */
function Shifts({ data, r, unit, region, onLevel, onRegion }) {
  const levelRows = ['low', 'mid', 'high'].map(l => {
    const lc = r.base.levels?.[l]
    const shown = lc && !levelCellStatus(r.base.levels, l).suppressed
    return { k: l, name: LEVEL_NAME[l], sub: LEVEL_YRS[l], st: shown ? cellStats(lc, unit) : null, n: shown ? lc.n : null, emp: shown ? lc.employers : 0, on: r.levelUsed === l, go: () => onLevel(r.levelUsed === l ? 'all' : l) }
  })
  const regionRows = data.regions.map(reg => {
    const rc = data.cells.find(c => c.role === r.base.role && c.region === reg && c.basis === r.base.basis)
    return rc ? { k: reg, name: regionName(reg), st: cellStats(rc, unit), n: rc.n, emp: rc.employers, on: reg === region, go: () => onRegion(reg) } : null
  }).filter(Boolean).sort((a, b) => b.st.medianRaw - a.st.medianRaw)
  const all = [...levelRows, ...regionRows].filter(x => x.st)
  const dom = niceDomain(Math.min(...all.map(x => x.st.p25Raw)), Math.max(...all.map(x => x.st.p75Raw)), 4)
  const table = ({ title, rows, note }) => (
    <div className="mr3-shift">
      <h3>{title}</h3>
      <table className="mr3-table">
        <thead><tr><th scope="col">{title === 'By experience' ? 'Level' : 'Region'}</th><th scope="col" className="r">Median</th><th scope="col" className="mr3-col-bar"><span className="sr-only">Range</span></th><th scope="col" className="r mr3-col-n">Jobs</th></tr></thead>
        <tbody>
          {rows.map(x => (
            <tr key={x.k} className={`${x.on ? 'is-on' : ''}${x.st ? ' is-link' : ''}`} onClick={x.st ? x.go : undefined}>
              <th scope="row">{x.st ? <button type="button" className="mr3-rowbtn" onClick={e => { e.stopPropagation(); x.go() }}>{x.name}</button> : x.name}{x.sub && <small>{x.sub}</small>}</th>
              {x.st ? (
                <>
                  <td className="r num">{fmtRate(x.st.median, unit)}<small className="mr3-range-sm">{fmtRange(x.st.p25, x.st.p75, unit)}</small></td>
                  <td className="mr3-col-bar"><Band st={x.st} dom={dom} size="sm" /></td>
                  <td className="r num mr3-col-n">{countView(x.n, x.emp).short}</td>
                </>
              ) : <td colSpan={3} className="mr3-na">Needs more jobs</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="mr3-shift__note">{note}</p>}
    </div>
  )
  return (
    <section className="mr3-sec" aria-labelledby="mr3-shift-h">
      <h2 id="mr3-shift-h" className="mr3-sec__h">{r.base.role_label} pay by experience and region</h2>
      <div className="mr3-shifts">
        {table({ title: 'By experience', rows: levelRows, note: `In ${inRegion(region)}. A level shows once enough jobs state it.` })}
        {regionRows.length > 1 && table({ title: 'By region', rows: regionRows, note: 'All experience levels.' })}
      </div>
    </section>
  )
}

/* ── common roles in this region ──────────────────────────────────── */
function CommonRoles({ data, region, unit, role, onRole }) {
  const rows = data.cells.filter(c => c.region === region && c.basis === UNIT_BASIS[unit] && !c.role.endsWith('-other') && c.role !== 'supervisor-foreman')
    .sort((a, b) => b.n - a.n).slice(0, COMMON_ROWS)
  if (rows.length < 2) return null
  const stats = rows.map(c => cellStats(c, unit))
  const dom = niceDomain(Math.min(...stats.map(s => s.p25Raw)), Math.max(...stats.map(s => s.p75Raw)), 4)
  return (
    <section className="mr3-sec" aria-labelledby="mr3-common-h">
      <h2 id="mr3-common-h" className="mr3-sec__h">Most common roles in {regionName(region)}</h2>
      <p className="mr3-sec__sub">{UNIT_LONG[unit]}, all experience levels. Choose a role to look it up.</p>
      <table className="mr3-table mr3-table--common">
        <thead><tr><th scope="col">Role</th><th scope="col" className="r">Median</th><th scope="col" className="r mr3-col-range">Middle half</th><th scope="col" className="mr3-col-bar"><span className="sr-only">Range</span></th><th scope="col" className="r mr3-col-n">Jobs</th></tr></thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={c.id} className={`is-link${c.role === role ? ' is-on' : ''}`} onClick={() => onRole(c.role)}>
              <th scope="row"><button type="button" className="mr3-rowbtn" onClick={e => { e.stopPropagation(); onRole(c.role) }}>{c.role_label}</button></th>
              <td className="r num mr3-strong">{fmtRate(stats[i].median, unit)}</td>
              <td className="r num mr3-col-range">{fmtRange(stats[i].p25, stats[i].p75, unit)}</td>
              <td className="mr3-col-bar"><Band st={stats[i]} dom={dom} size="sm" /></td>
              <td className="r num mr3-col-n">{countView(c.n, c.employers).short}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/* ── modal + detail drawer ────────────────────────────────────────── */
function RequestModal({ onClose }) {
  const [sent, setSent] = useState(false)
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="mr3-overlay" onClick={onClose}>
      <div className="mr3-modal" role="dialog" aria-modal="true" aria-labelledby="mr3-modal-h" onClick={e => e.stopPropagation()}>
        <button type="button" className="mr3-x" onClick={onClose} aria-label="Close">×</button>
        <h2 id="mr3-modal-h">Request the full edition</h2>
        {sent ? (
          <p className="mr3-modal__done">Mock only. Nothing was sent or stored. In a live version this request would reach the Moblyze team and open a trial of the full edition.</p>
        ) : (
          <form onSubmit={e => { e.preventDefault(); setSent(true) }}>
            <p className="mr3-modal__sub">Early access is limited to energy employers, crewing managers and recruiters.</p>
            <label className="mr3-field"><span className="mr3-field__l">Company</span><input placeholder="Company name" /></label>
            <label className="mr3-field"><span className="mr3-field__l">Your role</span>
              <select defaultValue="emp">
                <option value="emp">Employer or crewing manager</option>
                <option value="rec">Recruiter or staffing firm</option>
                <option value="hr">HR or rewards</option>
                <option value="oth">Other</option>
              </select>
            </label>
            <label className="mr3-field"><span className="mr3-field__l">Work email</span><input type="email" placeholder="name@company.com" /></label>
            <label className="mr3-field"><span className="mr3-field__l">Roles and regions you benchmark</span><input placeholder="e.g. ROV pilots, North Sea; electricians, Texas" /></label>
            <button type="submit" className="mr3-btn mr3-btn--primary">Request access</button>
            <p className="mr3-modal__fine">Internal preview. This form is a non-functional mock and submits nothing.</p>
          </form>
        )}
      </div>
    </div>
  )
}

function DetailDrawer({ data, sel, onClose }) {
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const c = sel.cell, b = sel.base
  const conf = confidenceOf(c.n, c.employers)
  const cv = countView(c.n, c.employers)
  const st = cellStats(c, b.unit)
  const cur = Object.entries(c.currencies || {}).map(([k, v]) => `${k} ${v}`).join(', ')
  const types = Object.entries(c.employer_types || {}).map(([k, v]) => `${({ direct: 'direct employer', board: 'job board', crewing_agency: 'crewing agency', staffing: 'staffing agency' })[k] || k.replace('_', ' ')} ${v}`).join(', ')
  const rows = [
    ['Measure', 'Pay stated on jobs for the role, with duplicates removed across sources.'],
    ['Market', `${b.role_label} · ${regionName(b.region)} · ${sel.levelUsed === 'all' ? 'All levels' : `${LEVEL_NAME[sel.levelUsed]} (${LEVEL_YRS[sel.levelUsed]})`} · ${b.basis_label}`],
    ['Typical range', `${fmtRange(st.p25, st.p75, st.period)}, the middle half of jobs (P25-P75). Median ${fmtRate(st.median, st.period)}.`],
    ['Jobs used', cv.exact
      ? `${cv.jobs} after removing duplicates (${c.n_raw.toLocaleString('en-US')} before) and ${c.outliers_excluded} ${c.outliers_excluded === 1 ? 'outlier' : 'outliers'} beyond 3x MAD`
      : cv.band ? `${cv.band}, after removing duplicates and outliers beyond 3x MAD` : 'Limited data. Duplicates and outliers beyond 3x MAD are removed.'],
    ...(cv.exact ? [['Employers', `${cv.employers} distinct${types ? ` (${types})` : ''}`]] : []),
    ['First seen', dateSpan(c.first_seen_min || b.first_seen_min, c.first_seen_max || b.first_seen_max)],
    ['Still open', `${Math.round((c.active_share ?? 0) * 100)}% of these jobs are open today`],
    ['Currencies', `${cur || 'USD'} as stated; shown in ${st.currency} at ECB reference rates of ${fmtDate(data.fx?.date || data.fx_date)}`],
    ['Confidence', `${cv.exact || cv.band ? conf : 'Limited data'}. Reflects how many jobs and employers back the number. Exact counts show at ${EXACT_MIN_JOBS}+ jobs from ${EXACT_MIN_EMPLOYERS}+ employers.`],
    ['Refreshed', `${fmtDate(c.last_updated || b.last_updated)} · extractor ${data.extractor_version}`],
  ]
  return (
    <div className="mr3-overlay mr3-overlay--side" onClick={onClose}>
      <aside className="mr3-drawer" role="dialog" aria-modal="true" aria-labelledby="mr3-drawer-h" onClick={e => e.stopPropagation()}>
        <button type="button" className="mr3-x" onClick={onClose} aria-label="Close">×</button>
        <h2 id="mr3-drawer-h">How this number is built</h2>
        <dl className="mr3-dl">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <p className="mr3-drawer__fine">Only pay stated with an explicit period counts. Hourly-to-day conversions assume 10 hours on contract work and 8 on permanent work.</p>
      </aside>
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────────────── */
function Lookup({ data, currency }) {
  const [f, setF] = useState(() => ({ ...START, rate: String(Math.round(convert(+START.rate, 'USD', currency))), cur: currency }))
  const [detail, setDetail] = useState(null)
  const top = useRef(null)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  // A typed rate follows the display currency, so switching USD -> GBP re-expresses it rather than reinterpreting it.
  useEffect(() => {
    setF(p => {
      if (p.cur === currency) return p
      const n = parseFloat(String(p.rate).replace(/[^0-9.]/g, ''))
      const conv = isFinite(n) ? convert(n, p.cur, currency) : null
      return { ...p, cur: currency, rate: conv == null ? p.rate : String(conv >= 100 ? Math.round(conv) : Math.round(conv * 100) / 100) }
    })
  }, [currency])
  const roles = useMemo(() => {
    const m = new Map()
    data.cells.filter(c => !c.role.endsWith('-other')).forEach(c => m.set(c.role, c.role_label))
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data])
  const units = useMemo(() => ['day', 'hour', 'year', 'month'].filter(u => data.cells.some(c => c.role === f.role && c.basis === UNIT_BASIS[u])), [data, f.role])
  const unit = units.includes(f.unit) ? f.unit : units[0]
  const regions = useMemo(() => data.regions.filter(r => data.cells.some(c => c.role === f.role && c.region === r && c.basis === UNIT_BASIS[unit])), [data, f.role, unit])
  const region = regions.includes(f.region) ? f.region : regions[0]
  const r = resolveCell(data, f.role, region, unit, f.level)
  const pickRole = role => { set('role', role); top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  return (
    <>
      <form className="mr3-form" ref={top} onSubmit={e => e.preventDefault()} aria-label="Look up a market rate">
        <Select label="Role" value={f.role} onChange={v => set('role', v)} wide>{roles.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</Select>
        <Select label="Region" value={region} onChange={v => set('region', v)}>{regions.map(x => <option key={x} value={x}>{regionName(x)}</option>)}</Select>
        <Select label="Experience" value={f.level} onChange={v => set('level', v)}>
          <option value="all">All levels</option>
          {['low', 'mid', 'high'].map(l => <option key={l} value={l}>{LEVEL_NAME[l]} ({LEVEL_YRS[l]})</option>)}
        </Select>
        <Select label="Pay type" value={unit} onChange={v => set('unit', v)}>{units.map(u => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</Select>
      </form>

      {!r && <p className="mr3-empty">Not enough data for this combination yet.</p>}
      {r && (
        <>
          <div className="mr3-main">
            <Answer r={r} unit={unit} region={region} onDetail={setDetail} />
            <RateCheck r={r} unit={unit} rate={f.rate} setRate={v => set('rate', v)} />
          </div>
          <Shifts data={data} r={r} unit={unit} region={region} onLevel={l => set('level', l)} onRegion={reg => set('region', reg)} />
        </>
      )}
      <CommonRoles data={data} region={region} unit={unit} role={f.role} onRole={pickRole} />
      {detail && <DetailDrawer data={data} sel={detail} onClose={() => setDetail(null)} />}
    </>
  )
}

export default function MarketRatesV2Page() {
  const { data, error } = useMarketRates()
  const [modal, setModal] = useState(false)
  const [currency, setCurrency] = useState(loadCurrency)
  const pickCurrency = c => { setCurrency(c); saveCurrency(c) }
  // every figure below is formatted in the chosen currency (utils read this during render)
  if (data) setActiveCurrency(currency, data.fx)
  const basis = data ? dataBasis(data) : null
  return (
    <div className="mz mr3">
      <SEO title="Moblyze Market Rates" description="Internal preview of a market pay benchmark for energy and trades roles." />
      <div className="mr3-wrap">
        <PageHeader
          title="Market rates"
          beta
          sub="What energy and trades roles typically earn, from jobs that state their pay."
          right={data && <CurrencyPicker value={currency} onChange={pickCurrency} fx={data.fx} />}
        />
        {basis && (
          <DataBasis parts={[
            <>Based on <b className="num">{basis.jobs.toLocaleString('en-US')}</b> jobs with stated pay{basis.employers ? <> from <b className="num">{basis.employers.toLocaleString('en-US')}</b> employers</> : null}{basis.from && basis.to ? <>, posted {monthSpan(basis.from, basis.to)}</> : null}</>,
            fmtUpdated(data.generated_at),
          ]} />
        )}

        {error && <p className="mr3-empty">Could not load market data ({error}).</p>}
        {!data && !error && <p className="mr3-empty">Loading market rates…</p>}
        {data && (
          <>
            <Lookup data={data} currency={currency} />
            <aside className="mr3-full">
              <p><b>Full edition.</b> All {data.counts.cells_published} role and region markets, monthly trends, peer sets and CSV export.</p>
              <button type="button" className="mr3-btn" onClick={() => setModal(true)}>Request access</button>
            </aside>
            <footer className="mr3-foot">
              <p>Built from pay stated on energy and trades jobs, with duplicates and reposts removed and only pay with an explicit period counted. A number publishes only when enough jobs from enough employers back it; exact counts show at 50+ jobs from 10+ employers. The typical range is the middle half of jobs (25th to 75th percentile); percentiles for a single rate are estimated from it. Figures are shown in {currency} at ECB reference rates of {fmtDate(data.fx?.date || data.fx_date)}.</p>
              <p className="mr3-foot__ed">Moblyze Market Rates · {EDITION} · Internal, not client-facing</p>
            </footer>
          </>
        )}
      </div>
      {modal && <RequestModal onClose={() => setModal(false)} />}
    </div>
  )
}
