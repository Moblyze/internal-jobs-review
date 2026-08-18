import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findStaleSources,
  classifyFetchError,
  sanitizeError,
  newestItemMsFromItems,
  contentStaleDaysFor,
  buildSourceConditions,
  decideAlerts,
  renderAlertText,
  updateSourceRecords,
} from '../healthAlert.js'

const DAY = 86_400_000
const HOUR = 3_600_000
const NOW = new Date('2026-08-18T12:00:00Z').getTime()
const iso = ms => new Date(ms).toISOString()

test('findStaleSources flags >48h-silent active sources', () => {
  const now = new Date('2026-05-07T12:00:00Z').getTime()
  const sources = [
    { id: 'a', active: true, last_seen_ok_at: '2026-05-07T11:00:00Z' },
    { id: 'b', active: true, last_seen_ok_at: '2026-05-04T10:00:00Z' },
    { id: 'c', active: false, last_seen_ok_at: null },
    { id: 'd', active: true, last_seen_ok_at: null },
  ]
  const stale = findStaleSources(sources, now).map(s => s.id)
  assert.deepEqual(stale.sort(), ['b', 'd'])
})

// --- error classification -------------------------------------------------

test('classifyFetchError extracts the HTTP status from real error shapes', () => {
  assert.deepEqual(classifyFetchError('Status code 403'), { error_class: 'http_403', http_status: 403 })
  assert.deepEqual(classifyFetchError('EDGAR 429'), { error_class: 'http_429', http_status: 429 })
  assert.deepEqual(classifyFetchError('Status code 500'), { error_class: 'http_500', http_status: 500 })
})

test('classifyFetchError classifies non-HTTP failures', () => {
  assert.equal(classifyFetchError('timeout').error_class, 'timeout')
  assert.equal(classifyFetchError('getaddrinfo ENOTFOUND feeds.example.com').error_class, 'dns')
  assert.equal(classifyFetchError('socket hang up').error_class, 'connection')
  assert.equal(classifyFetchError('Non-whitespace before first tag').error_class, 'parse_error')
  assert.equal(classifyFetchError('something odd').error_class, 'other')
  assert.equal(classifyFetchError(undefined).error_class, 'other')
})

test('sanitizeError collapses whitespace and truncates', () => {
  assert.equal(sanitizeError('  Status\n  code 403 '), 'Status code 403')
  assert.equal(sanitizeError(''), 'unknown error')
  assert.equal(sanitizeError('x'.repeat(400)).length, 200)
})

// --- content freshness ----------------------------------------------------

test('newestItemMsFromItems picks the newest dated item and ignores undated ones', () => {
  const items = [
    { published_at: '2026-08-01T00:00:00Z' },
    { published_at: null },
    { published_at: '2026-08-14T00:00:00Z' },
    {},
  ]
  assert.equal(newestItemMsFromItems(items), Date.parse('2026-08-14T00:00:00Z'))
  assert.equal(newestItemMsFromItems([]), null)
  assert.equal(newestItemMsFromItems([{ published_at: null }]), null)
})

test('contentStaleDaysFor honours the per-source override and falls back', () => {
  assert.equal(contentStaleDaysFor({ content_stale_days: 90 }, 7), 90)
  assert.equal(contentStaleDaysFor({}, 7), 7)
  assert.equal(contentStaleDaysFor({ content_stale_days: 0 }, 7), 7)
})

test('buildSourceConditions separates content staleness from fetch failure', () => {
  // BOEM-shaped: fetches fine (HTTP 200, items returned) but published nothing
  // for 120 days against a 90d threshold. The old fetch-only check never saw this.
  const sources = [
    { id: 'boem_us', name: 'BOEM US', active: true, last_seen_ok_at: iso(NOW), content_stale_days: 90 },
    { id: 'windeurope', name: 'WindEurope', active: true, last_seen_ok_at: iso(NOW), content_stale_days: 30 },
    { id: 'dead', name: 'Dead', active: false, last_seen_ok_at: null },
  ]
  const fetchResults = [
    { source: sources[0], ok: true, items: [{ published_at: iso(NOW - 120 * DAY) }] },
    { source: sources[1], ok: true, items: [{ published_at: iso(NOW - 13 * DAY) }] },
  ]
  const conds = buildSourceConditions({ sources, fetchResults, nowMs: NOW })
  assert.equal(conds.length, 2, 'inactive sources are excluded')

  const boem = conds.find(c => c.id === 'boem_us')
  assert.equal(boem.kind, 'content_stale')
  assert.equal(boem.content_age_days, 120)
  assert.equal(boem.content_stale_days, 90)

  // 13 days against a 30d threshold is within WindEurope's real cadence: not an alert.
  const we = conds.find(c => c.id === 'windeurope')
  assert.equal(we.kind, 'ok')
  assert.equal(we.content_age_days, 13)
})

