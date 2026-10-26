// src/pages/MarketRatesV2Page.jsx
// "Moblyze Market Rates, Q4 2026": v2 of the Market rates mock. Fewer numbers,
// more value per number: a "your rate vs market" hero, a small free layer
// (five US trades), and a gated full edition shown as locked previews.
// Internal preview, illustrative. v1 stays at /market-rates/v1.
// Reads /data/market_rates.json (pay_rates/site_bundle.py in moblyze-ops).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import SEO from '../components/SEO'
import { bandOf, cellStats, fmtAmount, fmtDate, fmtRange, fmtRate, niceDomain } from '../utils/marketRates'
import '../market-rates-v2.css'

const DATA_URL = `${import.meta.env.BASE_URL || '/'}data/market_rates.json`
const EDITION = 'Q4 2026'
const FEATURED = ['electrician', 'inspector', 'mechanical-technician', 'welding-inspector', 'ndt-technician']
const FREE_REGION = 'US'
const LEVEL_NAME = { low: 'Early career', mid: 'Mid-level', high: 'Senior' }
const LEVEL_YRS = { low: 'under 5 yrs', mid: '5 to 9 yrs', high: '10+ yrs' }
const UNIT_BASIS = { day: 'contract_day', hour: 'perm_timebased', year: 'salary_equiv', month: 'seafarer_month' }
const UNIT_LABEL = { day: 'per day', hour: 'per hour', year: 'per year', month: 'per month' }
const BASIS_NOUN = { contract_day: 'contract day rate', perm_timebased: 'hourly rate', salary_equiv: 'annual salary', seafarer_month: 'monthly seafarer wage' }
const REGION_NAME = { US: 'United States', UK: 'United Kingdom', 'Middle East': 'Middle East', 'Europe (other)': 'Europe', 'Unknown/Worldwide': 'Worldwide / unstated' }
const STATUS = {
  in_range: { label: 'Inside the typical range', tone: 'ok', icon: '●' },
  near_below: { label: 'Just below the typical range', tone: 'warn', icon: '▾' },
  near_above: { label: 'Just above the typical range', tone: 'up', icon: '▴' },
  below_market: { label: 'Below market', tone: 'low', icon: '▼' },
  above_market: { label: 'Above market', tone: 'up', icon: '▲' },
}
const HERO_EXAMPLE = { role: 'electrician', region: 'US', level: 'low', unit: 'day', rate: '320' }

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

// Confidence from deduped ads (n) and distinct employers, the stricter of the two wins.
export function confidenceOf(n, employers) {
  if (n >= 50 && employers >= 15) return 'High'
  if (n >= 20 && employers >= 6) return 'Medium'
  return 'Limited'
}

