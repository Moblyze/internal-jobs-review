// scripts/feed-ingest/healthAlert.js
//
// BD intel feed health alerting.
//
// Design (2026-08-18 redesign). Three properties the old version lacked:
//
//   1. It reports the REAL error. `fetchAllSources` already captures `err.message`
//      ("Status code 403"); the old alert threw it away and said only "last OK never".
//      MINING.com sat dead for 5 weeks because of that. The error text and HTTP status
//      are now carried all the way into the Slack message.
//
//   2. It does not repeat every run. feed-ingest runs every 6h, so the old alert
//      re-posted the identical line 4x/day forever. Alerts now fire on STATE CHANGE
//      (ok -> problem, problem -> ok, or a new error class) and then re-remind at
//      HEALTH_REMIND_INTERVAL_HOURS while the condition persists. State is persisted
//      in public/data/feed/alert_state.json, which the feed-ingest workflow already
//      commits along with the rest of public/data/feed/.
//
//   3. It separates CONTENT staleness from FETCH failure. A feed can return HTTP 200
//      with the same aging items forever (BOEM US, WindEurope). That never tripped the
//      old fetch-based check. Content thresholds are per-source and calibrated against
//      each feed's real observed publishing cadence (see CONTENT_STALE_DAYS_RATIONALE
//      and the `content_stale_days` field in sources.json).
//
// Message copy in here is read by humans in Slack: no em dashes (house style).

import {
  HEALTH_ALERT_THRESHOLD_HOURS,
  HEALTH_REMIND_INTERVAL_HOURS,
  CONTENT_STALE_DEFAULT_DAYS,
} from './config.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Conditions that are worth telling a human about. */
const PROBLEM_GROUPS = new Set(['fetch_fail', 'content_stale'])

/**
 * A single fetch failure is usually a blip. Treat a failure as reportable only once
 * the source has been failing longer than HEALTH_ALERT_THRESHOLD_HOURS (the same
 * semantic the old findStaleSources had). Until then it is recorded as
 * `fetch_flapping`: the error text is kept in state so the eventual alert can show
 * how long it has really been broken, but nothing is posted.
 */
export function conditionGroup(kind) {
  return kind === 'fetch_flapping' ? 'fetch_fail' : kind
}

export function isProblem(kind) {
  return PROBLEM_GROUPS.has(conditionGroup(kind))
}

