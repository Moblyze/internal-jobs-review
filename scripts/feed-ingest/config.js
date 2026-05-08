// scripts/feed-ingest/config.js
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')

export const PATHS = {
  ROOT,
  ENTRIES: resolve(ROOT, 'public/data/feed/entries.json'),
  ENTRIES_LITE: resolve(ROOT, 'public/data/feed/entries-lite.json'),
  TAXONOMY: resolve(ROOT, 'public/data/feed/taxonomy.json'),
  SOURCES: resolve(ROOT, 'public/data/feed/sources.json'),
  COMPANIES: resolve(ROOT, 'public/data/companies.json'),
  ARCHIVE_DIR: resolve(ROOT, 'public/data/feed'),
}

export async function readJson(path) {
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw)
}

export const FETCH_TIMEOUT_MS = 30_000
export const MAX_PARALLEL_FETCHES = 6
export const DEDUPE_WINDOW_DAYS = 30
export const TRIM_WINDOW_DAYS = 90
export const HEALTH_ALERT_THRESHOLD_HOURS = 48
