import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 2048

export function buildPrompt(item, taxonomy) {
  const subsectorIds = taxonomy.subsectors.map(s => s.id).join(', ')
  const disciplineIds = taxonomy.discipline_tags.map(d => d.id).join(', ')
  const signalIds = taxonomy.signal_types.map(s => s.id).join(', ')

  return `You are an extraction agent for a BD intelligence feed serving energy-industry agency recruiters.

Given a news article (headline + body), produce a single JSON object with the following keys. Use null when a field is not stated or strongly implied. Never invent operators, contractors, project names, certifications, or numbers.

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
  "hiring_entity": { "name": string | null }   // the contractor doing the actual hiring; often the EPC
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
  }
}

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
    enrichment_status: 'failed',
    enrichment_model: MODEL,
  }
}

export async function enrichEntry(item, taxonomy, opts = {}) {
  const client = opts.client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const prompt = buildPrompt(item, taxonomy)
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