/** Trim an error string down to something safe and readable in Slack. */
export function sanitizeError(message, maxLen = 200) {
  const flat = String(message ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return 'unknown error'
  return flat.length > maxLen ? `${flat.slice(0, maxLen - 1)}…` : flat
}

/**
 * Turn a raw fetch error message into a stable class plus an HTTP status when one
 * is present. The class is what dedupe compares on, so a 403 turning into a 500
 * re-alerts immediately instead of hiding behind the reminder interval.
 *
 * Real shapes seen in this pipeline:
 *   rss-parser  -> "Status code 403"
 *   edgar.js    -> "EDGAR 429"
 *   fetchSources timeout race -> "timeout"
 *   node fetch  -> "getaddrinfo ENOTFOUND ...", "fetch failed"
 */
export function classifyFetchError(message) {
  const msg = String(message ?? '')
  const explicit = msg.match(/(?:status(?:\s+code)?|http|edgar)\s*[:=]?\s*(\d{3})\b/i)
  const bare = msg.match(/\b([45]\d{2})\b/)
  const http_status = explicit ? Number(explicit[1]) : bare ? Number(bare[1]) : null

  let error_class
  if (http_status) error_class = `http_${http_status}`
  else if (/timeout|timed ?out|etimedout|esockettimedout/i.test(msg)) error_class = 'timeout'
  else if (/enotfound|eai_again|getaddrinfo/i.test(msg)) error_class = 'dns'
  else if (/econnrefused|econnreset|epipe|socket hang up|network|fetch failed/i.test(msg)) error_class = 'connection'
  else if (/cert|ssl|tls|self.signed/i.test(msg)) error_class = 'tls'
  else if (/non-whitespace before first tag|unexpected (close ?)?tag|unclosed root tag|invalid character|not recognized|unexpected end/i.test(msg)) error_class = 'parse_error'
  else error_class = 'other'

  return { error_class, http_status }
}

/** Newest item publish time seen in this run's fetch, in ms, or null. */
export function newestItemMsFromItems(items = []) {
  let newest = null
  for (const it of items) {
    if (!it || !it.published_at) continue
    const t = Date.parse(it.published_at)
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t
  }
  return newest
}

export function contentStaleDaysFor(source, fallback = CONTENT_STALE_DEFAULT_DAYS) {
  const v = Number(source?.content_stale_days)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/**
 * Collapse this run's fetch results plus the persisted source records into one
 * condition per active source.
 *
 * Returns objects shaped:
 *   { id, name, kind, error, error_class, http_status,
 *     last_seen_ok_at, hours_since_ok,
 *     newest_item_at, content_age_days, content_stale_days }
 *
 * kind is one of: 'ok' | 'fetch_fail' | 'fetch_flapping' | 'content_stale' | 'content_unknown'
 */
export function buildSourceConditions({
  sources = [],
  fetchResults = [],
  nowMs = Date.now(),
  thresholdHours = HEALTH_ALERT_THRESHOLD_HOURS,
  defaultContentStaleDays = CONTENT_STALE_DEFAULT_DAYS,
} = {}) {
  const byId = new Map(fetchResults.map(r => [r.source?.id, r]))

  return sources.filter(s => s.active).map(s => {
    const r = byId.get(s.id)
    const lastOkMs = s.last_seen_ok_at ? Date.parse(s.last_seen_ok_at) : NaN
    const hoursSinceOk = Number.isFinite(lastOkMs) ? (nowMs - lastOkMs) / HOUR_MS : Infinity
    const base = {
      id: s.id,
      name: s.name || s.id,
      last_seen_ok_at: s.last_seen_ok_at || null,
      hours_since_ok: Number.isFinite(hoursSinceOk) ? Math.round(hoursSinceOk * 10) / 10 : null,
      error: null,
      error_class: null,
      http_status: null,
      newest_item_at: s.newest_item_published_at || null,
      content_age_days: null,
      content_stale_days: contentStaleDaysFor(s, defaultContentStaleDays),
    }

    // 1. Fetch failed this run, or the source was never fetched at all.
    if (!r || r.ok === false) {
      const rawError = r ? r.error : 'source produced no fetch result this run'
      const { error_class, http_status } = r
        ? classifyFetchError(rawError)
        : { error_class: 'not_fetched', http_status: null }
      return {
        ...base,
        kind: hoursSinceOk > thresholdHours ? 'fetch_fail' : 'fetch_flapping',
        error: sanitizeError(rawError),
        error_class,
        http_status,
      }
    }

    // 2. Fetch succeeded. Judge content freshness.
    const runNewest = newestItemMsFromItems(r.items)
    const storedNewest = s.newest_item_published_at ? Date.parse(s.newest_item_published_at) : NaN
    const newestMs = runNewest !== null
      ? runNewest
      : (Number.isFinite(storedNewest) ? storedNewest : null)

    if (newestMs === null) {
      // Source returns items with no usable dates, so content age is unknowable.
      // Never alert on this; it would be a permanent false positive.
      return { ...base, kind: 'content_unknown' }
    }

    const ageDays = (nowMs - newestMs) / DAY_MS
    const out = {
      ...base,
      newest_item_at: new Date(newestMs).toISOString(),
      content_age_days: Math.round(ageDays * 10) / 10,
    }
    return { ...out, kind: ageDays > out.content_stale_days ? 'content_stale' : 'ok' }
  })
}

/**
 * Fold this run's fetch results back into the source records.
 *
 * Two independent stamps, deliberately kept apart:
 *   last_seen_ok_at            the source ANSWERED (fetch health)
 *   newest_item_published_at   the source PUBLISHED (content freshness)
 *
 * A feed that keeps serving the same aging items moves the first and not the second,
 * which is exactly the BOEM/WindEurope case the old fetch-only check could not see.
 * newest_item_published_at only ever moves forward, so one truncated fetch cannot
 * rewrite history backwards.
 */
export function updateSourceRecords(sources = [], fetchResults = [], nowIso = new Date().toISOString()) {
  return sources.map(src => {
    const r = fetchResults.find(f => f.source?.id === src.id)
    if (!r || !r.ok || !r.items || r.items.length === 0) return src
    const next = { ...src, last_seen_ok_at: nowIso }
    const newestMs = newestItemMsFromItems(r.items)
    const priorMs = src.newest_item_published_at ? Date.parse(src.newest_item_published_at) : NaN
    if (newestMs !== null && (!Number.isFinite(priorMs) || newestMs > priorMs)) {
      next.newest_item_published_at = new Date(newestMs).toISOString()
    }
    return next
  })
}

const iso = ms => new Date(ms).toISOString()

/**
 * Compare this run's conditions against the persisted alert state and decide what
 * actually needs to be said. This is the whole point of the redesign: no message
 * unless something changed, or the reminder interval has elapsed on a live problem.
 *
 * Returns { problems, recoveries, nextState }.
 *   problems[].reason  = 'new' | 'changed' | 'reminder'
 */
export function decideAlerts(previousState, conditions, nowMs = Date.now(), {
  remindIntervalHours = HEALTH_REMIND_INTERVAL_HOURS,
} = {}) {
  const prev = (previousState && previousState.sources) || {}
  const nextSources = {}
  const problems = []
  const recoveries = []

  for (const c of conditions) {
    const p = prev[c.id] || null
    const nowIso = iso(nowMs)

    if (!isProblem(c.kind)) {
      // Announce a recovery only if we ever told anyone it was broken.
      if (p && isProblem(p.kind) && p.last_alerted_at) {
        recoveries.push({ condition: c, previous: p, since: p.first_seen_at || null })
      }
      nextSources[c.id] = {
        kind: c.kind,
        error: null,
        error_class: null,
        http_status: null,
        first_seen_at: null,
        last_alerted_at: null,
        alert_count: 0,
      }
      continue
    }

    const sameCondition = !!p
      && conditionGroup(p.kind) === conditionGroup(c.kind)
      && (p.error_class || null) === (c.error_class || null)

    const firstSeenAt = sameCondition && p.first_seen_at ? p.first_seen_at : nowIso
    const lastAlertedMs = sameCondition && p.last_alerted_at ? Date.parse(p.last_alerted_at) : null

    let reason = null
    if (c.kind === 'fetch_flapping') {
      // Under the sustained-failure threshold: record, stay quiet.
      reason = null
    } else if (!sameCondition) {
      reason = p && isProblem(p.kind) ? 'changed' : 'new'
    } else if (lastAlertedMs === null) {
      reason = 'new'
    } else if (nowMs - lastAlertedMs >= remindIntervalHours * HOUR_MS) {
      reason = 'reminder'
    }

    const alertCount = sameCondition ? (p.alert_count || 0) : 0
    if (reason) {
      problems.push({ condition: c, reason, since: firstSeenAt, alert_count: alertCount + 1 })
    }

    nextSources[c.id] = {
      kind: c.kind,
      error: c.error || null,
      error_class: c.error_class || null,
      http_status: c.http_status ?? null,
      first_seen_at: firstSeenAt,
      last_alerted_at: reason ? nowIso : (sameCondition ? p.last_alerted_at || null : null),
      alert_count: reason ? alertCount + 1 : alertCount,
    }
  }

  return {
    problems,
    recoveries,
    nextState: { version: 1, updated_at: iso(nowMs), sources: nextSources },
  }
}

function fmtDuration(fromIso, nowMs) {
  if (!fromIso) return 'unknown'
  const t = Date.parse(fromIso)
  if (!Number.isFinite(t)) return 'unknown'
  const days = (nowMs - t) / DAY_MS
  if (days >= 1) return `${days.toFixed(days < 10 ? 1 : 0)}d`
  return `${Math.max(1, Math.round((nowMs - t) / HOUR_MS))}h`
}

const shortIso = s => (s ? String(s).slice(0, 16).replace('T', ' ') + 'Z' : 'never')

/**
 * Render the Slack message. Returns null when there is nothing to say, which is the
 * normal case on most runs.
 */
export function renderAlertText(decision, {
  nowMs = Date.now(),
  remindIntervalHours = HEALTH_REMIND_INTERVAL_HOURS,
  conditions = null,
} = {}) {
  const { problems = [], recoveries = [] } = decision || {}
  if (!problems.length && !recoveries.length) return null

  const fetchFails = problems.filter(p => p.condition.kind === 'fetch_fail')
  const contentStale = problems.filter(p => p.condition.kind === 'content_stale')

  const icon = fetchFails.length ? ':rotating_light:' : ':warning:'
  const lines = [`${icon} *BD intel feed health*`]

  if (fetchFails.length) {
    lines.push('', `*Fetch failing (${fetchFails.length})*`)
    for (const p of fetchFails) {
      const c = p.condition
      const status = c.http_status ? `HTTP ${c.http_status}` : c.error_class
      lines.push(
        `• *${c.name}* (\`${c.id}\`): ${status} | \`${c.error}\`` +
        `\n   failing ${fmtDuration(p.since, nowMs)} (since ${shortIso(p.since)}), last OK ${shortIso(c.last_seen_ok_at)} | ${p.reason}`
      )
    }
  }

  if (contentStale.length) {
    lines.push('', `*Content stale, fetch is fine (${contentStale.length})*`)
    for (const p of contentStale) {
      const c = p.condition
      lines.push(
        `• *${c.name}* (\`${c.id}\`): HTTP 200 but newest item is ${shortIso(c.newest_item_at)}` +
        `\n   ${c.content_age_days}d old vs ${c.content_stale_days}d threshold | ${p.reason}`
      )
    }
  }

  if (recoveries.length) {
    lines.push('', `*Recovered (${recoveries.length})*`)
    for (const r of recoveries) {
      const c = r.condition
      const was = r.previous?.error_class ? ` (was ${r.previous.error_class})` : ''
      lines.push(`• *${c.name}* (\`${c.id}\`): back to normal after ${fmtDuration(r.since, nowMs)}${was}`)
    }
  }

  // Watchlist: sources more than halfway to their own content threshold but not yet
  // over it. Gives the ageing-but-not-dead feeds visibility without alerting on them.
  if (conditions && conditions.length) {
    const roster = conditions
      .filter(c => c.kind !== 'content_stale')
      .filter(c => Number.isFinite(c.content_age_days) && c.content_age_days / c.content_stale_days >= 0.5)
      .sort((a, b) => b.content_age_days / b.content_stale_days - a.content_age_days / a.content_stale_days)
      .slice(0, 5)
      .map(c => `${c.id} ${c.content_age_days}d of ${c.content_stale_days}d`)
      .join(', ')
    if (roster) lines.push('', `_Content watchlist (not yet stale): ${roster}_`)
  }

  lines.push(
    '',
    `_Next reminder in ${remindIntervalHours}h if unchanged. Sources: \`public/data/feed/sources.json\`, adapters: \`scripts/feed-ingest/sources/\`._`
  )

  return lines.join('\n')
}

export async function postHealthAlert(text, slackWebhookUrl) {
  if (!text) return { posted: false, reason: 'nothing_to_report' }
  if (!slackWebhookUrl) {
    console.warn('[health] no SLACK_WEBHOOK_URL set; skipping alert')
    return { posted: false, reason: 'no_webhook' }
  }
  const res = await fetch(slackWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  return { posted: res.ok, status: res.status }
}

/**
 * Retained from the original implementation. Still the definition of "this fetch
 * failure has lasted long enough to be worth a human's attention", and still used
 * by buildSourceConditions via HEALTH_ALERT_THRESHOLD_HOURS.
 */
export function findStaleSources(sources, nowMs = Date.now()) {
  const thresholdMs = HEALTH_ALERT_THRESHOLD_HOURS * 60 * 60 * 1000
  return sources.filter(s => {
    if (!s.active) return false
    if (!s.last_seen_ok_at) return true
    return nowMs - new Date(s.last_seen_ok_at).getTime() > thresholdMs
  })
}
