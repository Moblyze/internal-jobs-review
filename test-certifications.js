/**
 * Test certification extraction from jobs data
 */

import { extractJobCertifications, getAllCertifications, groupCertificationsByCategory } from './src/utils/certificationExtractor.js';
import fs from 'fs';

// Load jobs data
const jobsData = JSON.parse(fs.readFileSync('./public/data/jobs.json', 'utf-8'));

console.log('==========================================');
console.log('CERTIFICATION EXTRACTION TEST');
console.log('==========================================\n');

console.log(`Total jobs analyzed: ${jobsData.length}\n`);

// Get all certifications
const allCerts = getAllCertifications(jobsData);

console.log(`Total unique certifications found: ${allCerts.length}\n`);

console.log('==========================================');
console.log('ALL CERTIFICATIONS (Alphabetical)');
console.log('==========================================');
allCerts.forEach((cert, index) => {
  console.log(`${index + 1}. ${cert}`);
});

console.log('\n==========================================');
console.log('CERTIFICATIONS BY CATEGORY');
console.log('==========================================\n');

const grouped = groupCertificationsByCategory(allCerts);

// Display by category
const categoryOrder = [
  'api',
  'well_control',
  'offshore_survival',
  'corrosion',
  'rigging',
  'crane',
  'welding',
  'safety',
  'first_aid',
  'maritime',
  'professional',
  'trades',
  'industry'
];

const categoryNames = {
  api: 'API Certifications',
  well_control: 'Well Control',
  offshore_survival: 'Offshore Survival',
  corrosion: 'Corrosion',
  rigging: 'Rigging & Lifting',
  crane: 'Crane Operations',
  welding: 'Welding',
  safety: 'Safety',
  first_aid: 'First Aid & Medical',
  maritime: 'Maritime',
  professional: 'Professional',
  trades: 'Skilled Trades',
  industry: 'Industry Bodies'
};

categoryOrder.forEach(category => {
  if (grouped[category] && grouped[category].length > 0) {
    console.log(`${categoryNames[category]}:`);
    grouped[category].forEach(cert => {
      console.log(`  - ${cert}`);
    });
    console.log('');
  }
});

console.log('==========================================');
console.log('QUALITY CHECKS');
console.log('==========================================\n');

// Check for sentences (contains periods)
const withPeriods = allCerts.filter(cert => cert.includes('.'));
console.log(`Certifications with periods: ${withPeriods.length}`);
if (withPeriods.length > 0) {
  console.log('WARNING: Found certifications with periods:');
  withPeriods.forEach(cert => console.log(`  - ${cert}`));
}

// Check for long certifications (likely sentences)
const tooLong = allCerts.filter(cert => cert.length > 80);
console.log(`\nCertifications over 80 chars: ${tooLong.length}`);
if (tooLong.length > 0) {
  console.log('WARNING: Found overly long certifications:');
  tooLong.forEach(cert => console.log(`  - ${cert}`));
}

// Check for requirement language
const requirementWords = ['required', 'preferred', 'must', 'should', 'candidates'];
const withRequirements = allCerts.filter(cert =>
  requirementWords.some(word => cert.toLowerCase().includes(word))
);
console.log(`\nCertifications with requirement language: ${withRequirements.length}`);
if (withRequirements.length > 0) {
  console.log('WARNING: Found certifications with requirement language:');
  withRequirements.forEach(cert => console.log(`  - ${cert}`));
}

console.log('\n==========================================');
console.log('CERTIFICATION FREQUENCY');
console.log('==========================================\n');

const certCounts = {};
for (const job of jobsData) {
  const certs = extractJobCertifications(job);
  certs.forEach(cert => {
    certCounts[cert] = (certCounts[cert] || 0) + 1;
  });
}

const sortedCerts = Object.entries(certCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);

sortedCerts.forEach(([cert, count]) => {
  const bar = '█'.repeat(Math.ceil(count / 2));
  console.log(`${cert.padEnd(30)} ${count.toString().padStart(3)} ${bar}`);
});

console.log('\n==========================================');
console.log('SAMPLE JOBS WITH CERTIFICATIONS');
console.log('==========================================\n');

let jobsWithCerts = 0;
let sampleCount = 0;
const maxSamples = 5;

for (const job of jobsData) {
  const certs = extractJobCertifications(job);

  if (certs.length > 0) {
    jobsWithCerts++;

    if (sampleCount < maxSamples) {
      console.log(`${job.title} at ${job.company}`);
      console.log(`  Certifications: ${certs.join(', ')}`);
      console.log('');
      sampleCount++;
    }
  }
}

console.log('==========================================');
console.log('SUMMARY');
console.log('==========================================\n');

console.log(`Total jobs: ${jobsData.length}`);
console.log(`Jobs with certifications: ${jobsWithCerts}`);
console.log(`Jobs without certifications: ${jobsData.length - jobsWithCerts}`);
console.log(`Percentage with certs: ${((jobsWithCerts / jobsData.length) * 100).toFixed(1)}%`);
console.log(`\nTotal certifications: ${allCerts.length}`);
console.log(`Categories represented: ${Object.keys(grouped).length}`);
console.log(`Quality issues: ${withPeriods.length + tooLong.length + withRequirements.length}`);

if (allCerts.length >= 5 && allCerts.length <= 30) {
  console.log('\n✅ PASS: Reasonable number of certifications (5-30)');
} else if (allCerts.length < 5) {
  console.log('\n⚠️  WARNING: Very few certifications found (< 5)');
} else {
  console.log('\n⚠️  WARNING: Many certifications found (> 30) - may include noise');
}

if (withPeriods.length === 0 && tooLong.length === 0 && withRequirements.length === 0) {
  console.log('✅ PASS: No quality issues detected');
} else {
  console.log('❌ FAIL: Quality issues detected - review warnings above');
}

console.log('');
