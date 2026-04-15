/**
 * Company Name Normalization
 *
 * Groups variant company names (from different scrapers/aggregators) under
 * a single canonical name. Two layers:
 *   1. Explicit alias map (hand-curated + sourced from companies.json brandVariations)
 *   2. Fuzzy matching via suffix stripping and prefix similarity
 *
 * Usage:
 *   import { normalizeCompanyName, getCompanyAliases, buildCompanyGroups } from './companyNormalizer';
 *   const canonical = normalizeCompanyName("Baker Hughes Company"); // "Baker Hughes"
 */

// ── Suffixes stripped during normalization ──────────────────────────────────
const STRIP_SUFFIXES = [
  // Must be ordered longest-first so "Group, Inc." is tried before "Inc."
  'group, inc.',
  'group inc.',
  'group, inc',
  'group inc',
  ', incorporated',
  ' incorporated',
  ', a ge company',
  ' a ge company',
  ' corporation',
  ', corporation',
  ' corp.',
  ', corp.',
  ' corp',
  ', corp',
  ' company',
  ', company',
  ' co.',
  ', co.',
  ', inc.',
  ' inc.',
  ', inc',
  ' inc',
  ', ltd.',
  ' ltd.',
  ', ltd',
  ' ltd',
  ', llc',
  ' llc',
  ', llp',
  ' llp',
  ' limited',
  ', limited',
  ' plc',
  ', plc',
  ' p.l.c.',
  ', p.l.c.',
  ', sa',
  ' sa',
  ', as',
  ' as',
  ', se',
  ' se',
  ' group',
  ', group',
  ' holdings',
  ', holdings',
  ' services',
];

