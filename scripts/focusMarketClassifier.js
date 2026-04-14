/**
 * Focus Market Classifier
 *
 * Assigns a focus market profile to jobs that lack one (e.g., company-scraped jobs).
 * Uses keyword matching against title and description, mirroring the relevance_include
 * and relevance_exclude keywords from scrapers/config/aggregators.yaml.
 *
 * Only the 11 app-valid focus markets are used (not company-specific profiles).
 *
 * Usage:
 *   import { classifyFocusMarket } from './focusMarketClassifier.js';
 *   const profile = classifyFocusMarket(job.title, job.description);
 *   // Returns e.g. 'subsea_oil_gas' or null
 */

/**
 * Market definitions with include/exclude keywords.
 * Sourced from scrapers/config/aggregators.yaml relevance_include/relevance_exclude.
 *
 * Order matters: more specific markets are checked first to avoid broad markets
 * (like energy_trades) absorbing jobs that belong to a narrower category.
 */
const MARKET_DEFINITIONS = [
  {
    slug: 'subsea_oil_gas',
    include: [
      'subsea', 'rov', 'diver', 'diving', 'underwater', 'saturation',
      'umbilical', 'remotely operated',
    ],
    exclude: [
      'x-ray', 'xray', 'radiolog', 'psycholog', 'school', 'nurse', 'nursing',
      'medical', 'physician', 'therapist', 'pharmacy', 'dental', 'veterinar',
      'teacher', 'teaching', 'retail', 'cashier', 'barista',
    ],
  },
  {
    slug: 'rope_access',
    include: [
      'rope access', 'irata', 'irata l1', 'irata l2', 'irata l3',
      'abseil', 'rappel',
    ],
    exclude: [
      'jump rope', 'jump-rope', 'school', 'nurse', 'nursing', 'medical',
      'retail',
    ],
  },
  {
    slug: 'survey_geophysical',
    include: [
      'hydrographic', 'geophysic', 'seismic', 'party chief', 'bathymetr',
      'geotechnic', 'dimensional control', 'surveyor',
    ],
    exclude: [
      'land survey', 'property survey', 'real estate', 'opinion survey',
      'market survey', 'customer survey', 'building survey', 'nurse',
      'medical', 'retail', 'teacher', 'school',
    ],
  },
  {
    slug: 'ndt_inspection',
    include: [
      'ndt', 'non-destructive', 'cswip', 'paut', 'ultrasonic', 'radiograph',
      'eddy current', 'magnetic particle', 'dye penetrant', 'loler',
      'weld inspect', 'piping inspect', 'coating inspect', 'qc inspect',
      'lifting inspect', '3.4u',
    ],
    exclude: [
      'home inspect', 'building inspect', 'food inspect', 'vehicle inspect',
      'school', 'nurse', 'medical', 'retail', 'dental', 'veterinar',
    ],
  },
  {
    slug: 'drilling_operations',
    include: [
      'drilling', 'driller', 'mud engineer', 'drilling fluid', 'mwd', 'lwd',
      'directional', 'derrickhand', 'derrickman', 'floorhand', 'roughneck',
      'roustabout', 'toolpusher', 'well test', 'wireline', 'slickline',
      'coiled tubing', 'cementing', 'completions', 'wellsite',
    ],
    exclude: [
      'dental drill', 'school', 'nurse', 'medical', 'retail', 'teacher',
      'dentist', 'pharmacy',
    ],
  },
  {
    slug: 'marine_offshore_ops',
    include: [
      'deck foreman', 'deck crew', 'bosun', 'boatswain', 'able seaman',
      'oim', 'installation manager', 'vessel', 'marine', 'maritime',
      'rigger', 'banksman', 'slinger', 'crane operator',
      'dynamic positioning', 'dpo', 'towmaster', 'mooring',
      'motorman', 'oiler', 'seafarer', 'stcw', 'engine room',
      'chief officer', 'second officer', 'third officer', 'master mariner',
      'chief engineer', 'second engineer', 'third engineer',
      'offshore', 'ship management', 'fleet',
    ],
    exclude: [
      'cruise', 'ferry', 'fishing', 'navy', 'military', 'school', 'nurse',
      'retail', 'restaurant', 'medical',
    ],
  },
  {
    slug: 'pipeline_mechanical',
    include: [
      'pipeline', 'pipefitter', 'pipefitting', 'pipe lay', 'mechanical fitter',
      'bolt up', 'millwright', 'hydraulic', 'mechanical technician', 'fabricat',
      'ironwork', 'flanging', 'flange', 'flowline', 'pre-comm',
    ],
    exclude: [
      'plumbing', 'residential', 'home', 'school', 'nurse', 'medical',
      'retail', 'dental', 'pharmacy',
    ],
  },
  {
    slug: 'process_plant_operations',
    include: [
      'process operator', 'plant operator', 'control room', 'production operator',
      'production technician', 'nitrogen', 'n2 pump', 'chemical plant',
      'solids control', 'process supervisor', 'commissioning', 'pre-commissioning',
      'operations technician', 'refinery', 'petrochemical', 'turnaround',
    ],
    exclude: [
      'food process', 'data process', 'word process', 'school', 'nurse',
      'medical', 'retail', 'pharmacy', 'restaurant',
    ],
  },
  {
    slug: 'industrial_construction',
    include: [
      'scaffold', 'scaffolder', 'blaster', 'insulator', 'insulation',
      'fireproof', 'coating', 'labourer', 'laborer', 'craftsman',
    ],
    exclude: [
      'house painter', 'residential', 'art', 'school', 'nurse', 'medical',
      'retail', 'teacher', 'face paint',
    ],
  },
  {
    // Terms mirror src/utils/marketContentMatcher.js so direct-employer jobs
    // picked up here match the same set the website surfaces when the
    // Decommissioning filter is selected.
    slug: 'decommissioning',
    include: [
      'decommission', 'decom ', 'plug and abandon', 'p&a', 'well abandonment',
      'topside removal', 'platform removal', 'jacket removal', 'conductor removal',
      'late life', 'cessation of production', 'asset removal', 'asset retirement',
      'cold stack', 'warm stack', 'well plugging', 'site restoration',
      'offshore dismantl', 'make safe', 'subsea decom', 'pipeline decom',
    ],
    exclude: [
      'school', 'nurse', 'nursing', 'medical', 'physician', 'therapist',
      'pharmacy', 'dental', 'veterinar', 'teacher', 'teaching', 'retail',
      'cashier', 'barista',
    ],
  },
  {
    slug: 'energy_trades',
    include: [
      'welder', 'weld', 'welding', 'lineman', 'lineworker', 'solar',
      'wind turbine', 'power plant', 'substation', 'transformer', 'generator',
      'boilermaker', 'instrumentation',
    ],
    exclude: [
      'x-ray', 'xray', 'radiolog', 'psycholog', 'school', 'nurse', 'nursing',
      'medical', 'physician', 'therapist', 'pharmacy', 'dental', 'veterinar',
      'teacher', 'teaching', 'retail', 'cashier', 'barista',
    ],
  },
];

