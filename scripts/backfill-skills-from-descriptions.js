#!/usr/bin/env node

/**
 * Backfill Skills from Structured Descriptions
 *
 * For jobs that already have AI-processed structuredDescription but poor/missing skills,
 * this script extracts skills by scanning the structured text for O*NET reference matches.
 *
 * No API calls needed — uses the existing structured content and O*NET reference allowlist.
 *
 * Usage:
 *   node scripts/backfill-skills-from-descriptions.js              # Run backfill
 *   node scripts/backfill-skills-from-descriptions.js --dry-run    # Preview without saving
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllReferenceSkills } from '../src/data/onetSkillsReference.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JOBS_FILE = path.join(__dirname, '../public/data/jobs.json');
const BACKUP_FILE = path.join(__dirname, '../public/data/jobs.backup.json');

const dryRun = process.argv.includes('--dry-run');

/**
 * Extract all text content from a structured description
 */
function extractTextFromStructured(structuredDescription) {
  if (!structuredDescription?.sections) return '';

  const texts = [];
  for (const section of structuredDescription.sections) {
    if (section.type === 'paragraph' && typeof section.content === 'string') {
      texts.push(section.content);
    } else if (section.type === 'list' && Array.isArray(section.content)) {
      texts.push(...section.content);
    }
  }
  return texts.join(' ');
}

// Pre-build reference terms with word boundary regex for fast scanning
const referenceTerms = getAllReferenceSkills().map(term => ({
  name: term,
  pattern: new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
}));

/**
 * Extract skills from text by checking which O*NET reference terms appear in it.
 * Much faster than n-gram generation — O(referenceTerms) regex matches per job.
 */
function extractSkillsFromText(text) {
  const matched = [];
  for (const { name, pattern } of referenceTerms) {
    if (pattern.test(text)) {
      matched.push(name);
    }
  }
  return matched;
}

async function main() {
  console.log('🔄 Backfill Skills from Structured Descriptions\n');

  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be saved\n');
  }

  if (!fs.existsSync(JOBS_FILE)) {
    console.error('❌ jobs.json not found');
    process.exit(1);
  }

  const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
  console.log(`📂 Loaded ${jobs.length} jobs`);

  // Find jobs with structuredDescription that could benefit from skill backfill
  const candidates = jobs.filter(j => j.structuredDescription && !j.structuredDescription.error);
  console.log(`📝 ${candidates.length} jobs have structured descriptions\n`);

  // Backup
  if (!dryRun) {
    fs.copyFileSync(JOBS_FILE, BACKUP_FILE);
    console.log('💾 Backup created\n');
  }

  let jobsUpdated = 0;
  let totalNewSkills = 0;
  let jobsGainedSkills = 0; // Jobs that went from 0 to >0 skills

  for (const job of candidates) {
    const text = extractTextFromStructured(job.structuredDescription);
    if (!text || text.length < 50) continue;

    // Extract skills from structured text (already O*NET-validated via regex match)
    const extracted = extractSkillsFromText(text);
    if (extracted.length === 0) continue;

    // Merge with existing skills (deduplicate, case-insensitive)
    const existingSkills = job.skills || [];
    const seen = new Set(existingSkills.map(s => s.toLowerCase()));
    const newSkills = extracted.filter(s => !seen.has(s.toLowerCase()));

    if (newSkills.length === 0) continue;

    // Track jobs that had zero skills before
    const hadNoSkills = existingSkills.length === 0;

    // Update job
    job.skills = [...existingSkills, ...newSkills];
    jobsUpdated++;
    totalNewSkills += newSkills.length;
    if (hadNoSkills) jobsGainedSkills++;
  }

  // Save
  if (!dryRun && jobsUpdated > 0) {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf-8');
  }

  // Summary
  const jobsWithSkills = jobs.filter(j => j.skills && j.skills.length > 0).length;

  console.log('✅ Backfill complete!\n');
  console.log('Summary:');
  console.log(`  • Jobs updated: ${jobsUpdated}`);
  console.log(`  • New skills added: ${totalNewSkills}`);
  console.log(`  • Jobs that gained skills (had 0): ${jobsGainedSkills}`);
  console.log(`  • Total jobs with skills now: ${jobsWithSkills}/${jobs.length} (${(jobsWithSkills / jobs.length * 100).toFixed(1)}%)`);

  if (dryRun) {
    console.log('\n⚠️  DRY RUN - No changes saved');
  }

  console.log('');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
