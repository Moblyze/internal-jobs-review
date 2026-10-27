// src/components/market/Sparkline.jsx
// Monthly median trend. Two sizes: a compact sparkline for table rows and a
// full chart (axis labels, hover crosshair + tooltip) for the benchmark card.
// Only rendered when the bundle found 3+ months with 5+ observations.
import { useState } from 'react'
import { fmtMonth, fmtRate, fromDay } from '../../utils/marketRates'

export default function Sparkline({ trend, cell, period, full = false }) {
  const [hover, setHover] = useState(null)
  if (!trend || trend.length < 2) return full ? <div className="mr-trend mr-trend--empty">Not enough monthly data for a trend yet.</div> : <span className="mr-spark-none">–</span>

  const W = full ? 400 : 96, H = full ? 132 : 28
  const padT = full ? 18 : 4, padB = full ? 22 : 4, padX = full ? 6 : 3
  const vals = trend.map(t => fromDay(t.usd_day_median, period, cell))
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const span = hi - lo || 1
  const x = (i) => padX + (i / (trend.length - 1)) * (W - padX * 2)
  const y = (v) => padT + (1 - (v - lo) / span) * (H - padT - padB)
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const last = vals.length - 1
  const first = vals[0], end = vals[last]
  const delta = (end - first) / first

  if (!full) {
    return (
      <svg className="mr-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
        aria-label={`Monthly median ${fmtMonth(trend[0].month)} to ${fmtMonth(trend[last].month)}`}>
        <title>{trend.map((t, i) => `${fmtMonth(t.month)}: ${fmtRate(vals[i], period)} (${t.n} jobs)`).join('\n')}</title>
        <polyline className="mr-spark__line" points={pts} />
        <circle className="mr-spark__dot" cx={x(last)} cy={y(end)} r="2.5" />
      </svg>
    )
  }

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    let best = 0
    for (let i = 1; i < vals.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
    setHover(best)
  }
  const hi_ = hover ?? last
  return (
    <div className="mr-trend">
      <div className="mr-trend__head">
        <div>
          <div className="mr-eyebrow">Monthly median</div>
          <div className="mr-trend__val num">{fmtRate(vals[hi_], period)}</div>
          <div className="mr-trend__meta">{fmtMonth(trend[hi_].month)} · {trend[hi_].n} jobs</div>
        </div>
        <div className={`mr-delta ${delta >= 0 ? 'up' : 'down'}`}>
          <span aria-hidden="true">{delta >= 0 ? '↗' : '↘'}</span>
          {`${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}%`}
          <small>since {fmtMonth(trend[0].month)}</small>
        </div>
      </div>
      <div className="mr-trend__plot" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Monthly median over ${trend.length} months`}>
          <defs>
            <linearGradient id="mrTrendFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--mr-teal)" stopOpacity="0.16" />
              <stop offset="1" stopColor="var(--mr-teal)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map(f => (
            <line key={f} className="mr-trend__grid" x1="0" x2={W} y1={padT + f * (H - padT - padB)} y2={padT + f * (H - padT - padB)} vectorEffect="non-scaling-stroke" />
          ))}
          <polygon fill="url(#mrTrendFill)" points={`${x(0)},${H - padB} ${pts} ${x(last)},${H - padB}`} />
          <polyline className="mr-trend__line" points={pts} vectorEffect="non-scaling-stroke" />
          {hover != null && <line className="mr-trend__cross" x1={x(hover)} x2={x(hover)} y1={padT - 6} y2={H - padB} vectorEffect="non-scaling-stroke" />}
        </svg>
        {vals.map((v, i) => (
          <span key={i} className={`mr-trend__pt${i === hi_ ? ' on' : ''}`} style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(v) / H) * 100}%` }} />
        ))}
        <div className="mr-trend__axis">
          {trend.map((t, i) => <span key={t.month} style={{ left: `${(x(i) / W) * 100}%` }}>{fmtMonth(t.month).split(' ')[0]}</span>)}
        </div>
      </div>
    </div>
  )
}
