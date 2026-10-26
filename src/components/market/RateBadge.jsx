// src/components/market/RateBadge.jsx
// "Rate vs market" badge: in range / near / above / below, per pay_rates/bands.py.
// Ships with a glyph and a label, never color alone.
import { BAND_META } from '../../utils/marketRates'

export default function RateBadge({ band, title }) {
  const m = BAND_META[band]
  if (!m) return null
  return (
    <span className={`mr-badge mr-badge--${m.tone}`} title={title}>
      <span className="mr-badge__g" aria-hidden="true">{m.glyph}</span>{m.label}
    </span>
  )
}
