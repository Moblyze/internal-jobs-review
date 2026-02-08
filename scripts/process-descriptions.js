#!/usr/bin/env node

/**
 * Batch Job Description Processing Script
 *
 * Processes all jobs in jobs.json and adds AI-restructured descriptions
 * Designed to work as part of the data ingestion pipeline
 *
 * Usage:
 *   npm run process-descriptions              # Process all jobs
 *   npm run process-descriptions -- --dry-run # Test without saving
 *   npm run process-descriptions -- --limit=10 # Process first 10 jobs only
 *   npm run process-descriptions -- --skip-processed # Skip jobs with structuredDescription
 *
 * Requirements:
 *   - public/data/jobs.json exists
 *   - src/utils/aiDescriptionParser.js exports restructureJobDescription()
 *
 * Features:
 *   - Resume capability (skip already-processed jobs)
 *   - Dry-run mode for testing
 *   - Progress tracking with visual progress bar
 *   - Rate limiting to avoid API overload
 *   - Error logging with detailed failure tracking
 *   - Configurable batch size
 */

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// File paths
const JOBS_FILE = path.join(__dirname, '../public/data/jobs.json')
const BACKUP_FILE = path.join(__dirname, '../public/data/jobs.backup.json')
const ERROR_LOG = path.join(__dirname, '../logs/description-processing-errors.log')

// Processing settings
const RATE_LIMIT_DELAY = 500 // 500ms between requests (adjust based on API limits)
const SAVE_INTERVAL = 10 // Save progress every N jobs
const MAX_RETRIES = 3 // Retry failed jobs up to N times

/**
 * Parse command-line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    dryRun: false,
    limit: null,
    skipProcessed: false,
    batchSize: null,
    rateLimit: RATE_LIMIT_DELAY
  }

  args.forEach(arg => {
    if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--skip-processed') {
      options.skipProcessed = true
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10)
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1], 10)
    } else if (arg.startsWith('--rate-limit=')) {
      options.rateLimit = parseInt(arg.split('=')[1], 10)
    }
  })

  return options
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Progress bar utility
 */
function drawProgressBar(current, total, jobTitle, status = '') {
  const percentage = ((current / total) * 100).toFixed(1)
  const barLength = 40
  const filledLength = Math.round((current / total) * barLength)
  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength)

  const truncatedTitle = jobTitle.slice(0, 35).padEnd(35)
  const statusIcon = status === 'success' ? '✓' : status === 'error' ? '✗' : '•'

  // Clear line and draw progress
  process.stdout.write(
    `\r[${bar}] ${percentage}% (${current}/${total}) ${statusIcon} ${truncatedTitle}`
  )
}

/**
 * Log error to file
 */
function logError(jobId, jobTitle, error) {
  const timestamp = new Date().toISOString()
  const logEntry = `[${timestamp}] Job: ${jobId} | Title: ${jobTitle}\n  Error: ${error.message}\n  Stack: ${error.stack}\n\n`

  // Ensure logs directory exists
  const logsDir = path.dirname(ERROR_LOG)
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }

  fs.appendFileSync(ERROR_LOG, logEntry, 'utf-8')
}

/**
 * Create backup of jobs.json before processing
 */
function createBackup(jobsData) {
  try {
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(jobsData, null, 2), 'utf-8')
    return true
  } catch (error) {
    console.error(`Failed to create backup: ${error.message}`)
    return false
  }
}

/**
 * Save jobs data to file
 */
function saveJobsData(jobsData, isDryRun = false) {
  if (isDryRun) {
    return true
  }

  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobsData, null, 2), 'utf-8')
    return true
  } catch (error) {
    console.error(`Failed to save jobs data: ${error.message}`)
    return false
  }
}

/**
 * Load the AI description parser
 * Note: This dynamically imports the parser to catch missing dependency
 */
async function loadParser() {
  try {
    const parserPath = path.join(__dirname, '../src/utils/aiDescriptionParser.js')

    if (!fs.existsSync(parserPath)) {
      throw new Error(
        'AI parser not found. Expected at: src/utils/aiDescriptionParser.js\n' +
        '   The parser should export a restructureJobDescription(text) function.'
      )
    }

    const parser = await import(parserPath)

    if (typeof parser.restructureJobDescription !== 'function') {
      throw new Error(
        'AI parser must export restructureJobDescription(text) function'
      )
    }

    return parser.restructureJobDescription
  } catch (error) {
    throw new Error(`Failed to load AI parser: ${error.message}`)
  }
}

/**
 * Process a single job description
 */
