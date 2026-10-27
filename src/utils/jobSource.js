// Where a job came from, for the Source filter. Two groups:
//   "Company career sites": a company's own careers page (one Sheet tab per company).
//   "Job boards & aggregators": CrewBase, each "Aggregator - <feed>" tab, and Lineman Central.
// Keys: 'career' or 'board:<name>'.
export const CAREER_KEY = 'career'

export function jobSourceKey(job) {
  if (job.source === 'linemancentral') return 'board:Lineman Central'
  const tab = job.sourceTab
  if (!tab) return CAREER_KEY
  if (tab === 'CrewBase' || /^aggregator\b/i.test(tab)) return `board:${tab}`
  return CAREER_KEY
}

export function jobSourceLabel(key) {
  if (key === CAREER_KEY) return 'Company career sites'
  const name = key.replace(/^board:/, '')
  const m = name.match(/^aggregator\s*-\s*(.+)$/i)
  return m ? `Aggregator: ${m[1].replace(/_/g, ' ')}` : name
}
