// src/pages/MarketRatesPage.jsx
// "Market rates": the first client data-insights view, laid out as if it were
// a paid client product so leadership can picture it. Internal preview, illustrative.
// Reads /data/market_rates.json (pay_rates/site_bundle.py in moblyze-ops).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SEO from '../components/SEO'
import RangeBar from '../components/market/RangeBar'
import Sparkline from '../components/market/Sparkline'
import RateBadge from '../components/market/RateBadge'
import { BAND_META, LEVELS, LEVEL_SHORT, cellStats, setActiveCurrency, fmtAmount, fmtDate, fmtRange, fmtRate, fromDay, niceDomain, niceMax } from '../utils/marketRates'
import '../market-rates.css'

const DATA_URL = `${import.meta.env.BASE_URL || '/'}data/market_rates.json`
const BASIS_ORDER = ['contract_day', 'perm_timebased', 'salary_equiv', 'seafarer_month']
const BASIS_SHORT = { contract_day: 'Contract day rate', perm_timebased: 'Hourly', salary_equiv: 'Annual salary', seafarer_month: 'Seafarer monthly' }
const PERIOD_OPTS = [['native', 'As posted'], ['day', 'Day'], ['hour', 'Hour'], ['month', 'Month'], ['year', 'Year']]
const REGION_ORDER = ['US', 'UK', 'Europe (other)', 'Middle East', 'Unknown/Worldwide']
const REGION_SHORT = { US: 'US', UK: 'UK', 'Europe (other)': 'Europe', 'Middle East': 'Middle East', 'Unknown/Worldwide': 'Worldwide' }
const LADDER_ROLES = ['rov-pilot-technician', 'substation-technician', 'hvac-technician', 'electrician', 'inspector', 'mechanical-technician']
const CARD_PICKS = ['below_market', 'in_range', 'above_market']

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

const pOf = (period, cell) => (period === 'native' ? cell.unit : period)
const isOther = (label) => /\(other\)/.test(label)

function Segmented({ options, value, onChange, label, size }) {
  return (
    <div className={`mr-seg${size ? ` mr-seg--${size}` : ''}`} role="group" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  )
}

function InfoIcon() {
  return <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10 9v5M10 6.2v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
}

function Axis({ max, min = 0, period, ticks = 4 }) {
  return (
    <div className="mr-axis" aria-hidden="true">
      {Array.from({ length: ticks + 1 }, (_, i) => (
        <span key={i} style={{ left: `${(i / ticks) * 100}%` }}>{fmtAmount(min + ((max - min) * i) / ticks, period)}</span>
      ))}
    </div>
  )
}

