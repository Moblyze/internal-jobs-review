#!/usr/bin/env node

/**
 * Test Web App Skills Loading
 *
 * Simulates what the web app does to load skills
 * to verify the dropdown will be populated correctly.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JOBS_FILE = path.join(__dirname, '../public/data/jobs.json');

async function simulateGetUniqueSkills(jobs) {
  // This matches what useJobs.js getUniqueSkills() does
  const { initializeONet } = await import('../src/utils/onetClient.js');
  await initializeONet();

  const { filterValidSkills } = await import('../src/utils/skillValidator.js');

  // Only include skills from ACTIVE jobs (exclude removed/paused jobs)
  const activeJobs = jobs.filter(job => job.status !== 'removed' && job.status !== 'paused');
  const allSkills = activeJobs.flatMap(job => job.skills);
  const validSkills = filterValidSkills(allSkills);
  const skills = [...new Set(validSkills)];
  return skills.sort();
}

async function main() {
  console.log('🌐 Simulating web app skills loading...\n');

  // Load jobs
  const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
  console.log(`📂 Loaded ${jobs.length} jobs`);

  // Simulate getUniqueSkills
  console.log('⏳ Processing skills (as web app does)...');
  const skills = await simulateGetUniqueSkills(jobs);

  console.log(`✅ Processed ${skills.length} unique skills\n`);

  // Show first 20 skills
  console.log('Skills that will appear in dropdown:');
  skills.slice(0, 20).forEach((skill, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${skill}`);
  });

  if (skills.length > 20) {
    console.log(`  ... and ${skills.length - 20} more`);
  }

  console.log();

  // Test filtering
  console.log('Testing filter: "Communication"');
  const activeJobs = jobs.filter(job => job.status !== 'removed' && job.status !== 'paused');
  const matchingJobs = activeJobs.filter(job => job.skills.includes('Communication'));
  console.log(`  Found ${matchingJobs.length} jobs with "Communication" skill`);
  console.log(`  Sample jobs:`);
  matchingJobs.slice(0, 3).forEach(job => {
    console.log(`    - ${job.company}: ${job.title.slice(0, 50)}`);
  });

  console.log('\n✅ Web app should show skills correctly!\n');
}

main().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
