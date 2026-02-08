#!/usr/bin/env node

/**
 * Setup Verification Script
 *
 * Checks that all necessary files and dependencies are in place
 * Run this before attempting to geocode locations
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const checks = {
  passed: [],
  failed: [],
  warnings: []
}

function pass(message) {
  checks.passed.push(message)
  console.log(`✅ ${message}`)
}

function fail(message) {
  checks.failed.push(message)
  console.log(`❌ ${message}`)
}

function warn(message) {
  checks.warnings.push(message)
  console.log(`⚠️  ${message}`)
}

console.log('\n🔍 Verifying Mapbox Geocoding Setup\n')

// Check 1: Jobs data exists
const jobsFile = path.join(__dirname, '../public/data/jobs.json')
if (fs.existsSync(jobsFile)) {
  const jobsData = JSON.parse(fs.readFileSync(jobsFile, 'utf-8'))
  pass(`Jobs data exists (${jobsData.length} jobs)`)
} else {
  fail('Jobs data not found at public/data/jobs.json')
}

// Check 2: .env file exists
const envFile = path.join(__dirname, '../.env')
if (fs.existsSync(envFile)) {
  pass('.env file exists')

  // Check 3: Mapbox token in .env
  const envContent = fs.readFileSync(envFile, 'utf-8')
  if (envContent.includes('VITE_MAPBOX_TOKEN')) {
    const match = envContent.match(/VITE_MAPBOX_TOKEN=(.+)/)
    if (match && match[1] && match[1] !== 'your_mapbox_token_here') {
      pass('Mapbox token configured')
    } else {
      fail('Mapbox token not set (still using placeholder)')
      console.log('   → Get token from: https://account.mapbox.com/access-tokens/')
    }
  } else {
    fail('VITE_MAPBOX_TOKEN not found in .env')
  }
} else {
  fail('.env file not found')
  console.log('   → Copy .env.example to .env and add your Mapbox token')
}

// Check 4: .env.example exists
if (fs.existsSync(path.join(__dirname, '../.env.example'))) {
  pass('.env.example template exists')
} else {
  warn('.env.example not found (optional)')
}

// Check 5: Geocoding script exists
if (fs.existsSync(path.join(__dirname, './geocode-locations.js'))) {
  pass('Geocoding script exists')
} else {
  fail('Geocoding script not found at scripts/geocode-locations.js')
}

// Check 6: Package.json has geocode script
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8')
)
if (packageJson.scripts && packageJson.scripts['geocode-locations']) {
  pass('npm script configured')
} else {
  fail('geocode-locations script not found in package.json')
}

// Check 7: dotenv dependency
if (packageJson.devDependencies && packageJson.devDependencies.dotenv) {
  pass('dotenv dependency present')
} else {
  fail('dotenv dependency missing')
  console.log('   → Run: npm install --save-dev dotenv')
}

// Check 8: Geocoded data directory exists
const dataDir = path.join(__dirname, '../public/data')
if (fs.existsSync(dataDir)) {
  pass('Data directory exists')
} else {
  fail('Data directory not found at public/data/')
}

// Check 9: Geocoded locations file
const geocodedFile = path.join(__dirname, '../public/data/locations-geocoded.json')
if (fs.existsSync(geocodedFile)) {
  const geocodedData = JSON.parse(fs.readFileSync(geocodedFile, 'utf-8'))
  const count = Object.keys(geocodedData).length
  if (count > 0) {
    pass(`Geocoded data exists (${count} locations)`)
  } else {
    warn('Geocoded data file is empty')
    console.log('   → Run: npm run geocode-locations')
  }
} else {
  warn('Geocoded data file not found')
  console.log('   → Will be created when you run: npm run geocode-locations')
}

// Check 10: Required utility files
const requiredFiles = [
  'src/services/mapboxGeocoder.js',
  'src/utils/locationGeodata.js',
  'src/utils/locationFormatter.js',
  'src/utils/locationParser.js'
]

requiredFiles.forEach(file => {
  if (fs.existsSync(path.join(__dirname, '..', file))) {
    pass(`${file} exists`)
  } else {
    fail(`${file} not found`)
  }
})

// Check 11: Documentation
const docs = [
  'MAPBOX_SETUP.md',
  'TESTING_GEOCODING.md',
  'GEOCODING_IMPLEMENTATION.md'
]

docs.forEach(doc => {
  if (fs.existsSync(path.join(__dirname, '..', doc))) {
    pass(`${doc} exists`)
  } else {
    warn(`${doc} not found (optional)`)
  }
})

// Summary
console.log('\n' + '='.repeat(60))
console.log('Summary')
console.log('='.repeat(60))
console.log(`✅ Passed: ${checks.passed.length}`)
console.log(`❌ Failed: ${checks.failed.length}`)
console.log(`⚠️  Warnings: ${checks.warnings.length}`)
console.log('='.repeat(60))

if (checks.failed.length === 0 && checks.warnings.length === 0) {
  console.log('\n🎉 All checks passed! Ready to geocode.')
  console.log('\nNext step: npm run geocode-locations\n')
} else if (checks.failed.length === 0) {
  console.log('\n✅ Setup is valid but has warnings.')
  console.log('\nYou can proceed with: npm run geocode-locations\n')
} else {
  console.log('\n⚠️  Setup has issues. Please fix the failed checks above.')
  console.log('\nSee MAPBOX_SETUP.md for detailed instructions.\n')
  process.exit(1)
}
