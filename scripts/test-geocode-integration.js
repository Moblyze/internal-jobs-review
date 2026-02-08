#!/usr/bin/env node

/**
 * Test Script: Geocoding Integration
 *
 * Tests the automatic geocoding functionality without running the full app.
 * Verifies that new locations are detected and would be geocoded.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JOBS_FILE = path.join(__dirname, '../public/data/jobs.json');
const GEOCODED_FILE = path.join(__dirname, '../public/data/locations-geocoded.json');

/**
 * Extract unique locations from jobs (same logic as browser)
 */
function extractUniqueLocations(jobs) {
  const locationSet = new Set();

  jobs.forEach(job => {
    if (job.location) {
      const locations = job.location.split('\n');
      locations.forEach(loc => {
        const cleaned = loc.replace(/^locations\s*/i, '').trim();
        if (cleaned && cleaned.toLowerCase() !== 'locations') {
          locationSet.add(cleaned);
        }
      });
    }
  });

  return Array.from(locationSet);
}

async function main() {
  console.log('\n🧪 Testing Geocoding Integration\n');

  // Load jobs
  if (!fs.existsSync(JOBS_FILE)) {
    console.error(`❌ Jobs file not found: ${JOBS_FILE}`);
    process.exit(1);
  }

  const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
  console.log(`✓ Loaded ${jobs.length} jobs`);

  // Extract all unique locations
  const allLocations = extractUniqueLocations(jobs);
  console.log(`✓ Found ${allLocations.length} unique locations\n`);

  // Load existing geocoded data
  let existingData = {};
  if (fs.existsSync(GEOCODED_FILE)) {
    existingData = JSON.parse(fs.readFileSync(GEOCODED_FILE, 'utf-8'));
    console.log(`✓ Loaded ${Object.keys(existingData).length} existing geocoded locations`);
  } else {
    console.log(`⚠ No existing geocoded data found`);
  }

  // Check for new locations
  const newLocations = allLocations.filter(loc => !existingData[loc]);

  console.log('\n📊 Summary:\n');
  console.log(`  Total unique locations in jobs: ${allLocations.length}`);
  console.log(`  Already geocoded: ${Object.keys(existingData).length}`);
  console.log(`  New locations to geocode: ${newLocations.length}\n`);

  if (newLocations.length > 0) {
    console.log('🆕 New locations that would be geocoded:\n');
    newLocations.slice(0, 10).forEach((loc, i) => {
      console.log(`  ${i + 1}. ${loc}`);
    });
    if (newLocations.length > 10) {
      console.log(`  ... and ${newLocations.length - 10} more`);
    }
    console.log('\n✅ Auto-geocoding will trigger on next refresh!');
  } else {
    console.log('✅ All locations are already geocoded!');
  }

  console.log('\n📝 Next steps:');
  console.log('  1. Run `npm run dev` to start the dev server');
  console.log('  2. Open the app and click "Refresh Jobs"');
  console.log('  3. Watch the geocoding happen automatically!\n');
}

main().catch(error => {
  console.error('\n❌ Error:', error);
  process.exit(1);
});