/* ── hero ─────────────────────────────────────────────────────────── */
function Hero({ data, onMethod, onExplore }) {
  const ladder = LADDER_ROLES.map(r => data.cells.find(c => c.role === r && c.basis === 'contract_day' && (c.region === 'US' || c.region === 'UK'))).filter(Boolean)
  const ld = niceDomain(Math.min(...ladder.map(c => c.usd_day.range_lo)), Math.max(...ladder.map(c => c.usd_day.range_hi)))
  const top = [...data.cells].filter(c => c.basis === 'contract_day').sort((a, b) => b.usd_day.median - a.usd_day.median)[0]
  const firstSeen = data.cells.map(c => c.first_seen_min).sort()[0]
  return (
    <header className="mr-hero">
      <div className="mr-hero__grid">
        <div className="mr-hero__copy">
          <div className="mr-hero__tags">
            <span className="mr-brandmark"><span className="dot" />Moblyze Market Intelligence</span>
            <span className="mr-preview-pill" title="Not client-facing. Illustrative market pay data.">Beta</span>
          </div>
          <h1>Market day rates for <em>offshore and energy</em> roles</h1>
          <p>Typical pay by role, region and experience level, benchmarked from {data.counts.observations_dedup.toLocaleString('en-US')} jobs that state their rate. Ranges show the middle half of the market; the marker is the median.</p>
          <div className="mr-hero__cta">
            <button type="button" className="mr-btn mr-btn--primary" onClick={onExplore}>Explore benchmarks</button>
            <button type="button" className="mr-btn mr-btn--ghost" onClick={onMethod}><InfoIcon />Methodology</button>
          </div>
        </div>
        <div className="mr-hero__panel" aria-label="Contract day rate preview">
          <div className="mr-hero__panelhead">
            <span>Contract day rates</span>
            <span className="muted">Typical range · median</span>
          </div>
          <div className="mr-ladder">
            {ladder.map(c => {
              const s = cellStats(c, 'day')
              const pct = v => `${((v - ld.min) / (ld.max - ld.min)) * 100}%`
              return (
                <div key={c.id} className="mr-ladder__row">
                  <div className="mr-ladder__name">{c.role_label}<span>{REGION_SHORT[c.region]}</span></div>
                  <div className="mr-ladder__track">
                    <div className="mr-ladder__band" style={{ left: pct(s.p25Raw), width: `calc(${pct(s.p75Raw)} - ${pct(s.p25Raw)})` }} />
                    <div className="mr-ladder__med" style={{ left: pct(s.medianRaw) }} />
                  </div>
                  <div className="mr-ladder__val num">{fmtRate(s.median, 'day')}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="mr-kpis">
        <div className="mr-kpi">
          <div className="mr-kpi__l">Jobs with a stated rate</div>
          <div className="mr-kpi__v num">{data.counts.observations_dedup.toLocaleString('en-US')}</div>
          <div className="mr-kpi__s">deduped from {data.counts.rows_in.toLocaleString('en-US')} pay mentions</div>
        </div>
        <div className="mr-kpi">
          <div className="mr-kpi__l">Role and region benchmarks</div>
          <div className="mr-kpi__v num">{data.counts.cells_published}</div>
          <div className="mr-kpi__s">{data.counts.level_cells_published} split by experience level</div>
        </div>
        <div className="mr-kpi">
          <div className="mr-kpi__l">Highest contract median</div>
          <div className="mr-kpi__v num">{fmtRate(top.usd_day.median, 'day')}</div>
          <div className="mr-kpi__s">{top.role_label}, {REGION_SHORT[top.region]}</div>
        </div>
        <div className="mr-kpi">
          <div className="mr-kpi__l">Last updated</div>
          <div className="mr-kpi__v mr-kpi__v--date">{fmtDate(data.cells[0]?.last_updated)}</div>
          <div className="mr-kpi__s">jobs first seen since {fmtDate(firstSeen)}</div>
        </div>
      </div>
    </header>
  )
}

/* ── benchmark card ───────────────────────────────────────────────── */
function LevelRow({ L, cell, period, max, min, labels }) {
  const lc = cell.levels?.[L]
  const n = cell.level_n?.[L] ?? 0
  return (
    <div className={`mr-lvl${lc ? '' : ' mr-lvl--empty'}`}>
      <div className="mr-lvl__name">{LEVEL_SHORT[L]}<small>{labels.levels[L]}</small></div>
      {lc ? (
        <>
          <RangeBar stats={cellStats(lc, period)} max={max} min={min} ghost={cellStats(cell, period)} size="sm"
            label={`${LEVEL_SHORT[L]} level, ${labels.levels[L]}`} meta={`${lc.n} jobs · ${lc.employers} employers`} />
          <div className="mr-lvl__val num">{fmtRate(cellStats(lc, period).median, period)}</div>
        </>
      ) : (
        <>
          <div className="mr-lvl__na">{n === 0 ? 'No jobs state this level yet' : `${n} job${n === 1 ? '' : 's'} so far, publishes at 10`}</div>
          <div className="mr-lvl__val muted">–</div>
        </>
      )}
    </div>
  )
}

function Benchmark({ data, cell, roleCells, region, setRegion, basis, setBasis, period, onInfo }) {
  const p = pOf(period, cell)
  const s = cellStats(cell, p)
  const lv = LEVELS.map(L => cell.levels?.[L]).filter(Boolean).map(l => cellStats(l, p))
  const dom = niceDomain(Math.min(s.p25Raw, ...lv.map(x => x.p25Raw)), Math.max(s.p75Raw, ...lv.map(x => x.p75Raw)))
  const max = dom.max, min = dom.min
  const regions = REGION_ORDER.filter(r => roleCells.some(c => c.region === r))
  const bases = BASIS_ORDER.filter(b => roleCells.some(c => c.region === region && c.basis === b))
  const converted = p !== cell.unit
  return (
    <article className="mr-bench">
      <div className="mr-bench__head">
        <div className="mr-bench__title">
          <div className="mr-eyebrow">{cell.basis_label}{converted ? ` · shown per ${p}, posted per ${cell.unit}` : ''}</div>
          <h3>{cell.role_label}</h3>
          <div className="mr-bench__controls">
            <Segmented label="Region" options={regions.map(r => [r, REGION_SHORT[r]])} value={region} onChange={setRegion} size="sm" />
            {bases.length > 1 && <Segmented label="Pay type" options={bases.map(b => [b, BASIS_SHORT[b]])} value={basis} onChange={setBasis} size="sm" />}
          </div>
        </div>
        <div className="mr-bench__headline">
          <div className="mr-eyebrow">Median</div>
          <div className="mr-bench__median num">{fmtAmount(s.median, p)}<span>{({ day: '/day', hour: '/hr', month: '/mo', year: '/yr' })[p]}</span></div>
          <div className="mr-bench__typ">Typical <b className="num">{fmtRange(s.p25, s.p75, p)}</b></div>
        </div>
      </div>

      <div className="mr-bench__body">
        <div className="mr-bench__chart">
          <div className="mr-bench__all">
            <div className="mr-lvl__name">All levels<small>{cell.n} jobs</small></div>
            <RangeBar stats={s} max={max} min={min} size="lg" showMedian label={`${cell.role_label}, ${cell.region_label}`} meta={`${cell.n} jobs · ${cell.employers} employers`} />
            <div />
          </div>
          <div className="mr-bench__axisrow"><div /><Axis max={max} min={min} ticks={dom.ticks} period={p} /><div /></div>
          <div className="mr-bench__sub">
            <span className="mr-eyebrow">By experience</span>
            <span className="mr-legend"><i className="sw band" />Typical (p25 to p75)<i className="sw med" />Median<i className="sw ghost" />All levels</span>
          </div>
          {LEVELS.map(L => <LevelRow key={L} L={L} cell={cell} period={p} max={max} min={min} labels={data.labels} />)}
          <Insight cell={cell} s={s} p={p} data={data} />
        </div>

        <aside className="mr-bench__side">
          <Sparkline trend={cell.trend} cell={cell} period={p} full />
          <dl className="mr-facts">
            <div><dt>Sample</dt><dd className="num">{cell.n} jobs</dd></div>
            <div><dt>Employers</dt><dd className="num">{cell.employers}</dd></div>
            <div><dt>Still live</dt><dd className="num">{Math.round(cell.active_share * 100)}%</dd></div>
            <div><dt>Seen</dt><dd>{fmtDate(cell.first_seen_min).replace(/, \d{4}$/, '')} to {fmtDate(cell.first_seen_max).replace(/, \d{4}$/, '')}</dd></div>
          </dl>
          <button type="button" className="mr-linkbtn" onClick={onInfo}><InfoIcon />How this benchmark is built</button>
        </aside>
      </div>
    </article>
  )
}

function Insight({ cell, s, p, data }) {
  const lvl = LEVELS.filter(L => cell.levels?.[L]).map(L => ({ L, st: cellStats(cell.levels[L], p) }))
  let text
  if (lvl.length >= 2) {
    const a = lvl[0], b = lvl[lvl.length - 1]
    const d = b.st.medianRaw - a.st.medianRaw
    text = <>{LEVEL_SHORT[b.L]}-level jobs ({data.labels.levels[b.L]}) pay a median <b>{fmtRate(Math.abs(d), p)} {d >= 0 ? 'more' : 'less'}</b> than {LEVEL_SHORT[a.L].toLowerCase()}-level jobs ({d >= 0 ? '+' : '-'}{Math.round(Math.abs(d) / a.st.medianRaw * 100)}%).</>
  } else {
    const spread = s.p75Raw - s.p25Raw
    text = <>The middle half of the market spans <b>{fmtRate(spread, p)}</b>, about {Math.round(spread / s.medianRaw * 100)}% of the median. Experience splits publish as more jobs state years.</>
  }
  return <div className="mr-insight"><span className="mr-insight__k">Insight</span><p>{text}</p></div>
}

/* ── role picker ──────────────────────────────────────────────────── */
function RolePicker({ roles, role, setRole }) {
  const [q, setQ] = useState('')
  const shown = roles.filter(r => r.label.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="mr-picker">
      <label className="mr-search">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="9" cy="9" r="6" /><path d="m14 14 4 4" strokeLinecap="round" /></svg>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a role" aria-label="Find a role" />
      </label>
      <ul className="mr-picker__list" role="listbox" aria-label="Roles">
        {shown.map(r => (
          <li key={r.role}>
            <button type="button" role="option" aria-selected={r.role === role} onClick={() => setRole(r.role)}>
              <span>{r.label}</span><span className="num">{r.n.toLocaleString('en-US')}</span>
            </button>
          </li>
        ))}
        {!shown.length && <li className="mr-picker__none">No role matches</li>}
      </ul>
      <select className="mr-picker__select" value={role} onChange={e => setRole(e.target.value)} aria-label="Role">
        {roles.map(r => <option key={r.role} value={r.role}>{r.label}</option>)}
      </select>
    </div>
  )
}

/* ── comparison table ─────────────────────────────────────────────── */
function CompareTable({ data, region, setRegion, basis, setBasis, period, selectedId, onPick }) {
  const [all, setAll] = useState(false)
  const rows = data.cells.filter(c => c.region === region && c.basis === basis).sort((a, b) => b.usd_day.median - a.usd_day.median)
  const p = rows.length ? pOf(period, rows[0]) : 'day'
  const dom = rows.length ? niceDomain(Math.min(...rows.map(c => cellStats(c, p).p25Raw)), Math.max(...rows.map(c => cellStats(c, p).p75Raw)), 8) : { min: 0, max: 1, ticks: 4 }
  const max = dom.max
  const regions = REGION_ORDER.filter(r => data.cells.some(c => c.region === r && c.basis === basis))
  const bases = BASIS_ORDER.filter(b => data.cells.some(c => c.region === region && c.basis === b))
  const shown = all ? rows : rows.slice(0, 10)
  return (
    <section className="mr-section" id="compare">
      <div className="mr-section__head">
        <div>
          <div className="mr-eyebrow">Compare</div>
          <h2>{REGION_SHORT[region]} {BASIS_SHORT[basis].toLowerCase()}s, side by side</h2>
        </div>
        <div className="mr-section__tools">
          <Segmented label="Region" options={regions.map(r => [r, REGION_SHORT[r]])} value={region} onChange={setRegion} size="sm" />
          <Segmented label="Pay type" options={bases.map(b => [b, BASIS_SHORT[b]])} value={basis} onChange={setBasis} size="sm" />
        </div>
      </div>
      <div className="mr-table" role="table" aria-label="Role comparison">
        <div className="mr-tr mr-tr--head" role="row">
          <span role="columnheader">Role</span>
          <span role="columnheader" className="mr-col-range">Typical range</span>
          <span role="columnheader" className="r">Median</span>
          <span role="columnheader" className="r mr-col-lvl">Low</span>
          <span role="columnheader" className="r mr-col-lvl">Mid</span>
          <span role="columnheader" className="r mr-col-lvl">High</span>
          <span role="columnheader" className="mr-col-trend">Trend</span>
          <span role="columnheader" className="r mr-col-n">Jobs</span>
        </div>
        {shown.map(c => {
          const s = cellStats(c, p)
          return (
            <button type="button" key={c.id} className={`mr-tr${c.id === selectedId ? ' on' : ''}`} role="row" onClick={() => onPick(c)}>
              <span className="mr-td-role" role="cell">{c.role_label}<small className="num">{fmtRange(s.p25, s.p75, p)}</small></span>
              <span className="mr-col-range" role="cell">
                <RangeBar stats={s} max={max} min={dom.min} size="xs" label={c.role_label} meta={`${c.n} jobs · ${c.employers} employers`} />
              </span>
              <span className="r num mr-td-med" role="cell">{fmtRate(s.median, p)}</span>
              {LEVELS.map(L => (
                <span key={L} className="r num mr-col-lvl" role="cell">{c.levels?.[L] ? fmtAmount(cellStats(c.levels[L], p).median, p) : <span className="muted">–</span>}</span>
              ))}
              <span className="mr-col-trend" role="cell"><Sparkline trend={c.trend} cell={c} period={p} /></span>
              <span className="r num mr-col-n" role="cell">{c.n}</span>
            </button>
          )
        })}
        <div className="mr-axisrow mr-table__axis"><span /><span className="mr-col-range"><Axis max={max} min={dom.min} ticks={dom.ticks} period={p} /></span></div>
      </div>
      {rows.length > 10 && (
        <button type="button" className="mr-more" onClick={() => setAll(!all)}>{all ? 'Show top 10' : `Show all ${rows.length} roles`}</button>
      )}
    </section>
  )
}

/* ── job cards ────────────────────────────────────────────────────── */
function JobCard({ s, cell }) {
  const u = s.ad_display.unit
  const m = BAND_META[s.band]
  const jd = niceDomain(Math.min(cell.usd_day.range_lo, s.usd_day.min) * 0.9, Math.max(cell.usd_day.range_hi, s.usd_day.max) * 1.1)
  const pct = (v) => `${Math.max(0, Math.min(100, ((v - jd.min) / (jd.max - jd.min)) * 100))}%`
  const conv = (v) => fromDay(v, u, cell)
  const marketLo = conv(cell.usd_day.range_lo), marketHi = conv(cell.usd_day.range_hi), marketMed = conv(cell.usd_day.median)
  const initials = s.employer.split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const diff = ((s.usd_day.min + s.usd_day.max) / 2 - cell.usd_day.median) / cell.usd_day.median
  return (
    <article className="mr-job">
      <div className="mr-job__top">
        <span className="mr-job__logo" aria-hidden="true">{initials}</span>
        <div>
          <h4>{s.title.replace(/\s+/g, ' ')}</h4>
          <div className="mr-job__co">{s.employer} · {s.location?.replace(/, (United States|US)$/, '')}</div>
        </div>
      </div>
      <div className="mr-job__pay">
        <div>
          <div className="mr-eyebrow">Posted rate</div>
          <div className="mr-job__rate num">{fmtRange(s.ad_display.min, s.ad_display.max, u)}</div>
        </div>
        <RateBadge band={s.band} title={`${m.label}: job midpoint vs the ${s.role_label}, ${s.region_label} typical range`} />
      </div>
      <div className="mr-job__gauge" aria-hidden="true">
        <div className="mr-job__track" />
        <div className="mr-job__mkt" style={{ left: pct(cell.usd_day.range_lo), width: `calc(${pct(cell.usd_day.range_hi)} - ${pct(cell.usd_day.range_lo)})` }} />
        <div className="mr-job__mmed" style={{ left: pct(cell.usd_day.median) }} />
        <div className={`mr-job__ad mr-job__ad--${m.tone}`} style={{ left: pct(s.usd_day.min), width: `calc(${pct(s.usd_day.max)} - ${pct(s.usd_day.min)} + 2px)` }} />
      </div>
      <div className="mr-job__legend"><span><i className="sw band" />Market {fmtRange(marketLo, marketHi, u)}</span><span><i className={`sw ad ${m.tone}`} />This job</span></div>
      <div className="mr-job__foot">
        {Math.abs(diff) < 0.03
          ? <span className="mr-job__diff num">At the market median</span>
          : <span className={`mr-job__diff ${diff >= 0 ? 'up' : 'down'} num`}>{diff >= 0 ? '+' : ''}{Math.round(diff * 100)}% vs median</span>}
        <span>{fmtRate(marketMed, u)} median · {cell.n} jobs</span>
      </div>
    </article>
  )
}

/* ── info drawer ──────────────────────────────────────────────────── */
function Drawer({ data, cell, onClose }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const a = data.rules.assumptions
  const types = cell ? Object.entries(cell.employer_types || {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ') : ''
  return (
    <div className="mr-drawer" role="dialog" aria-modal="true" aria-label="About this data">
      <div className="mr-drawer__scrim" onClick={onClose} />
      <div className="mr-drawer__panel">
        <div className="mr-drawer__head">
          <div>
            <div className="mr-eyebrow">About this data</div>
            <h3>{cell ? `${cell.role_label}, ${cell.region_label}` : 'Methodology'}</h3>
          </div>
          <button type="button" className="mr-drawer__x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="mr-drawer__body">
          <div className="mr-drawer__note">Internal preview. Illustrative only. Not client-facing until source terms are settled.</div>
          {cell && (
            <section>
              <h4>This benchmark</h4>
              <dl className="mr-dl">
                <dt>Pay basis</dt><dd>{cell.basis_label}{cell.hours_per_day ? `, ${cell.hours_per_day}h day` : ''}</dd>
                <dt>Jobs used</dt><dd className="num">{cell.n} of {cell.n_dedup} deduped ({cell.outliers_excluded} outliers removed), {cell.n_raw} raw</dd>
                <dt>Employers</dt><dd className="num">{cell.employers}: {types}</dd>
                <dt>Currencies</dt><dd className="num">{Object.entries(cell.currencies).map(([k, v]) => `${k} ${v}`).join(', ')}</dd>
                <dt>Seen</dt><dd>{fmtDate(cell.first_seen_min)} to {fmtDate(cell.first_seen_max)}</dd>
                <dt>Unleveled</dt><dd className="num">{cell.level_n?.unspecified ?? 0} jobs give no years or seniority and count only in all levels</dd>
              </dl>
            </section>
          )}
          <section>
            <h4>Coverage</h4>
            <dl className="mr-dl">
              <dt>Last updated</dt><dd>{fmtDate(data.cells[0]?.last_updated)}</dd>
              <dt>Pay mentions</dt><dd className="num">{data.counts.rows_in.toLocaleString('en-US')} scanned</dd>
              <dt>Jobs with pay</dt><dd className="num">{data.counts.observations_dedup.toLocaleString('en-US')} after dedup</dd>
              <dt>Benchmarks</dt><dd className="num">{data.counts.cells_published} published, {data.counts.level_cells_published} by level</dd>
            </dl>
          </section>
          <section>
            <h4>How ranges are built</h4>
            <p>One observation per employer, role, title and stated pay, so reposts collapse. Only jobs with an explicit pay period count. A benchmark publishes at {data.rules.min_n}+ jobs from {data.rules.min_employers}+ employers. The typical range is p25 to p75 with outliers beyond 3x MAD removed; ends are rounded.</p>
          </section>
          <section>
            <h4>Experience levels</h4>
            <p>Low is under 5 years, mid 5 to 9, high 10+, from years stated in the job, else seniority words in the title (trainee, junior: low; senior, lead, chief, superintendent: high). A level shows at 10+ jobs.</p>
          </section>
          <section>
            <h4>Rate vs market</h4>
            <p>In range inside p25 to p75; slightly above or below within 10% outside an end; above or below market beyond that. A job with its own pay range is banded on its midpoint.</p>
          </section>
          <section>
            <h4>Conversions</h4>
            <p>Hourly converts at {a.contract_hours_per_day}h a day on contract work and {a.perm_hours_per_day}h on permanent work; {a.days_per_year} days a year, {a.days_per_month} days a month. FX at ECB reference rates of {fmtDate(data.fx_date)}. Extractor {data.extractor_version}.</p>
          </section>
          <section>
            <h4>Caveats</h4>
            <p>"Up to" ranges overstate; permanent salaries exclude benefits. Marine monthly cells are crewing-agency wages.</p>
          </section>
        </div>
      </div>
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────────────── */
export default function MarketRatesPage() {
  const { data, loading, error } = useMarketRates()
  // v1 sizes its axes from usd_day, so it always shows USD (the currency selector lives on v2)
  setActiveCurrency('USD', data?.fx)
  const [params, setParams] = useSearchParams()
  const [role, setRoleRaw] = useState(params.get('role') || 'electrician')
  const [region, setRegionRaw] = useState(params.get('region') || 'US')
  const [basis, setBasisRaw] = useState(BASIS_ORDER.includes(params.get('basis')) ? params.get('basis') : 'contract_day')
  const [period, setPeriod] = useState(PERIOD_OPTS.some(([k]) => k === params.get('period')) ? params.get('period') : 'native')
  const [tRegion, setTRegion] = useState('US')
  const [tBasis, setTBasis] = useState('contract_day')
  const [drawer, setDrawer] = useState(null) // null | 'method' | 'cell'
  const explorerRef = useRef(null)

  useEffect(() => {
    const next = new URLSearchParams()
    next.set('role', role); next.set('region', region); next.set('basis', basis)
    if (period !== 'native') next.set('period', period)
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [role, region, basis, period]) // eslint-disable-line react-hooks/exhaustive-deps

  const roles = useMemo(() => {
    if (!data) return []
    const m = new Map()
    for (const c of data.cells) {
      const r = m.get(c.role) || { role: c.role, label: c.role_label, n: 0 }
      r.n += c.n
      m.set(c.role, r)
    }
    return [...m.values()].sort((a, b) => (isOther(a.label) - isOther(b.label)) || b.n - a.n)
  }, [data])

  const roleCells = useMemo(() => (data ? data.cells.filter(c => c.role === role) : []), [data, role])

  // keep role / region / basis a valid combination
  const pickFor = (r, preferRegion, preferBasis) => {
    const cs = data.cells.filter(c => c.role === r)
    if (!cs.length) return null
    const byN = (a, b) => b.n - a.n
    return cs.find(c => c.region === preferRegion && c.basis === preferBasis)
      || cs.filter(c => c.region === preferRegion).sort(byN)[0]
      || cs.filter(c => c.basis === preferBasis).sort(byN)[0]
      || cs.sort(byN)[0]
  }
  const apply = (c) => { if (c) { setRoleRaw(c.role); setRegionRaw(c.region); setBasisRaw(c.basis) } }
  const setRole = (r) => apply(pickFor(r, region, basis))
  const setRegion = (g) => apply(pickFor(role, g, basis))
  const setBasis = (b) => apply(pickFor(role, region, b))

  const cell = useMemo(() => {
    if (!data) return null
    return data.cells.find(c => c.role === role && c.region === region && c.basis === basis) || pickFor(role, region, basis) || data.cells[0]
  }, [data, role, region, basis]) // eslint-disable-line react-hooks/exhaustive-deps

  const samples = useMemo(() => {
    if (!data) return []
    return CARD_PICKS.map(b => data.samples.find(s => s.band === b)).filter(Boolean)
      .map(s => ({ s, cell: data.cells.find(c => c.id === s.cell_id) })).filter(x => x.cell)
  }, [data])

  const scrollToExplorer = () => explorerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  if (loading) return <div className="mr"><div className="mr-empty">Loading market rates…</div></div>
  if (error || !data) return <div className="mr"><div className="mr-empty">Could not load market rates: {error}</div></div>

  return (
    <div className="mr">
      <SEO title="Market rates - Moblyze Jobs" description="Internal preview of market pay rates by role, region and experience level" />
      <Hero data={data} onMethod={() => setDrawer('method')} onExplore={scrollToExplorer} />

      <section className="mr-section" ref={explorerRef} id="explore">
        <div className="mr-section__head">
          <div>
            <div className="mr-eyebrow">Benchmarks</div>
            <h2>Explore a role</h2>
          </div>
          <div className="mr-section__tools">
            <span className="mr-tools-label">Show rates</span>
            <Segmented label="Pay period" options={PERIOD_OPTS} value={period} onChange={setPeriod} size="sm" />
          </div>
        </div>
        <div className="mr-explorer">
          <RolePicker roles={roles} role={role} setRole={setRole} />
          {cell && (
            <Benchmark data={data} cell={cell} roleCells={roleCells} region={cell.region} setRegion={setRegion}
              basis={cell.basis} setBasis={setBasis} period={period} onInfo={() => setDrawer('cell')} />
          )}
        </div>
      </section>

      <CompareTable data={data} region={tRegion} setRegion={(g) => {
        setTRegion(g)
        if (!data.cells.some(c => c.region === g && c.basis === tBasis)) setTBasis(BASIS_ORDER.find(b => data.cells.some(c => c.region === g && c.basis === b)))
      }} basis={tBasis} setBasis={setTBasis} period={period} selectedId={cell?.id}
        onPick={(c) => { apply(c); scrollToExplorer() }} />

      {samples.length > 0 && (
        <section className="mr-section" id="job-cards">
          <div className="mr-section__head">
            <div>
              <div className="mr-eyebrow">On a job card</div>
              <h2>Rate vs market, at a glance</h2>
            </div>
            <p className="mr-section__note">Real jobs, each banded against the typical range for its role and region.</p>
          </div>
          <div className="mr-jobs">
            {samples.map(({ s, cell: c }) => <JobCard key={s.source_url} s={s} cell={c} />)}
          </div>
        </section>
      )}

      <footer className="mr-foot">
        <span className="mr-preview-pill mr-preview-pill--light">Beta</span>
        <span>Shown in USD. Updated {fmtDate(data.cells[0]?.last_updated)}.</span>
        <button type="button" className="mr-linkbtn" onClick={() => setDrawer('method')}><InfoIcon />Methodology</button>
      </footer>

      {drawer && <Drawer data={data} cell={drawer === 'cell' ? cell : null} onClose={() => setDrawer(null)} />}
    </div>
  )
}
