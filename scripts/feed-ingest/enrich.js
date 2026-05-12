import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'
const GATE_MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 2048
const GATE_MAX_TOKENS = 256

export const PROMPT_VERSION = 'phase-targeting-v1'

export const PHASES = ['pre_sanction', 'sanctioned_engineering', 'construction', 'operating']
export const READINESS = ['cold', 'warming', 'hot', 'live_now']
export const HIRING_WINDOWS = ['now', '1-3mo', '3-6mo', '6-12mo', '12mo+', 'ongoing']
export const HIRING_RELEVANCE = ['likely_decision_maker', 'context_only']

const BD_RELEVANCE_CRITERIA = `BD RELEVANCE CRITERIA:

INCLUDE (bd_relevant: true) — the article describes a discrete workforce-demand event in offshore O&G, onshore O&G, offshore wind, onshore renewables, nuclear, or mining, AND names at least one of: operator, contractor/hiring entity, or project name. Qualifying events:
  - Project sanction (FID), EPC/SURF/HUC contract award, drilling/services tender or contract, FEED award
  - Rig fixture, vessel mobilization, drillship mobilization, vessel mobilization announcement
  - Large workforce ramp-up announcement at a specific named project
  - Decommissioning contract or notice
  - Contractor replacement mid-project
  - Specific block/lease award naming the operator and acreage
  - Exploration license assignment to a named operator
  - Field development plan approval, permit grant, or operator change-of-control affecting a named project

EXCLUDE (bd_relevant: false):
  - Geopolitics, war, national policy debates (e.g. "UAE withdraws from OPEC", "Trump comments on energy")
  - Earnings reports, quarterly results, dividend announcements, share buybacks
  - M&A talks, rumored deals, IPO news — UNLESS the deal directly assigns a named project to a new operator
  - Generic industry commentary, opinion pieces, executive interviews without a named project
  - Generic regulatory news without a named project (e.g. "regulator announces new safety rules")
  - Tech/research announcements without staffing implications
  - Conference/event coverage, awards, award nominations
  - General market analysis, oil-price commentary, demand forecasts
  - Any article that does not name at least one operator, contractor, or project`

const BD_RELEVANCE_EXAMPLES = `EXAMPLES:

INCLUDE — "Saipem Awarded €2.1B SURF Contract for Equinor's Rosebank Phase 2"
  → Discrete contract award, names operator (Equinor) and contractor (Saipem), offshore O&G
  → bd_relevant: true, bd_relevance_reason: "EPC/SURF contract award naming Equinor and Saipem for Rosebank Phase 2"

INCLUDE — "Valaris DS-8 Drillship Fixed to Shell for Namibia Campaign, Mob Q3 2026"
  → Rig fixture with named rig, operator, and mobilization window
  → bd_relevant: true, bd_relevance_reason: "Drillship fixture naming Shell as operator and Valaris DS-8 for Namibia campaign"

INCLUDE — "Petrobras Awards Pre-Salt FPSO HUC Contract to Technip Energies"
  → Contract award naming operator and EPC, offshore O&G
  → bd_relevant: true, bd_relevance_reason: "FPSO HUC contract award naming Petrobras and Technip Energies"

INCLUDE — "Block 15 Awarded to TotalEnergies in Angola's 2026 Deepwater Licensing Round"
  → Specific block award naming operator and acreage
  → bd_relevant: true, bd_relevance_reason: "Deepwater block award naming TotalEnergies in Angola licensing round"

INCLUDE — "Saipem Appoints John Doe as Project Director for Equinor's Rosebank Phase 2 SURF Contract"
  → EPC/SURF award naming Equinor (operator) and Saipem (hiring entity); Project Director named with title
  → bd_relevant: true, bd_relevance_reason: "EPC/SURF contract award naming Equinor and Saipem with a named Project Director"
  → phase: "sanctioned_engineering" (EPC award is post-FID; engineering ramps next)
  → phase_evidence: "EPC SURF contract just awarded; detailed engineering will follow"
  → outreach_readiness: "hot", estimated_hiring_window: "3-6mo"
  → key_people: [{name: "John Doe", title: "Project Director", company: "Saipem", hiring_relevance: "likely_decision_maker"}]

EXCLUDE — "J.P. Morgan: Oil Inventories Acting as Shock Absorber of Global Supply System"
  → Market analysis, no project or workforce signal
  → bd_relevant: false, bd_relevance_reason: "Generic oil market commentary, no project or hiring entity named"

EXCLUDE — "Exxon & Chevron Beat Profit Estimates"
  → Earnings report, no BD signal
  → bd_relevant: false, bd_relevance_reason: "Quarterly earnings report, no contract award or workforce signal"

EXCLUDE — "USA Says Iran Ceasefire Still in Place"
  → Geopolitics, no energy project or workforce signal
  → bd_relevant: false, bd_relevance_reason: "Geopolitical news unrelated to any named project or hiring event"

EXCLUDE — "Trump Comments on State of Iran Nuclear Talks"
  → Political commentary, no named project or operator
  → bd_relevant: false, bd_relevance_reason: "Political commentary with no actionable BD signal or named project"`

