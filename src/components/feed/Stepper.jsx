// src/components/feed/Stepper.jsx
// Fixed-width stage indicator: six dots on the left (every stage up to and including the current one
// filled), the stage name on the right. Hover or focus shows all six stages.
import { getPhaseStage, STAGES } from '../../utils/feed/phaseStage'

export default function Stepper({ entry }) {
  const data = getPhaseStage(entry)
  const current = data ? data.currentIndex : -1
  const trackNote = data?.track === 'decommissioning' ? ' (decommissioning)' : ''
  const label = data
    ? `Stage ${current + 1} of ${STAGES.length}: ${data.currentLabel}${trackNote}`
    : 'Stage unknown'

  return (
    <div className={`stepper${data ? '' : ' stepper--unknown'}`} tabIndex={0} aria-label={label}>
      <span className="stepper__dots" aria-hidden="true">
        {STAGES.map((s, i) => (
          <span
            key={s.key}
            className={`stepper__dot${i <= current ? ' stepper__dot--on' : ''}${i === current ? ' stepper__dot--current' : ''}`}
          />
        ))}
      </span>
      <span className="stepper__label">{data ? data.currentLabel : 'Unknown'}</span>

      <div className="stepper__popover" role="tooltip">
        <div className="stepper__popover-title">
          {data ? `Stage ${current + 1} of ${STAGES.length}${trackNote}` : 'Stage not stated in the source'}
        </div>
        {STAGES.map((s, i) => (
          <div
            key={s.key}
            className={`stepper__popover-row${i <= current ? ' stepper__popover-row--on' : ''}${i === current ? ' stepper__popover-row--current' : ''}`}
          >
            <span className="stepper__popover-dot" />
            <span className="stepper__popover-stage">{i + 1}. {s.label}</span>
            <span className="stepper__popover-meaning">{s.meaning}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
