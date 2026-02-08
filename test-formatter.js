/**
 * Test script for content formatter
 * Run with: node test-formatter.js
 */

import { formatJobDescription } from './src/utils/contentFormatter.js';
import { formatLocation } from './src/utils/locationParser.js';
import fs from 'fs';

// Sample job description (from actual Baker Hughes data)
const sampleDescription = `ESSENTIAL RESPONSIBILITIES:
•    Ensure compliance with manage the Job Cycle (MtJC) process
•    Work with the assigned Service Delivery Coordinator/Salesperson to understand the client's well construction or production objectives
•    Perform offset job analysis and product/service specific engineering modelling calculations to understand application hazards and incident potential

QUALIFICATIONS/REQUIREMENTS:
•    Bachelor's degree in engineering
•    Excellent leadership, strong interpersonal, influencing and planning skills
•    Ability to be on call outside of normal business hours
•    Ability to work in a global matrix organization
•    Excellent communication and presentation skills

DESIRED CHARACTERISTICS:
•    Significant operational experience
•    Comfortable presenting in front of an audience of experienced peers
•    Ability to manage, develop, coach, and mentor teams across organizational boundaries`;

// Sample locations
const sampleLocations = [
  'locations\nUS-TX-HOUSTON-2001 RANKIN ROAD',
  'locations\nAE-ABU DHABI-AL GHAITH HOLDING TOWER, AIRPORT ROAD',
  'locations\nBR-RJ-RIO DE JANEIRO-VENTURA-AV REPUBLICA DO CHILE 330',
  'Houston',
  'Global Recruiting'
];

console.log('='.repeat(80));
console.log('JOB DESCRIPTION FORMATTER TEST');
console.log('='.repeat(80));

// Test description formatting
console.log('\n📄 TESTING DESCRIPTION FORMATTING\n');
console.log('Original Description:');
console.log('-'.repeat(80));
console.log(sampleDescription);
console.log('-'.repeat(80));

const formatted = formatJobDescription(sampleDescription);
console.log('\n✨ Formatted Structure:');
console.log('-'.repeat(80));
console.log(JSON.stringify(formatted, null, 2));
console.log('-'.repeat(80));

console.log('\n🎨 Rendered Output:\n');
formatted.forEach((block, index) => {
  switch (block.type) {
    case 'header':
      console.log(`\n### ${block.content}\n`);
      break;
    case 'list':
      block.items.forEach(item => {
        console.log(`  • ${item}`);
      });
      console.log();
      break;
    case 'paragraph':
      console.log(`${block.content}\n`);
      break;
  }
});

// Test location formatting
console.log('='.repeat(80));
console.log('\n📍 TESTING LOCATION FORMATTING\n');
console.log('-'.repeat(80));

sampleLocations.forEach(location => {
  const formatted = formatLocation(location);
  console.log(`Input:  "${location.replace(/\n/g, '\\n')}"`);
  console.log(`Output: "${formatted}"`);
  console.log('-'.repeat(80));
});

// Test with real job data if available
try {
  const jobsData = fs.readFileSync('./public/data/jobs.json', 'utf8');
  const jobs = JSON.parse(jobsData);

  console.log('\n🔍 TESTING WITH REAL JOB DATA\n');
  console.log(`Found ${jobs.length} jobs in database\n`);

  // Test first 3 jobs
  jobs.slice(0, 3).forEach((job, index) => {
    console.log(`\nJob ${index + 1}: ${job.title}`);
    console.log('-'.repeat(80));

    const formattedLoc = formatLocation(job.location);
    console.log(`Location: ${formattedLoc || 'N/A'}`);

    const formattedDesc = formatJobDescription(job.description);
    console.log(`Description blocks: ${formattedDesc.length}`);

    const blockTypes = formattedDesc.reduce((acc, block) => {
      acc[block.type] = (acc[block.type] || 0) + 1;
      return acc;
    }, {});
    console.log(`Block types: ${JSON.stringify(blockTypes)}`);
    console.log('-'.repeat(80));
  });

  console.log('\n✅ Test completed successfully!');
} catch (error) {
  console.log('\n⚠️  Could not load real job data:', error.message);
  console.log('✅ Formatter tests completed successfully!');
}

console.log('\n' + '='.repeat(80));