test('buildSourceConditions carries the error text and status through, and only calls a failure sustained after the threshold', () => {
  const sustained = { id: 'mining_com', name: 'MINING.com', active: true, last_seen_ok_at: iso(NOW - 35 * DAY) }
  const fresh = { id: 'rigzone', name: 'Rigzone', active: true, last_seen_ok_at: iso(NOW - 6 * HOUR) }
  const fetchResults = [
    { source: sustained, ok: false, items: [], error: 'Status code 403' },
    { source: fresh, ok: false, items: [], error: 'timeout' },
  ]
  const conds = buildSourceConditions({ sources: [sustained, fresh], fetchResults, nowMs: NOW })

  const mining = conds.find(c => c.id === 'mining_com')
  assert.equal(mining.kind, 'fetch_fail')
  assert.equal(mining.error, 'Status code 403')
  assert.equal(mining.error_class, 'http_403')
  assert.equal(mining.http_status, 403)

  // 6h into an outage is a blip, recorded but not alerted.
  const rig = conds.find(c => c.id === 'rigzone')
  assert.equal(rig.kind, 'fetch_flapping')
  assert.equal(rig.error_class, 'timeout')
})

test('buildSourceConditions never alerts on a source whose items carry no dates', () => {
  const s = { id: 'undated', name: 'Undated', active: true, last_seen_ok_at: iso(NOW) }
  const conds = buildSourceConditions({
    sources: [s],
    fetchResults: [{ source: s, ok: true, items: [{ published_at: null }] }],
    nowMs: NOW,
  })
  assert.equal(conds[0].kind, 'content_unknown')
})

// --- dedupe / state machine ----------------------------------------------

const failCond = (over = {}) => ({
  id: 'mining_com', name: 'MINING.com', kind: 'fetch_fail',
  error: 'Status code 403', error_class: 'http_403', http_status: 403,
  last_seen_ok_at: iso(NOW - 35 * DAY), hours_since_ok: 840,
  newest_item_at: null, content_age_days: null, content_stale_days: 7,
  ...over,
})

test('a brand new problem alerts', () => {
  const d = decideAlerts(null, [failCond()], NOW)
  assert.equal(d.problems.length, 1)
  assert.equal(d.problems[0].reason, 'new')
  assert.equal(d.nextState.sources.mining_com.last_alerted_at, iso(NOW))
})

test('the same unchanged problem does NOT re-alert on the next 6h run', () => {
  const first = decideAlerts(null, [failCond()], NOW)
  // feed-ingest runs every 6h. Under the old code this posted again, 4x/day forever.
  const second = decideAlerts(first.nextState, [failCond()], NOW + 6 * HOUR)
  assert.equal(second.problems.length, 0)
  const third = decideAlerts(second.nextState, [failCond()], NOW + 12 * HOUR)
  assert.equal(third.problems.length, 0)
  const fourth = decideAlerts(third.nextState, [failCond()], NOW + 18 * HOUR)
  assert.equal(fourth.problems.length, 0)
  // Original first_seen_at survives every quiet run.
  assert.equal(fourth.nextState.sources.mining_com.first_seen_at, iso(NOW))
})

test('an unchanged problem re-reminds once the interval has elapsed', () => {
  const first = decideAlerts(null, [failCond()], NOW)
  const quiet = decideAlerts(first.nextState, [failCond()], NOW + 18 * HOUR)
  const remind = decideAlerts(quiet.nextState, [failCond()], NOW + 24 * HOUR)
  assert.equal(remind.problems.length, 1)
  assert.equal(remind.problems[0].reason, 'reminder')
  assert.equal(remind.problems[0].alert_count, 2)
  assert.equal(remind.problems[0].since, iso(NOW), 'reminder still reports the original start')
})

