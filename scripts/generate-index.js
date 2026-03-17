/**
 * Generate jobs-index.json from existing jobs.json
 *
 * Strips description and structuredDescription to create a lightweight
 * index file for the list view (~18MB instead of ~94MB).
 *
 * Usage: node scripts/generate-index.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JOBS_PATH = path.join(__dirname, '../public/data/jobs.json');
const INDEX_PATH = path.join(__dirname, '../public/data/jobs-index.json');

console.log('Reading jobs.json...');
const jobs = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf8'));
console.log(`  Loaded ${jobs.length} jobs (${(fs.statSync(JOBS_PATH).size / 1024 / 1024).toFixed(1)}MB)`);

const indexJobs = jobs.map(job => {
  const { description, structuredDescription, ...rest } = job;
  // Keep first 200 chars of description for card preview
  if (description) {
    rest.descriptionPreview = description
      .replace(/<[^>]*>/g, '')    // Strip HTML
      .replace(/\s+/g, ' ')       // Collapse whitespace
      .trim()
      .substring(0, 200);
  }
  return rest;
});

fs.writeFileSync(INDEX_PATH, JSON.stringify(indexJobs), 'utf8');
const indexSize = (fs.statSync(INDEX_PATH).size / 1024 / 1024).toFixed(1);
console.log(`Wrote ${INDEX_PATH} (${indexSize}MB)`);
