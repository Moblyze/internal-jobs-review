/**
 * Generate jobs-index.json and jobs-index-lite.json from existing jobs.json
 *
 * Produces three outputs:
 * 1. jobs-index.json — legacy full index (no description/structuredDescription)
 * 2. jobs-index-lite.json — dictionary-encoded compact index (~16MB vs 45MB)
 *    Uses numeric indices for companies, skills, and locations to minimize size.
 * 3. filter-options.json — pre-computed filter dropdown options (~50KB)
 *    Eliminates expensive runtime computation of filter options from 46K jobs.
 *
 * Usage: node scripts/generate-index.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCompanyName, loadBrandVariations, loadPDLCache, detectPrefixGroups } from '../src/utils/companyNormalizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JOBS_PATH = path.join(__dirname, '../public/data/jobs.json');
const INDEX_PATH = path.join(__dirname, '../public/data/jobs-index.json');
const LITE_INDEX_PATH = path.join(__dirname, '../public/data/jobs-index-lite.json');
const FILTER_OPTIONS_PATH = path.join(__dirname, '../public/data/filter-options.json');
const COMPANIES_PATH = path.join(__dirname, '../public/data/companies.json');
const PDL_CACHE_PATH = path.join(__dirname, '../public/data/pdl-company-cache.json');

// Certification patterns (mirroring src/utils/certificationExtractor.js)
const CERT_PATTERNS = {
  'API 510': [/\bAPI[\s-]*510\b/gi],
  'API 570': [/\bAPI[\s-]*570\b/gi],
  'API 653': [/\bAPI[\s-]*653\b/gi],
  'API 571': [/\bAPI[\s-]*571\b/gi],
  'API 580': [/\bAPI[\s-]*580\b/gi],
  'API 1169': [/\bAPI[\s-]*1169\b/gi],
  'IADC WellSharp': [/\bIADC[\s-]*WellSharp\b/gi, /\bWellSharp\b/gi, /\bWell[\s-]*Control[\s-]*Certif/gi],
  'IWCF': [/\bIWCF\b/gi],
  'BOSIET': [/\bBOSIET\b/gi, /\bT-BOSIET\b/gi],
  'HUET': [/\bHUET\b/gi],
  'FOET': [/\bFOET\b/gi],
  'NACE CIP': [/\bNACE[\s-]*CIP[\s-]*[1-4]?\b/gi],
  'NACE CP': [/\bNACE[\s-]*CP[\s-]*[1-4]?\b/gi],
  'Rigger Certification': [/\bRigger[\s-]*Level[\s-]*[1-3]\b/gi, /\bCertified[\s-]*Rigger\b/gi],
  'Signal Person': [/\bSignal[\s-]*Person\b/gi],
  'NCCCO Crane Operator': [/\bNCCCO\b/gi, /\bCrane[\s-]*Operator[\s-]*Certif/gi, /\bCCO\b/gi],
  'CWI': [/\bCWI\b/gi, /\bCertified[\s-]*Welding[\s-]*Inspector\b/gi],
  'CWB': [/\bCWB\b/gi],
  'AWS Certification': [/\bAWS[\s-]*Certif/gi],
  'OSHA 10': [/\bOSHA[\s-]*10[\s-]*hour\b/gi, /\bOSHA[\s-]*10\b/gi],
  'OSHA 30': [/\bOSHA[\s-]*30[\s-]*hour\b/gi, /\bOSHA[\s-]*30\b/gi],
  'OSHA 40': [/\bOSHA[\s-]*40[\s-]*hour\b/gi, /\bOSHA[\s-]*40\b/gi],
  'HAZMAT': [/\bHAZMAT\b/gi, /\bHazardous[\s-]*Materials[\s-]*Certif/gi],
  'HAZWOPER': [/\bHAZWOPER\b/gi],
  'H2S': [/\bH2S[\s-]*Alive\b/gi, /\bH2S[\s-]*Clear\b/gi, /\bH2S[\s-]*Safety\b/gi],
  'CPR/First Aid': [/\bCPR[\s\/]*First[\s-]*Aid\b/gi, /\bCPR\b/gi, /\bFirst[\s-]*Aid[\s-]*Certif/gi, /\bBLS\b/gi],
  'AED': [/\bAED[\s-]*Certif/gi],
  'USCG License': [/\bUSCG[\s-]*[\w\s]*License\b/gi, /\bUSCG[\s-]*Master\b/gi],
  'DPO': [/\bDPO\b/gi, /\bDynamic[\s-]*Positioning[\s-]*Operator\b/gi],
  'STCW': [/\bSTCW\b/gi],
  'PE License': [/\bPE[\s-]*License\b/gi, /\bP\.E\.[\s-]*License\b/gi],
  'PMP': [/\bPMP\b/gi, /\bProject[\s-]*Management[\s-]*Professional\b/gi],
  'Six Sigma': [/\bSix[\s-]*Sigma[\s-]*Green[\s-]*Belt\b/gi, /\bSix[\s-]*Sigma[\s-]*Black[\s-]*Belt\b/gi, /\bLean[\s-]*Six[\s-]*Sigma\b/gi],
  'CDL': [/\bCDL\b/gi, /\bClass[\s-]*[ABC][\s-]*CDL\b/gi, /\bCommercial[\s-]*Driver'?s?[\s-]*License\b/gi],
  'Master Electrician': [/\bMaster[\s-]*Electrician\b/gi],
  'Journeyman Electrician': [/\bJourneyman[\s-]*Electrician\b/gi],
  'EPA 608': [/\bEPA[\s-]*608\b/gi],
  'Forklift Operator': [/\bForklift[\s-]*Operator\b/gi, /\bForklift[\s-]*Certif/gi],
  'IADC': [/\bIADC[\s-]*Certif/gi],
  'IMCA': [/\bIMCA[\s-]*Certif/gi],
  'NICET': [/\bNICET\b/gi],
};

function extractCertsFromText(text) {
  if (!text) return [];
  const found = new Set();
  for (const [certName, patterns] of Object.entries(CERT_PATTERNS)) {
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      if (regex.test(text)) {
        found.add(certName);
        break;
      }
    }
  }
  return Array.from(found);
}

// ── Load companies.json brand variations into the normalizer ────────────────
if (fs.existsSync(COMPANIES_PATH)) {
  const companiesData = JSON.parse(fs.readFileSync(COMPANIES_PATH, 'utf8'));
  loadBrandVariations(companiesData.companies || []);
  console.log(`  Loaded ${(companiesData.companies || []).length} company profiles from companies.json`);
}

// ── Load PDL Company Cleaner cache into the normalizer ──────────────────────
if (fs.existsSync(PDL_CACHE_PATH)) {
  const pdlCacheData = JSON.parse(fs.readFileSync(PDL_CACHE_PATH, 'utf8'));
  loadPDLCache(pdlCacheData);
  console.log(`  Loaded PDL cache with ${Object.keys(pdlCacheData).length} entries`);
}

// ── Determine data source: full jobs.json or existing jobs-index.json ────────
// If jobs.json is unavailable (e.g. Git LFS pointer), fall back to jobs-index.json
let indexJobs;
let usedFallback = false;

function isValidJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    return content.startsWith('[') || content.startsWith('{');
  } catch { return false; }
}

if (fs.existsSync(JOBS_PATH) && isValidJson(JOBS_PATH)) {
  console.log('Reading jobs.json...');
  const jobs = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf8'));
  console.log(`  Loaded ${jobs.length} jobs (${(fs.statSync(JOBS_PATH).size / 1024 / 1024).toFixed(1)}MB)`);

  let certsExtracted = 0;
  let companiesNormalized = 0;

  indexJobs = jobs.map(job => {
    const { description, structuredDescription, ...rest } = job;

    // Normalize company name so variants are grouped in the index
    if (rest.company) {
      const canonical = normalizeCompanyName(rest.company);
      if (canonical !== rest.company) {
        rest.companyRaw = rest.company;
        rest.company = canonical;
        companiesNormalized++;
      }
    }

    // Keep first 200 chars of description for card preview
    if (description) {
      rest.descriptionPreview = description
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 200);
    }

    // Pre-extract certifications from description so cert filter works without full text
    if (description) {
      const descCerts = extractCertsFromText(description);
      const skillsCerts = (job.skills || []).flatMap(s => extractCertsFromText(s));
      const allCerts = [...new Set([...(rest.certifications || []), ...descCerts, ...skillsCerts])];
      if (allCerts.length > 0) {
        rest.extractedCertifications = allCerts.sort();
        certsExtracted++;
      }
    }

    return rest;
  });

  fs.writeFileSync(INDEX_PATH, JSON.stringify(indexJobs), 'utf8');
  const indexSize = (fs.statSync(INDEX_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`Wrote ${INDEX_PATH} (${indexSize}MB)`);
  console.log(`  Pre-extracted certifications for ${certsExtracted} jobs`);
  console.log(`  Normalized company names for ${companiesNormalized} jobs`);
} else if (fs.existsSync(INDEX_PATH) && isValidJson(INDEX_PATH)) {
  console.log('jobs.json not available (Git LFS pointer?), reading existing jobs-index.json...');
  indexJobs = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  console.log(`  Loaded ${indexJobs.length} jobs from existing index (${(fs.statSync(INDEX_PATH).size / 1024 / 1024).toFixed(1)}MB)`);

  // Re-normalize company names (picks up new normalizer rules even when jobs.json is unavailable)
  let reNormalized = 0;
  indexJobs.forEach(job => {
    if (job.company) {
      const canonical = normalizeCompanyName(job.company);
      if (canonical && canonical !== job.company) {
        job.companyRaw = job.companyRaw || job.company;
        job.company = canonical;
        reNormalized++;
      }
    }
  });
  if (reNormalized > 0) {
    console.log(`  Re-normalized ${reNormalized} company names`);
    // Update the index file with re-normalized names
    fs.writeFileSync(INDEX_PATH, JSON.stringify(indexJobs), 'utf8');
    console.log(`  Updated ${INDEX_PATH}`);
  }

  usedFallback = true;
} else {
  console.error('ERROR: Neither jobs.json nor jobs-index.json available. Run npm run export-jobs first.');
  process.exit(1);
}

// ── Generate dictionary-encoded lite index ──────────────────────────────────
console.log('\nGenerating lite index...');

// Build dictionaries
const skillDict = [];
const skillIndex = {};
const companyDict = [];
const companyIndex = {};
const locationDict = [];
const locationIndex = {};

indexJobs.forEach(job => {
  // Skills dictionary
  (job.skills || []).forEach(s => {
    if (!(s in skillIndex)) {
      skillIndex[s] = skillDict.length;
      skillDict.push(s);
    }
  });
  // Company dictionary
  if (job.company && !(job.company in companyIndex)) {
    companyIndex[job.company] = companyDict.length;
    companyDict.push(job.company);
  }
  // Location dictionary (raw location strings)
  if (job.location && !(job.location in locationIndex)) {
    locationIndex[job.location] = locationDict.length;
    locationDict.push(job.location);
  }
});

// Build compact job entries using short keys and dictionary indices
const liteJobs = indexJobs.map(job => {
  const entry = {
    t: job.title,
    c: job.company ? (companyIndex[job.company] ?? -1) : -1,
    l: job.location ? (locationIndex[job.location] ?? -1) : -1,
  };

  // Only include non-default status (most are 'active', save space by omitting)
  if (job.status && job.status !== 'active') entry.s = job.status;

  // Dictionary-encoded skills (numeric indices instead of full strings)
  if (job.skills && job.skills.length > 0) {
    entry.k = job.skills.map(s => skillIndex[s]);
  }

  // Short keys for categorical fields (only when present)
  if (job.employmentType) entry.e = job.employmentType;
  if (job.source) entry.sr = job.source;
  if (job.profile) entry.p = job.profile;
  if (job.appReady) entry.a = 1;

  // Certifications (small arrays, keep as strings)
  if (job.extractedCertifications && job.extractedCertifications.length > 0) {
    entry.cr = job.extractedCertifications;
  }

  // Display-only fields for JobCard rendering
  if (job.descriptionPreview) entry.d = job.descriptionPreview.substring(0, 100);
  if (job.salary) entry.sa = job.salary;
  if (job.postedDate) entry.pd = job.postedDate;

  return entry;
});

// IDs stored as separate array (position matches jobs array index)
const ids = indexJobs.map(job => job.id);

const liteOutput = {
  _version: 1,
  skills: skillDict,
  companies: companyDict,
  locations: locationDict,
  ids: ids,
  jobs: liteJobs,
};

fs.writeFileSync(LITE_INDEX_PATH, JSON.stringify(liteOutput), 'utf8');
const liteSize = (fs.statSync(LITE_INDEX_PATH).size / 1024 / 1024).toFixed(1);
console.log(`Wrote ${LITE_INDEX_PATH} (${liteSize}MB)`);
console.log(`  Dictionaries: ${skillDict.length} skills, ${companyDict.length} companies, ${locationDict.length} locations`);

// ── Focus market label mapping (mirrors src/utils/focusMarkets.js) ──────────
const FOCUS_MARKET_LABELS = {
  subsea_oil_gas: 'ROV & Subsea',
  rope_access: 'Rope Access',
  ndt_inspection: 'NDT Inspection',
  drilling_operations: 'Drilling',
  marine_offshore_ops: 'Marine & Offshore',
  energy_trades: 'Energy Trades',
  pipeline_mechanical: 'Pipeline & Mechanical',
  industrial_construction: 'Industrial Construction',
  process_plant_operations: 'Process & Plant',
  survey_geophysical: 'Survey & Geophysical',
};
const PRIORITY_MARKET_SLUGS = ['subsea_oil_gas', 'rope_access'];

function getMarketLabel(slug) {
  if (FOCUS_MARKET_LABELS[slug]) return FOCUS_MARKET_LABELS[slug];
  return slug.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Generate pre-computed filter options ─────────────────────────────────────
console.log('\nGenerating filter options...');

const activeJobs = indexJobs.filter(j => j.status !== 'removed' && j.status !== 'paused');
const inactiveJobs = indexJobs.filter(j => j.status === 'removed' || j.status === 'paused');

// Companies with counts (active jobs only)
const companyCounts = {};
activeJobs.forEach(j => {
  if (j.company) {
    companyCounts[j.company] = (companyCounts[j.company] || 0) + 1;
  }
});
const companyOptions = Object.entries(companyCounts)
  .map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count);

// Employment types
const empTypeCounts = {};
activeJobs.forEach(j => {
  if (j.employmentType) {
    empTypeCounts[j.employmentType] = (empTypeCounts[j.employmentType] || 0) + 1;
  }
});
const employmentTypeOptions = Object.entries(empTypeCounts)
  .map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count);

// Sources
const sourceCounts = {};
activeJobs.forEach(j => {
  const src = j.source || 'direct';
  sourceCounts[src] = (sourceCounts[src] || 0) + 1;
});
const sourceOptions = Object.entries(sourceCounts)
  .map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count);

// Profiles / search profiles
const profileCounts = {};
activeJobs.forEach(j => {
  if (j.profile) {
    profileCounts[j.profile] = (profileCounts[j.profile] || 0) + 1;
  }
});
const profileOptions = Object.entries(profileCounts)
  .map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count);

// Focus markets (derived from profiles with labels and priority flag)
const focusMarketOptions = Object.entries(profileCounts)
  .map(([slug, count]) => ({
    slug,
    label: getMarketLabel(slug),
    count,
    isPriority: PRIORITY_MARKET_SLUGS.includes(slug),
  }))
  .sort((a, b) => {
    if (a.isPriority && !b.isPriority) return -1;
    if (!a.isPriority && b.isPriority) return 1;
    return b.count - a.count;
  });

// Certifications with counts
const certCounts = {};
activeJobs.forEach(j => {
  (j.extractedCertifications || []).forEach(cert => {
    certCounts[cert] = (certCounts[cert] || 0) + 1;
  });
});
// Also include cert names that exist in the CERT_PATTERNS but have zero matches
Object.keys(CERT_PATTERNS).forEach(certName => {
  if (!(certName in certCounts)) {
    certCounts[certName] = 0;
  }
});
const certificationOptions = Object.entries(certCounts)
  .map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

// App-ready count
const appReadyCount = indexJobs.filter(j => j.appReady).length;

const filterOptions = {
  _generatedAt: new Date().toISOString(),
  totalJobs: indexJobs.length,
  totalActive: activeJobs.length,
  totalInactive: inactiveJobs.length,
  appReadyCount,
  companies: companyOptions,
  employmentTypes: employmentTypeOptions,
  sources: sourceOptions,
  profiles: profileOptions,
  focusMarkets: focusMarketOptions,
  certifications: certificationOptions,
};

fs.writeFileSync(FILTER_OPTIONS_PATH, JSON.stringify(filterOptions, null, 0), 'utf8');
const filterSize = (fs.statSync(FILTER_OPTIONS_PATH).size / 1024).toFixed(0);
console.log(`Wrote ${FILTER_OPTIONS_PATH} (${filterSize}KB)`);
console.log(`  ${companyOptions.length} companies, ${employmentTypeOptions.length} employment types`);
console.log(`  ${sourceOptions.length} sources, ${focusMarketOptions.length} focus markets`);
console.log(`  ${certificationOptions.length} certifications`);

// ── Report: detect un-mapped prefix groups for future seeding ───────────────
const allCompanyNames = [...new Set(indexJobs.map(j => j.company).filter(Boolean))];
const suggestions = detectPrefixGroups(allCompanyNames);
if (suggestions.length > 0) {
  console.log(`\n  Potential un-mapped company groups (review for EXPLICIT_GROUPS):`);
  for (const { canonical, variants } of suggestions) {
    // Only show groups that aren't already handled by the normalizer
    const normalized = new Set(variants.map(v => normalizeCompanyName(v)));
    if (normalized.size > 1) {
      console.log(`    "${canonical}": ${variants.map(v => `"${v}"`).join(', ')}`);
    }
  }
}
