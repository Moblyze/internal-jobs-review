// src/utils/feed/relativeTime.js
import { formatDistanceToNowStrict, format, parseISO } from 'date-fns'

export function formatRelativeOrAbsolute(iso) {
  if (!iso) return ''
  const d = parseISO(iso)
  const ageMs = Date.now() - d.getTime()
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
  if (ageMs < SEVEN_DAYS_MS) {
    return formatDistanceToNowStrict(d, { addSuffix: false }).replace(' minutes', 'm').replace(' hours', 'h').replace(' days', 'd').replace(' minute', 'm').replace(' hour', 'h').replace(' day', 'd')
  }
  return format(d, 'd MMM yyyy')
}
