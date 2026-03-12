#!/usr/bin/env node

/**
 * Preserve AI-enhanced data during daily syncs
 *
 * After export-jobs.js overwrites jobs.json from Google Sheets,
 * this script merges back structuredDescription and onetSkills
 * from two sources:
 *   1. public/data/ai-enhancements.json (saved AI data)
 *   2. public/data/batches/batch-*-processed.json (batch processing output)
 *
 * Also saves current AI data to ai-enhancements.json for next sync.
 *
 * Usage: node scripts/preserve-ai-data.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JOBS_FILE = path.join(__dirname, '../public/data/jobs.json');
const AI_DATA_FILE = path.join(__dirname, '../public/data/ai-enhancements.json');
const BATCH_DIR = path.join(__dirname, '../public/data/batches');

console.log('\n🔄 Preserving AI-enhanced data...\n');

// Load freshly exported jobs
if (!fs.existsSync(JOBS_FILE)) {
  console.error('❌ jobs.json not found');
  process.exit(1);
}

const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
console.log(`  Loaded ${jobs.length} jobs from fresh export`);

// Build AI data map from saved enhancements file
const aiDataMap = new Map();

if (fs.existsSync(AI_DATA_FILE)) {
  const savedData = JSON.parse(fs.readFileSync(AI_DATA_FILE, 'utf-8'));
  for (const [id, data] of Object.entries(savedData)) {
    aiDataMap.set(id, data);
  }
  console.log(`  Loaded ${aiDataMap.size} saved AI enhancements`);
}

// Also load from batch files (in case ai-enhancements.json is stale)
if (fs.existsSync(BATCH_DIR)) {
  const batchFiles = fs.readdirSync(BATCH_DIR)
    .filter(f => f.match(/^batch-\d+-processed\.json$/));

  for (const file of batchFiles) {
    const batchJobs = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, file), 'utf-8'));
    for (const job of batchJobs) {
      const key = job.id || job.url;
      if (key && job.structuredDescription) {
        aiDataMap.set(key, {
          structuredDescription: job.structuredDescription,
          onetSkills: job.onetSkills || [],
        });
      }
    }
  }
  console.log(`  Total AI data entries after batch merge: ${aiDataMap.size}`);
}

// Merge AI data back into jobs
let merged = 0;
for (const job of jobs) {
  const key = job.id || job.url;
  const aiData = aiDataMap.get(key);
  if (aiData && !job.structuredDescription) {
    job.structuredDescription = aiData.structuredDescription;
    if (aiData.onetSkills && aiData.onetSkills.length > 0) {
      job.onetSkills = aiData.onetSkills;
    }
    merged++;
  }
}

console.log(`  Merged AI data into ${merged} jobs`);

// Save updated jobs.json
fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf-8');

// Save current AI data for next sync
const currentAiData = {};
for (const job of jobs) {
  if (job.structuredDescription) {
    const key = job.id || job.url;
    currentAiData[key] = {
      structuredDescription: job.structuredDescription,
      onetSkills: job.onetSkills || [],
    };
  }
}

fs.writeFileSync(AI_DATA_FILE, JSON.stringify(currentAiData), 'utf-8');
const aiCount = Object.keys(currentAiData).length;
console.log(`  Saved ${aiCount} AI enhancements to ai-enhancements.json`);

console.log(`\n✅ AI data preserved: ${aiCount}/${jobs.length} jobs have AI enhancements\n`);
