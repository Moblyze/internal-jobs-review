#!/usr/bin/env node

/**
 * Merge processed batches back into main jobs.json
 *
 * This script:
 * 1. Loads all processed batch files
 * 2. Merges them with the original jobs.json (preserving job order and any unprocessed jobs)
 * 3. Creates a backup of the original
 * 4. Writes the merged result
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JOBS_FILE = path.join(__dirname, '../public/data/jobs.json');
const BACKUP_FILE = path.join(__dirname, '../public/data/jobs.backup.json');
const BATCH_DIR = path.join(__dirname, '../public/data/batches');

console.log('\n🔄 Merging Processed Batches\n');

// Load original jobs
console.log('Loading original jobs.json...');
const originalJobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
console.log(`  Original jobs: ${originalJobs.length}`);

// Find all processed batch files
const processedFiles = fs.readdirSync(BATCH_DIR)
  .filter(file => file.match(/^batch-\d+-processed\.json$/))
  .sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)[0], 10);
    const numB = parseInt(b.match(/\d+/)[0], 10);
    return numA - numB;
  });

console.log(`\nFound ${processedFiles.length} processed batch files:`);
processedFiles.forEach(file => console.log(`  - ${file}`));

// Load all processed jobs into a map (keyed by job ID or URL)
const processedJobsMap = new Map();
let totalProcessed = 0;
let totalWithAI = 0;
let totalErrors = 0;

console.log('\nLoading processed jobs...');
processedFiles.forEach(file => {
  const filePath = path.join(BATCH_DIR, file);
  const batchJobs = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  batchJobs.forEach(job => {
    const key = job.id || job.url || JSON.stringify(job);
    processedJobsMap.set(key, job);
    totalProcessed++;

    if (job.structuredDescription) {
      totalWithAI++;
    }
    if (job.processingError) {
      totalErrors++;
    }
  });
});

console.log(`  Total processed jobs: ${totalProcessed}`);
console.log(`  Successfully AI-enhanced: ${totalWithAI}`);
console.log(`  Processing errors: ${totalErrors}`);

// Merge: Replace jobs with processed versions
console.log('\nMerging processed data...');
const mergedJobs = originalJobs.map(job => {
  const key = job.id || job.url || JSON.stringify(job);
  const processedJob = processedJobsMap.get(key);

  if (processedJob) {
    return processedJob;
  }

  // Keep original if not in processed map
  return job;
});

// Count final results
const finalWithAI = mergedJobs.filter(j => j.structuredDescription).length;
const finalWithErrors = mergedJobs.filter(j => j.processingError).length;

console.log('\nFinal results:');
console.log(`  Total jobs: ${mergedJobs.length}`);
console.log(`  With AI descriptions: ${finalWithAI} (${((finalWithAI / mergedJobs.length) * 100).toFixed(1)}%)`);
console.log(`  With errors: ${finalWithErrors}`);

// Create backup
console.log('\nCreating backup...');
fs.writeFileSync(BACKUP_FILE, fs.readFileSync(JOBS_FILE));
console.log(`  ✅ Backup saved: ${BACKUP_FILE}`);

// Write merged result
console.log('\nWriting merged jobs.json...');
fs.writeFileSync(JOBS_FILE, JSON.stringify(mergedJobs, null, 2));
console.log(`  ✅ Saved: ${JOBS_FILE}`);

// Summary
console.log('\n✅ Merge Complete!');
console.log(`\n📊 Summary:`);
console.log(`  - Jobs with AI enhancements: ${finalWithAI}/${mergedJobs.length}`);
console.log(`  - Processing errors: ${finalWithErrors}`);
console.log(`  - Backup location: ${BACKUP_FILE}`);
console.log(`\n🚀 Ready to deploy. Run 'npm run build' to rebuild the site.`);
