// scripts/discover-decision-makers.js
//
// Diffs entries.json against decision_makers.json and runs Claude with the
// web_search tool to find hiring decision-makers for any company not yet
// covered. Preserves existing entries; only writes new keys.
//
// Trigger paths:
//   • npm run discover-decision-makers              (full run, all gaps)
//   • npm run discover-decision-makers -- --limit 5 (cap for testing)
//   • npm run discover-decision-makers -- --dry-run (compute diff, no API calls)
//
// Env:
//   ANTHROPIC_API_KEY  required (same key as feed-ingest)
//   HUNTER_API_KEY     optional — reserved for follow-up email enrichment

import Anthropic from '@anthropic-ai/sdk'
import { readFile, writeFile, rename } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const ENTRIES_PATH = resolve(ROOT, 'public/data/feed/entries.json')
const DM_PATH = resolve(ROOT, 'public/data/feed/decision_makers.json')

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 2048
const MAX_WEB_SEARCH_USES = 3
const CONCURRENCY = 3 // parallel companies — keep modest to respect rate limits

const TARGET_PERSONAS = ['ta', 'hr', 'operations', 'project', 'crewing']
const ALL_PERSONAS = [...TARGET_PERSONAS, 'other']

function parseArgs() {
  const args = { limit: null, dryRun: false, refresh: false, only: null }
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--refresh') args.refresh = true
    else if (a === '--limit') args.limit = parseInt(process.argv[++i], 10) || null
    else if (a === '--only') args.only = process.argv[++i] // comma-separated company names
  }
  return args
}

function collectFeedCompanies(entries) {
  const names = new Set()
  for (const e of entries) {
    for (const k of ['hiring_entity', 'operator']) {
      const v = e?.[k]
      if (v && typeof v === 'object' && typeof v.name === 'string' && v.name.trim()) {
        names.add(v.name.trim())
      }
    }
  }
  return [...names]
}

function diffMissing(feedCompanies, dm) {
  const covered = new Set(Object.keys(dm).filter(k => k !== '_meta'))
  return feedCompanies.filter(c => !covered.has(c.toLowerCase()))
}

function buildPrompt(companyName) {
  return `You are a B2B sales-research agent. Your task: find up to 5 hiring decision-makers at the company below who are likely to influence recruitment in skilled trades / energy / mining workforce.

Company: ${companyName}

Target personas (in priority order):
- ta        — Talent Acquisition, Recruiting, Sourcing
- hr        — HR Business Partner, People Ops (when no dedicated TA)
- operations— VPs / Directors / Managers of Operations, Field Ops
- project   — Project / Construction / Site Managers and Directors
- crewing   — Crewing, Mobilization, Workforce planning (offshore / heavy industry)

Use the web_search tool to find LinkedIn profiles and other public sources. Prefer LinkedIn URLs (linkedin.com/in/...) for source_url.

For EACH contact, also try to capture:
- email:    A work email address ONLY if you find it explicitly published in a public source — investor-relations pages, press-release contacts, conference speaker bios, "Contact us" pages, regulatory filings (proxies, 10-Ks). NEVER guess, infer, or construct emails from a domain pattern. If unsure, return null.
- phone:    A direct dial ONLY if explicitly published next to that person's name in the same kind of public source. Never guess. Return null if not found.
- location: The person's home base. Prefer "City, State, Country" for US/Canada (e.g. "Houston, TX, USA"), "City, Country" elsewhere (e.g. "London, UK"). Typically visible on LinkedIn. If unknown, return null. Don't guess from company HQ.

Return ONLY a JSON object matching this schema — no prose, no markdown, no code fences:

{
  "contacts": [
    {
      "name": "string",
      "title": "string",
      "persona": "ta" | "hr" | "operations" | "project" | "crewing" | "other",
      "source_url": "string (LinkedIn URL preferred) or null",
      "in_target_persona": true | false,
      "email": "string or null",
      "phone": "string or null",
      "location": "string or null"
    }
  ]
}

Rules:
- 0 contacts is a valid answer if nothing relevant found.
- "in_target_persona" is true iff persona is ta/hr/operations/project/crewing (not "other").
- email / phone: null is much better than a guess. Only fill when explicitly published.
- Cap at 5 contacts. Prefer named individuals with verifiable LinkedIn URLs over guesses.`
}

