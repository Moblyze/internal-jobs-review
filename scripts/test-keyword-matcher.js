/**
 * Test Keyword Matcher
 *
 * Quick validation that new keyword patterns correctly match
 * energy sector roles from Notion database.
 */

import { matchEnergyRole } from '../src/utils/energyJobMatcher.js'

// Test cases based on Notion roles
const testCases = [
  // Subsea & Marine (Previously missed by O*NET)
  { title: 'ROV Pilot', expected: 'rov-pilot-technician', category: 'Subsea & Marine' },
  { title: 'ROV Supervisor - Offshore', expected: 'rov-supervisor', category: 'Subsea & Marine' },
  { title: 'Subsea Engineer - Production Systems', expected: 'subsea-engineer', category: 'Subsea & Marine' },
  { title: 'Saturation Diver', expected: 'saturation-diver', category: 'Subsea & Marine' },
  { title: 'DP Operator', expected: 'dp-operator', category: 'Subsea & Marine' },
  { title: 'Chief Engineer (Marine)', expected: 'chief-engineer-marine', category: 'Subsea & Marine' },

  // Drilling & Wells
  { title: 'Driller - Land Rig', expected: 'driller-rig-crew', category: 'Drilling & Wells' },
  { title: 'Assistant Driller', expected: 'assistant-driller', category: 'Drilling & Wells' },
  { title: 'Field Professional - MWD, II', expected: 'mwd-lwd', category: 'Drilling & Wells' },
  { title: 'Directional Drilling Engineer', expected: 'directional-drilling', category: 'Drilling & Wells' },
  { title: 'Mud Engineer', expected: 'mud-engineer', category: 'Drilling & Wells' },

  // Operations
  { title: 'Process Operator', expected: 'process-operator', category: 'Operations' },
  { title: 'Plant Operator - Refinery', expected: 'plant-operator', category: 'Operations' },
  { title: 'Control Room Operator', expected: 'control-room-operator', category: 'Operations' },
  { title: 'Reactor Operator', expected: 'reactor-operator', category: 'Operations' },
  { title: 'Crane Operator', expected: 'crane-operator', category: 'Operations' },

  // Technical Trades (New patterns)
  { title: 'Welder - Pipeline', expected: 'welder', category: 'Technical Trades' },
  { title: 'Pipefitter', expected: 'pipefitter', category: 'Technical Trades' },
  { title: 'Scaffolder', expected: 'scaffolder', category: 'Technical Trades' },
  { title: 'Rigger', expected: 'rigger', category: 'Technical Trades' },

  // Maintenance & Trades
  { title: 'Instrumentation Technician', expected: 'instrumentation-tech', category: 'Maintenance' },
  { title: 'E&I Technician - Offshore', expected: 'ei-technician', category: 'Maintenance' },
  { title: 'Millwright', expected: 'millwright', category: 'Maintenance' },

  // Inspection & Integrity (New)
  { title: 'NDT Inspector', expected: 'ndt-inspector', category: 'Inspection' },
  { title: 'Pipeline Inspector', expected: 'pipeline-inspector', category: 'Inspection' },
  { title: 'Coating Inspector', expected: 'coating-inspector', category: 'Inspection' },

  // Digital & Automation (New)
  { title: 'SCADA Engineer', expected: 'scada-engineer', category: 'Digital' },
  { title: 'PLC Technician', expected: 'plc-technician', category: 'Digital' },
  { title: 'Automation Engineer', expected: 'automation-engineer', category: 'Digital' },

  // Wind Energy (New)
  { title: 'Wind Turbine Technician', expected: 'wind-turbine-technician', category: 'Wind' },
  { title: 'Blade Technician', expected: 'blade-technician', category: 'Wind' },

  // Energy Transition (New)
  { title: 'CCS Engineer', expected: 'ccs-engineer', category: 'Energy Transition' },
  { title: 'Hydrogen Engineer', expected: 'hydrogen-engineer', category: 'Energy Transition' },
  { title: 'Hydrogen Technician', expected: 'hydrogen-technician', category: 'Energy Transition' },

  // Specialized
  { title: 'Rope Access Technician - IRATA Level 3', expected: 'rope-access-technician', category: 'Specialized' },
]

console.log('🧪 Testing Keyword Matcher\n')
console.log('Testing new patterns against Notion roles...\n')

let passCount = 0
let failCount = 0
const failures = []

for (const test of testCases) {
  const result = matchEnergyRole(test.title)

  if (!result) {
    failCount++
    failures.push({
      ...test,
      result: null,
      error: 'No match found'
    })
    console.log(`❌ FAIL: "${test.title}" (${test.category})`)
    console.log(`   Expected: ${test.expected}`)
    console.log(`   Got: No match\n`)
  } else if (result.roleId !== test.expected) {
    failCount++
    failures.push({
      ...test,
      result: result.roleId,
      error: 'Wrong match'
    })
    console.log(`❌ FAIL: "${test.title}" (${test.category})`)
    console.log(`   Expected: ${test.expected}`)
    console.log(`   Got: ${result.roleId}\n`)
  } else {
    passCount++
    console.log(`✅ PASS: "${test.title}" → ${result.roleName} (${result.confidence} confidence)`)
  }
}

// Summary
console.log('\n' + '='.repeat(60))
console.log('📊 Test Summary\n')
console.log(`Total tests: ${testCases.length}`)
console.log(`Passed: ${passCount} (${Math.round(passCount / testCases.length * 100)}%)`)
console.log(`Failed: ${failCount} (${Math.round(failCount / testCases.length * 100)}%)`)

if (failures.length > 0) {
  console.log('\n❌ Failed Tests:')
  failures.forEach(f => {
    console.log(`   - ${f.title} (expected: ${f.expected}, got: ${f.result || 'no match'})`)
  })
  process.exit(1)
} else {
  console.log('\n✅ All tests passed!')
  console.log('\nReady to run: npm run match-occupations')
}