// ── Explicit alias map ─────────────────────────────────────────────────────
// canonical (key) => list of known aliases (values)
// The canonical name itself is always implicitly included.
const EXPLICIT_GROUPS = {
  'Helix Energy Solutions': [
    'Helix Energy Solutions Group, Inc',
    'Helix Energy Solutions Group, Inc.',
    'Helix Energy Solutions Group Inc',
    'Helix Energy Solutions Group',
    'Helix Offshore Crewing Services',
    'Helix Offshore Crewing Services Limited',
    'Helix Offshore',
    'Helix ESG',
  ],
  'Oceaneering': [
    'Oceaneering International',
    'Oceaneering International, Inc',
    'Oceaneering International, Inc.',
    'Oceaneering International Inc',
    'OII',
  ],
  'Altrad Sparrows': [
    'Sparrows Group',
    'Sparrows Group Inc',
    'Sparrows Group Inc.',
    'Sparrows',
    'Altrad Group',
    'Altrad Alpha',
    'Altrad Sparrows Recruitment — Americas',
    'Altrad Sparrows Recruitment - Americas',
  ],
  'Baker Hughes': [
    'Baker Hughes Company',
    'Baker Hughes, a GE company',
    'Baker Hughes, a GE Company',
  ],
  'KBR': [
    'KBR, Inc.',
    'KBR, Inc',
    'KBR Inc',
    'KBR Inc.',
  ],
  'TechnipFMC': [
    'TechnipFMC plc',
    'TechnipFMC PLC',
    'Technip Energies',
  ],
  'Schlumberger': [
    'SLB',
    'Schlumberger Limited',
    'Schlumberger Ltd',
  ],
  'ConocoPhillips': [
    'ConocoPhillips Company',
  ],
  'Marathon Petroleum': [
    'Marathon Petroleum Corporation',
    'Marathon Petroleum Corp',
    'Marathon Petroleum Corp.',
  ],
  'Phillips 66': [
    'Phillips 66 Company',
  ],
  'BP': [
    'BP p.l.c.',
    'BP plc',
    'BP PLC',
  ],
  'Noble Corporation': [
    'Noble Corporation plc',
    'Noble Corporation PLC',
    'Noble Drilling',
    'Noble Drilling Services',
  ],
  'Interocean Marine Services': [
    'Interocean',
    'Interocean Marine',
    'Interocean Marine Services Limited',
  ],
  'ROVOP': [
    'ROVOP Limited',
  ],
  'Petrofac': [
    'Petrofac Limited',
    'Petrofac Engineering',
  ],
  'LRQA': [
    "Lloyd's Register Quality Assurance",
    'LRQA Group',
    'LRQA Group Limited',
  ],
  'OSM Thome': [
    'OSM Maritime',
    'Thome Group',
    'OSM',
    'OSM Thome Group',
  ],
  'Wellsafe Solutions': [
    'Wellsafe',
    'Wellsafe Solutions Limited',
  ],
  'Dron & Dickson': [
    'Dron Dickson',
    'Dron and Dickson',
    'Dron & Dickson Limited',
  ],
  'Sulmara': [
    'Sulmara Subsea',
    'Sulmara Subsea Limited',
  ],
  'Allrig Group': [
    'Allrig',
    'AllRig',
    'Allrig Group B.V.',
  ],
  'Coast Renewable Services': [
    'Coast Renewable',
    'Coast Renewable Services Limited',
  ],
  'Taurus Industrial Group': [
    'Taurus IG',
    'Taurus Industrial Group, LLC',
  ],
  'PBS by Ponticelli': [
    'PBS Offshore',
    'Ponticelli',
    'PBS Offshore Limited',
  ],
  'IO Consulting': [
    'IO Consulting Group',
    'IO Consulting Group Limited',
  ],
  'Finnco': [
    'Finnco Service',
    'Finnco Service Ltd',
  ],
  'Rig Integrity Solutions': [
    'Rig Integrity',
    'Rig Integrity Solutions, LLC',
  ],
  'Halliburton': [
    'Halliburton Company',
    'Halliburton Energy Services',
  ],
  'ExxonMobil': [
    'Exxon Mobil',
    'Exxon Mobil Corporation',
    'ExxonMobil Corporation',
  ],
  'Chevron': [
    'Chevron Corporation',
    'Chevron Corp',
    'Chevron USA',
    'Chevron U.S.A.',
  ],
  'Shell': [
    'Shell plc',
    'Shell PLC',
    'Royal Dutch Shell',
  ],
  'Transocean': [
    'Transocean Ltd',
    'Transocean Ltd.',
    'Transocean Inc',
  ],
  'Weatherford': [
    'Weatherford International',
    'Weatherford International Ltd',
    'Weatherford International, Ltd.',
  ],
  'NOV': [
    'National Oilwell Varco',
    'NOV Inc',
    'NOV Inc.',
  ],
  'Valero Energy': [
    'Valero Energy Corporation',
    'Valero',
  ],
  'Enbridge': [
    'Enbridge Inc',
    'Enbridge Inc.',
  ],
  'Williams Companies': [
    'Williams',
    'The Williams Companies',
    'Williams Companies, Inc.',
  ],
  'Kinder Morgan': [
    'Kinder Morgan, Inc.',
    'Kinder Morgan Inc',
  ],
  'Fluor': [
    'Fluor Corporation',
    'Fluor Corp',
  ],
  'Bechtel': [
    'Bechtel Corporation',
    'Bechtel Corp',
  ],
  'Wood': [
    'Wood Group',
    'Wood PLC',
    'Wood plc',
    'John Wood Group',
  ],
  'Worley': [
    'Worley Limited',
    'WorleyParsons',
    'Worley Parsons',
  ],
  'Saipem': [
    'Saipem S.p.A.',
    'Saipem SpA',
  ],
  'Subsea 7': [
    'Subsea7',
    'Subsea 7 S.A.',
  ],
  'McDermott': [
    'McDermott International',
    'McDermott International, Ltd',
  ],
  'Nabors': [
    'Nabors Industries',
    'Nabors Industries Ltd',
    'Nabors Industries, Ltd.',
  ],
  'Patterson-UTI': [
    'Patterson UTI',
    'Patterson-UTI Energy',
    'Patterson-UTI Energy, Inc.',
  ],
  'Helmerich & Payne': [
    'Helmerich and Payne',
    'H&P',
    'Helmerich & Payne, Inc.',
  ],
  'Precision Drilling': [
    'Precision Drilling Corporation',
  ],
  'Tesco Corporation': [
    'Tesco Corp',
  ],
  'Diamond Offshore': [
    'Diamond Offshore Drilling',
    'Diamond Offshore Drilling, Inc.',
  ],
  'Seadrill': [
    'Seadrill Limited',
    'Seadrill Ltd',
  ],
  'Borr Drilling': [
    'Borr Drilling Limited',
  ],
  'Valaris': [
    'Valaris Limited',
    'Valaris Ltd',
    'Valaris plc',
  ],
  'Archrock': [
    'Archrock, Inc.',
    'Archrock Inc',
  ],
  'Cactus': [
    'Cactus, Inc.',
    'Cactus Wellhead',
  ],
  'ChampionX': [
    'ChampionX Corporation',
  ],
  'Ranger Energy Services': [
    'Ranger Energy',
  ],
  'Mistras Group': [
    'MISTRAS Group',
    'Mistras Group, Inc',
    'Mistras Group, Inc.',
    'MISTRAS Group, Inc',
    'MISTRAS Group, Inc.',
    'Mistras',
    'MISTRAS',
  ],
  'Sargent & Lundy': [
    'Sargent Lundy',
    'Sargent and Lundy',
    'Sargent & Lundy, LLC',
  ],
  'iPS Powerful People': [
    'IPS Powerful People',
    'iPS',
    'IPS',
  ],
  "Church's Chicken": [
    'Churchs Chicken',
    "Church's",
  ],
};

