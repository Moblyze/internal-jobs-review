const READINESS_STYLE = {
  cold:     { bg: 'bg-gray-100',    text: 'text-gray-700',    label: 'Cold' },
  warming:  { bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'Warming' },
  hot:      { bg: 'bg-orange-100',  text: 'text-orange-800',  label: 'Hot' },
  live_now: { bg: 'bg-red-100',     text: 'text-red-800',     label: 'Live now', pulse: true },
}

export default function ReadinessBadge({ readiness }) {
  if (!readiness) return null
  const style = READINESS_STYLE[readiness]
  if (!style) return null
  return (
    <span
      className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${style.bg} ${style.text} ${style.pulse ? 'animate-pulse' : ''}`}
      title={`Outreach readiness: ${style.label}`}
    >
      {style.label}
    </span>
  )
}
