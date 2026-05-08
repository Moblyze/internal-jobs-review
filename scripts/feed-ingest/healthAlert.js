import { HEALTH_ALERT_THRESHOLD_HOURS } from './config.js'

export async function postHealthAlert(staleSources, slackWebhookUrl) {
  if (!staleSources.length) return { posted: false }
  if (!slackWebhookUrl) {
    console.warn('[health] no SLACK_WEBHOOK_URL set; skipping alert')
    return { posted: false }
  }
  const lines = staleSources.map(s => `• *${s.name}* — last OK ${s.last_seen_ok_at || 'never'}`).join('\n')
  const text = `:warning: BD intel feed — sources silent >${HEALTH_ALERT_THRESHOLD_HOURS}h:\n${lines}\nInvestigate: \`scripts/feed-ingest/sources/\``
  const res = await fetch(slackWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  return { posted: res.ok, status: res.status }
}

export function findStaleSources(sources, nowMs = Date.now()) {
  const thresholdMs = HEALTH_ALERT_THRESHOLD_HOURS * 60 * 60 * 1000
  return sources.filter(s => {
    if (!s.active) return false
    if (!s.last_seen_ok_at) return true
    return nowMs - new Date(s.last_seen_ok_at).getTime() > thresholdMs
  })
}
