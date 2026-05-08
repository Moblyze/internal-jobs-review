import { createHash } from 'crypto'
import { DEDUPE_WINDOW_DAYS } from './config.js'

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function computeHash(entry) {
  const headline = normalize(entry.headline)
  const project = normalize(entry.project_name)
  const operator = normalize(entry.operator?.name)
  const key = `${headline}|${project}|${operator}`
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

export function dedupeAgainstExisting(freshItems, existingEntries) {
  const cutoff = Date.now() - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const recent = existingEntries.filter(e => {
    const t = e.ingested_at ? new Date(e.ingested_at).getTime() : 0
    return t >= cutoff
  })
  const byHash = new Map(recent.map(e => [computeHash(e), e]))

  const newEntries = []
  const updatedExisting = []
  const seenHashes = new Set()

  for (const item of freshItems) {
    const hash = computeHash(item)
    if (seenHashes.has(hash)) continue
    seenHashes.add(hash)
    const match = byHash.get(hash)
    if (match) {
      const merged = { ...match }
      const existingSourceIds = new Set(merged.sources.map(s => s.id))
      for (const src of item.sources || []) {
        if (!existingSourceIds.has(src.id)) merged.sources.push(src)
      }
      updatedExisting.push(merged)
    } else {
      newEntries.push({ ...item, hash })
    }
  }

  return { newEntries, updatedExisting }
}
