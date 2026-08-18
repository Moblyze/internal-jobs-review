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
  EXCLUDED_COUNTRIES: resolve(ROOT, 'public/data/feed/excluded_countries.json'),
  REJECTED_HASHES: resolve(ROOT, 'public/data/feed/rejected_hashes.json'),
  PDL_COMPANY_CACHE: resolve(ROOT, 'public/data/pdl-company-cache.json'),
  ALERT_STATE: resolve(ROOT, 'public/data/feed/alert_state.json'),
}

export async function readJson(path) {
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw)
}

export const FETCH_TIMEOUT_MS = 30_000
export const MAX_PARALLEL_FETCHES = 6
export const DEDUPE_WINDOW_DAYS = 30
export const TRIM_WINDOW_DAYS = 90
// A fetch failure must persist this long before it is worth a Slack message.
// feed-ingest runs every 6h, so 48h == 8 consecutive failed fetches.
export const HEALTH_ALERT_THRESHOLD_HOURS = 48

// While a problem persists unchanged, re-remind at most this often. The alert
// otherwise fires only on state change (ok -> problem, problem -> ok, new error
// class). Before this existed, one dead source posted the same line 4x/day forever.
export const HEALTH_REMIND_INTERVAL_HOURS = 24

// Content staleness: a source can return HTTP 200 and still have published nothing
// for weeks. Default threshold for a source with no `content_stale_days` override.
//
// CONTENT_STALE_DAYS_RATIONALE (measured 2026-08-18 against the live feeds, by
// reading every dated item each source currently exposes):
//
//   source              items  newest      max gap between items
//   rigzone               65   2026-08-18   1.0d  (7.5d window)
//   world_nuclear_news    42   2026-08-18   2.8d  (13.3d window)
//   pr_newswire_energy    20   2026-08-18   0.04d (0.2d window)
//   mining_com            36   2026-08-18   1.8d  (5.7d window)
//   sec_edgar_8k          70   2026-08-18   fixed 3d lookback by design
//   bsee_us               10   2026-08-18   7.2d  (20.9d window)
//   windeurope            10   2026-08-05   18.9d (44.2d window)
//   boem_us               10   2026-07-22   70d   (2026 gaps: 7,15,12,4,47,70)
//
// The five fast sources never gap more than ~3d, so a 7d default is ~2.5x their
// worst observed gap: late enough to avoid false alarms, early enough to catch a
// death inside two days. The three lumpy sources carry per-source overrides in
// sources.json sized at roughly 1.3x their worst observed gap.
export const CONTENT_STALE_DEFAULT_DAYS = 7