async function processJobDescription(job, restructureFunction, retryCount = 0) {
  try {
    // Call the AI parser
    const structuredDescription = await restructureFunction(job.description)

    // Validate response
    if (!structuredDescription || typeof structuredDescription !== 'object') {
      throw new Error('Invalid response from AI parser (expected object)')
    }

    // Validate sections array exists (for actual aiDescriptionParser.js format)
    if (!structuredDescription.sections || !Array.isArray(structuredDescription.sections)) {
      throw new Error('Invalid response structure (expected sections array)')
    }

    // Check if parser returned an error
    if (structuredDescription.error) {
      throw new Error(`AI parser error: ${structuredDescription.error}`)
    }

    return {
      success: true,
      structuredDescription
    }

  } catch (error) {
    // Retry logic
    if (retryCount < MAX_RETRIES) {
      console.log(`\n   Retrying job ${job.id} (attempt ${retryCount + 1}/${MAX_RETRIES})...`)
      await sleep(RATE_LIMIT_DELAY * 2) // Double delay on retry
      return processJobDescription(job, restructureFunction, retryCount + 1)
    }

    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Main processing function
 */
async function main() {
  console.log('\n🤖 AI Job Description Processing Script\n')

  // Parse command-line arguments
  const options = parseArgs()

  if (options.dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be saved\n')
  }

  // Validate jobs file exists
  if (!fs.existsSync(JOBS_FILE)) {
    console.error(`❌ Error: Jobs file not found: ${JOBS_FILE}`)
    process.exit(1)
  }

  // Load AI parser
  console.log('📦 Loading AI description parser...')
  let restructureJobDescription
  try {
    restructureJobDescription = await loadParser()
    console.log('   ✓ Parser loaded successfully')
  } catch (error) {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  }

  // Load jobs data
  console.log('\n📂 Loading jobs data...')
  let jobsData
  try {
    jobsData = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
    console.log(`   Found ${jobsData.length} jobs`)
  } catch (error) {
    console.error(`❌ Failed to parse jobs.json: ${error.message}`)
    process.exit(1)
  }

  // Filter jobs to process
  let jobsToProcess = jobsData

  if (options.skipProcessed) {
    jobsToProcess = jobsData.filter(job => !job.structuredDescription)
    console.log(`   ${jobsToProcess.length} jobs need processing (${jobsData.length - jobsToProcess.length} already processed)`)
  }

  if (options.limit) {
    jobsToProcess = jobsToProcess.slice(0, options.limit)
    console.log(`   Limited to ${options.limit} jobs`)
  }

  if (jobsToProcess.length === 0) {
    console.log('\n✅ No jobs to process!')
    if (options.skipProcessed) {
      console.log('   All jobs already have structuredDescription field')
    }
    console.log('\n')
    process.exit(0)
  }

  // Create backup before processing
  if (!options.dryRun) {
    console.log('\n💾 Creating backup...')
    if (createBackup(jobsData)) {
      console.log(`   ✓ Backup saved: ${BACKUP_FILE}`)
    } else {
      console.error('❌ Failed to create backup. Aborting.')
      process.exit(1)
    }
  }

  // Processing stats
  const stats = {
    total: jobsToProcess.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: []
  }

  console.log(`\n🔄 Processing ${stats.total} job descriptions...\n`)

  // Process jobs with progress tracking
  for (let i = 0; i < jobsToProcess.length; i++) {
    const job = jobsToProcess[i]
    const jobIndex = jobsData.findIndex(j => j.id === job.id)

    // Update progress bar
    drawProgressBar(i + 1, stats.total, job.title || 'Untitled Job')

    // Skip if no description
    if (!job.description || job.description.trim() === '') {
      stats.skipped++
      drawProgressBar(i + 1, stats.total, job.title || 'Untitled Job', 'skip')
      await sleep(50) // Brief pause to show status
      continue
    }

    // Process the job description
    const result = await processJobDescription(job, restructureJobDescription)

    if (result.success) {
      // Add structuredDescription to job
      jobsData[jobIndex].structuredDescription = result.structuredDescription
      stats.succeeded++
      drawProgressBar(i + 1, stats.total, job.title || 'Untitled Job', 'success')
    } else {
      // Log error
      logError(job.id, job.title, new Error(result.error))
      stats.failed++
      stats.errors.push({
        id: job.id,
        title: job.title,
        error: result.error
      })
      drawProgressBar(i + 1, stats.total, job.title || 'Untitled Job', 'error')
    }

    stats.processed++

    // Save progress periodically
    if (!options.dryRun && stats.processed % SAVE_INTERVAL === 0) {
      saveJobsData(jobsData, false)
    }

    // Rate limiting
    if (i < jobsToProcess.length - 1) {
      await sleep(options.rateLimit)
    }
  }

  // Clear progress bar
  process.stdout.write('\r' + ' '.repeat(120) + '\r')

  // Save final results
  if (!options.dryRun) {
    console.log('\n💾 Saving final results...')
    if (saveJobsData(jobsData, false)) {
      console.log(`   ✓ Results saved to: ${JOBS_FILE}`)
    } else {
      console.error('❌ Failed to save final results')
      console.error(`   Backup available at: ${BACKUP_FILE}`)
      process.exit(1)
    }
  }

  // Print summary
  console.log('\n✅ Processing complete!\n')
  console.log('   Summary:')
  console.log(`   ├─ Total jobs: ${stats.total}`)
  console.log(`   ├─ Processed: ${stats.processed}`)
  console.log(`   ├─ Succeeded: ${stats.succeeded}`)
  console.log(`   ├─ Failed: ${stats.failed}`)
  console.log(`   └─ Skipped: ${stats.skipped} (no description)`)

  if (stats.failed > 0) {
    console.log('\n⚠️  Failed jobs:')
    stats.errors.slice(0, 5).forEach((err, idx) => {
      console.log(`   ${idx + 1}. ${err.title}`)
      console.log(`      Error: ${err.error}`)
    })

    if (stats.errors.length > 5) {
      console.log(`   ... and ${stats.errors.length - 5} more`)
    }

    console.log(`\n   Full error log: ${ERROR_LOG}`)
  }

  if (options.dryRun) {
    console.log('\n⚠️  DRY RUN - No changes were saved')
  } else {
    console.log(`\n   Backup: ${BACKUP_FILE}`)
  }

  console.log('\n📝 Next steps:')
  console.log('   1. Review the updated jobs.json')
  console.log('   2. Check the frontend to verify structuredDescription rendering')
  if (stats.failed > 0) {
    console.log(`   3. Review error log: ${ERROR_LOG}`)
    console.log('   4. Re-run script to retry failed jobs')
  }
  console.log('\n')
}

// Run the script
main().catch(error => {
  console.error('\n❌ Fatal error:', error)
  process.exit(1)
})