const PHASE_AND_READINESS_RULES = `PROJECT PHASE — classify the project's lifecycle stage from the article body, not from your industry assumptions. Pick exactly one:
  - pre_sanction: concept/FEED/pre-FID. Not yet greenlit.
  - sanctioned_engineering: FID done, EPC tenders running or just awarded, detailed engineering ramping.
  - construction: fabrication, installation, hookup/commissioning. THE prime hiring window for trades.
  - operating: producing/operational. Only ongoing maintenance hires.

OUTREACH READINESS — how imminent is hiring? Pick exactly one:
  - cold: >12 months from active hiring, or this is old news about something completed
  - warming: 6-12 months from active hiring
  - hot: 1-6 months from active hiring
  - live_now: actively hiring within weeks

ESTIMATED HIRING WINDOW — coarse time-to-first-hire (or "ongoing" for steady maintenance). One of: now, 1-3mo, 3-6mo, 6-12mo, 12mo+, ongoing.

CONSISTENCY RULE — phase, readiness, and window must align. Allowed pairings (deviating usually means you misread the phase):
  - pre_sanction → cold, window 12mo+ or null
  - sanctioned_engineering → warming or hot, window 3-6mo or 6-12mo
  - construction → hot or live_now, window now, 1-3mo, or 3-6mo
  - operating → cold (no new ramp) OR warming/hot with window ongoing (maintenance)

KEY PEOPLE — extract individuals named in the article body WITH A TITLE. Skip generic "spokesperson" quotes.
  hiring_relevance: 'likely_decision_maker' for Project Director, Project Manager, VP Operations, Site Manager, GM, Hiring Manager, COO, head of TA.
  hiring_relevance: 'context_only' for CEO, board members, press contacts, government officials, analysts, competitors.`

export function buildGatePrompt(item, excludedCountries = []) {
  return `You are a fast gate for a BD intelligence feed serving energy-industry agency recruiters. Decide whether the article describes a discrete labor-demand event a recruiter can act on. Apply the criteria strictly.

${BD_RELEVANCE_CRITERIA}
${excludedCountries.length > 0 ? `
GEO HINT: If the project country is one of [${excludedCountries.join(', ')}], default to bd_relevant: false UNLESS the article describes a Western contractor or operator that needs Western/EEA-eligible labor at that location.
` : ''}
ARTICLE:
Source: ${item.source?.name || 'unknown'}
Headline: ${item.headline}
Body: ${item.body || '(no body provided)'}

Output ONLY a single JSON object with this exact shape, no prose, no code fences:
{"bd_relevant": true|false, "reason": "one short sentence"}`
}