test('a new error class re-alerts immediately, without waiting for the interval', () => {
  const first = decideAlerts(null, [failCond()], NOW)
  const changed = decideAlerts(
    first.nextState,
    [failCond({ error: 'Status code 500', error_class: 'http_500', http_status: 500 })],
    NOW + HOUR,
  )
  assert.equal(changed.problems.length, 1)
  assert.equal(changed.problems[0].reason, 'changed')
  assert.equal(changed.problems[0].since, iso(NOW + HOUR), 'a new class restarts the clock')
})

test('recovery alerts once, then goes quiet', () => {
  const okCond = { id: 'mining_com', name: 'MINING.com', kind: 'ok', content_age_days: 0.5, content_stale_days: 7 }
  const first = decideAlerts(null, [failCond()], NOW)
  const recovered = decideAlerts(first.nextState, [okCond], NOW + 2 * DAY)
  assert.equal(recovered.recoveries.length, 1)
  assert.equal(recovered.problems.length, 0)
  const after = decideAlerts(recovered.nextState, [okCond], NOW + 3 * DAY)
  assert.equal(after.recoveries.length, 0)
  assert.equal(after.problems.length, 0)
})

test('a flap that was never alerted never produces a recovery message', () => {
  const flap = failCond({ kind: 'fetch_flapping', last_seen_ok_at: iso(NOW - 6 * HOUR) })
  const okCond = { id: 'mining_com', name: 'MINING.com', kind: 'ok', content_age_days: 0.5, content_stale_days: 7 }
  const first = decideAlerts(null, [flap], NOW)
  assert.equal(first.problems.length, 0, 'flapping is recorded, not announced')
  assert.equal(first.nextState.sources.mining_com.error, 'Status code 403', 'but the error text is kept')
  const back = decideAlerts(first.nextState, [okCond], NOW + HOUR)
  assert.equal(back.recoveries.length, 0)
})

test('a flap that hardens into a sustained failure reports the true outage start', () => {
  const flap = failCond({ kind: 'fetch_flapping', last_seen_ok_at: iso(NOW - 6 * HOUR) })
  const first = decideAlerts(null, [flap], NOW)
  const hard = decideAlerts(first.nextState, [failCond()], NOW + 2 * DAY)
  assert.equal(hard.problems.length, 1)
  assert.equal(hard.problems[0].reason, 'new')
  assert.equal(hard.problems[0].since, iso(NOW), 'continuity across the flapping -> fail transition')
})

// --- message rendering ----------------------------------------------------

test('renderAlertText returns null when nothing changed', () => {
  assert.equal(renderAlertText({ problems: [], recoveries: [] }, { nowMs: NOW }), null)
})

test('renderAlertText includes the error text, the HTTP status and the outage length', () => {
  const d = decideAlerts(null, [failCond()], NOW)
  const text = renderAlertText(d, { nowMs: NOW })
  assert.match(text, /MINING\.com/)
  assert.match(text, /HTTP 403/)
  assert.match(text, /Status code 403/)
  assert.match(text, /last OK 2026-07-14/)
  assert.match(text, /Fetch failing \(1\)/)
})

test('renderAlertText reports content staleness in its own section with the threshold', () => {
  const stale = {
    id: 'boem_us', name: 'BOEM US', kind: 'content_stale',
    error: null, error_class: null, http_status: null,
    last_seen_ok_at: iso(NOW), newest_item_at: iso(NOW - 120 * DAY),
    content_age_days: 120, content_stale_days: 90,
  }
  const text = renderAlertText(decideAlerts(null, [stale], NOW), { nowMs: NOW })
  assert.match(text, /Content stale, fetch is fine \(1\)/)
  assert.match(text, /HTTP 200 but newest item is/)
  assert.match(text, /120d old vs 90d threshold/)
  assert.doesNotMatch(text, /Fetch failing/)
})

