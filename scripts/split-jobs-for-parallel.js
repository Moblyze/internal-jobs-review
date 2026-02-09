#!/usr/bin/env node

/**
 * Split jobs into batches for parallel AI processing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JOBS_FILE = path.join(__dirname, '../public/data/jobs.json');
const BATCH_DIR = path.join(__dirname, '../public/data/batches');
const BATCH_SIZE = 400; // Jobs per batch

// Create batch directory
if (!fs.existsSync(BATCH_DIR)) {
  fs.mkdirSync(BATCH_DIR, { recursive: true });
}

// Load jobs
console.log('Loading jobs...');
const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
console.log(`Total jobs: ${jobs.length}`);

// Filter jobs needing AI processing
const jobsToProcess = jobs.filter(job => !job.structuredDescription);
console.log(`Jobs needing AI processing: ${jobsToProcess.length}`);

// Split into batches
const batches = [];
for (let i = 0; i < jobsToProcess.length; i += BATCH_SIZE) {
  batches.push(jobsToProcess.slice(i, i + BATCH_SIZE));
}

console.log(`\nCreating ${batches.length} batches...`);

// Write batch files
batches.forEach((batch, index) => {
  const batchFile = path.join(BATCH_DIR, `batch-${index + 1}.json`);
  fs.writeFileSync(batchFile, JSON.stringify(batch, null, 2));
  console.log(`  Batch ${index + 1}: ${batch.length} jobs → ${batchFile}`);
});

console.log(`\n✅ Split complete. Process batches in parallel with:`);
console.log(`   node scripts/process-batch.js <batch-number>`);
console.log(`\nOr use the parallel processing coordinator.`);
