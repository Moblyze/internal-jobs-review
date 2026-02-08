/**
 * Test Energy Regions Matching
 *
 * Quick verification script to test region matching against actual jobs data
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Import the energy regions utilities
import {
  TOP_ENERGY_REGIONS,
  ADDITIONAL_ENERGY_REGIONS,
  getRegionLocations,
  extractAllLocations,
  getRegionStats
} from '../src/utils/energyRegions.js'

// Load jobs data
const jobsPath = path.join(__dirname, '../public/data/jobs.json')
const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf-8'))

console.log('='.repeat(80))
console.log('ENERGY REGIONS VERIFICATION')
console.log('='.repeat(80))
console.log(`Total jobs in dataset: ${jobs.length}`)
console.log()

// Extract all locations
const allLocations = extractAllLocations(jobs)
console.log(`Total unique locations: ${allLocations.length}`)
console.log()

// Test each top energy region
console.log('TOP 5 ENERGY REGIONS')
console.log('-'.repeat(80))

TOP_ENERGY_REGIONS.forEach((region, idx) => {
  const stats = getRegionStats(region, jobs)
  const matchedLocations = stats.matchedLocations.slice(0, 10) // Show first 10

  console.log(`${idx + 1}. ${region.name} - ${region.description}`)
  console.log(`   Jobs: ${stats.jobCount}`)
  console.log(`   Locations matched: ${stats.matchedLocations.length}`)
  if (matchedLocations.length > 0) {
    console.log(`   Sample locations:`)
    matchedLocations.forEach(loc => {
      console.log(`   - ${loc}`)
    })
  }
  console.log()
})

console.log()
console.log('ADDITIONAL ENERGY REGIONS')
console.log('-'.repeat(80))

ADDITIONAL_ENERGY_REGIONS.forEach((region, idx) => {
  const stats = getRegionStats(region, jobs)
  const matchedLocations = stats.matchedLocations.slice(0, 5) // Show first 5

  console.log(`${idx + 1}. ${region.name} - ${region.description}`)
  console.log(`   Jobs: ${stats.jobCount}`)
  console.log(`   Locations matched: ${stats.matchedLocations.length}`)
  if (matchedLocations.length > 0) {
    console.log(`   Sample locations:`)
    matchedLocations.forEach(loc => {
      console.log(`   - ${loc}`)
    })
  }
  console.log()
})

// Summary
console.log('='.repeat(80))
console.log('SUMMARY')
console.log('-'.repeat(80))

const totalStats = [...TOP_ENERGY_REGIONS, ...ADDITIONAL_ENERGY_REGIONS].map(region => {
  const stats = getRegionStats(region, jobs)
  return {
    name: region.name,
    jobs: stats.jobCount,
    locations: stats.matchedLocations.length
  }
})

totalStats.sort((a, b) => b.jobs - a.jobs)

console.log('Regions ranked by job count:')
totalStats.forEach((stat, idx) => {
  console.log(`${idx + 1}. ${stat.name.padEnd(20)} - ${stat.jobs} jobs (${stat.locations} locations)`)
})

console.log()
console.log('='.repeat(80))
console.log('Test completed successfully!')