test('alert copy contains no em dashes (house style, and they break GSM-7 downstream)', () => {
  const stale = {
    id: 'boem_us', name: 'BOEM US', kind: 'content_stale',
    last_seen_ok_at: iso(NOW), newest_item_at: iso(NOW - 120 * DAY),
    content_age_days: 120, content_stale_days: 90,
  }
  const d = decideAlerts(null, [failCond(), stale], NOW)
  const text = renderAlertText(d, { nowMs: NOW, conditions: [failCond(), stale] })
  assert.doesNotMatch(text, /—/)
  assert.doesNotMatch(text, /–/)
})

test('the content watchlist lists ageing sources but excludes healthy and already-stale ones', () => {
  const conditions = [
    { id: 'windeurope', name: 'WindEurope', kind: 'ok', content_age_days: 20, content_stale_days: 30 },
    { id: 'rigzone', name: 'Rigzone', kind: 'ok', content_age_days: 0.2, content_stale_days: 7 },
    { id: 'boem_us', name: 'BOEM US', kind: 'content_stale', content_age_days: 120, content_stale_days: 90 },
  ]
  const d = decideAlerts(null, [failCond(), ...conditions], NOW)
  const text = renderAlertText(d, { nowMs: NOW, conditions: [failCond(), ...conditions] })
  assert.match(text, /Content watchlist \(not yet stale\): windeurope 20d of 30d/)
  assert.doesNotMatch(text, /watchlist[^\n]*rigzone/, 'a healthy source is not on the watchlist')
  assert.doesNotMatch(text, /watchlist[^\n]*boem_us/, 'an already-alerting source is not repeated on the watchlist')
})

// --- source record updates (step 2 of the ingest run) ---------------------

test('updateSourceRecords stamps fetch health and content freshness independently', () => {
  const nowIso = iso(NOW)
  const sources = [
    // Answers, but is serving items 120 days old: fetch health moves, content does not.
    { id: 'boem_us', active: true, last_seen_ok_at: iso(NOW - 6 * HOUR), newest_item_published_at: iso(NOW - 120 * DAY) },
    // Answers with a fresh item: both move.
    { id: 'rigzone', active: true, last_seen_ok_at: iso(NOW - 6 * HOUR), newest_item_published_at: iso(NOW - DAY) },
    // Fails: neither moves.
    { id: 'mining_com', active: true, last_seen_ok_at: iso(NOW - 35 * DAY), newest_item_published_at: iso(NOW - 35 * DAY) },
  ]
  const fetchResults = [
    { source: sources[0], ok: true, items: [{ published_at: iso(NOW - 120 * DAY) }] },
    { source: sources[1], ok: true, items: [{ published_at: iso(NOW) }] },
    { source: sources[2], ok: false, items: [], error: 'Status code 403' },
  ]
  const out = updateSourceRecords(sources, fetchResults, nowIso)

  const boem = out.find(s => s.id === 'boem_us')
  assert.equal(boem.last_seen_ok_at, nowIso, 'the source answered')
  assert.equal(boem.newest_item_published_at, iso(NOW - 120 * DAY), 'but it published nothing new')

  const rig = out.find(s => s.id === 'rigzone')
  assert.equal(rig.last_seen_ok_at, nowIso)
  assert.equal(rig.newest_item_published_at, iso(NOW))

  const mining = out.find(s => s.id === 'mining_com')
  assert.equal(mining.last_seen_ok_at, iso(NOW - 35 * DAY), 'a failed fetch leaves both stamps alone')
  assert.equal(mining.newest_item_published_at, iso(NOW - 35 * DAY))
})

test('updateSourceRecords never moves newest_item_published_at backwards', () => {
  const s = { id: 'x', active: true, last_seen_ok_at: iso(NOW - DAY), newest_item_published_at: iso(NOW - DAY) }
  // A truncated fetch that only returns an old item must not rewrite history.
  const out = updateSourceRecords([s], [{ source: s, ok: true, items: [{ published_at: iso(NOW - 40 * DAY) }] }], iso(NOW))
  assert.equal(out[0].newest_item_published_at, iso(NOW - DAY))
  assert.equal(out[0].last_seen_ok_at, iso(NOW))
})

test('updateSourceRecords leaves an empty-but-ok fetch untouched', () => {
  const s = { id: 'x', active: true, last_seen_ok_at: iso(NOW - DAY) }
  const out = updateSourceRecords([s], [{ source: s, ok: true, items: [] }], iso(NOW))
  assert.deepEqual(out[0], s)
})