export function buildPrompt(item, taxonomy, excludedCountries = []) {
  const subsectorIds = taxonomy.subsectors.map(s => s.id).join(', ')
  const disciplineIds = taxonomy.discipline_tags.map(d => d.id).join(', ')
  const signalIds = taxonomy.signal_types.map(s => s.id).join(', ')

  return `You are an extraction agent for a BD intelligence feed serving energy-industry agency recruiters.

This is a BUSINESS DEVELOPMENT feed — not a news feed. Your first job is to decide whether the article describes a discrete labor-demand event that a recruiter can act on. Apply the criteria below strictly.

${BD_RELEVANCE_CRITERIA}

${BD_RELEVANCE_EXAMPLES}

${PHASE_AND_READINESS_RULES}

Given a news article (headline + body), produce a single JSON object with the following keys. Use null when a field is not stated or strongly implied. Never invent operators, contractors, project names, certifications, or numbers. Never invent named individuals — only extract people the article actually names with a title.
${excludedCountries.length > 0 ? `
GEO HINT: If the project country is one of [${excludedCountries.join(', ')}], default to bd_relevant: false UNLESS the article describes a Western contractor or operator that needs Western/EEA-eligible labor at that location. (We don't recruit local nationals in those markets.)
` : ''}
OUTPUT SCHEMA (JSON only, no prose):
{
  "subsector": one of [${subsectorIds}],
  "discipline_tags": array of any of [${disciplineIds}],
  "signal_type": one of [${signalIds}],
  "region": short slug like "uk-north-sea" | "us-gulf" | "saudi-arabia" or null,
  "country": ISO-name slug like "united_kingdom" | null,
  "headline": cleaned BD-angle headline, max 120 chars,
  "tldr": 1-2 sentence BD summary naming the labor-demand window,
  "operator": { "name": string | null },
  "hiring_entity": { "name": string | null },
  "project_name": string | null,
  "scope": array of short scope chips like ["huc","topsides_epc","subsea_install"],
  "mob_window": { "start": "YYYY-Qn" | null, "end": "YYYY-Qn" | null, "duration_months": number | null },
  "contract_value_usd": number | null,
  "targeting": {
    "job_titles_freetext": array of likely job titles,
    "skills": array of skill keywords,
    "certs_freetext": array of relevant cert names,
    "geo_rtw": short string,
    "project_experience": array of adjacent project names,
    "yoe_band": string like "8-15",
    "seniority": short string,
    "boolean_search": single LinkedIn-Recruiter-compatible Boolean string capped at 700 chars
  },
  "outreach_drafts": {
    "linkedin_inmail": "string up to 300 chars",
    "email_subject": "string",
    "email_body": "string"
  },
  "bd_relevant": true | false,
  "bd_relevance_reason": "one sentence explaining why this is or is not BD-relevant",
  "phase": "pre_sanction" | "sanctioned_engineering" | "construction" | "operating" | null,
  "phase_evidence": "1 sentence pointing at the article phrase that supports your phase call" | null,
  "outreach_readiness": "cold" | "warming" | "hot" | "live_now" | null,
  "estimated_hiring_window": "now" | "1-3mo" | "3-6mo" | "6-12mo" | "12mo+" | "ongoing" | null,
  "key_people": [
    { "name": "string", "title": "string", "company": "string | null", "hiring_relevance": "likely_decision_maker" | "context_only" }
  ]
}

For bd_relevant: false entries, you may set all other fields to null/empty — the entry will be dropped from the feed.

ARTICLE:
Source: ${item.source?.name || 'unknown'}
Headline: ${item.headline}
Body: ${item.body || '(no body provided)'}

Output the JSON now. Do not wrap in code fences.`
}

export function parseGateJson(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch {}
  const stripped = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
  try { return JSON.parse(stripped) } catch {}
  const first = stripped.indexOf('{')
  const last = stripped.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(stripped.slice(first, last + 1)) } catch {}
  }
  return null
}

export function reducedDetailEntry(item) {
  return {
    ...item,
    subsector: null,
    discipline_tags: [],
    signal_type: null,
    region: null,
    country: null,
    tldr: null,
    operator: { name: null },
    hiring_entity: { name: null },
    project_name: null,
    scope: [],
    mob_window: null,
    contract_value_usd: null,
    targeting: null,
    outreach_drafts: null,
    bd_relevant: false,
    bd_relevance_reason: 'enrichment failed',
    enrichment_status: 'failed',
    enrichment_model: MODEL,
  }
}

function gatedOutEntry(item, reason) {
  return {
    ...reducedDetailEntry(item),
    bd_relevance_reason: reason || 'gated out by relevance gate',
    enrichment_status: 'gated_out',
    enrichment_model: GATE_MODEL,
  }
}

export async function enrichEntry(item, taxonomy, opts = {}) {
  const client = opts.client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const excludedCountries = opts.excludedCountries || []

  // Pass 1: cheap Haiku gate. Prefill with '{' so the model continues with
  // JSON only. On malformed JSON we fall through to Sonnet (assume relevant)
  // so we never silently drop a hit because of gate flakiness.
  try {
    const gateResp = await client.messages.create({
      model: GATE_MODEL,
      max_tokens: GATE_MAX_TOKENS,
      messages: [
        { role: 'user', content: buildGatePrompt(item, excludedCountries) },
        { role: 'assistant', content: '{' },
      ],
    })
    const gateText = '{' + (gateResp.content?.[0]?.text || '')
    const gate = parseGateJson(gateText)
    if (!gate) {
      console.warn(`[enrich] gate JSON parse failed for ${item.headline?.slice(0, 60)}; raw=${gateText.slice(0, 200)}; falling through to Sonnet`)
    } else if (gate.bd_relevant === false) {
      return gatedOutEntry(item, gate.reason)
    }
  } catch (err) {
    console.warn(`[enrich] gate API error for ${item.headline?.slice(0, 60)}: ${err.message}; falling through to Sonnet`)
  }

  // Pass 2: full Sonnet extraction.
  const prompt = buildPrompt(item, taxonomy, excludedCountries)
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = resp.content?.[0]?.text || ''
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      console.warn(`[enrich] JSON parse failed for ${item.headline?.slice(0, 60)}`)
      return reducedDetailEntry(item)
    }
    return {
      ...item,
      ...parsed,
      enrichment_status: 'ok',
      enrichment_model: MODEL,
    }
  } catch (err) {
    console.warn(`[enrich] API error for ${item.headline?.slice(0, 60)}: ${err.message}`)
    return reducedDetailEntry(item)
  }
}
