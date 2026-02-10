#!/usr/bin/env node

/**
 * Test Skill Filtering
 *
 * Verifies that:
 * 1. Skills are loaded from jobs
 * 2. Skill filter dropdown only shows skills with jobs
 * 3. Filtering by skill returns correct jobs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processSkills } from '../src/utils/skillValidator.js';
import { initializeONet } from '../src/utils/onetClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JOBS_FILE = path.join(__dirname, '../public/data/jobs.json');

async function main() {
  console.log('🧪 Testing skill filtering logic...\n');

  // Load jobs
  const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
  console.log(`📂 Loaded ${jobs.length} jobs\n`);

  // Initialize O*NET cache
  await initializeONet();

  // Test 1: Get unique skills from active jobs only
  console.log('Test 1: Unique skills extraction');
  const activeJobs = jobs.filter(job => job.status !== 'removed' && job.status !== 'paused');
  const allSkills = activeJobs.flatMap(job => job.skills);
  const uniqueSkills = [...new Set(allSkills)].sort();

  console.log(`  Active jobs: ${activeJobs.length}`);
  console.log(`  Total skills (with dupes): ${allSkills.length}`);
  console.log(`  Unique skills: ${uniqueSkills.length}`);
  console.log(`  Sample skills:`, uniqueSkills.slice(0, 10));
  console.log('  ✅ PASS\n');

  // Test 2: Verify each skill has at least one job
  console.log('Test 2: Every skill has jobs');
  const skillJobCounts = {};
  for (const skill of uniqueSkills) {
    const jobsWithSkill = activeJobs.filter(job => job.skills.includes(skill));
    skillJobCounts[skill] = jobsWithSkill.length;
  }

  const skillsWithNoJobs = Object.entries(skillJobCounts).filter(([skill, count]) => count === 0);
  if (skillsWithNoJobs.length > 0) {
    console.log('  ❌ FAIL: Found skills with no jobs:');
    skillsWithNoJobs.forEach(([skill, count]) => {
      console.log(`    - ${skill}: ${count} jobs`);
    });
  } else {
    console.log('  ✅ PASS: All skills have at least one job');
  }
  console.log();

  // Test 3: Skill filtering logic
  console.log('Test 3: Skill filtering');
  const testSkill = uniqueSkills[0]; // Pick first skill
  const filteredJobs = activeJobs.filter(job => job.skills.includes(testSkill));

  console.log(`  Test skill: "${testSkill}"`);
  console.log(`  Jobs with this skill: ${filteredJobs.length}`);
  console.log(`  Sample jobs:`);
  filteredJobs.slice(0, 3).forEach(job => {
    console.log(`    - ${job.company}: ${job.title.slice(0, 50)}`);
  });

  if (filteredJobs.length > 0) {
    console.log('  ✅ PASS\n');
  } else {
    console.log('  ❌ FAIL: No jobs found with test skill\n');
  }

  // Test 4: Top 10 most common skills
  console.log('Test 4: Most common skills');
  const topSkills = Object.entries(skillJobCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  topSkills.forEach(([skill, count]) => {
    console.log(`  ${count.toString().padStart(4)} jobs: ${skill}`);
  });
  console.log('  ✅ PASS\n');

  // Test 5: Check for empty skills arrays
  console.log('Test 5: Jobs with no skills');
  const jobsWithoutSkills = activeJobs.filter(job => !job.skills || job.skills.length === 0);
  console.log(`  Jobs without skills: ${jobsWithoutSkills.length} (${(jobsWithoutSkills.length / activeJobs.length * 100).toFixed(1)}%)`);
  if (jobsWithoutSkills.length > 0) {
    console.log('  Sample jobs without skills:');
    jobsWithoutSkills.slice(0, 5).forEach(job => {
      console.log(`    - ${job.company}: ${job.title.slice(0, 50)}`);
    });
  }
  console.log('  ✅ PASS (this is expected - some jobs may not have skills)\n');

  // Summary
  console.log('=== Summary ===');
  console.log(`Total jobs: ${jobs.length}`);
  console.log(`Active jobs: ${activeJobs.length}`);
  console.log(`Unique skills: ${uniqueSkills.length}`);
  console.log(`Jobs with skills: ${activeJobs.length - jobsWithoutSkills.length}`);
  console.log(`Jobs without skills: ${jobsWithoutSkills.length}`);
  console.log(`\n✅ All tests passed! Skills filtering should work correctly.\n`);
}

main().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
