#!/usr/bin/env node

/**
 * Clean Job Skills
 *
 * Processes all skills in jobs.json through the skill validator
 * to remove invalid skills and normalize valid ones.
 *
 * This ensures:
 * 1. Only valid skills from O*NET reference are kept
 * 2. Skills are properly normalized (title case, standardized)
 * 3. Invalid/generic text is filtered out
 * 4. Skills dropdown only shows skills that have jobs
 *
 * Usage: npm run clean-skills
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processSkills } from '../src/utils/skillValidator.js';
import { initializeONet } from '../src/utils/onetClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JOBS_FILE = path.join(__dirname, '../public/data/jobs.json');
const BACKUP_FILE = path.join(__dirname, '../public/data/jobs.backup.json');

async function main() {
  console.log('🧹 Cleaning job skills...\n');

  // Load jobs
  if (!fs.existsSync(JOBS_FILE)) {
    console.error('❌ Error: jobs.json not found. Run npm run export-jobs first.');
    process.exit(1);
  }

  const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
  console.log(`📂 Loaded ${jobs.length} jobs`);

  // Initialize O*NET cache for skill validation
  console.log('⏳ Initializing O*NET skill cache...');
  await initializeONet();
  console.log('✓ O*NET cache loaded\n');

  // Backup original file
  fs.copyFileSync(JOBS_FILE, BACKUP_FILE);
  console.log(`💾 Backup created: ${path.basename(BACKUP_FILE)}\n`);

  // Process each job's skills
  let totalBefore = 0;
  let totalAfter = 0;
  let jobsWithSkills = 0;
  let jobsWithoutSkills = 0;

  for (const job of jobs) {
    const before = job.skills?.length || 0;
    totalBefore += before;

    if (!job.skills || job.skills.length === 0) {
      job.skills = [];
      continue;
    }

    // Process skills through validator
    const cleaned = processSkills(job.skills);
    job.skills = cleaned;

    const after = cleaned.length;
    totalAfter += after;

    if (after > 0) {
      jobsWithSkills++;
    } else {
      jobsWithoutSkills++;
    }

    // Log jobs that lost all skills
    if (before > 0 && after === 0) {
      console.log(`⚠️  ${job.company} - ${job.title.slice(0, 50)}`);
      console.log(`   Had ${before} raw skills, all filtered out (invalid)`);
    }
  }

  // Save cleaned jobs
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf-8');

  // Report
  console.log('\n✅ Skills cleaned successfully!\n');
  console.log('Summary:');
  console.log(`  • Total jobs: ${jobs.length}`);
  console.log(`  • Jobs with valid skills: ${jobsWithSkills}`);
  console.log(`  • Jobs with no valid skills: ${jobsWithoutSkills}`);
  console.log(`  • Raw skills before: ${totalBefore}`);
  console.log(`  • Valid skills after: ${totalAfter}`);
  console.log(`  • Filtered out: ${totalBefore - totalAfter} (${((totalBefore - totalAfter) / totalBefore * 100).toFixed(1)}%)`);
  console.log(`\n💾 Updated: ${path.basename(JOBS_FILE)}`);
  console.log(`📦 Backup: ${path.basename(BACKUP_FILE)}\n`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
