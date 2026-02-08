#!/usr/bin/env node

/**
 * Batch Processing Integration Test
 *
 * Tests the batch processing script with the actual AI parser
 * to verify they work together correctly.
 *
 * Usage:
 *   node scripts/test-batch-processing.js
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Test data
const TEST_JOBS = [
  {
    id: 'test-job-1',
    title: 'Senior Software Engineer',
    description: `We are seeking a talented senior software engineer to join our team.

Key Responsibilities:
- Design and implement scalable backend systems
- Lead technical architecture decisions
- Mentor junior developers
- Participate in code reviews

Requirements:
- 5+ years of backend development experience
- Strong knowledge of Node.js and Python
- Experience with microservices architecture
- Excellent communication skills

Benefits:
- Competitive salary
- Remote work options
- Professional development budget
- Health insurance`
  },
  {
    id: 'test-job-2',
    title: 'Electrician',
    description: 'Join our team! We need experienced electricians to work on commercial projects. You will install and maintain electrical systems. Must have valid license and 3+ years experience. Great pay and benefits offered.'
  }
]

/**
 * Test the AI parser directly
 */
async function testParser() {
  console.log('\n🧪 Testing AI Parser...\n')

  try {
    // Dynamic import to test the actual parser
    const parserPath = path.join(__dirname, '../src/utils/aiDescriptionParser.js')

    if (!fs.existsSync(parserPath)) {
      throw new Error('AI parser not found at: src/utils/aiDescriptionParser.js')
    }

    const parser = await import(parserPath)

    if (typeof parser.restructureJobDescription !== 'function') {
      throw new Error('Parser must export restructureJobDescription function')
    }

    console.log('✓ Parser file exists')
    console.log('✓ Parser exports restructureJobDescription function')

    // Test with sample job
    console.log('\n📝 Testing with sample job description...\n')

    const result = await parser.restructureJobDescription(TEST_JOBS[0].description)

    console.log('Response structure:')
    console.log(JSON.stringify(result, null, 2))

    // Validate structure
    if (!result.sections || !Array.isArray(result.sections)) {
      throw new Error('Invalid response: missing sections array')
    }

    console.log(`\n✓ Parser returned ${result.sections.length} sections`)

    // Check if there was an error
    if (result.error) {
      console.warn(`\n⚠️  Parser returned with error: ${result.error}`)
      console.warn('   This might indicate API key issues or rate limiting')
    }

    // Validate section structure
    for (let i = 0; i < result.sections.length; i++) {
      const section = result.sections[i]

      if (!section.title || !section.type || !section.content) {
        throw new Error(`Invalid section ${i}: missing required fields`)
      }

      if (section.type !== 'paragraph' && section.type !== 'list') {
        throw new Error(`Invalid section ${i}: type must be "paragraph" or "list"`)
      }

      console.log(`✓ Section ${i + 1}: "${section.title}" (${section.type})`)
    }

    return { success: true, result }

  } catch (error) {
    console.error(`\n✗ Parser test failed: ${error.message}\n`)
    return { success: false, error: error.message }
  }
}

/**
 * Test batch processing script without actually running it
 */
