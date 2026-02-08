/**
 * Test Location Parser with Metadata
 *
 * Demonstrates the new geographic metadata capabilities.
 */

import {
  formatLocation,
  getLocationWithMetadata,
  getAllLocationsWithMetadata
} from './src/utils/locationParser.js';

console.log('Testing Location Parser with Metadata\n');
console.log('='.repeat(80));

// Test cases
const testCases = [
  {
    description: 'US location with full metadata',
    input: 'locations\nUS-TX-HOUSTON-2001 RANKIN ROAD'
  },
  {
    description: 'Italian location with coordinates',
    input: 'locations\nIT-FI-FLORENCE-VIA FELICE MATTEUCCI 2'
  },
  {
    description: 'Canadian location',
    input: 'locations\nCA-AB-CALGARY-4839 90TH AVENUE SE'
  },
  {
    description: 'UAE location (no state code)',
    input: 'locations\nAE-ABU DHABI-AL GHAITH HOLDING TOWER'
  },
  {
    description: 'Multiple locations',
    input: 'locations\nUS-TX-HOUSTON-2001 RANKIN ROAD\nUS-LA-NEW ORLEANS-123 MAIN ST'
  },
  {
    description: 'Simple city name (minimal metadata)',
    input: 'locations\nHouston'
  },
  {
    description: 'Special case - offshore',
    input: 'locations\nGulf of Mexico'
  }
];

testCases.forEach((test, index) => {
  console.log(`\n\nTest ${index + 1}: ${test.description}`);
  console.log('-'.repeat(80));
  console.log(`Input: "${test.input}"`);

  // Test backward-compatible formatLocation
  const formatted = formatLocation(test.input);
  console.log(`\nFormatted (backward compatible): "${formatted}"`);

  // Test new getLocationWithMetadata
  const withMetadata = getLocationWithMetadata(test.input);
  console.log('\nWith Metadata:');
  console.log(JSON.stringify(withMetadata, null, 2));

  // For multiple locations, show all with metadata
  if (test.input.split('\n').length > 2) {
    const allWithMetadata = getAllLocationsWithMetadata(test.input);
    console.log('\nAll Locations with Metadata:');
    console.log(JSON.stringify(allWithMetadata, null, 2));
  }
});

console.log('\n\n' + '='.repeat(80));
console.log('\n✓ Location parser integration complete!');
console.log('\nNew Features:');
console.log('- Uses country-state-city library for comprehensive geographic data');
console.log('- Provides coordinates (lat/lon) for mapping features');
console.log('- Backward compatible with existing formatLocation() API');
console.log('- New getLocationWithMetadata() for enhanced data');
console.log('- Handles edge cases (no state code, special locations)');
console.log('- No API key required - all data is offline\n');
