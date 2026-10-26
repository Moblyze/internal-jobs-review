// src/components/market/Sparkline.jsx
// Monthly median trend for one cell. Only rendered when the bundle found
// enough months (>= 3 months with >= 5 observations each). The line is SVG
// stretched to the box; labels and the end dot are HTML so they never distort.
import { fmtMoney, fmtMonth, fromDay, roundClean } from '../../utils/marketRates'

export default function Sparkline({ trend, cell, period }) {
  if (!trend || trend.length < 2) return null
  const W = 100, H = 100
  const vals = trend.map(t => fromDay(t.usd_day_median, period, cell))
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const span = hi - lo || 1
  const x = (i) => (i / (trend.length - 1)) * W
  const y = (v) => 8 + (1 - (v - lo) / span) * (H - 16)
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const last = vals.length - 1
  return (
    <div className="mr-spark" title={trend.map(t => `${fmtMonth(t.month)}: ${fmtMoney(roundClean(fromDay(t.usd_day_median, period, cell), period))} (${t.n} ads)`).join('\n')}>
      <div className="plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Monthly median, ${trend.length} months`}>
          <polygon className="area" points={`${x(0)},${H} ${pts} ${x(last)},${H}`} />
          <polyline className="line" points={pts} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="dot" style={{ left: '100%', top: `${y(vals[last])}%` }} />
        <span className="val" style={{ top: `${y(vals[last])}%` }}>{fmtMoney(roundClean(vals[last], period))}</span>
      </div>
      <div className="axis"><span>{fmtMonth(trend[0].month)}</span><span>{fmtMonth(trend[last].month)}</span></div>
    </div>
  )
}