async function testBatchScript() {
  console.log('\n🧪 Testing Batch Processing Script...\n')

  try {
    const scriptPath = path.join(__dirname, 'process-descriptions.js')

    if (!fs.existsSync(scriptPath)) {
      throw new Error('Batch script not found at: scripts/process-descriptions.js')
    }

    console.log('✓ Batch script exists')

    // Check if script is executable
    const stats = fs.statSync(scriptPath)
    const isExecutable = (stats.mode & parseInt('100', 8)) !== 0

    if (isExecutable) {
      console.log('✓ Script is executable')
    } else {
      console.warn('⚠️  Script is not executable (but still runnable via node)')
    }

    // Read script to check structure
    const scriptContent = fs.readFileSync(scriptPath, 'utf-8')

    // Check for key features
    const features = [
      { name: 'Shebang', pattern: /^#!\/usr\/bin\/env node/ },
      { name: 'Progress bar', pattern: /drawProgressBar/ },
      { name: 'Error logging', pattern: /logError/ },
      { name: 'Rate limiting', pattern: /RATE_LIMIT/ },
      { name: 'Dry run support', pattern: /--dry-run/ },
      { name: 'Resume capability', pattern: /--skip-processed/ },
      { name: 'Backup creation', pattern: /createBackup/ },
    ]

    features.forEach(feature => {
      if (feature.pattern.test(scriptContent)) {
        console.log(`✓ ${feature.name} implemented`)
      } else {
        console.warn(`⚠️  ${feature.name} not found`)
      }
    })

    return { success: true }

  } catch (error) {
    console.error(`\n✗ Batch script test failed: ${error.message}\n`)
    return { success: false, error: error.message }
  }
}

/**
 * Check environment configuration
 */
function testEnvironment() {
  console.log('\n🧪 Testing Environment...\n')

  try {
    // Check for .env file
    const envPath = path.join(__dirname, '../.env')

    if (fs.existsSync(envPath)) {
      console.log('✓ .env file exists')

      const envContent = fs.readFileSync(envPath, 'utf-8')

      // Check for Anthropic API key
      if (envContent.includes('ANTHROPIC_API_KEY')) {
        const match = envContent.match(/ANTHROPIC_API_KEY=(.+)/)
        if (match && match[1] && match[1] !== 'your_anthropic_api_key_here') {
          console.log('✓ ANTHROPIC_API_KEY is configured')
        } else {
          console.warn('⚠️  ANTHROPIC_API_KEY is not set (required for processing)')
        }
      } else {
        console.warn('⚠️  ANTHROPIC_API_KEY not found in .env')
      }
    } else {
      console.warn('⚠️  .env file not found')
    }

    // Check for jobs.json
    const jobsPath = path.join(__dirname, '../public/data/jobs.json')

    if (fs.existsSync(jobsPath)) {
      const jobsData = JSON.parse(fs.readFileSync(jobsPath, 'utf-8'))
      console.log(`✓ jobs.json exists with ${jobsData.length} jobs`)

      // Count how many already have structuredDescription
      const processedCount = jobsData.filter(job => job.structuredDescription).length
      console.log(`   ${processedCount} already processed, ${jobsData.length - processedCount} remaining`)
    } else {
      console.warn('⚠️  jobs.json not found (run npm run export-jobs first)')
    }

    // Check logs directory
    const logsDir = path.join(__dirname, '../logs')
    if (!fs.existsSync(logsDir)) {
      console.log('ℹ️  logs/ directory will be created automatically')
    } else {
      console.log('✓ logs/ directory exists')
    }

    return { success: true }

  } catch (error) {
    console.error(`\n✗ Environment test failed: ${error.message}\n`)
    return { success: false, error: error.message }
  }
}

/**
 * Test data flow (dry run simulation)
 */
async function testDataFlow() {
  console.log('\n🧪 Testing Data Flow (Dry Run Simulation)...\n')

  try {
    // Load parser
    const parserPath = path.join(__dirname, '../src/utils/aiDescriptionParser.js')
    const parser = await import(parserPath)

    // Simulate processing
    console.log('Simulating batch processing of 2 test jobs...\n')

    for (let i = 0; i < TEST_JOBS.length; i++) {
      const job = TEST_JOBS[i]

      console.log(`[${i + 1}/${TEST_JOBS.length}] Processing: ${job.title}`)

      // Call parser
      const result = await parser.restructureJobDescription(job.description)

      if (result.error) {
        console.warn(`   ⚠️  Error: ${result.error}`)
      } else {
        console.log(`   ✓ Success: ${result.sections.length} sections created`)
      }

      // Small delay to simulate rate limiting
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    console.log('\n✓ Data flow simulation complete')

    return { success: true }

  } catch (error) {
    console.error(`\n✗ Data flow test failed: ${error.message}\n`)
    return { success: false, error: error.message }
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  Batch Processing Integration Test')
  console.log('═══════════════════════════════════════════════════════════')

  const results = {
    environment: testEnvironment(),
    batchScript: await testBatchScript(),
    parser: await testParser(),
    dataFlow: await testDataFlow(),
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  Test Summary')
  console.log('═══════════════════════════════════════════════════════════\n')

  const allPassed = Object.values(results).every(r => r.success)

  Object.entries(results).forEach(([test, result]) => {
    const status = result.success ? '✓ PASS' : '✗ FAIL'
    console.log(`${status} - ${test}`)
    if (!result.success && result.error) {
      console.log(`       Error: ${result.error}`)
    }
  })

  if (allPassed) {
    console.log('\n✅ All tests passed! Ready to process jobs.')
    console.log('\nNext steps:')
    console.log('  1. Set ANTHROPIC_API_KEY in .env (if not already set)')
    console.log('  2. Run: npm run process-descriptions -- --dry-run --limit=5')
    console.log('  3. Review output')
    console.log('  4. Run: npm run process-descriptions')
  } else {
    console.log('\n⚠️  Some tests failed. Review errors above.')
    console.log('\nCommon fixes:')
    console.log('  - Missing API key: Add ANTHROPIC_API_KEY to .env')
    console.log('  - Missing jobs.json: Run npm run export-jobs')
    console.log('  - Parser issues: Check src/utils/aiDescriptionParser.js')
  }

  console.log('\n')

  process.exit(allPassed ? 0 : 1)
}

// Run tests
main().catch(error => {
  console.error('\n❌ Fatal test error:', error)
  process.exit(1)
})
