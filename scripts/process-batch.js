#!/usr/bin/env node

/**
 * Process a single batch of jobs with AI
 * Usage: node scripts/process-batch.js <batch-number>
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BATCH_DIR = path.join(__dirname, '../public/data/batches');
const RATE_LIMIT_DELAY = 500; // 500ms between requests

// Get batch number from command line
const batchNumber = parseInt(process.argv[2], 10);
if (!batchNumber || isNaN(batchNumber)) {
  console.error('Usage: node scripts/process-batch.js <batch-number>');
  process.exit(1);
}

const batchFile = path.join(BATCH_DIR, `batch-${batchNumber}.json`);
const outputFile = path.join(BATCH_DIR, `batch-${batchNumber}-processed.json`);

if (!fs.existsSync(batchFile)) {
  console.error(`Batch file not found: ${batchFile}`);
  process.exit(1);
}

console.log(`\n🤖 Processing Batch ${batchNumber}`);
console.log(`Input: ${batchFile}`);
console.log(`Output: ${outputFile}`);

// Load AI parser
async function loadParser() {
  const parserPath = path.join(__dirname, '../src/utils/aiDescriptionParser.js');
  const parser = await import(parserPath);
  return parser.restructureJobDescription;
}

// Process a single job
async function processJob(job, restructureFunction) {
  try {
    if (!job.description || job.description.trim() === '') {
      return { ...job, skipped: true };
    }

    const timeout = job.description.length > 5000 ? 60000 : 30000;
    const structuredDescription = await restructureFunction(job.description, { timeout });

    if (!structuredDescription || typeof structuredDescription !== 'object') {
      throw new Error('Invalid response from AI parser');
    }

    if (structuredDescription.error) {
      throw new Error(`AI parser error: ${structuredDescription.error}`);
    }

    return { ...job, structuredDescription };
  } catch (error) {
    console.error(`  ❌ Error processing job ${job.id}: ${error.message}`);
    return { ...job, processingError: error.message };
  }
}

// Sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Main processing
async function main() {
  const startTime = Date.now();

  // Load batch
  const jobs = JSON.parse(fs.readFileSync(batchFile, 'utf-8'));
  console.log(`Jobs in batch: ${jobs.length}`);

  // Load parser
  console.log('Loading AI parser...');
  const restructureFunction = await loadParser();

  // Process jobs
  console.log('Processing jobs...\n');
  const processedJobs = [];
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    process.stdout.write(`  [${i + 1}/${jobs.length}] Processing job ${job.id || i}... `);

    const result = await processJob(job, restructureFunction);
    processedJobs.push(result);

    if (result.skipped) {
      console.log('⊘ Skipped (no description)');
      skippedCount++;
    } else if (result.processingError) {
      console.log('❌ Error');
      errorCount++;
    } else {
      console.log('✅ Success');
      successCount++;
    }

    // Rate limiting
    if (i < jobs.length - 1) {
      await sleep(RATE_LIMIT_DELAY);
    }
  }

  // Save results
  fs.writeFileSync(outputFile, JSON.stringify(processedJobs, null, 2));

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Batch ${batchNumber} complete in ${duration}s`);
  console.log(`   Success: ${successCount}`);
  console.log(`   Errors: ${errorCount}`);
  console.log(`   Skipped: ${skippedCount}`);
  console.log(`   Output: ${outputFile}`);
}

main().catch(error => {
  console.error(`\n❌ Fatal error: ${error.message}`);
  process.exit(1);
});
