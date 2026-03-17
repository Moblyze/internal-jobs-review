/**
 * Generate jobs-index.json from existing jobs.json
 *
 * Strips description and structuredDescription to create a lightweight
 * index file for the list view (~16MB instead of ~94MB).
 * Pre-extracts certifications from descriptions so the cert filter works
 * without loading the full description.
 *
 * Usage: node scripts/generate-index.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCompanyName, loadBrandVariations, detectPrefixGroups } from '../src/utils/companyNormalizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JOBS_PATH = path.join(__dirname, '../public/data/jobs.json');
const INDEX_PATH = path.join(__dirname, '../public/data/jobs-index.json');
const COMPANIES_PATH = path.join(__dirname, '../public/data/companies.json');

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

console.log('Reading jobs.json...');
const jobs = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf8'));
console.log(`  Loaded ${jobs.length} jobs (${(fs.statSync(JOBS_PATH).size / 1024 / 1024).toFixed(1)}MB)`);

let certsExtracted = 0;
let companiesNormalized = 0;

const indexJobs = jobs.map(job => {
  const { description, structuredDescription, ...rest } = job;

  // Normalize company name so variants are grouped in the index
  if (rest.company) {
    const canonical = normalizeCompanyName(rest.company);
    if (canonical !== rest.company) {
      // Keep original for debugging; overwrite displayed company
      rest.companyRaw = rest.company;
      rest.company = canonical;
      companiesNormalized++;
    }
  }

  // Keep first 200 chars of description for card preview
  if (description) {
    rest.descriptionPreview = description
      .replace(/<[^>]*>/g, '')    // Strip HTML
      .replace(/\s+/g, ' ')       // Collapse whitespace
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

// ── Report: detect un-mapped prefix groups for future seeding ───────────────
const allCompanyNames = [...new Set(jobs.map(j => j.company).filter(Boolean))];
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