function extractJson(text) {
  if (!text) return null
  // Look for first { ... } block. Tool-use models sometimes wrap output.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function normalizeContact(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = typeof raw.name === 'string' ? raw.name.trim() : null
  const title = typeof raw.title === 'string' ? raw.title.trim() : null
  if (!name || !title) return null
  let persona = typeof raw.persona === 'string' ? raw.persona.toLowerCase().trim() : 'other'
  if (!ALL_PERSONAS.includes(persona)) persona = 'other'
  const emailRaw = typeof raw.email === 'string' ? raw.email.trim() : ''
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null
  const phoneRaw = typeof raw.phone === 'string' ? raw.phone.trim() : ''
  const phone = phoneRaw && phoneRaw.length >= 6 ? phoneRaw : null
  const locationRaw = typeof raw.location === 'string' ? raw.location.trim() : ''
  const location = locationRaw && locationRaw.length >= 2 ? locationRaw : null
  return {
    name,
    title,
    persona,
    source_url: typeof raw.source_url === 'string' && raw.source_url.trim() ? raw.source_url.trim() : null,
    in_target_persona: TARGET_PERSONAS.includes(persona),
    email,
    phone,
    location,
  }
}

async function discoverOne(client, companyName) {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCH_USES }],
    messages: [{ role: 'user', content: buildPrompt(companyName) }],
  })
  // Concatenate all text blocks in the final assistant turn.
  const textBlocks = (resp.content || []).filter(b => b.type === 'text').map(b => b.text || '')
  const text = textBlocks.join('\n').trim()
  const parsed = extractJson(text)
  if (!parsed || !Array.isArray(parsed.contacts)) {
    return { contacts: [], raw_text: text.slice(0, 500), parse_error: true }
  }
  const contacts = parsed.contacts.map(normalizeContact).filter(Boolean)
  return { contacts, parse_error: false }
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await worker(items[i], i)
      } catch (err) {
        results[i] = { error: err.message || String(err) }
      }
    }
  })
  await Promise.all(runners)
  return results
}

async function atomicWriteJson(path, data) {
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2))
  await rename(tmp, path)
}

async function main() {
  const args = parseArgs()
  if (!process.env.ANTHROPIC_API_KEY && !args.dryRun) {
    console.error('[discover-dm] ANTHROPIC_API_KEY not set')
    process.exit(1)
  }

  const [entriesRaw, dmRaw] = await Promise.all([
    readFile(ENTRIES_PATH, 'utf-8'),
    readFile(DM_PATH, 'utf-8').catch(() => '{}'),
  ])
  const entries = JSON.parse(entriesRaw)
  const dm = JSON.parse(dmRaw)

  const feedCompanies = collectFeedCompanies(entries)
  let targets
  if (args.only) {
    const onlySet = new Set(args.only.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
    targets = feedCompanies.filter(c => onlySet.has(c.toLowerCase()))
  } else if (args.refresh) {
    targets = feedCompanies // re-discover everything
  } else {
    targets = diffMissing(feedCompanies, dm)
  }
  if (args.limit && targets.length > args.limit) targets = targets.slice(0, args.limit)

  console.log(`[discover-dm] feed companies: ${feedCompanies.length}, already covered: ${feedCompanies.length - diffMissing(feedCompanies, dm).length}, missing: ${diffMissing(feedCompanies, dm).length}, processing: ${targets.length}${args.refresh ? ' (refresh)' : ''}${args.only ? ' (only)' : ''}`)
  const missing = targets
  if (missing.length === 0) {
    console.log('[discover-dm] nothing to do')
    return
  }
  if (args.dryRun) {
    for (const c of missing) console.log(`  - ${c}`)
    return
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const startedAt = Date.now()
  const results = await runWithConcurrency(missing, CONCURRENCY, async (companyName, i) => {
    const t0 = Date.now()
    process.stdout.write(`[discover-dm] (${i + 1}/${missing.length}) ${companyName} … `)
    const r = await discoverOne(client, companyName)
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`${r.contacts.length} contacts${r.parse_error ? ' (parse error)' : ''} · ${dt}s`)
    return { companyName, ...r }
  })

  // Merge into dm. Preserve existing entries — only write new keys.
  const now = new Date().toISOString()
  let added = 0
  let totalContacts = 0
  let parseErrors = 0
  for (const r of results) {
    if (!r || !r.companyName) continue
    if (r.error) {
      console.warn(`[discover-dm] error for ${r.companyName}: ${r.error}`)
      continue
    }
    const key = r.companyName.toLowerCase()
    if (dm[key] && !args.refresh && !args.only) continue // skip already-covered unless refresh/only
    dm[key] = {
      discovered_at: now,
      contacts: r.contacts,
    }
    added++
    totalContacts += r.contacts.length
    if (r.parse_error) parseErrors++
  }

  // Update _meta.
  dm._meta = {
    ...(dm._meta || {}),
    generated_at: dm._meta?.generated_at || now,
    last_updated_at: now,
    method: 'Anthropic web_search tool, claude-sonnet-4-6, ~3 searches per company',
    personas: ALL_PERSONAS,
    in_target_personas: TARGET_PERSONAS,
  }

  await atomicWriteJson(DM_PATH, dm)
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`[discover-dm] done · added ${added} companies · ${totalContacts} contacts · ${parseErrors} parse errors · ${elapsed}s`)
}

main().catch(err => {
  console.error('[discover-dm] fatal', err)
  process.exit(1)
})
