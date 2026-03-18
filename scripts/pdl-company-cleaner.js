/**
 * PDL Company Cleaner — Batch Processor
 *
 * Resolves all unique company names from jobs.json through the PDL Company
 * Cleaner API, builds a persistent cache, and generates a canonical-names
 * mapping file grouped by PDL company ID.
 *
 * Outputs:
 *   public/data/pdl-company-cache.json        — raw name → PDL response cache
 *   public/data/company-canonical-names.json   — grouped canonical companies
 *
 * Usage:
 *   PDL_API_KEY=xxx node scripts/pdl-company-cleaner.js
 *   node scripts/pdl-company-cleaner.js          # reads key from .env
 *
 * Rate limits: 10 requests/minute (free tier). The script sleeps 6.1s between
 * requests and retries on 429.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Paths ───────────────────────────────────────────────────────────────────
// Use index file (lightweight) — jobs.json may be a Git LFS pointer locally
const JOBS_PATH = path.join(__dirname, '../public/data/jobs-index.json');
const JOBS_FULL_PATH = path.join(__dirname, '../public/data/jobs.json');
const CACHE_PATH = path.join(__dirname, '../public/data/pdl-company-cache.json');
const CANONICAL_PATH = path.join(__dirname, '../public/data/company-canonical-names.json');
const ENV_PATH = path.join(__dirname, '../.env');

// ── API config ──────────────────────────────────────────────────────────────
const PDL_BASE_URL = 'https://api.peopledatalabs.com/v5/company/clean';
const RATE_LIMIT_DELAY_MS = 6100; // 10 req/min → ~6s between calls
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 30000; // 30s backoff on 429

// ── Load API key ────────────────────────────────────────────────────────────
function loadApiKey() {
  // 1. Environment variable
  if (process.env.PDL_API_KEY) return process.env.PDL_API_KEY;

  // 2. .env file
  if (fs.existsSync(ENV_PATH)) {
    const envContent = fs.readFileSync(ENV_PATH, 'utf8');
    const match = envContent.match(/^PDL_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  }

  // 3. Hardcoded fallback (from pdl_company_cleaner_test.py)
  return '5376ca68a1c3ea144981a0eb8cd613d09b09f5e60e0131edb01501525abb2fcb';
}

// ── Title-case helper ───────────────────────────────────────────────────────
function toTitleCase(str) {
  if (!str) return str;

  // Known acronyms / special cases that should stay uppercase or specific casing
  const specialCases = {
    'slb': 'SLB',
    'bp': 'BP',
    'kbr': 'KBR',
    'nov': 'NOV',
    'edf': 'EDF',
    'ge': 'GE',
    'usa': 'USA',
    'llc': 'LLC',
    'plc': 'PLC',
    'uk': 'UK',
    'technipfmc': 'TechnipFMC',
    'conocophillips': 'ConocoPhillips',
    'exxonmobil': 'ExxonMobil',
    'championx': 'ChampionX',
  };

  // Check full string first
  const lowerFull = str.toLowerCase().trim();
  if (specialCases[lowerFull]) return specialCases[lowerFull];

  return str
    .split(/(\s+)/)
    .map(word => {
      const lower = word.toLowerCase();
      if (specialCases[lower]) return specialCases[lower];
      if (word.length <= 1) return word;
      // Preserve parenthetical content like "(uk)"
      if (word.startsWith('(') && word.endsWith(')')) {
        const inner = word.slice(1, -1).toLowerCase();
        return specialCases[inner] ? `(${specialCases[inner]})` : `(${inner.charAt(0).toUpperCase() + inner.slice(1)})`;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join('');
}

// ── PDL API call ────────────────────────────────────────────────────────────
async function cleanCompany(name, apiKey) {
  const url = new URL(PDL_BASE_URL);
  url.searchParams.set('name', name);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 200) {
        return await response.json();
      }

      if (response.status === 429) {
        console.log(`    Rate limited, waiting ${RETRY_BACKOFF_MS / 1000}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }

      if (response.status === 404) {
        return null;
      }

      const text = await response.text();
      console.error(`    API error ${response.status} for "${name}": ${text.slice(0, 200)}`);
      return null;
    } catch (err) {
      console.error(`    Network error for "${name}": ${err.message}`);
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_BACKOFF_MS);
      }
    }
  }

  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Load / save cache ───────────────────────────────────────────────────────
function loadCache() {
  if (fs.existsSync(CACHE_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch (err) {
      console.warn(`  Warning: could not parse existing cache, starting fresh: ${err.message}`);
    }
  }
  return {};
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

// ── Build canonical names file ──────────────────────────────────────────────
function buildCanonicalNames(cache) {
  // Group by pdl_id
  const byPdlId = new Map();

  for (const [rawName, entry] of Object.entries(cache)) {
    if (!entry || !entry.pdl_id || entry.score === 0) continue;

    const id = entry.pdl_id;
    if (!byPdlId.has(id)) {
      byPdlId.set(id, {
        pdl_id: id,
        pdl_canonical_name: entry.name || '',
        aliases_found: [],
        industry: entry.industry || null,
        website: entry.website || null,
        ticker: entry.ticker || null,
        size: entry.size || null,
        location: entry.location
          ? [entry.location.locality, entry.location.region, entry.location.country]
              .filter(Boolean)
              .join(', ')
          : null,
        linkedin_url: entry.linkedin_url || null,
      });
    }

    byPdlId.get(id).aliases_found.push(rawName);
  }

  // Build output array
  const canonicalCompanies = [];

  for (const group of byPdlId.values()) {
    // Title-case the PDL canonical name for display
    const displayName = toTitleCase(group.pdl_canonical_name);

    canonicalCompanies.push({
      pdl_id: group.pdl_id,
      canonical_name: displayName,
      display_name: displayName,
      aliases_found: [...new Set(group.aliases_found)].sort(),
      industry: group.industry,
      website: group.website,
      ticker: group.ticker,
      size: group.size,
      location: group.location,
      linkedin_url: group.linkedin_url,
    });
  }

  // Sort by number of aliases (most aliases first — biggest companies)
  canonicalCompanies.sort((a, b) => b.aliases_found.length - a.aliases_found.length);

  return { canonical_companies: canonicalCompanies };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey = loadApiKey();
  if (!apiKey) {
    console.error('No PDL API key found. Set PDL_API_KEY env var or add it to .env');
    process.exit(1);
  }

  console.log('PDL Company Cleaner — Batch Processor');
  console.log('='.repeat(60));

  // Load jobs
  // Try index first (always valid locally), fall back to full jobs.json
  const jobsFile = fs.existsSync(JOBS_PATH) ? JOBS_PATH : JOBS_FULL_PATH;
  if (!fs.existsSync(jobsFile)) {
    console.error(`Jobs file not found: ${JOBS_PATH} or ${JOBS_FULL_PATH}`);
    process.exit(1);
  }

  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const uniqueNames = [...new Set(jobs.map(j => j.company).filter(Boolean))].sort();
  console.log(`  Loaded ${jobs.length} jobs with ${uniqueNames.length} unique company names`);

  // Load existing cache
  const cache = loadCache();
  const cachedCount = Object.keys(cache).length;
  console.log(`  Existing cache: ${cachedCount} entries`);

  // Find names not yet cached
  const uncached = uniqueNames.filter(name => !(name in cache));
  console.log(`  Need to fetch: ${uncached.length} new names`);

  if (uncached.length === 0) {
    console.log('\n  All companies already cached. Regenerating canonical names...');
  } else {
    const estimatedMinutes = Math.ceil((uncached.length * RATE_LIMIT_DELAY_MS) / 60000);
    console.log(`  Estimated time: ~${estimatedMinutes} minutes (rate limit: 10 req/min)`);
    console.log(`  Free tier budget: 10,000/month\n`);

    // Process uncached names
    for (let i = 0; i < uncached.length; i++) {
      const name = uncached[i];
      const progress = `[${i + 1}/${uncached.length}]`;

      process.stdout.write(`  ${progress} "${name}" ... `);

      const result = await cleanCompany(name, apiKey);

      if (result && result.name) {
        const displayName = toTitleCase(result.name);
        const matchInfo = result.fuzzy_match ? ' (fuzzy)' : '';
        console.log(`→ "${displayName}" (${result.industry || '?'})${matchInfo}`);
        cache[name] = result;
      } else if (result) {
        console.log('→ no match (score 0)');
        cache[name] = { ...result, score: 0 };
      } else {
        console.log('→ API error / not found');
        cache[name] = null;
      }

      // Save cache after every request (crash-safe)
      saveCache(cache);

      // Rate limit delay (skip after last request)
      if (i < uncached.length - 1) {
        await sleep(RATE_LIMIT_DELAY_MS);
      }
    }
  }

  // Generate canonical names file
  const canonicalData = buildCanonicalNames(cache);
  fs.writeFileSync(CANONICAL_PATH, JSON.stringify(canonicalData, null, 2), 'utf8');

  // ── Report ──────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('REPORT');
  console.log('='.repeat(60));

  const totalCached = Object.keys(cache).length;
  const resolved = Object.values(cache).filter(v => v && v.pdl_id && v.score !== 0).length;
  const unresolved = totalCached - resolved;
  const uniqueCompanies = canonicalData.canonical_companies.length;
  const grouped = canonicalData.canonical_companies.filter(c => c.aliases_found.length > 1).length;

  console.log(`  Total names in cache:    ${totalCached}`);
  console.log(`  Resolved by PDL:         ${resolved}`);
  console.log(`  Unresolved / no match:   ${unresolved}`);
  console.log(`  Unique companies (by ID): ${uniqueCompanies}`);
  console.log(`  Grouped (>1 alias):      ${grouped}`);

  // Show top grouped companies
  if (grouped > 0) {
    console.log('\n  Top grouped companies:');
    canonicalData.canonical_companies
      .filter(c => c.aliases_found.length > 1)
      .slice(0, 15)
      .forEach(c => {
        console.log(`    ${c.display_name} (${c.aliases_found.length} variants): ${c.aliases_found.join(', ')}`);
      });
  }

  // Show unresolved
  const unresolvedNames = Object.entries(cache)
    .filter(([, v]) => !v || !v.pdl_id || v.score === 0)
    .map(([name]) => name);

  if (unresolvedNames.length > 0) {
    console.log(`\n  Unresolved names (${unresolvedNames.length}):`);
    unresolvedNames.slice(0, 20).forEach(name => {
      console.log(`    - ${name}`);
    });
    if (unresolvedNames.length > 20) {
      console.log(`    ... and ${unresolvedNames.length - 20} more`);
    }
  }

  // Show staffing agencies
  const staffing = canonicalData.canonical_companies.filter(
    c => c.industry && c.industry.toLowerCase().includes('staffing')
  );
  if (staffing.length > 0) {
    console.log(`\n  Staffing agencies detected (${staffing.length}):`);
    staffing.forEach(c => {
      console.log(`    - ${c.display_name} (${c.aliases_found.join(', ')})`);
    });
  }

  console.log(`\n  Cache saved:     ${CACHE_PATH}`);
  console.log(`  Canonical saved: ${CANONICAL_PATH}`);
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
