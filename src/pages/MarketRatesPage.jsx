// src/pages/MarketRatesPage.jsx
// "Market rates": the first client data-insights view, laid out as if it were
// a client product so leadership can picture it. Internal preview, illustrative.
// Reads /data/market_rates.json (pay_rates/site_bundle.py in moblyze-ops).
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SEO from '../components/SEO'
import RangeBar from '../components/market/RangeBar'
import Sparkline from '../components/market/Sparkline'
import RateBadge from '../components/market/RateBadge'
import { BAND_META, LEVELS, LEVEL_SHORT, cellStats, fmtDate, fmtMoney, niceMax, unitSuffix } from '../utils/marketRates'
import '../market-rates.css'

const DATA_URL = `${import.meta.env.BASE_URL || '/'}data/market_rates.json`
const BASIS_ORDER = ['contract_day', 'perm_timebased', 'salary_equiv', 'seafarer_month']
const PERIOD_OPTS = [['native', 'Native'], ['day', 'Day'], ['hour', 'Hour'], ['year', 'Year']]

function useMarketRates() {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  useEffect(() => {
    let cancelled = false
    fetch(DATA_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => { if (!cancelled) setState({ data, loading: false, error: null }) })
      .catch(err => { if (!cancelled) setState({ data: null, loading: false, error: err.message }) })
    return () => { cancelled = true }
  }, [])
  return state
}

function Stat({ v, l, txt }) {
  return <div className="mr-stat"><div className={`v num${txt ? ' txt' : ''}`}>{v}</div><div className="l">{l}</div></div>
}

function LevelRows({ cell, period, max, labels }) {
  const parent = cellStats(cell, period)
  return (
    <div className="mr-levels">
      {LEVELS.map(L => {
        const lc = cell.levels[L]
        const n = cell.level_n[L]
        if (!lc) {
          return (
            <div key={L} className="mr-level fallback">
              <div className="lv">{LEVEL_SHORT[L]}<small>{labels.levels[L]}</small></div>
              <div className="fb">{n === 0 ? 'No ads state this level.' : `${n} ad${n === 1 ? '' : 's'}: under the n=10 floor, so the role x region range applies.`}</div>
            </div>
          )
        }
        const s = cellStats(lc, period)
        return (
          <div key={L} className="mr-level">
            <div className="lv">{LEVEL_SHORT[L]}<small>{labels.levels[L]}</small></div>
            <RangeBar stats={s} max={max} ghost={parent} sub tip={<><br />{lc.n} ads, {lc.employers} employers<br />lighter band = all levels</>} />
            <div className="median num">{fmtMoney(s.median)}<span style={{ fontSize: 11, fontWeight: 500, color: 'var(--mr-ink-3)' }}>{unitSuffix(s.period)}</span></div>
            <div className="n num">n={lc.n}</div>
          </div>
        )
      })}
      {cell.level_n.unspecified > 0 && (
        <div className="mr-prov" style={{ fontSize: 11.5, marginTop: 2 }}>{cell.level_n.unspecified} of {cell.n_dedup} ads give no years or seniority word and count only in the all-levels range.</div>
      )}
    </div>
  )
}