// Estimated percentile of v inside a cell, piecewise linear through P25 / P50 / P75,
// tails extended at the slope of the nearest segment, clamped to P2..P98.
function percentileOf(v, st) {
  const { p25: a, median: m, p75: b } = st
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

function fmtExact(v, unit) {
  const sfx = { day: '/day', hour: '/hr', month: '/mo', year: '/yr' }[unit] || ''
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: unit === 'hour' ? 2 : 0 })}${sfx}`
}

function prettyRole(c) { return c.role_label.replace(/ Technician$/, ' technician').replace(/ Inspector$/, ' inspector') }

// The cell to benchmark against: the level cell when it publishes, else the role x region cell.
function resolveCell(data, role, region, unit, level) {
  const base = data.cells.find(c => c.role === role && c.region === region && c.basis === UNIT_BASIS[unit])
  if (!base) return null
  const lv = level !== 'all' ? base.levels?.[level] : null
  return { base, cell: lv || base, levelUsed: lv ? level : 'all', levelMissing: level !== 'all' && !lv ? (base.level_n?.[level] ?? 0) : null }
}

/* ── small pieces ─────────────────────────────────────────────────── */
function Provenance({ cell, base, compact, onDetail }) {
  const b = base || cell
  const conf = confidenceOf(cell.n, cell.employers)
  return (
    <div className={`m2-prov${compact ? ' m2-prov--compact' : ''}`}>
      <span className="m2-prov__src">Advertised pay</span>
      <span className="m2-prov__dot" />
      <span className="num">{cell.n} ads</span>
      <span className="m2-prov__dot" />
      <span className="num">{cell.employers} employers</span>
      <span className="m2-prov__dot" />
      <span className="num">{dateSpan(cell.first_seen_min || b.first_seen_min, cell.first_seen_max || b.first_seen_max)}</span>
      {!compact && <><span className="m2-prov__dot" /><span>Refreshed {fmtDate(cell.last_updated || b.last_updated)}</span></>}
      <span className={`m2-conf m2-conf--${conf.toLowerCase()}`} title="High: 50+ ads from 15+ employers. Medium: 20+ ads from 6+ employers. Limited: 10+ ads from 3+ employers.">
        <span className="m2-conf__bars" aria-hidden="true"><i /><i /><i /></span>{conf}
      </span>
      {onDetail && <button type="button" className="m2-prov__more" onClick={onDetail} aria-label="How this number is built">How it's built</button>}
    </div>
  )
}

function Band({ st, dom, marker, markerLabel, height = 'md', tipTitle }) {
  const pct = v => Math.max(0, Math.min(100, ((v - dom.min) / (dom.max - dom.min)) * 100))
  const lo = pct(st.p25), hi = pct(st.p75), med = pct(st.median)
  return (
    <div className={`m2-band m2-band--${height}`}>
      <div className="m2-band__track" />
      <div className="m2-band__iqr" style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%` }} />
      <div className="m2-band__med" style={{ left: `${med}%` }} />
      {marker != null && (
        <div className="m2-band__you" style={{ left: `${pct(marker)}%` }}>
          <span className="m2-band__youlabel num">{markerLabel}</span>
        </div>
      )}
      <div className="m2-tip" role="tooltip">
        {tipTitle && <b>{tipTitle}</b>}
        <span>Typical (P25-P75) <em className="num">{fmtRange(st.p25, st.p75, st.period)}</em></span>
        <span>Median <em className="num">{fmtRate(st.median, st.period)}</em></span>
      </div>
    </div>
  )
}

function Axis({ dom, period }) {
  const step = (dom.max - dom.min) / dom.ticks
  return (
    <div className="m2-axis" aria-hidden="true">
      {Array.from({ length: dom.ticks + 1 }, (_, i) => (
        <span key={i} className="num" style={{ left: `${(i / dom.ticks) * 100}%` }}>{fmtAmount(dom.min + i * step, period)}</span>
      ))}
    </div>
  )
}

function LockIcon() {
  return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor" /><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
}

