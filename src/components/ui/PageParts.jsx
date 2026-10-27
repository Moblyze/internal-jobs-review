// Shared page parts for the internal tabs (styles in src/styles/mz-ui.css).
// PageHeader: title, optional Beta badge, one-line purpose, optional right-hand control.
// DataBasis: the "how much data, how fresh" line that sits under every header.
// EmptyState: one calm sentence plus a hint, never a red box for "nothing matched".
import '../../styles/mz-ui.css'

export function PageHeader({ title, beta, sub, right }) {
  return (
    <header className="mz-head">
      <div>
        <h1>{title}{beta && <span className="mz-beta">Beta</span>}</h1>
        {sub && <p className="mz-head__sub">{sub}</p>}
      </div>
      {right}
    </header>
  )
}

// parts: array of nodes shown in order, separated by a middle dot; falsy parts are skipped
export function DataBasis({ parts }) {
  const shown = parts.filter(Boolean)
  if (!shown.length) return null
  return (
    <p className="mz-basis">
      <span className="mz-basis__dot" aria-hidden="true" />
      {shown.map((p, i) => (
        <span key={i}>{i > 0 && <span className="mz-basis__sep" aria-hidden="true">·</span>}{p}</span>
      ))}
    </p>
  )
}

export function EmptyState({ title, children }) {
  return <div className="mz-empty">{title && <b>{title}</b>}{children}</div>
}

export function fmtUpdated(iso) {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso)
  if (isNaN(d)) return null
  return `Updated ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
}
