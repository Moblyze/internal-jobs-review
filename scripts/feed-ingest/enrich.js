import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 2048

export function buildPrompt(item, taxonomy, excludedCountries = []) {
  const subsectorIds = taxonomy.subsectors.map(s => s.id).join(', ')
  const disciplineIds = taxonomy.discipline_tags.map(d => d.id).join(', ')
  const signalIds = taxonomy.signal_types.map(s => s.id).join(', ')

  return `You are an extraction agent for a BD intelligence feed serving energy-industry agency recruiters.

This is a BUSINESS DEVELOPMENT feed — not a news feed. Your first job is to decide whether the article describes a discrete labor-demand event that a recruiter can act on. Apply the criteria below strictly.

BD RELEVANCE CRITERIA:

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
  - Any article that does not name at least one operator, contractor, or project

EXAMPLES:

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
  → bd_relevant: false, bd_relevance_reason: "Political commentary with no actionable BD signal or named project"

Given a news article (headline + body), produce a single JSON object with the following keys. Use null when a field is not stated or strongly implied. Never invent operators, contractors, project names, certifications, or numbers.
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
  "bd_relevance_reason": "one sentence explaining why this is or is not BD-relevant"
}

For bd_relevant: false entries, you may set all other fields to null/empty — the entry will be dropped from the feed.

ARTICLE:
Source: ${item.source?.name || 'unknown'}
Headline: ${item.headline}
Body: ${item.body || '(no body provided)'}

Output the JSON now. Do not wrap in code fences.`
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

export async function enrichEntry(item, taxonomy, opts = {}) {
  const client = opts.client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const excludedCountries = opts.excludedCountries || []
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