function RateRow({ cell, period, max, open, onToggle, labels, levelFilter }) {
  const s = cellStats(cell, period)
  const types = Object.entries(cell.employer_types || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ')
  const shownLevel = levelFilter !== 'all' && cell.levels[levelFilter] ? cell.levels[levelFilter] : null
  const sh = shownLevel ? cellStats(shownLevel, period) : s
  return (
    <article className={`mr-row${open ? ' open' : ''}`}>
      <button className="head" onClick={onToggle} aria-expanded={open}>
        <div className="who">
          <div className="role">{cell.role_label}</div>
          <div className="meta">
            <span>{cell.region_label}</span>
            {shownLevel && <span className="mr-pill level">{LEVEL_SHORT[levelFilter]} level</span>}
            {!shownLevel && levelFilter !== 'all' && <span className="mr-pill" title={`${cell.level_n[levelFilter]} ads at this level, under the n=10 floor`}>all levels (n={cell.level_n[levelFilter]} at {LEVEL_SHORT[levelFilter].toLowerCase()})</span>}
            {sh.converted && <span className="mr-pill conv" title={`Native unit is per ${cell.unit}; converted at ${cell.hours_per_day || 10}h/day, 260 days/yr`}>from /{cell.unit}</span>}
          </div>
        </div>
        <RangeBar stats={sh} max={max} ghost={shownLevel ? s : null}
          tip={<><br />{shownLevel ? shownLevel.n : cell.n} ads, {shownLevel ? shownLevel.employers : cell.employers} employers<br />seen {fmtDate(cell.first_seen_min)} to {fmtDate(cell.first_seen_max)}</>} />
        <div className="median">
          <div className="v num">{fmtMoney(sh.median)}</div>
          <div className="u">median{unitSuffix(sh.period)}</div>
        </div>
        <div className="n">
          <div><b className="num">n={shownLevel ? shownLevel.n : cell.n}</b> · {shownLevel ? shownLevel.employers : cell.employers} employers</div>
          <div className="upd">updated {fmtDate(cell.last_updated)}</div>
        </div>
      </button>
      {open && (
        <div className="mr-detail">
          <div>
            <h3>By experience level</h3>
            <LevelRows cell={cell} period={period} max={max} labels={labels} />
            {cell.trend && (
              <div style={{ marginTop: 14 }}>
                <h3>Monthly median, {cell.trend.length} months with 5+ ads</h3>
                <Sparkline trend={cell.trend} cell={cell} period={s.period} />
              </div>
            )}
          </div>
          <div className="mr-prov">
            <h3>Behind this number</h3>
            <dl>
              <dt>Basis</dt><dd>{cell.basis_label}{cell.hours_per_day ? `, ${cell.hours_per_day}h day` : ''}</dd>
              <dt>Ads used</dt><dd className="num">{cell.n} of {cell.n_dedup} deduped ({cell.outliers_excluded} outliers out), {cell.n_raw} raw</dd>
              <dt>Employers</dt><dd className="num">{cell.employers} distinct: {types}</dd>
              <dt>Still live</dt><dd className="num">{Math.round(cell.active_share * 100)}% of ads</dd>
              <dt>Seen</dt><dd>{fmtDate(cell.first_seen_min)} to {fmtDate(cell.first_seen_max)}</dd>
              <dt>Currencies</dt><dd className="num">{Object.entries(cell.currencies).map(([k, v]) => `${k} ${v}`).join(', ')}</dd>
            </dl>
          </div>
        </div>
      )}
    </article>
  )
}

function SampleCard({ s, cells }) {
  const cell = cells.find(c => c.id === s.cell_id)
  const m = BAND_META[s.band]
  const u = s.ad_display.unit
  const ad = s.ad_display.min === s.ad_display.max ? fmtMoney(s.ad_display.min) : `${fmtMoney(s.ad_display.min)} to ${fmtMoney(s.ad_display.max)}`
  // mini position bar: 0 .. 1.6 x p75
  const scaleMax = cell ? cell.usd_day.range_hi * 1.6 : 1
  const pct = (v) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`
  const mid = (s.usd_day.min + s.usd_day.max) / 2
  return (
    <div className="mr-card">
      <div className="t">{s.title}</div>
      <div className="sub"><span className="co">{s.employer}</span><span>{s.location || s.region_label}</span></div>
      <div className="pay">
        <div className="v num">{ad}<small>{unitSuffix(u)}</small></div>
        <RateBadge band={s.band} title={`${m.label}: ad midpoint vs the ${s.role_label} ${s.region_label} typical range ${s.market.typical_range}`} />
      </div>
      {cell && (
        <div className="minibar" aria-hidden="true">
          <div className="b" style={{ left: pct(cell.usd_day.range_lo), width: `calc(${pct(cell.usd_day.range_hi)} - ${pct(cell.usd_day.range_lo)})` }} />
          <div className={`m ${m.tone}`} style={{ left: pct(mid) }} />
        </div>
      )}
      <div className="mkt">Market: <b>{s.market.typical_range}</b> typical, median {s.market.median_display}, {s.market.n} ads · {s.role_label}, {s.region_label}{s.experience_level ? `, ${LEVEL_SHORT[s.experience_level].toLowerCase()} level` : ''}</div>
    </div>
  )
}

export default function MarketRatesPage() {
  const { data, loading, error } = useMarketRates()
  // deep-linkable state: /market-rates?q=electrician&region=US&level=mid&period=day&open=electrician|US|contract_day
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [region, setRegion] = useState(params.get('region') || 'all')
  const [level, setLevel] = useState(LEVELS.includes(params.get('level')) ? params.get('level') : 'all')
  const [basis, setBasis] = useState(BASIS_ORDER.includes(params.get('basis')) ? params.get('basis') : 'all')
  const [period, setPeriod] = useState(PERIOD_OPTS.some(([k]) => k === params.get('period')) ? params.get('period') : 'native')
  const [open, setOpen] = useState(params.get('open') || null)
  useEffect(() => {
    const next = new URLSearchParams()
    if (q) next.set('q', q)
    if (region !== 'all') next.set('region', region)
    if (level !== 'all') next.set('level', level)
    if (basis !== 'all') next.set('basis', basis)
    if (period !== 'native') next.set('period', period)
    if (open) next.set('open', open)
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [q, region, level, basis, period, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    return data.cells.filter(c => {
      if (region !== 'all' && c.region !== region) return false
      if (basis !== 'all' && c.basis !== basis) return false
      if (needle && !(c.role_label.toLowerCase().includes(needle) || c.role.includes(needle) || c.region_label.toLowerCase().includes(needle))) return false
      return true
    })
  }, [data, q, region, basis])

  // sections by basis, each with its own shared scale (same unit inside a section)
  const sections = useMemo(() => {
    const out = []
    for (const b of BASIS_ORDER) {
      const rows = filtered.filter(c => c.basis === b)
      if (!rows.length) continue
      const p = period === 'native' ? rows[0].unit : period
      const top = Math.max(...rows.map(c => {
        const lc = level !== 'all' && c.levels[level] ? c.levels[level] : c
        return cellStats(lc, p).p75Raw
      }))
      out.push({ basis: b, label: data.labels.bases[b], rows, period: p, max: niceMax(top * 1.08) })
    }
    return out
  }, [filtered, period, level, data])

  const totalEmployers = useMemo(() => data ? data.cells.reduce((a, c) => a + c.employers, 0) : 0, [data])

  return (
    <div className="mr">
      <SEO title="Market rates - Moblyze Jobs" description="Internal preview of market pay rates by role, region and experience level" />
      <div className="mr-preview"><span className="tag">Internal preview</span> Illustrative client-product mock. Numbers come from public job ads, not placements; nothing here is client-facing yet.</div>

      <header className="mr-hero">
        <div>
          <h1>What the market is <em>paying</em> right now</h1>
          <p>Typical pay by role, region and experience level, built from {data ? data.counts.rows_in.toLocaleString('en-US') : '…'} pay mentions across energy and marine job ads. Ranges are the middle half of the market (p25 to p75); the tick is the median.</p>
        </div>
        {data && (
          <div className="mr-stats">
            <Stat v={data.counts.cells_published} l="role x region cells" />
            <Stat v={data.counts.level_cells_published} l="with experience levels" />
            <Stat v={data.counts.observations_dedup.toLocaleString('en-US')} l="ads with explicit pay" />
            <Stat v={fmtDate(data.cells[0]?.last_updated)} l="last updated" txt />
          </div>
        )}
      </header>

      {data && (
        <div className="mr-filters">
          <div className="row">
            <label className="mr-search">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="m14 14 4 4" strokeLinecap="round" /></svg>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a role (electrician, ROV, inspector…)" aria-label="Search roles" />
            </label>
            <select className="mr-select" value={region} onChange={e => setRegion(e.target.value)} aria-label="Region">
              <option value="all">All regions</option>
              {data.regions.map(r => <option key={r} value={r}>{data.cells.find(c => c.region === r)?.region_label || r}</option>)}
            </select>
            <div className="mr-seg" role="group" aria-label="Experience level">
              <span className="lbl">Level</span>
              {[['all', 'All'], ...LEVELS.map(L => [L, LEVEL_SHORT[L]])].map(([k, l]) => (
                <button key={k} aria-pressed={level === k} onClick={() => setLevel(k)} title={k === 'all' ? 'All experience levels' : data.labels.levels[k]}>{l}</button>
              ))}
            </div>
            <div className="mr-seg" role="group" aria-label="Pay period">
              <span className="lbl">Show</span>
              {PERIOD_OPTS.map(([k, l]) => <button key={k} aria-pressed={period === k} onClick={() => setPeriod(k)}>{l}</button>)}
            </div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <div className="mr-chips" role="group" aria-label="Pay basis">
              <button className="mr-chip" aria-pressed={basis === 'all'} onClick={() => setBasis('all')}>All bases</button>
              {BASIS_ORDER.map(b => <button key={b} className="mr-chip" aria-pressed={basis === b} onClick={() => setBasis(b)}>{data.labels.bases[b]}</button>)}
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--mr-ink-3)' }}>{filtered.length} of {data.cells.length} cells</span>
          </div>
        </div>
      )}

      {loading && <div className="mr-empty">Loading market rates…</div>}
      {error && <div className="mr-empty">Could not load market rates: {error}</div>}
      {data && !filtered.length && <div className="mr-empty">No published cell matches. Cells need 10+ deduped ads from 3+ employers.</div>}

      {sections.map(sec => (
        <section key={sec.basis} className="mr-section">
          <div className="mr-section-head">
            <h2>{sec.label}</h2>
            <span className="sub">{sec.rows.length} cell{sec.rows.length === 1 ? '' : 's'} · USD{unitSuffix(sec.period)}{sec.period !== sec.rows[0].unit ? ` (converted from /${sec.rows[0].unit})` : ''}</span>
          </div>
          <div className="mr-axis">
            <span>Role · region</span>
            <span className="ticks"><span>$0</span><span>{fmtMoney(sec.max / 2, { compact: true })}</span><span>{fmtMoney(sec.max, { compact: true })}{unitSuffix(sec.period)}</span></span>
            <span style={{ textAlign: 'right' }}>Median</span>
            <span>Sample</span>
          </div>
          <div className="mr-list">
            {sec.rows.map(c => (
              <RateRow key={c.id} cell={c} period={sec.period} max={sec.max} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} labels={data.labels} levelFilter={level} />
            ))}
          </div>
        </section>
      ))}

      {data && (
        <div className="mr-legend">
          <span><span className="sw" />Typical range, p25 to p75</span>
          <span><span className="sw tick" />Median</span>
          <span><span className="sw ghost" />All-levels range behind a level</span>
          <span>Click a row for levels, trend and provenance</span>
        </div>
      )}

      {data && data.samples.length > 0 && (
        <section className="mr-section">
          <div className="mr-section-head">
            <h2>On a job card: rate vs market</h2>
            <span className="sub">Real ads, banded against their role x region range</span>
          </div>
          <div className="mr-cards">
            {data.samples.slice(0, 6).map(s => <SampleCard key={s.source_url} s={s} cells={data.cells} />)}
          </div>
          <div className="mr-legend">
            {Object.entries(BAND_META).map(([k, m]) => <span key={k}><RateBadge band={k} /></span>)}
            <span>In range inside p25 to p75; near within 10% outside an end; above or below beyond that. Ads with their own range are banded on the midpoint.</span>
          </div>
        </section>
      )}

      {data && (
        <footer className="mr-foot">
          <h2>Source and method</h2>
          <p style={{ margin: 0 }}>
            Scraped public job ads (direct career sites, job boards, crewing agencies), extractor {data.extractor_version}, FX at ECB reference rates of {fmtDate(data.fx_date)}. One observation per employer, role, title and stated pay (reposts collapse). Only ads with an explicit pay period count (grade A/B); cells publish at {data.rules.min_n}+ deduped ads from {data.rules.min_employers}+ employers, with 3xMAD outliers excluded. Hourly ads convert at {data.rules.assumptions.contract_hours_per_day}h/day on contract work and {data.rules.assumptions.perm_hours_per_day}h/day on permanent work; {data.rules.assumptions.days_per_year} days a year.
          </p>
          <ul>
            <li><b>Experience level:</b> {data.rules.experience_level}. Of {data.counts.observations_dedup.toLocaleString('en-US')} ads with pay, {data.counts.experience_source_of_observations.years.toLocaleString('en-US')} state years, {data.counts.experience_source_of_observations.title.toLocaleString('en-US')} carry a title word, {data.counts.experience_level_of_observations.unspecified.toLocaleString('en-US')} give neither. {data.rules.level_fallback}.</li>
            <li><b>Trend:</b> {data.rules.trend}.</li>
            <li><b>Caveats:</b> ads, not placements; ranges with "up to" overstate and permanent salaries exclude benefits. Marine cells are crewing-agency monthly wages. Not for client use until source terms are settled.</li>
          </ul>
        </footer>
      )}
    </div>
  )
}