/**
 * Score a job against a single market definition.
 *
 * @param {string} title - Lowercased job title
 * @param {string} description - Lowercased job description
 * @param {Object} market - Market definition with include/exclude arrays
 * @returns {number} Score (0 = no match or excluded, >0 = match strength).
 *                    Title matches are weighted 3x vs description matches.
 */
function scoreMarket(title, description, market) {
  // Check excludes first — any exclude hit in the title disqualifies
  for (const term of market.exclude) {
    if (title.includes(term)) return 0;
  }

  let score = 0;

  for (const term of market.include) {
    if (title.includes(term)) {
      score += 3; // Title match is high signal
    } else if (description.includes(term)) {
      score += 1; // Description match is supporting signal
    }
  }

  return score;
}

/**
 * Classify a job into one of the 10 focus markets based on title and description.
 *
 * @param {string} title - Job title
 * @param {string} description - Job description (can be HTML — tags are stripped)
 * @returns {string|null} Focus market slug (e.g. 'subsea_oil_gas') or null if no match
 */
export function classifyFocusMarket(title, description) {
  if (!title) return null;

  const cleanTitle = title.toLowerCase();
  const cleanDesc = (description || '')
    .replace(/<[^>]*>/g, ' ')  // Strip HTML tags
    .replace(/\s+/g, ' ')
    .toLowerCase();

  let bestSlug = null;
  let bestScore = 0;

  for (const market of MARKET_DEFINITIONS) {
    const score = scoreMarket(cleanTitle, cleanDesc, market);
    if (score > bestScore) {
      bestScore = score;
      bestSlug = market.slug;
    }
  }

  return bestSlug;
}

/**
 * Get all market slugs handled by the classifier.
 * @returns {string[]}
 */
export function getClassifierMarkets() {
  return MARKET_DEFINITIONS.map(m => m.slug);
}

/**
 * Expose the full include/exclude rule set so callers can render it
 * (e.g., in documentation or dashboards).
 */
export function getMarketDefinitions() {
  return MARKET_DEFINITIONS.map(m => ({
    slug: m.slug,
    include: [...m.include],
    exclude: [...m.exclude],
  }));
}

export default { classifyFocusMarket, getClassifierMarkets, getMarketDefinitions };
