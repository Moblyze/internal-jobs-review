// src/components/feed/Stepper.jsx
import { getPhaseStage } from '../../utils/feed/phaseStage'

export default function Stepper({ entry }) {
  const data = getPhaseStage(entry)

  if (!data) {
    return (
      <div className="stepper stepper--unknown" aria-label="Project phase: unknown">
        <span className="stepper__dots">
          {[0, 1, 2, 3, 4, 5].map(i => <span key={i} className="stepper__dot" />)}
        </span>
        <span className="stepper__label">Phase unknown</span>
      </div>
    )
  }

  const { track, stages, currentIndex, currentLabel } = data
  const trackTitle = track === 'decommissioning' ? 'Decom lifecycle' : 'Project lifecycle'

  return (
    <div
      className="stepper"
      tabIndex={0}
      aria-label={`${trackTitle}: ${currentLabel} (stage ${currentIndex + 1} of 6)`}
    >
      <span className="stepper__dots">
        {stages.map((_, i) => (
          <span
            key={i}
            className={`stepper__dot${i === currentIndex ? ' stepper__dot--current' : ''}`}
          />
        ))}
      </span>
      <span className="stepper__label">{currentLabel}</span>

      <div className="stepper__popover" role="tooltip">
        <div className="stepper__popover-title">{trackTitle} · stage {currentIndex + 1} of 6</div>
        {stages.map((s, i) => (
          <div
            key={s.key}
            className={`stepper__popover-row${i === currentIndex ? ' stepper__popover-row--current' : ''}`}
          >
            <span className="stepper__popover-dot" />
            <span className="stepper__popover-stage">{s.label}</span>
            <span className="stepper__popover-meaning">{s.meaning}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
