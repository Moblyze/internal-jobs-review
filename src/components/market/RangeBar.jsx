// src/components/market/RangeBar.jsx
// One horizontal range bar: p25-p75 band in teal, a median tick, optional
// ghost band for a parent cell (role x region) behind a level cell. Values are
// already in the display period; `max` is the shared scale for the section.
// Plain HTML on a percentage scale: crisp at any width, labels never scale.
import { fmtMoney, unitSuffix } from '../../utils/marketRates'

export default function RangeBar({ stats, max, ghost, tip, showEnds = true, sub = false }) {
  const pct = (v) => Math.max(0, Math.min(100, (v / max) * 100))
  const p25 = pct(stats.p25Raw), p75 = pct(stats.p75Raw), med = pct(stats.medianRaw)
  const suffix = unitSuffix(stats.period)
  const compact = stats.period === 'year' || stats.period === 'month'
  // end labels sit outside the band like a dumbbell; fall below it when there is no room at the edge
  const loBelow = p25 < 9, hiBelow = p75 > 91
  return (
    <div className="mr-bar">
      <div className="track" />
      {ghost && <div className="ghost" style={{ left: `${pct(ghost.p25Raw)}%`, width: `${Math.max(0.4, pct(ghost.p75Raw) - pct(ghost.p25Raw))}%` }} />}
      <div className={`band${sub ? ' sub' : ''}`} style={{ left: `${p25}%`, width: `${Math.max(0.6, p75 - p25)}%` }} />
      <div className="tick" style={{ left: `${med}%` }} />
      {showEnds && (
        <>
          <span className={`end lo${loBelow ? ' below' : ''}`} style={{ left: `${p25}%` }}>{fmtMoney(stats.p25, { compact })}</span>
          <span className={`end hi${hiBelow ? ' below' : ''}`} style={{ left: `${p75}%` }}>{fmtMoney(stats.p75, { compact })}</span>
        </>
      )}
      {tip && (
        <div className="mr-tip" role="tooltip">
          <b>{fmtMoney(stats.p25)}{suffix} to {fmtMoney(stats.p75)}{suffix}</b> typical (p25 to p75)<br />
          median <b>{fmtMoney(stats.median)}{suffix}</b>{tip}
        </div>
      )}
    </div>
  )
}
