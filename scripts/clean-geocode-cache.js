/**
 * Clean the locations-geocoded.json cache by flagging entries whose keys
 * are obviously not locations (company names, staffing agencies,
 * placeholders, numeric IDs, vessel/rig names, etc.) with `_skip: true`.
 *
 * parseLocation in src/utils/locationParser.js drops entries flagged this
 * way, keeping the "Other" bucket in the location filter clean.
 *
 * Idempotent: re-running on an already-cleaned file is a no-op.
 *
 * Usage: node scripts/clean-geocode-cache.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_PATH = path.join(__dirname, '../public/data/locations-geocoded.json');

// Tokens that, when present in a location string, strongly suggest the value
// came from a company / staffing / agency field rather than a real location.
const COMPANY_TOKEN_PATTERNS = [
  /\bstaffing\b/i,
  /\brecruitment\b/i,
  /\brecruiting\b/i,
  /\bagency\b/i,
  /\bservices\s*(group|inc|llc|ltd|limited)?\s*\.?$/i,
  /\bsolutions\s*(inc|llc|ltd|limited)?\s*\.?$/i,
  /\benterprises\b/i,
  /\bpartners\b/i,
  /\bcorporation\b/i,
  /\bcorp\.?$/i,
  /\bllc\.?$/i,
  /\bllp\.?$/i,
  /\binc\.?$/i,
  /\bltd\.?$/i,
  /\blimited\.?$/i,
  /\bplc\.?$/i,
  /\bgroup\.?$/i,
  /\bholdings\.?$/i,
  /\bindustries\.?$/i,
  /\btechnologies\.?$/i,
  /\bconsulting\.?$/i,
  /\bsystems\s*(inc|llc)?\.?$/i,
];

// Explicit placeholder strings that mean "multiple locations" or similar
// filler rather than a real location.
const PLACEHOLDER_PATTERNS = [
  /^\d+\s+locations?$/i,       // "2 Locations", "3 Locations"
  /^various( locations)?$/i,
  /^multiple( locations)?$/i,
  /^remote$/i,                 // handled separately if the app cares
  /^tbd$/i,
  /^location not specified$/i,
  /^global( recruiting)?$/i,   // except the whitelist in locationGrouping
  /^worldwide$/i,
  /^anywhere$/i,
  /^n\/a$/i,
  /^none$/i,
];

// Vessel / offshore rig naming patterns (keys like "LEVIATHAN PLATFORM LPP")
const VESSEL_PATTERNS = [
  /\bplatform\b/i,
  /\bvessel\b/i,
  /\bfpso\b/i,
  /\brig\b\s*\d*$/i,
  /\bdrillship\b/i,
];

// Whitelist: keys that match a company-token pattern but are actually
// legitimate locations (e.g., "United Services, AL"). Add here as discovered.
const WHITELIST = new Set([
  // (empty — populate as false positives surface)
]);

function shouldSkip(key, entry) {
  if (!key || typeof key !== 'string') return false;
  if (WHITELIST.has(key)) return false;

  const trimmed = key.trim();

  // Empty, whitespace, or single/double character junk
  if (trimmed.length <= 2) return true;

  // Purely numeric keys ("0", "6", "13", "1234")
  if (/^\d+$/.test(trimmed)) return true;

  // Placeholder / filler
  if (PLACEHOLDER_PATTERNS.some(re => re.test(trimmed))) return true;

  // Company-looking tokens
  if (COMPANY_TOKEN_PATTERNS.some(re => re.test(trimmed))) return true;

  // Vessel / rig names
  if (VESSEL_PATTERNS.some(re => re.test(trimmed))) return true;

  // Geocode returned no country at all — probably unresolvable junk
  if (entry && !entry.countryCode && !entry.country && !entry.mapboxPlaceName) {
    return true;
  }

  return false;
}

function main() {
  if (!fs.existsSync(CACHE_PATH)) {
    console.error(`Geocode cache not found at ${CACHE_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(CACHE_PATH, 'utf8');

  // Handle git-LFS pointer files gracefully
  if (raw.startsWith('version https://git-lfs.github.com')) {
    console.error('locations-geocoded.json is a git-LFS pointer; fetch the real file first.');
    process.exit(1);
  }

  const cache = JSON.parse(raw);
  const total = Object.keys(cache).length;

  let flagged = 0;
  let alreadyFlagged = 0;

  for (const [key, entry] of Object.entries(cache)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry._skip) {
      alreadyFlagged++;
      continue;
    }
    if (shouldSkip(key, entry)) {
      entry._skip = true;
      entry._skipReason = classifyReason(key, entry);
      flagged++;
    }
  }

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');

  console.log(`Cleaned ${CACHE_PATH}`);
  console.log(`  Total entries: ${total}`);
  console.log(`  Newly flagged _skip: ${flagged}`);
  console.log(`  Already flagged:    ${alreadyFlagged}`);
  console.log(`  Active locations:   ${total - flagged - alreadyFlagged}`);
}

function classifyReason(key, entry) {
  const trimmed = key.trim();
  if (trimmed.length <= 2) return 'too-short';
  if (/^\d+$/.test(trimmed)) return 'numeric-key';
  if (PLACEHOLDER_PATTERNS.some(re => re.test(trimmed))) return 'placeholder';
  if (COMPANY_TOKEN_PATTERNS.some(re => re.test(trimmed))) return 'company-token';
  if (VESSEL_PATTERNS.some(re => re.test(trimmed))) return 'vessel-name';
  if (entry && !entry.countryCode && !entry.country) return 'unresolved';
  return 'unknown';
}

main();
