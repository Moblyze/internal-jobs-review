/**
 * Tests for Location Parser
 *
 * Run with: node --experimental-modules locationParser.test.js
 * Or just verify logic manually
 */

import { formatLocation, getAllLocations } from './locationParser.js';

// Test cases from actual job data
const testCases = [
  {
    input: "locations\nIT-FI-FLORENCE-VIA FELICE MATTEUCCI 2",
    expected: "Florence, Italy",
    description: "Italian location with address"
  },
  {
    input: "locations\nUS-TX-HOUSTON-2001 RANKIN ROAD",
    expected: "Houston, TX",
    description: "US location with address"
  },
  {
    input: "locations\nBR-RJ-RIO DE JANEIRO-VENTURA-AV REPUBLICA DO CHILE 330",
    expected: "Rio De Janeiro, Rio de Janeiro, Brazil",
    description: "Brazilian location with facility name"
  },
  {
    input: "locations\nCA-AB-CALGARY-4839 90TH AVENUE SE",
    expected: "Calgary, AB, Canada",
    description: "Canadian location"
  },
  {
    input: "locations\nAE-ABU DHABI-AL GHAITH HOLDING TOWER, AIRPORT ROAD",
    expected: "Abu Dhabi, United Arab Emirates",
    description: "UAE location"
  },
  {
    input: "locations\nHouston",
    expected: "Houston",
    description: "Simple city name"
  },
  {
    input: "locations\nAberdeen",
    expected: "Aberdeen",
    description: "Simple city name"
  },
  {
    input: "locations\nGlobal Recruiting",
    expected: "Global Recruiting",
    description: "Special case - recruiting"
  },
  {
    input: "locations\nGulf of Mexico",
    expected: "Gulf of Mexico",
    description: "Special case - offshore"
  },
  {
    input: "locations\nNoble Interceptor",
    expected: "Noble Interceptor",
    description: "Special case - vessel name"
  },
  {
    input: "locations\nUS-TX-OTHER TEXAS\nUS-NM-OTHER NEW MEXICO\nUS-MS-OTHER MISSISSIPPI",
    expectedCount: 3,
    description: "Multiple US states"
  },
  {
    input: "locations\nUS-TX-MIDLAND-2105 MARKET STREET",
    expected: "Midland, TX",
    description: "US location - Midland"
  },
  {
    input: "locations\nUS-TX-OTHER TEXAS",
    expected: "Texas",
    description: "State-wide location (OTHER TEXAS) - should show just state name"
  },
  {
    input: "locations\nUS-NM-OTHER NEW MEXICO",
    expected: "New Mexico",
    description: "State-wide location (OTHER NEW MEXICO) - should show just state name"
  },
  {
    input: "locations\nUS-AR-OTHER ARKANSAS",
    expected: "Arkansas",
    description: "State-wide location (OTHER ARKANSAS) - should show just state name"
  }
];

console.log('Running Location Parser Tests\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
  console.log(`\nTest ${index + 1}: ${test.description}`);
  console.log(`Input: "${test.input}"`);

  if (test.expectedCount) {
    const locations = getAllLocations(test.input);
    console.log(`Output: [${locations.join(', ')}]`);
    console.log(`Expected count: ${test.expectedCount}, Actual count: ${locations.length}`);

    if (locations.length === test.expectedCount) {
      console.log('✓ PASS');
      passed++;
    } else {
      console.log('✗ FAIL');
      failed++;
    }
  } else {
    const formatted = formatLocation(test.input);
    console.log(`Output: "${formatted}"`);
    console.log(`Expected: "${test.expected}"`);

    if (formatted === test.expected) {
      console.log('✓ PASS');
      passed++;
    } else {
      console.log('✗ FAIL');
      failed++;
    }
  }
});

console.log('\n' + '='.repeat(60));
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);

if (failed === 0) {
  console.log('\n🎉 All tests passed!');
} else {
  console.log('\n⚠️  Some tests failed. Review implementation.');
}
