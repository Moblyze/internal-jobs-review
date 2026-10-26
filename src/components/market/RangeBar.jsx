// src/components/market/RangeBar.jsx
// One horizontal range: p25-p75 band with a median marker on a shared scale.
// `stats` are already in the display period (see cellStats); `max` is the
// shared axis max. Optional `ghost` draws the all-levels band behind a level.
// Plain HTML on a percentage scale, so it stays crisp at any width.
import { fmtRange, fmtRate } from '../../utils/marketRates'

export default function RangeBar({ stats, max, min = 0, ghost, size = 'md', label, meta, showMedian = false }) {
  const pct = (v) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))
  const lo = pct(stats.p25Raw), hi = pct(stats.p75Raw), med = pct(stats.medianRaw)
  return (
    <div className={`mr-range mr-range--${size}`}>
      <div className="mr-range__track" />
      {ghost && (
        <div className="mr-range__ghost" style={{ left: `${pct(ghost.p25Raw)}%`, width: `${Math.max(0.6, pct(ghost.p75Raw) - pct(ghost.p25Raw))}%` }} />
      )}
      <div className="mr-range__band" style={{ left: `${lo}%`, width: `${Math.max(0.8, hi - lo)}%` }} />
      <div className="mr-range__median" style={{ left: `${med}%` }} />
      {showMedian && (
        <span className="mr-range__medlabel num" style={{ left: `${med}%` }}>{fmtRate(stats.median, stats.period)}</span>
      )}
      <div className="mr-tip" role="tooltip">
        {label && <div className="mr-tip__h">{label}</div>}
        <div className="mr-tip__row"><span>Typical</span><b className="num">{fmtRange(stats.p25, stats.p75, stats.period)}</b></div>
        <div className="mr-tip__row"><span>Median</span><b className="num">{fmtRate(stats.median, stats.period)}</b></div>
        {meta && <div className="mr-tip__meta">{meta}</div>}
      </div>
    </div>
  )
}
