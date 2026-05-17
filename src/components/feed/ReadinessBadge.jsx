const READINESS_STYLE = {
  cold:     { bg: 'bg-gray-100',    text: 'text-gray-700',    label: 'Cold',     tip: 'Cold — >12 months from active hiring, or news about something already completed.' },
  warming:  { bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'Warming',  tip: 'Warming — 6–12 months from active hiring.' },
  hot:      { bg: 'bg-orange-100',  text: 'text-orange-800',  label: 'Hot',      tip: 'Hot — 1–6 months from active hiring.' },
  live_now: { bg: 'bg-red-100',     text: 'text-red-800',     label: 'Live now', tip: 'Live now — actively hiring within weeks.', pulse: true },
}

export default function ReadinessBadge({ readiness }) {
  if (!readiness) return null
  const style = READINESS_STYLE[readiness]
  if (!style) return null
  return (
    <span
      className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${style.bg} ${style.text} ${style.pulse ? 'animate-pulse' : ''}`}
      title={style.tip}
    >
      {style.label}
    </span>
  )
}