// ── PDL Company Cleaner cache ───────────────────────────────────────────────
// Maps raw company name (lowercase) → { canonical_name, pdl_id, industry, ... }
let _pdlCache = null;         // raw cache data (name → PDL response)
let _pdlCanonicalMap = null;  // lowercase raw name → title-cased canonical name

/**
 * Title-case a PDL canonical name (they return lowercase).
 * Handles common acronyms in the energy sector.
 */
function _pdlTitleCase(str) {
  if (!str) return str;
  const specials = {
    'slb': 'SLB', 'bp': 'BP', 'kbr': 'KBR', 'nov': 'NOV', 'edf': 'EDF',
    'ge': 'GE', 'usa': 'USA', 'llc': 'LLC', 'plc': 'PLC', 'uk': 'UK',
    'technipfmc': 'TechnipFMC', 'conocophillips': 'ConocoPhillips',
    'exxonmobil': 'ExxonMobil', 'championx': 'ChampionX',
  };
  const lowerFull = str.toLowerCase().trim();
  if (specials[lowerFull]) return specials[lowerFull];

  return str.split(/(\s+)/).map(word => {
    const lower = word.toLowerCase();
    if (specials[lower]) return specials[lower];
    if (word.length <= 1) return word;
    if (word.startsWith('(') && word.endsWith(')')) {
      const inner = word.slice(1, -1).toLowerCase();
      return specials[inner] ? `(${specials[inner]})` : `(${inner.charAt(0).toUpperCase() + inner.slice(1)})`;
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join('');
}

/**
 * Load the PDL Company Cleaner cache file.
 * Call once before normalizing if you want PDL-enhanced resolution.
 *
 * @param {Object} cacheData - Parsed contents of pdl-company-cache.json
 */
export function loadPDLCache(cacheData) {
  if (!cacheData || typeof cacheData !== 'object') return;

  _pdlCache = cacheData;
  _pdlCanonicalMap = new Map();

  // Build a map: lowercase raw name → display name (title-cased PDL canonical)
  // Group by pdl_id so all aliases of the same company resolve to one name
  const byPdlId = new Map();

  for (const [rawName, entry] of Object.entries(cacheData)) {
    if (!entry || !entry.pdl_id || entry.score === 0) continue;

    const id = entry.pdl_id;
    if (!byPdlId.has(id)) {
      byPdlId.set(id, {
        displayName: _pdlTitleCase(entry.name),
        pdlId: id,
        industry: entry.industry || null,
        rawNames: [],
      });
    }
    byPdlId.get(id).rawNames.push(rawName);
  }

  // Map every raw name to its group's display name
  for (const group of byPdlId.values()) {
    for (const rawName of group.rawNames) {
      _pdlCanonicalMap.set(rawName.toLowerCase().trim(), group.displayName);
    }
  }
}

/**
 * Get PDL metadata for a company name (after loadPDLCache has been called).
 *
 * @param {string} name - Raw company name
 * @returns {{ canonical_name: string, pdl_id: string, industry: string, size: string, website: string } | null}
 */
export function getPDLCompanyInfo(name) {
  if (!_pdlCache || !name) return null;
  const entry = _pdlCache[name] || _pdlCache[name.trim()];
  if (!entry || !entry.pdl_id || entry.score === 0) return null;
  return {
    canonical_name: _pdlTitleCase(entry.name),
    pdl_id: entry.pdl_id,
    industry: entry.industry || null,
    size: entry.size || null,
    website: entry.website || null,
    ticker: entry.ticker || null,
  };
}

// ── Build reverse lookup: alias (lowercase) → canonical name ───────────────
const _aliasToCanonical = new Map();
// Secondary index keyed by punctuation-stripped fuzzy key so variants like
// "Sargent & Lundy" vs "Sargent Lundy" resolve to the same canonical.
const _fuzzyKeyToCanonical = new Map();

function _indexFuzzy(alias, canonical) {
  const key = toFuzzyKey(alias);
  if (key && !_fuzzyKeyToCanonical.has(key)) {
    _fuzzyKeyToCanonical.set(key, canonical);
  }
}

function _buildAliasMap() {
  if (_aliasToCanonical.size > 0) return; // already built

  for (const [canonical, aliases] of Object.entries(EXPLICIT_GROUPS)) {
    // Map the canonical name itself
    _aliasToCanonical.set(canonical.toLowerCase().trim(), canonical);
    _indexFuzzy(canonical, canonical);

    for (const alias of aliases) {
      _aliasToCanonical.set(alias.toLowerCase().trim(), canonical);
      _indexFuzzy(alias, canonical);
    }
  }
}

// ── Augment alias map from companies.json data ─────────────────────────────
let _companiesJsonLoaded = false;

/**
 * Merge brandVariations from companies.json into the alias map.
 * Call this once after loading companies.json (optional; explicit groups
 * already cover researched companies, but this catches future additions).
 *
 * @param {Array} companies - The `companies` array from companies.json
 */
export function loadBrandVariations(companies) {
  _buildAliasMap();
  if (_companiesJsonLoaded) return;

  for (const company of companies) {
    const canonical = company.name;
    // Don't overwrite a hand-curated canonical
    if (!_aliasToCanonical.has(canonical.toLowerCase().trim())) {
      _aliasToCanonical.set(canonical.toLowerCase().trim(), canonical);
    }
    _indexFuzzy(canonical, canonical);

    for (const variation of company.brandVariations || []) {
      const key = variation.toLowerCase().trim();
      if (!_aliasToCanonical.has(key)) {
        _aliasToCanonical.set(key, canonical);
      }
      _indexFuzzy(variation, canonical);
    }

    // Also map subsidiaries
    for (const sub of company.subsidiaries || []) {
      const key = sub.toLowerCase().trim();
      if (!_aliasToCanonical.has(key)) {
        _aliasToCanonical.set(key, canonical);
      }
      _indexFuzzy(sub, canonical);
    }
  }

  _companiesJsonLoaded = true;
}

// ── Suffix stripping ───────────────────────────────────────────────────────

/**
 * Strip common corporate suffixes from a company name (case-insensitive).
 * Returns the stripped, trimmed string in its original casing.
 */
function stripSuffixes(name) {
  let result = name.trim();
  const lower = result.toLowerCase();

  for (const suffix of STRIP_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      result = result.slice(0, result.length - suffix.length).trim();
      // Remove trailing comma left behind
      if (result.endsWith(',')) {
        result = result.slice(0, -1).trim();
      }
      break; // only strip one suffix per pass — avoids over-stripping
    }
  }

  return result;
}

/**
 * Create a normalised key for fuzzy comparison:
 * lowercase, strip suffixes, collapse whitespace, remove non-alphanumeric.
 */
function toFuzzyKey(name) {
  return stripSuffixes(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Normalise a company name to its canonical form.
 *
 * Resolution order:
 *   1. Exact match in EXPLICIT_GROUPS alias map (hand-curated, highest trust)
 *   2. Match after stripping corporate suffixes against alias map
 *   3. PDL Company Cleaner cache lookup (if loaded)
 *   4. Return the original name (trimmed) as-is
 *
 * @param {string} name - Raw company name from a job posting
 * @returns {string} Canonical company name
 */
export function normalizeCompanyName(name) {
  if (!name) return name || '';
  _buildAliasMap();

  // Clean leading/trailing dots, spaces, and other punctuation noise
  const trimmed = name.trim().replace(/^[\s.·•,;:\-]+|[\s.·•,;:\-]+$/g, '').trim();
  if (!trimmed) return name.trim(); // If cleaning removed everything, return original trimmed
  const lowerTrimmed = trimmed.toLowerCase();

  // 1. Exact match in hand-curated alias map
  const exactMatch = _aliasToCanonical.get(lowerTrimmed);
  if (exactMatch) return exactMatch;

  // 2. Try after stripping suffixes against alias map
  const stripped = stripSuffixes(trimmed);
  const strippedMatch = _aliasToCanonical.get(stripped.toLowerCase());
  if (strippedMatch) return strippedMatch;

  // 3. PDL cache lookup
  if (_pdlCanonicalMap) {
    const pdlMatch = _pdlCanonicalMap.get(lowerTrimmed);
    if (pdlMatch) return pdlMatch;

    // Also try stripped version against PDL cache
    const pdlStrippedMatch = _pdlCanonicalMap.get(stripped.toLowerCase());
    if (pdlStrippedMatch) return pdlStrippedMatch;
  }

  // 4. Fuzzy-key match — catches punctuation/whitespace variants of known
  //    aliases (e.g. "Sargent Lundy" ↔ "Sargent & Lundy", "Mistras" case variants)
  const fuzzyMatch = _fuzzyKeyToCanonical.get(toFuzzyKey(trimmed));
  if (fuzzyMatch) return fuzzyMatch;

  // 5. Return trimmed original — no match found
  return trimmed;
}

/**
 * Get all known aliases for a canonical company name.
 *
 * @param {string} canonicalName - The canonical company name
 * @returns {string[]} All aliases including the canonical name itself
 */
export function getCompanyAliases(canonicalName) {
  if (!canonicalName) return [];
  _buildAliasMap();

  const aliases = EXPLICIT_GROUPS[canonicalName];
  if (aliases) {
    return [canonicalName, ...aliases];
  }

  // Check if canonicalName is itself an alias and find its group
  const resolved = _aliasToCanonical.get(canonicalName.toLowerCase().trim());
  if (resolved && EXPLICIT_GROUPS[resolved]) {
    return [resolved, ...EXPLICIT_GROUPS[resolved]];
  }

  return [canonicalName];
}

/**
 * Build grouped company data from a jobs array.
 * Each group maps a canonical company name to its raw name variants and jobs.
 *
 * @param {Array} jobs - Array of job objects with a `company` field
 * @returns {Map<string, { names: Set<string>, jobs: Array }>}
 */
export function buildCompanyGroups(jobs) {
  _buildAliasMap();

  const groups = new Map();

  for (const job of jobs) {
    if (!job.company) continue;

    const canonical = normalizeCompanyName(job.company);

    if (!groups.has(canonical)) {
      groups.set(canonical, { names: new Set(), jobs: [] });
    }

    const group = groups.get(canonical);
    group.names.add(job.company);
    group.jobs.push(job);
  }

  return groups;
}

/**
 * Auto-detect potential company groups from a list of names by looking for
 * names that share a long common prefix after suffix-stripping.
 *
 * This is a helper for seeding new explicit groups — not used at runtime for
 * normalisation (too slow for per-job calls).
 *
 * @param {string[]} names - All unique raw company names
 * @param {number} [minPrefixRatio=0.7] - Minimum ratio of shared prefix to shorter name
 * @returns {Array<{ canonical: string, variants: string[] }>} Suggested groups
 */
export function detectPrefixGroups(names, minPrefixRatio = 0.7) {
  const fuzzyKeys = names.map(n => ({ raw: n, key: toFuzzyKey(n) }));

  // Sort by fuzzy key so similar names are adjacent
  fuzzyKeys.sort((a, b) => a.key.localeCompare(b.key));

  const groups = [];
  const grouped = new Set();

  for (let i = 0; i < fuzzyKeys.length; i++) {
    if (grouped.has(i)) continue;

    const cluster = [i];
    for (let j = i + 1; j < fuzzyKeys.length; j++) {
      if (grouped.has(j)) continue;

      const a = fuzzyKeys[i].key;
      const b = fuzzyKeys[j].key;
      const minLen = Math.min(a.length, b.length);
      if (minLen < 4) continue; // skip very short names

      // Find common prefix length
      let prefixLen = 0;
      while (prefixLen < minLen && a[prefixLen] === b[prefixLen]) {
        prefixLen++;
      }

      if (prefixLen / minLen >= minPrefixRatio) {
        cluster.push(j);
      }
    }

    if (cluster.length > 1) {
      // Pick the shortest raw name as canonical suggestion
      const variants = cluster.map(idx => fuzzyKeys[idx].raw);
      const canonical = variants.reduce((a, b) =>
        stripSuffixes(a).length <= stripSuffixes(b).length ? a : b
      );

      groups.push({
        canonical: stripSuffixes(canonical),
        variants,
      });

      cluster.forEach(idx => grouped.add(idx));
    }
  }

  return groups;
}

// ── Node.js / script usage ─────────────────────────────────────────────────
// When run as a script (node companyNormalizer.js), it reads jobs-index.json
// and prints detected prefix groups for review.
// This helps seed new EXPLICIT_GROUPS entries.
//
// Usage: node --experimental-vm-modules src/utils/companyNormalizer.js
//   (or import from generate-index.js which already has ESM enabled)