/* ── hero: your rate vs market ────────────────────────────────────── */
function RateCheck({ data, buyer, onDetail }) {
  const [f, setF] = useState(HERO_EXAMPLE)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
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
  const v = parseFloat(String(f.rate).replace(/[^0-9.]/g, ''))
  const ok = r && isFinite(v) && v > 0
  const st = r ? cellStats(r.cell, unit) : null
  const dom = st ? niceDomain(Math.min(st.p25Raw, ok ? v : Infinity) * 0.92, Math.max(st.p75Raw, ok ? v : 0) * 1.04, 4) : null
  const pctl = ok ? percentileOf(v, st) : null
  const diff = ok ? (v - st.median) / st.median : 0
  const dayV = ok ? (unit === 'day' ? v : unit === 'hour' ? v * (r.cell.hours_per_day || (r.cell.basis === 'perm_timebased' ? 8 : 10)) : unit === 'year' ? v / 260 : v / 30.4) : null
  const band = ok ? bandOf(dayV, dayV, r.cell) : null
  const lvlLabel = r?.levelUsed !== 'all' ? `${LEVEL_NAME[r.levelUsed].toLowerCase()} median` : 'median'
  const dir = diff < 0 ? 'under' : 'over'
  const gapAbs = ok ? Math.abs(st.median - v) : 0

  // "What moves it": only comparisons the data publishes (level cells, other regions).
  const moves = []
  if (r) {
    for (const l of ['low', 'mid', 'high']) {
      const lc = r.base.levels?.[l]
      if (!lc || l === r.levelUsed) continue
      const ls = cellStats(lc, unit)
      const d = ls.median - st.median
      if (d === 0) continue
      moves.push({ k: `lvl-${l}`, kind: 'Experience', text: `${LEVEL_NAME[l]} (${LEVEL_YRS[l]})`, val: fmtRate(ls.median, unit), d, n: lc.n })
    }
    for (const reg of data.regions) {
      if (reg === region) continue
      const rc = data.cells.find(c => c.role === f.role && c.region === reg && c.basis === r.base.basis)
      if (!rc) continue
      const rs = cellStats(rc, unit)
      const d = rs.median - st.median
      if (d === 0) continue
      moves.push({ k: `reg-${reg}`, kind: 'Region', text: REGION_NAME[reg], val: fmtRate(rs.median, unit), d, n: rc.n })
    }
  }
  const shown = moves.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3)

  const copy = buyer === 'employer'
    ? { eyebrow: 'Rate check for employers and crewing managers', title: <>Are your rates <em>competitive?</em></>, input: 'Rate you offer', lead: ok && diff < -0.02 ? `To reach the market median, add ${fmtRate(gapAbs, unit)}.` : ok ? 'Your offer is at or above the market median.' : '' }
    : { eyebrow: 'Rate check for recruiters', title: <>What rate can you <em>defend?</em></>, input: 'Rate you plan to quote', lead: st ? `Defensible band: ${fmtRange(st.p25, st.p75, unit)}, the middle half of ${r.cell.n} ads. Quoting up to ${fmtRate(st.p75, unit)} stays inside market.` : '' }

  return (
    <section className="m2-hero" aria-labelledby="m2-hero-h">
      <div className="m2-hero__copy">
        <p className="m2-eyebrow">{copy.eyebrow}</p>
        <h1 id="m2-hero-h">{copy.title}</h1>
        <p className="m2-hero__sub">Enter a role, region, experience level and rate. See where it sits against what the market advertises right now.</p>
        <form className="m2-form" onSubmit={e => e.preventDefault()}>
          <label className="m2-field m2-field--wide"><span>Role</span>
            <select value={f.role} onChange={e => set('role', e.target.value)}>{roles.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
          </label>
          <label className="m2-field"><span>Region</span>
            <select value={region} onChange={e => set('region', e.target.value)}>{regions.map(x => <option key={x} value={x}>{REGION_NAME[x]}</option>)}</select>
          </label>
          <label className="m2-field"><span>Experience</span>
            <select value={f.level} onChange={e => set('level', e.target.value)}>
              <option value="all">All levels</option>
              {['low', 'mid', 'high'].map(l => <option key={l} value={l}>{LEVEL_NAME[l]} ({LEVEL_YRS[l]})</option>)}
            </select>
          </label>
          <label className="m2-field m2-field--rate"><span>{copy.input}</span>
            <div className="m2-rate">
              <span className="m2-rate__cur">$</span>
              <input inputMode="decimal" value={f.rate} onChange={e => set('rate', e.target.value)} aria-label={copy.input} />
              <select value={unit} onChange={e => set('unit', e.target.value)} aria-label="Pay period">
                {units.map(u => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
              </select>
            </div>
          </label>
        </form>
        {r?.levelMissing != null && (
          <p className="m2-note">{LEVEL_NAME[f.level]} needs 10+ ads for this role and region ({r.levelMissing} so far), so this compares against all levels.</p>
        )}
      </div>

      <div className="m2-result" aria-live="polite">
        {!r && <p className="m2-empty">No published market yet for this combination. A cell publishes at 10+ ads from 3+ employers.</p>}
        {r && (
          <>
            <div className="m2-result__head">
              <span className="m2-result__ctx">{prettyRole(r.base)} · {REGION_NAME[region]} · {r.levelUsed === 'all' ? 'All levels' : `${LEVEL_NAME[r.levelUsed]} (${LEVEL_YRS[r.levelUsed]})`} · {BASIS_NOUN[r.base.basis]}</span>
            </div>
            {ok ? (
              <div className="m2-verdict">
                <div className="m2-verdict__p num"><small>P</small>{pctl}</div>
                <div className="m2-verdict__txt">
                  <p className="m2-verdict__line"><b className="num">{Math.round(Math.abs(diff) * 100)}% {dir}</b> the {lvlLabel} of <b className="num">{fmtRate(st.median, unit)}</b></p>
                  <p className={`m2-status m2-status--${STATUS[band].tone}`}><span aria-hidden="true">{STATUS[band].icon}</span>{STATUS[band].label}</p>
                </div>
              </div>
            ) : <p className="m2-empty">Enter a rate to see its position.</p>}
            <div className="m2-result__plot">
              <Band st={st} dom={dom} height="lg" marker={ok ? v : null} markerLabel={ok ? (buyer === 'employer' ? 'Your offer ' : 'Your quote ') + fmtExact(v, unit) : ''} tipTitle="Market" />
              <Axis dom={dom} period={unit} />
              <div className="m2-legend"><span><i className="m2-key m2-key--iqr" />Typical range, P25-P75</span><span><i className="m2-key m2-key--med" />Median</span><span><i className="m2-key m2-key--you" />{buyer === 'employer' ? 'Your offer' : 'Your quote'}</span></div>
            </div>
            {copy.lead && <p className="m2-lead">{copy.lead}</p>}
            {shown.length > 0 && (
              <div className="m2-moves">
                <h3>What moves it</h3>
                <ul>
                  {shown.map(m => (
                    <li key={m.k}>
                      <span className="m2-moves__kind">{m.kind}</span>
                      <span className="m2-moves__what">{m.text}</span>
                      <span className="m2-moves__val num">{m.val}</span>
                      <span className={`m2-moves__d num ${m.d > 0 ? 'is-up' : 'is-down'}`}>{m.d > 0 ? '+' : '-'}{fmtRate(Math.abs(m.d), unit)}</span>
                      <span className="m2-moves__n num">{m.n} ads</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Provenance cell={r.cell} base={r.base} onDetail={() => onDetail(r)} />
          </>
        )}
      </div>
    </section>
  )
}

/* ── free layer ───────────────────────────────────────────────────── */
function FreeLayer({ data, onDetail }) {
  const cells = FEATURED.map(role => data.cells.find(c => c.role === role && c.region === FREE_REGION && c.basis === 'contract_day')).filter(Boolean)
  const all = cells.flatMap(c => [c, ...Object.values(c.levels || {}).filter(Boolean)])
  const dom = niceDomain(Math.min(...all.map(c => c.usd_day.range_lo)), Math.max(...all.map(c => c.usd_day.range_hi)), 4)
  return (
    <section className="m2-sec" aria-labelledby="m2-free-h">
      <header className="m2-sec__head">
        <div>
          <p className="m2-eyebrow">Included in this edition</p>
          <h2 id="m2-free-h">Five featured trades, United States contract day rates</h2>
        </div>
        <p className="m2-sec__aside">One median and one typical range per trade. Experience levels show only when 10 or more ads back them.</p>
      </header>
      <div className="m2-cards">
        {cells.map(c => {
          const st = cellStats(c, 'day')
          return (
            <article key={c.id} className="m2-card">
              <div className="m2-card__top">
                <h3>{prettyRole(c)}</h3>
                <div className="m2-card__med"><span className="num">{fmtAmount(st.median, 'day')}</span><small>/day median</small></div>
              </div>
              <p className="m2-card__range num">Typical {fmtRange(st.p25, st.p75, 'day')}</p>
              <Band st={st} dom={dom} tipTitle={prettyRole(c)} />
              <ul className="m2-levels">
                {['low', 'mid', 'high'].map(l => {
                  const lc = c.levels?.[l]
                  return (
                    <li key={l}>
                      <span className="m2-levels__l">{LEVEL_NAME[l]}<small>{LEVEL_YRS[l]}</small></span>
                      {lc
                        ? <span className="m2-levels__v num">{fmtRange(cellStats(lc, 'day').p25, cellStats(lc, 'day').p75, 'day')}</span>
                        : <span className="m2-levels__na">Needs 10+ ads</span>}
                    </li>
                  )
                })}
              </ul>
              <Provenance cell={c} compact onDetail={() => onDetail({ base: c, cell: c, levelUsed: 'all' })} />
            </article>
          )
        })}
      </div>
      <Axis dom={dom} period="day" />
    </section>
  )
}

/* ── gated layer ──────────────────────────────────────────────────── */
function GatedLayer({ data, onRequest }) {
  const gridRoles = ['electrician', 'inspector', 'ndt-technician', 'welder', 'chief-officer', 'vessel-master', 'marine-engineer', 'substation-technician']
  const grid = gridRoles.map(role => ({ role, cells: data.regions.map(reg => data.cells.find(c => c.role === role && c.region === reg && c.basis === 'contract_day')) })).filter(g => g.cells.some(Boolean))
  const trendCells = data.cells.filter(c => c.trend?.length >= 3)
  const tc = data.cells.find(c => c.id === 'electrician|US|perm_timebased') || trendCells[0]
  const tr = tc?.trend || []
  const tmin = Math.min(...tr.map(t => t.usd_day_median)), tmax = Math.max(...tr.map(t => t.usd_day_median))
  const pts = tr.map((t, i) => `${(i / Math.max(1, tr.length - 1)) * 200},${54 - ((t.usd_day_median - tmin) / Math.max(1, tmax - tmin)) * 44}`).join(' ')
  const regionalRole = data.cells.filter(c => c.role === 'chief-officer' && c.basis === 'contract_day')

  const tiles = [
    { k: 'grid', title: 'Full role, region and experience grid', body: `All ${data.counts.cells_published} published cells and ${data.counts.level_cells_published} experience-level cells, every basis.`, tag: 'Full edition' },
    { k: 'region', title: 'Regional comparison', body: 'The same role side by side across the US, UK, Middle East, Europe and worldwide crewing.', tag: 'Full edition' },
    { k: 'trend', title: 'Monthly trends, up to 12 months', body: `Shown only where 3+ months each have 5+ ads: ${trendCells.length} cells qualify today. Others carry no trend.`, tag: 'Full edition' },
    { k: 'prem', title: 'Certification and rotation premiums', body: 'What a 28/28 rotation or a GWO, CSWIP or IRATA ticket adds. Rotation is stated in too few ads to price yet.', tag: 'Coming soon' },
    { k: 'peer', title: 'Custom peer sets', body: 'Benchmark against the employers you compete with for crew, for example North Sea subsea contractors.', tag: 'Full edition' },
    { k: 'alert', title: 'Watched-role alerts and CSV export', body: 'A note when a watched role moves outside its range, plus the full grid as a rate card.', tag: 'Full edition' },
  ]

  return (
    <section className="m2-sec m2-gated" aria-labelledby="m2-gated-h">
      <header className="m2-sec__head">
        <div>
          <p className="m2-eyebrow"><LockIcon /> Full edition</p>
          <h2 id="m2-gated-h">Every role, every region, every level</h2>
        </div>
        <button type="button" className="m2-btn m2-btn--primary" onClick={onRequest}>Request access</button>
      </header>

      <div className="m2-locked m2-locked--grid">
        <div className="m2-locked__blur" aria-hidden="true">
          <table className="m2-grid">
            <thead><tr><th>Role, contract day rate</th>{data.regions.map(r => <th key={r}>{REGION_NAME[r]}</th>)}</tr></thead>
            <tbody>
              {grid.map(g => (
                <tr key={g.role}>
                  <td>{(g.cells.find(Boolean) || {}).role_label}</td>
                  {g.cells.map((c, i) => <td key={i} className="num">{c ? fmtRange(cellStats(c, 'day').p25, cellStats(c, 'day').p75, 'day') : 'Needs 10+ ads'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="m2-locked__cta">
          <span className="m2-lockbadge"><LockIcon /> Full edition</span>
          <p><b className="num">{data.counts.cells_published} market cells</b> across {data.regions.length} regions and 3 experience levels</p>
          <button type="button" className="m2-btn m2-btn--primary" onClick={onRequest}>Request access</button>
        </div>
      </div>

      <div className="m2-tiles">
        {tiles.map(t => (
          <button type="button" key={t.k} className={`m2-tile${t.tag === 'Coming soon' ? ' is-soon' : ''}`} onClick={onRequest}>
            <div className="m2-tile__preview" aria-hidden="true">
              {t.k === 'trend' && tr.length > 1 && <svg viewBox="-4 0 208 60" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>}
              {t.k === 'region' && <div className="m2-mini-bars">{regionalRole.map(c => <i key={c.id} style={{ width: `${Math.min(100, (c.usd_day.median / 450) * 100)}%` }} />)}</div>}
              {t.k === 'grid' && <div className="m2-mini-grid">{Array.from({ length: 15 }, (_, i) => <i key={i} style={{ opacity: 0.25 + ((i * 37) % 60) / 100 }} />)}</div>}
              {t.k === 'prem' && <div className="m2-mini-prem"><span>+?</span><span>+?</span><span>+?</span></div>}
              {t.k === 'peer' && <div className="m2-mini-peer"><i /><i /><i /><i /></div>}
              {t.k === 'alert' && <div className="m2-mini-alert"><span>CSV</span><span>Alert</span></div>}
            </div>
            <span className={`m2-tile__tag${t.tag === 'Coming soon' ? ' is-soon' : ''}`}>{t.tag === 'Coming soon' ? t.tag : <><LockIcon /> {t.tag}</>}</span>
            <h3>{t.title}</h3>
            <p>{t.body}</p>
          </button>
        ))}
      </div>
    </section>
  )
}

/* ── modal + detail drawer ────────────────────────────────────────── */
function RequestModal({ buyer, onClose }) {
  const [sent, setSent] = useState(false)
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="m2-overlay" onClick={onClose}>
      <div className="m2-modal" role="dialog" aria-modal="true" aria-labelledby="m2-modal-h" onClick={e => e.stopPropagation()}>
        <button type="button" className="m2-modal__x" onClick={onClose} aria-label="Close">×</button>
        <p className="m2-eyebrow">Moblyze Market Rates · {EDITION}</p>
        <h2 id="m2-modal-h">Request the full edition</h2>
        {sent ? (
          <p className="m2-modal__done">Mock only. Nothing was sent or stored. In a live version this request would reach the Moblyze team and open a trial of the full edition.</p>
        ) : (
          <form onSubmit={e => { e.preventDefault(); setSent(true) }}>
            <p className="m2-modal__sub">Early access is limited to energy employers, crewing managers and recruiters. Tell us who you are and what you need to benchmark.</p>
            <label className="m2-field"><span>Company</span><input placeholder="Company name" /></label>
            <label className="m2-field"><span>Your role</span>
              <select defaultValue={buyer === 'employer' ? 'emp' : 'rec'}>
                <option value="emp">Employer or crewing manager</option>
                <option value="rec">Recruiter or staffing firm</option>
                <option value="hr">HR or rewards</option>
                <option value="oth">Other</option>
              </select>
            </label>
            <label className="m2-field"><span>Work email</span><input type="email" placeholder="name@company.com" /></label>
            <label className="m2-field"><span>Roles and regions you benchmark</span><input placeholder="e.g. ROV pilots, North Sea; electricians, Texas" /></label>
            <button type="submit" className="m2-btn m2-btn--primary m2-btn--block">Request access</button>
            <p className="m2-modal__fine">Internal preview. This form is a non-functional mock and submits nothing.</p>
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
  const st = cellStats(c, b.unit)
  const cur = Object.entries(c.currencies || {}).map(([k, v]) => `${k} ${v}`).join(', ')
  const types = Object.entries(c.employer_types || {}).map(([k, v]) => `${({ direct: 'direct employer', board: 'job board', crewing_agency: 'crewing agency', staffing: 'staffing agency' })[k] || k.replace('_', ' ')} ${v}`).join(', ')
  const rows = [
    ['Measure', 'Advertised pay in public job ads. Not verified, placed or employer-submitted pay.'],
    ['Cell', `${b.role_label} · ${REGION_NAME[b.region]} · ${sel.levelUsed === 'all' ? 'All levels' : `${LEVEL_NAME[sel.levelUsed]} (${LEVEL_YRS[sel.levelUsed]})`} · ${b.basis_label}`],
    ['Typical range', `${fmtRange(st.p25, st.p75, st.period)} (P25-P75), median ${fmtRate(st.median, st.period)}`],
    ['Ads used', `${c.n} after removing reposts (${c.n_raw} raw) and ${c.outliers_excluded} ${c.outliers_excluded === 1 ? 'outlier' : 'outliers'} beyond 3x MAD`],
    ['Employers', `${c.employers} distinct${types ? ` (${types})` : ''}`],
    ['Ads first seen', dateSpan(c.first_seen_min || b.first_seen_min, c.first_seen_max || b.first_seen_max)],
    ['Still open', `${Math.round((c.active_share ?? 0) * 100)}% of these ads are live today`],
    ['Currencies', `${cur || 'USD'}, converted at ECB reference rates of ${fmtDate(data.fx_date)}`],
    ['Confidence', `${conf}. High needs 50+ ads from 15+ employers, Medium 20+ from 6+, Limited 10+ from 3+. Below that a cell does not publish.`],
    ['Refreshed', `${fmtDate(c.last_updated || b.last_updated)} · extractor ${data.extractor_version}`],
  ]
  return (
    <div className="m2-overlay m2-overlay--side" onClick={onClose}>
      <aside className="m2-drawer" role="dialog" aria-modal="true" aria-labelledby="m2-drawer-h" onClick={e => e.stopPropagation()}>
        <button type="button" className="m2-modal__x" onClick={onClose} aria-label="Close">×</button>
        <p className="m2-eyebrow">Provenance</p>
        <h2 id="m2-drawer-h">How this number is built</h2>
        <dl className="m2-dl">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <p className="m2-drawer__fine">Only ads that state pay with an explicit period are counted (about 7% of scraped energy ads). Hourly-to-day conversions assume 10 hours on contract work and 8 on permanent work.</p>
      </aside>
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────────────── */
export default function MarketRatesV2Page() {
  const { data, error } = useMarketRates()
  const [buyer, setBuyer] = useState('employer')
  const [modal, setModal] = useState(false)
  const [detail, setDetail] = useState(null)
  return (
    <div className="m2">
      <SEO title="Moblyze Market Rates Q4 2026" description="Internal preview of a market pay benchmark built from advertised pay." />
      <div className="m2-wrap">
        <div className="m2-mast">
          <div className="m2-mast__brand">
            <span className="m2-mast__mark" aria-hidden="true" />
            <span className="m2-mast__name">Moblyze Market Rates</span>
            <span className="m2-mast__ed">{EDITION} edition</span>
          </div>
          <div className="m2-mast__right">
            <span className="m2-pill">Internal preview · Illustrative</span>
            <Link to="/market-rates/v1" className="m2-mast__v1">Compare with v1</Link>
          </div>
        </div>

        <div className="m2-buyers" role="tablist" aria-label="Who is this for">
          {[['employer', 'For employers and crewing managers', 'Are my rates competitive?'], ['recruiter', 'For recruiters', 'What rate can I defend?']].map(([k, who, q]) => (
            <button key={k} type="button" role="tab" aria-selected={buyer === k} className={`m2-buyer${buyer === k ? ' is-on' : ''}`} onClick={() => setBuyer(k)}>
              <span className="m2-buyer__who">{who}</span>
              <span className="m2-buyer__q">{q}</span>
            </button>
          ))}
        </div>

        {error && <p className="m2-empty">Could not load market data ({error}).</p>}
        {!data && !error && <p className="m2-empty">Loading the {EDITION} edition…</p>}
        {data && (
          <>
            <RateCheck data={data} buyer={buyer} onDetail={setDetail} />
            <FreeLayer data={data} onDetail={setDetail} />
            <GatedLayer data={data} onRequest={() => setModal(true)} />
            <footer className="m2-foot">
              <p><b>Advertised pay, not verified pay.</b> Built from {data.counts.observations_dedup.toLocaleString('en-US')} deduplicated public job ads that state pay with an explicit period, out of 129,335 energy and trades ads scraped Feb to Oct 2026. A number publishes only at 10+ ads from 3+ employers. Percentiles are estimated from each cell's P25, median and P75.</p>
              <p className="m2-foot__ed">Moblyze Market Rates · {EDITION} · Refreshed {fmtDate(data.generated_at.slice(0, 10))} · Internal preview, illustrative, not client-facing</p>
            </footer>
          </>
        )}
      </div>
      {modal && <RequestModal buyer={buyer} onClose={() => setModal(false)} />}
      {detail && data && <DetailDrawer data={data} sel={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}
