// scripts/feed-ingest/health-report.js
//
// Dry-run / inspection path for the BD intel feed health alert.
//
// It NEVER posts to Slack and NEVER writes alert_state.json. It exists so the alert
// message can be proven to render before it is trusted in #monitoring, and so the
// current health of every source can be checked without running a full ingest
// (a full ingest calls the Anthropic API and costs money; this does not).
//
// Usage:
//   npm run health-report                 fetch the live feeds, evaluate against the
//                                         committed alert_state.json, print the message
//   npm run health-report -- --offline    render a fixed scenario, no network at all
//   npm run health-report -- --json       also print the conditions and next state

import { PATHS, readJson, HEALTH_REMIND_INTERVAL_HOURS } from './config.js'
import { fetchAllSources } from './fetchSources.js'
import { buildSourceConditions, decideAlerts, renderAlertText } from './healthAlert.js'

const argv = process.argv.slice(2)
const OFFLINE = argv.includes('--offline')
const AS_JSON = argv.includes('--json')

/**
 * Deterministic scenario used by --offline. Exercises every branch of the message:
 * a sustained fetch failure with a real HTTP status, a content-stale source that is
 * fetching fine, and a recovery. Modelled on the real MINING.com 403 outage.
 */
export function offlineFixture(nowMs) {
  const iso = ms => new Date(ms).toISOString()
  const DAY = 86_400_000
  const sources = [
    { id: 'mining_com', name: 'MINING.com', type: 'rss', active: true, last_seen_ok_at: iso(nowMs - 35 * DAY), newest_item_published_at: iso(nowMs - 35 * DAY) },
    { id: 'boem_us', name: 'BOEM US', type: 'rss', active: true, last_seen_ok_at: iso(nowMs), content_stale_days: 90, newest_item_published_at: iso(nowMs - 120 * DAY) },
    { id: 'rigzone', name: 'Rigzone', type: 'rss', active: true, last_seen_ok_at: iso(nowMs), newest_item_published_at: iso(nowMs) },
    { id: 'windeurope', name: 'WindEurope', type: 'rss', active: true, last_seen_ok_at: iso(nowMs), content_stale_days: 30, newest_item_published_at: iso(nowMs - 20 * DAY) },
  ]
  const fetchResults = [
    { source: sources[0], items: [], ok: false, error: 'Status code 403', elapsed_ms: 412 },
    { source: sources[1], items: [{ published_at: iso(nowMs - 120 * DAY) }], ok: true, elapsed_ms: 300 },
    { source: sources[2], items: [{ published_at: iso(nowMs) }], ok: true, elapsed_ms: 250 },
    { source: sources[3], items: [{ published_at: iso(nowMs - 20 * DAY) }], ok: true, elapsed_ms: 280 },
  ]
  const previousState = {
    version: 1,
    updated_at: iso(nowMs - 6 * 3_600_000),
    sources: {
      // MINING.com already alerted 30h ago: this run is a reminder, not a new alert.
      mining_com: { kind: 'fetch_fail', error: 'Status code 403', error_class: 'http_403', http_status: 403, first_seen_at: iso(nowMs - 35 * DAY), last_alerted_at: iso(nowMs - 30 * 3_600_000), alert_count: 34 },
      // BOEM is newly stale on content: first alert.
      boem_us: { kind: 'ok', error: null, error_class: null, http_status: null, first_seen_at: null, last_alerted_at: null, alert_count: 0 },
      // Rigzone was failing and we said so: this run announces the recovery.
      rigzone: { kind: 'fetch_fail', error: 'timeout', error_class: 'timeout', http_status: null, first_seen_at: iso(nowMs - 3 * DAY), last_alerted_at: iso(nowMs - DAY), alert_count: 3 },
      // WindEurope is ageing (20d of a 30d threshold) but not stale: watchlist only.
      windeurope: { kind: 'ok', error: null, error_class: null, http_status: null, first_seen_at: null, last_alerted_at: null, alert_count: 0 },
    },
  }
  return { sources, fetchResults, previousState }
}

async function main() {
  const nowMs = Date.now()
  let sources, fetchResults, previousState

  if (OFFLINE) {
    ({ sources, fetchResults, previousState } = offlineFixture(nowMs))
    console.log('[health-report] OFFLINE fixture scenario (no network, no Slack, no writes)\n')
  } else {
    sources = await readJson(PATHS.SOURCES)
    previousState = await readJson(PATHS.ALERT_STATE).catch(() => null)
    console.log(`[health-report] fetching ${sources.filter(s => s.active).length} active sources (no Slack, no writes)\n`)
    fetchResults = await fetchAllSources(sources)
  }

  const conditions = buildSourceConditions({ sources, fetchResults, nowMs })

  console.log('SOURCE HEALTH')
  const pad = (s, n) => String(s).padEnd(n)
  console.log(`  ${pad('source', 22)}${pad('condition', 17)}${pad('content_age', 13)}${pad('threshold', 11)}detail`)
  for (const c of conditions) {
    const age = c.content_age_days === null ? 'n/a' : `${c.content_age_days}d`
    const detail = c.error ? `${c.error_class} :: ${c.error}` : `newest ${c.newest_item_at || 'unknown'}`
    console.log(`  ${pad(c.id, 22)}${pad(c.kind, 17)}${pad(age, 13)}${pad(c.content_stale_days + 'd', 11)}${detail}`)
  }

  const decision = decideAlerts(previousState, conditions, nowMs)
  const text = renderAlertText(decision, { nowMs, conditions })

  console.log('\nALERT DECISION')
  console.log(`  problems: ${decision.problems.length} (${decision.problems.map(p => `${p.condition.id}:${p.reason}`).join(', ') || 'none'})`)
  console.log(`  recoveries: ${decision.recoveries.length} (${decision.recoveries.map(r => r.condition.id).join(', ') || 'none'})`)
  console.log(`  remind interval: ${HEALTH_REMIND_INTERVAL_HOURS}h`)

  console.log('\nSLACK MESSAGE THAT WOULD BE POSTED')
  console.log('----------------------------------------------------------------')
  console.log(text === null ? '(nothing: no state change and no reminder due)' : text)
  console.log('----------------------------------------------------------------')

  if (AS_JSON) {
    console.log('\nCONDITIONS\n' + JSON.stringify(conditions, null, 2))
    console.log('\nNEXT STATE (not written)\n' + JSON.stringify(decision.nextState, null, 2))
  }

  console.log('\n[health-report] dry run complete. Nothing was posted and nothing was written.')
}

main().catch(err => {
  console.error('[health-report] failed', err)
  process.exit(1)
})
