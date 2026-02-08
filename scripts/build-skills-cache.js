/**
 * Build O*NET Skills Cache
 *
 * Extracts all skills from jobs data, standardizes them with O*NET,
 * and creates a pre-built cache file for fast lookups.
 *
 * Usage: node scripts/build-skills-cache.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ONET_API_KEY = process.env.VITE_ONET_API_KEY;
const BASE_URL = process.env.VITE_ONET_BASE_URL || 'https://api-v2.onetcenter.org';

// Mock localStorage for Node.js
const mockStorage = new Map();
global.localStorage = {
  getItem: (key) => mockStorage.get(key) || null,
  setItem: (key, value) => mockStorage.set(key, value),
  removeItem: (key) => mockStorage.delete(key)
};

// Import skill validator
const { processSkills } = await import('../src/utils/skillValidator.js');

console.log('🏗️  Building O*NET Skills Cache\n');

// Paths
const JOBS_FILE = path.join(__dirname, '..', 'public', 'data', 'jobs.json');
const CACHE_FILE = path.join(__dirname, '..', 'public', 'data', 'onet-skills-cache.json');

// Load jobs data
console.log('📂 Loading jobs data...');
const jobsData = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
console.log(`   Found ${jobsData.length} jobs`);

// Extract all skills
console.log('\n📊 Extracting skills...');
const allSkills = [];
jobsData.forEach(job => {
  if (job.skills && Array.isArray(job.skills)) {
    allSkills.push(...job.skills);
  }
});
console.log(`   Found ${allSkills.length} total skill entries (with duplicates)`);

// Normalize skills (client-side processing)
console.log('\n🔧 Normalizing skills...');
const normalizedSkills = processSkills(allSkills);
console.log(`   Normalized to ${normalizedSkills.length} unique skills`);

// Show sample
console.log('\n   Sample normalized skills:');
normalizedSkills.slice(0, 10).forEach((skill, i) => {
  console.log(`     ${i + 1}. ${skill}`);
});

// O*NET standardization
console.log('\n🌐 Standardizing with O*NET API...');
console.log('   This may take a few minutes for all skills...\n');

const RATE_LIMIT = 150; // ms between requests
let lastRequest = 0;

async function rateLimit() {
  const now = Date.now();
  const wait = RATE_LIMIT - (now - lastRequest);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequest = Date.now();
}

async function onetRequest(endpoint) {
  await rateLimit();

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'X-API-Key': ONET_API_KEY,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) return null;
  return await response.json();
}

// Priority occupations for energy/trades sector
const PRIORITY_OCCUPATIONS = [
  '47-2111.00', // Electricians
  '49-9021.00', // HVAC Mechanics and Installers
  '51-4121.00', // Welders, Cutters, Solderers, and Brazers
  '17-2199.11', // Solar Energy Systems Engineers
  '17-2141.00', // Mechanical Engineers
  '47-2152.00', // Plumbers, Pipefitters, and Steamfitters
  '17-2071.00', // Electrical Engineers
  '17-2141.01', // Fuel Cell Engineers
  '47-2221.00', // Structural Iron and Steel Workers
  '49-9051.00', // Electrical Power-Line Installers and Repairers
  '17-3023.00', // Electrical and Electronic Engineering Technologists
  '17-3026.00', // Industrial Engineering Technologists
  '51-8013.00', // Power Plant Operators
  '47-2031.00', // Carpenters
  '49-9041.00', // Industrial Machinery Mechanics
  '17-2112.00', // Industrial Engineers
  '11-9041.00', // Architectural and Engineering Managers
];

// Fuzzy match score (0-1, higher is better)
function getFuzzyMatchScore(skillName, onetSkill) {
  const skillLower = skillName.toLowerCase();
  const onetLower = onetSkill.toLowerCase();

  // Exact match
  if (skillLower === onetLower) return 1.0;

  // One contains the other
  if (onetLower.includes(skillLower)) return 0.9;
  if (skillLower.includes(onetLower)) return 0.85;

  // Word overlap
  const skillWords = new Set(skillLower.split(/\s+/));
  const onetWords = new Set(onetLower.split(/\s+/));
  const intersection = [...skillWords].filter(w => onetWords.has(w));
  const union = new Set([...skillWords, ...onetWords]);
  const jaccard = intersection.length / union.size;

  // Penalize if lengths are very different
  const lengthRatio = Math.min(skillLower.length, onetLower.length) /
                      Math.max(skillLower.length, onetLower.length);

  return jaccard * 0.8 + lengthRatio * 0.2;
}

// Check if an O*NET skill name is actually a valid skill (not a phrase)
function isValidONetSkill(skillName) {
  const lower = skillName.toLowerCase();

  // Reject phrases that start with verbs
  const verbStarters = [
    'delegate', 'organize', 'establish', 'maintain', 'develop', 'implement',
    'create', 'manage', 'coordinate', 'supervise', 'direct', 'oversee',
    'monitor', 'evaluate', 'assess', 'review', 'update', 'prepare',
    'conduct', 'perform', 'execute', 'complete', 'ensure'
  ];

  const firstWord = lower.split(/\s+/)[0];
  if (verbStarters.includes(firstWord)) return false;

  // Reject overly long phrases (likely task descriptions)
  if (skillName.length > 40) return false;

  // Reject phrases with too many words (likely sentences)
  const wordCount = skillName.split(/\s+/).length;
  if (wordCount > 5) return false;

  // Reject if contains "that has been" or similar constructions
  if (/that (has|have|had) been/i.test(skillName)) return false;

  return true;
}

async function searchONetSkill(skillName) {
  try {
    // First try direct search
    const data = await onetRequest(`/online/search?keyword=${encodeURIComponent(skillName)}`);
    if (!data || !data.occupation || data.occupation.length === 0) {
      // For common soft skills, try searching with "skills" keyword
      if (['communication', 'planning', 'leadership', 'teamwork'].includes(skillName.toLowerCase())) {
        const fallbackData = await onetRequest(`/online/search?keyword=${encodeURIComponent(skillName + ' skills')}`);
        if (!fallbackData || !fallbackData.occupation || fallbackData.occupation.length === 0) {
          return null;
        }
        // Use fallback results
        data.occupation = fallbackData.occupation;
      } else {
        return null;
      }
    }

    // Separate priority and other occupations
    const priorityOccs = [];
    const otherOccs = [];

    for (const occ of data.occupation) {
      if (PRIORITY_OCCUPATIONS.includes(occ.code)) {
        priorityOccs.push(occ);
      } else {
        otherOccs.push(occ);
      }
    }

    // Try priority occupations first, then others (more occupations for better matches)
    const occsToTry = [...priorityOccs, ...otherOccs].slice(0, 8);

    let bestOverallMatch = null;
    let bestScore = 0.35; // Lower threshold to catch more matches

    for (const occ of occsToTry) {
      const skillsData = await onetRequest(`/online/occupations/${occ.code}/summary/skills`);

      if (!skillsData || !skillsData.element || skillsData.element.length === 0) continue;

      // Score each skill in this occupation
      for (const onetSkill of skillsData.element) {
        // Skip invalid skill names
        if (!isValidONetSkill(onetSkill.name)) continue;

        const score = getFuzzyMatchScore(skillName, onetSkill.name);

        // Boost score if from priority occupation
        const finalScore = PRIORITY_OCCUPATIONS.includes(occ.code)
          ? score * 1.3  // Increased boost
          : score;

        if (finalScore > bestScore) {
          bestScore = finalScore;
          bestOverallMatch = {
            id: onetSkill.id,
            name: onetSkill.name,
            description: onetSkill.description,
            occupation_code: occ.code,
            occupation_title: occ.title,
            match_score: finalScore
          };
        }
      }

      // If we found a great match in priority occupations, stop early
      if (bestScore > 0.85 && PRIORITY_OCCUPATIONS.includes(occ.code)) {
        break;
      }
    }

    return bestOverallMatch;
  } catch (error) {
    console.error(`   ⚠️  Error for "${skillName}": ${error.message}`);
    return null;
  }
}

// Build cache
const cache = {};
const stats = {
  total: normalizedSkills.length,
  matched: 0,
  unmatched: 0,
  errors: 0
};

let processed = 0;
const startTime = Date.now();

for (const skill of normalizedSkills) {
  processed++;
  const progress = Math.round((processed / stats.total) * 100);
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const rate = processed / elapsed || 0;
  const remaining = Math.round((stats.total - processed) / rate);

  process.stdout.write(
    `   Progress: ${processed}/${stats.total} (${progress}%) | ` +
    `Matched: ${stats.matched} | ` +
    `Elapsed: ${elapsed}s | ` +
    `ETA: ${remaining}s\r`
  );

  const onetSkill = await searchONetSkill(skill);

  if (onetSkill) {
    cache[skill.toLowerCase()] = {
      normalized: skill,
      onet: {
        id: onetSkill.id,
        name: onetSkill.name,
        description: onetSkill.description,
        occupation: {
          code: onetSkill.occupation_code,
          title: onetSkill.occupation_title
        }
      }
    };
    stats.matched++;
  } else {
    // No O*NET match - cache the normalized version
    cache[skill.toLowerCase()] = {
      normalized: skill,
      onet: null
    };
    stats.unmatched++;
  }
}

console.log('\n');

// Save cache
console.log('\n💾 Saving cache file...');
const cacheOutput = {
  version: '1.0.0',
  generated: new Date().toISOString(),
  stats: {
    total_skills: stats.total,
    onet_matched: stats.matched,
    unmatched: stats.unmatched,
    match_rate: `${Math.round((stats.matched / stats.total) * 100)}%`
  },
  cache
};

fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheOutput, null, 2));
const fileSizeKB = Math.round(fs.statSync(CACHE_FILE).size / 1024);
console.log(`   Saved to: ${CACHE_FILE}`);
console.log(`   File size: ${fileSizeKB}KB`);

// Summary
console.log('\n' + '='.repeat(70));
console.log('📋 CACHE BUILD SUMMARY');
console.log('='.repeat(70));

console.log('\n📊 Statistics:\n');
console.log(`   Total unique skills:     ${stats.total}`);
console.log(`   O*NET matched:           ${stats.matched} (${Math.round((stats.matched / stats.total) * 100)}%)`);
console.log(`   Unmatched (normalized):  ${stats.unmatched} (${Math.round((stats.unmatched / stats.total) * 100)}%)`);
console.log(`   Processing time:         ${Math.round((Date.now() - startTime) / 1000)}s`);
console.log(`   Cache file size:         ${fileSizeKB}KB`);

console.log('\n📝 Cache Examples (with scores):\n');

// Show examples with O*NET matches
const matchedExamples = Object.entries(cache)
  .filter(([k, v]) => v.onet !== null)
  .slice(0, 5);

console.log('  ✅ Skills with O*NET matches:');
matchedExamples.forEach(([key, value]) => {
  console.log(`   "${value.normalized}"`);
  console.log(`     → O*NET: ${value.onet.name} (${value.onet.id})`);
  console.log(`     → From: ${value.onet.occupation.title}`);
  if (value.onet.match_score) {
    console.log(`     → Match Score: ${(value.onet.match_score * 100).toFixed(1)}%`);
  }
  console.log('');
});

// Show examples without O*NET matches
const unmatchedExamples = Object.entries(cache)
  .filter(([k, v]) => v.onet === null)
  .slice(0, 3);

if (unmatchedExamples.length > 0) {
  console.log('  ❌ Skills without O*NET matches:');
  unmatchedExamples.forEach(([key, value]) => {
    console.log(`   "${value.normalized}"`);
    console.log(`     → No O*NET match (using normalized)`);
    console.log('');
  });
}

console.log('✅ Skills cache built successfully!\n');
console.log('📝 Next steps:');
console.log('   1. Update onetClient.js to load from cache file');
console.log('   2. Integrate with jobs data pipeline');
console.log('   3. Test with full dataset\n');
