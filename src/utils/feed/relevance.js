// src/utils/feed/relevance.js
//
// Scores BD-feed signals by how relevant the hiring opportunity is to Moblyze's
// staffing business, then ranks hiring companies. Used by the contact-prewarm
// job to decide WHICH employers/projects are worth spending a (free-tier)
// contact lookup on — we only auto-enrich genuinely high-relevance targets.
//
// The weights below are deliberately data-driven and TUNABLE. They reflect
// Moblyze's priority specialties — oil & gas, subsea, and rope access — mapped
// onto the feed's actual taxonomy (see public/data/feed/taxonomy or the distinct
// values in entries-lite.json). Rope access has no taxonomy tag of its own, so
// it's caught via headline keywords + proxy disciplines (NDT / industrial
// construction on offshore structures).

export const RELEVANCE_WEIGHTS = {
  // subsector (one per entry) — oil & gas is the core book; offshore work
  // carries subsea/rope-access overlap.
  subsector: {
    'offshore-og': 4,        // oil & gas — top priority
    'onshore-og': 4,         // oil & gas — top priority
    'offshore-wind': 3,      // subsea + rope-access overlap
    'onshore-renewables': 1,
    'nuclear': 0.5,          // deprioritized
    'mining': 0.5,           // deprioritized
  },
  // discipline_tags (several per entry) — summed. Subsea + O&G trades score
  // highest; NDT / industrial construction are rope-access proxies.
  discipline: {
    rov_subsea: 3,            // subsea
    marine_offshore_ops: 3,   // subsea / offshore
    drilling_operations: 3,   // oil & gas
    pipeline_mechanical: 2,   // oil & gas
    ndt_inspection: 2,        // rope-access proxy
    industrial_construction: 1, // rope-access proxy
    energy_trades: 1,
    process_plant_operations: 1,
    survey_geophysical: 1,
  },
  // headline keyword boosts — the only signal that catches "rope access"
  // (no taxonomy tag) and reinforces explicit subsea / O&G mentions.
  keywords: [
    { re: /\brope[\s-]?access\b|\bIRATA\b|\bSPRAT\b/i, w: 3, label: 'rope_access' },
    { re: /\bsubsea\b|\bROV\b|\bdiv(?:ing|er|ers)\b|\bsaturation\b|\bumbilical\b/i, w: 2, label: 'subsea' },
    { re: /\boil\s*&?\s*gas\b|\bdrilling\b|\bFPSO\b|\bplatform\b|\bwellhead\b|\brigs?\b/i, w: 1, label: 'oil_gas' },
  ],
  // outreach_readiness — how ready the opportunity is to hire crews now.
  readiness: { live_now: 3, hot: 2, warming: 1, cold: 0 },
  // lifecycle phase — construction/mobilization needs people soonest.
  phase: { construction: 2, sanctioned_engineering: 1, operating: 1, pre_sanction: 0 },
}

// Only employers with at least one signal scoring >= this count as "genuinely
// high relevance" and become eligible for auto-enrichment.
export const QUALIFY_MIN_BEST_SCORE = 6

function contractValueScore(usd) {
  if (!usd || typeof usd !== 'number') return 0
  if (usd >= 1e9) return 3
  if (usd >= 1e8) return 2
  if (usd >= 1e7) return 1
  return 0
}

function recencyScore(ingestedAt, nowMs) {
  if (!ingestedAt) return 0
  const ageDays = (nowMs - new Date(ingestedAt).getTime()) / (1000 * 60 * 60 * 24)
  if (!Number.isFinite(ageDays) || ageDays < 0) return 0
  if (ageDays <= 14) return 1
  if (ageDays <= 30) return 0.5
  return 0
}

// Score a single feed entry. Returns { score, matched } where `matched` lists
// the keyword labels that fired (for explainable logging).
export function scoreEntry(entry, nowMs = Date.now()) {
  const W = RELEVANCE_WEIGHTS
  let score = 0
  const matched = []

  score += W.subsector[entry?.subsector] || 0

  for (const tag of entry?.discipline_tags || []) {
    score += W.discipline[tag] || 0
  }

  const headline = entry?.headline || ''
  for (const k of W.keywords) {
    if (k.re.test(headline)) { score += k.w; matched.push(k.label) }
  }

  score += W.readiness[entry?.outreach_readiness] || 0
  score += W.phase[entry?.phase] || 0
  score += contractValueScore(entry?.contract_value_usd)
  score += recencyScore(entry?.ingested_at, nowMs)

  return { score: Math.round(score * 10) / 10, matched }
}

function hiringName(entry) {
  return (entry?.hiring_entity?.name || entry?.operator?.name || '').trim() || null
}

// Aggregate entries into ranked hiring targets. Returns an array of
// { name, totalScore, bestScore, signalCount, matched, subsectors } sorted by
// totalScore desc, filtered to those whose best signal clears QUALIFY_MIN_BEST_SCORE.
export function rankHiringTargets(entries, { nowMs = Date.now(), minBestScore = QUALIFY_MIN_BEST_SCORE, breadthWeight = 0.3 } = {}) {
  const byCompany = new Map()
  for (const e of entries || []) {
    const name = hiringName(e)
    if (!name) continue
    const { score, matched } = scoreEntry(e, nowMs)
    const cur = byCompany.get(name) || { name, sumScore: 0, bestScore: 0, signalCount: 0, matched: new Set(), subsectors: new Set() }
    cur.sumScore += score
    cur.bestScore = Math.max(cur.bestScore, score)
    cur.signalCount += 1
    for (const m of matched) cur.matched.add(m)
    if (e.subsector) cur.subsectors.add(e.subsector)
    byCompany.set(name, cur)
  }
  return [...byCompany.values()]
    .filter(c => c.bestScore >= minBestScore)
    .map(c => {
      // Rank on the strongest single signal plus a damped breadth bonus, so a few
      // strong (high-relevance) signals beat a pile of weak ones — signal volume
      // alone shouldn't lift a low-priority sector above a focused O&G/subsea target.
      const totalScore = Math.round((c.bestScore + breadthWeight * (c.sumScore - c.bestScore)) * 10) / 10
      return { name: c.name, totalScore, bestScore: c.bestScore, signalCount: c.signalCount, matched: [...c.matched], subsectors: [...c.subsectors] }
    })
    .sort((a, b) => b.totalScore - a.totalScore || b.bestScore - a.bestScore)
}

// Persona priority for crew-hiring decision-makers (who Moblyze sells to).
export const PERSONA_PRIORITY = ['crewing', 'ta', 'project', 'operations', 'hr', 'other']

// Pick up to `limit` contacts for a company, best persona first, skipping
// anyone who already has an email (nothing to enrich).
export function pickTopContacts(contacts, limit = 2) {
  return (contacts || [])
    .filter(c => c && c.name && !c.email)
    .map(c => ({ c, rank: PERSONA_PRIORITY.indexOf((c.persona || 'other').toLowerCase()) }))
    .map(x => ({ ...x, rank: x.rank === -1 ? PERSONA_PRIORITY.length : x.rank }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(x => x.c)
}
