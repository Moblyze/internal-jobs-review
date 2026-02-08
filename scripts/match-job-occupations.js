/**
 * Match Job Occupations Script (AI-Enhanced Approach)
 *
 * Matches all jobs in jobs.json using an AI-enhanced approach:
 * 1. AI-based semantic role classification (PRIMARY)
 * 2. O*NET API fallback for low/no confidence matches
 * 3. Intelligent confidence scoring
 *
 * This uses Claude AI to understand job role variations and specializations,
 * providing more accurate matching than keyword-based approaches.
 *
 * Output: public/data/job-occupations.json
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config as dotenvConfig } from 'dotenv'

// Load environment variables FIRST before importing clients
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.join(__dirname, '../.env')
dotenvConfig({ path: envPath })

// Verify API keys are loaded
if (!process.env.VITE_ONET_API_KEY) {
  console.error('❌ Error: VITE_ONET_API_KEY not found in .env file')
  console.error(`   Checked: ${envPath}`)
  process.exit(1)
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ Error: ANTHROPIC_API_KEY not found in .env file')
  console.error(`   Checked: ${envPath}`)
  console.error('   AI classification requires Anthropic API key')
  process.exit(1)
}

// Now import clients after env is loaded
const { search } = await import('../src/utils/onetClient.js')
const { classifyJobRole } = await import('../src/utils/aiDescriptionParser.js')
const { ENERGY_ROLES } = await import('../src/utils/energyRoles.js')

// Priority O*NET occupations for energy sector (same as skills cache)
const PRIORITY_OCCUPATIONS = [
  '47-2111.00', // Electricians
  '49-9021.00', // HVAC Mechanics and Installers
  '51-4121.00', // Welders, Cutters, Solderers, and Brazers
  '17-2199.11', // Solar Energy Systems Engineers
  '17-2141.00', // Mechanical Engineers
  '47-2152.00', // Plumbers, Pipefitters, and Steamfitters
  '17-2071.00', // Electrical Engineers
  '17-2141.01', // Fuel Cell Engineers
  '47-2221.00', // Structural Iron and Steel Workers
  '49-9051.00', // Electrical Power-Line Installers and Repairers
  '17-3023.00', // Electrical and Electronic Engineering Technologists
  '17-3026.00', // Industrial Engineering Technologists
  '51-8013.00', // Power Plant Operators
  '47-2031.00', // Carpenters
  '49-9041.00', // Industrial Machinery Mechanics
  '17-2112.00', // Industrial Engineers
  '11-9041.00', // Architectural and Engineering Managers
]

/**
 * Calculate matching confidence based on search results
 */
function calculateConfidence(results, jobTitle, topMatch) {
  if (!topMatch) return 'low'

  const totalResults = results.occupation?.length || 0

  // High confidence: exact or very close match
  if (totalResults === 1) return 'high'

  // Check if title is very similar (case-insensitive exact match)
  const titleLower = jobTitle.toLowerCase()
  const matchLower = topMatch.title.toLowerCase()

  if (titleLower === matchLower) return 'high'

  // Check if job title is contained in O*NET title or vice versa
  if (titleLower.includes(matchLower) || matchLower.includes(titleLower)) {
    return 'high'
  }

  // Medium confidence: top result from small set
  if (totalResults <= 5) return 'medium'

  // Low confidence: many results
  return 'low'
}

// Prepare energy roles list for AI classification
const AVAILABLE_ROLES = Object.entries(ENERGY_ROLES).map(([id, role]) => ({
  id,
  label: role.label,
  category: role.category
}))

/**
 * Find best matching occupation using AI-enhanced approach
 *
 * STRATEGY:
 * 1. Use AI semantic classification first (PRIMARY)
 * 2. If AI has high/medium confidence, use it immediately
 * 3. If AI has low/none confidence, query O*NET API as fallback
 * 4. Cache results to avoid re-classification
 */
async function matchJobToOccupation(job, index, total, cache = {}) {
  const jobTitle = job.title
  const jobDescription = job.description || ''

  // Progress indicator
  if ((index + 1) % 10 === 0 || index === 0) {
    console.log(`Processing job ${index + 1}/${total}: "${jobTitle.substring(0, 50)}..."`)
  }

  // Check cache first
  if (cache[job.id]) {
    console.log(`  📦 CACHED: "${jobTitle}"`)
    return cache[job.id]
  }

  try {
    // STEP 1: AI-based semantic classification
    console.log(`  🤖 AI classifying: "${jobTitle}"`)
    const aiMatch = await classifyJobRole(jobTitle, jobDescription, AVAILABLE_ROLES)

    // If AI has high or medium confidence, use it immediately
    if (aiMatch.confidence === 'high' || aiMatch.confidence === 'medium') {
      console.log(`  ✅ AI MATCH (${aiMatch.confidence}): "${aiMatch.roleName}"`)
      console.log(`     Reasoning: ${aiMatch.reasoning}`)

      const result = {
        match_type: 'ai',
        role_id: aiMatch.roleId,
        role_name: aiMatch.roleName,
        confidence: aiMatch.confidence,
        reasoning: aiMatch.reasoning,
        onet_code: null,
        onet_title: null
      }

      cache[job.id] = result
      return result
    }

    // STEP 2: AI has low/none confidence - try O*NET API as fallback
    console.log(`  🔄 AI low confidence (${aiMatch.confidence}), trying O*NET...`)

    const results = await search(jobTitle)

    if (!results.occupation || results.occupation.length === 0) {
      // No O*NET match either
      if (aiMatch.confidence === 'low') {
        // Use AI's low confidence match rather than nothing
        console.log(`  ⚠️  No O*NET match, using AI low-confidence match: "${aiMatch.roleName}"`)
        const result = {
          match_type: 'ai_fallback',
          role_id: aiMatch.roleId,
          role_name: aiMatch.roleName,
          confidence: 'low',
          reasoning: aiMatch.reasoning,
          onet_code: null,
          onet_title: null
        }
        cache[job.id] = result
        return result
      }

      console.log(`  ❌ No match found for: "${jobTitle}"`)
      return null
    }

    // Get top O*NET result
    const topMatch = results.occupation[0]
    const isPriority = PRIORITY_OCCUPATIONS.includes(topMatch.code)
    let onetConfidence = calculateConfidence(results, jobTitle, topMatch)

    // Boost O*NET confidence if it's a priority energy occupation
    if (isPriority && onetConfidence === 'medium') {
      onetConfidence = 'high'
    }

    console.log(`  📊 O*NET match: "${topMatch.title}" (${onetConfidence})`)

    // STEP 3: Use O*NET result
    const result = {
      match_type: 'onet_fallback',
      onet_code: topMatch.code,
      onet_title: topMatch.title,
      confidence: onetConfidence,
      is_priority: isPriority,
      match_count: results.occupation.length,
      // Include AI match as alternative if it was low confidence
      ...(aiMatch.confidence === 'low' && aiMatch.roleId && {
        ai_alternative: {
          role_id: aiMatch.roleId,
          role_name: aiMatch.roleName,
          confidence: 'low',
          reasoning: aiMatch.reasoning
        }
      })
    }

    cache[job.id] = result
    return result

  } catch (error) {
    console.error(`  ❌ Error matching "${jobTitle}":`, error.message)
    return null
  }
}

/**
 * Add delay between API calls to respect rate limits
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting AI-Enhanced Job Role Matching\n')

  // Load jobs data
  const jobsPath = path.join(__dirname, '../public/data/jobs.json')
  const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf-8'))

  console.log(`📊 Found ${jobs.length} jobs to process`)
  console.log(`🤖 Using AI semantic classification with O*NET fallback\n`)

  // Load existing cache if available
  const outputPath = path.join(__dirname, '../public/data/job-occupations.json')
  let cache = {}
  if (fs.existsSync(outputPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outputPath, 'utf-8'))
      // Only cache AI matches to allow re-evaluation of O*NET fallbacks
      cache = Object.fromEntries(
        Object.entries(existing).filter(([_, match]) => match.match_type === 'ai')
      )
      console.log(`📦 Loaded ${Object.keys(cache).length} cached AI matches\n`)
    } catch (err) {
      console.log('⚠️  Could not load cache, starting fresh\n')
    }
  }

  // Process each job
  const mappings = {}
  let matchedCount = 0
  let unmatchedCount = 0
  let priorityCount = 0

  // Track match types for AI statistics
  const matchTypeStats = {
    ai: 0,              // AI high/medium confidence
    ai_fallback: 0,     // AI low confidence (no O*NET)
    onet_fallback: 0    // O*NET used (AI low/none)
  }

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]

    // Match job using AI-enhanced approach
    const match = await matchJobToOccupation(job, i, jobs.length, cache)

    if (match) {
      mappings[job.id] = match
      matchedCount++
      if (match.is_priority) {
        priorityCount++
      }
      // Track match type
      if (match.match_type) {
        matchTypeStats[match.match_type] = (matchTypeStats[match.match_type] || 0) + 1
      }
    } else {
      unmatchedCount++
    }

    // Rate limiting: wait 200ms between AI requests to avoid rate limits
    // Skip delay if using cached result
    if (!cache[job.id]) {
      await delay(200)
    }
  }

  // Calculate statistics
  const highConfidence = Object.values(mappings).filter(m => m.confidence === 'high').length
  const mediumConfidence = Object.values(mappings).filter(m => m.confidence === 'medium').length
  const lowConfidence = Object.values(mappings).filter(m => m.confidence === 'low').length

  // Count role classifications
  const roleStats = {}
  Object.values(mappings).forEach(match => {
    if (match.role_id) {
      roleStats[match.role_id] = (roleStats[match.role_id] || 0) + 1
    }
  })

  // Get top 10 roles
  const topRoles = Object.entries(roleStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  // Output results
  console.log('\n✅ Matching Complete!\n')
  console.log('📊 Statistics:')
  console.log(`   Total jobs: ${jobs.length}`)
  console.log(`   Matched: ${matchedCount} (${Math.round(matchedCount / jobs.length * 100)}%)`)
  console.log(`   Unmatched: ${unmatchedCount} (${Math.round(unmatchedCount / jobs.length * 100)}%)`)
  console.log(`   Priority O*NET occupations: ${priorityCount}`)
  console.log('\n   Confidence breakdown:')
  console.log(`   High: ${highConfidence} (${Math.round(highConfidence / matchedCount * 100)}%)`)
  console.log(`   Medium: ${mediumConfidence} (${Math.round(mediumConfidence / matchedCount * 100)}%)`)
  console.log(`   Low: ${lowConfidence} (${Math.round(lowConfidence / matchedCount * 100)}%)`)
  console.log('\n   Match type breakdown (AI-enhanced approach):')
  console.log(`   AI classification (high/medium): ${matchTypeStats.ai || 0} (${Math.round((matchTypeStats.ai || 0) / matchedCount * 100)}%)`)
  console.log(`   AI low confidence (no O*NET): ${matchTypeStats.ai_fallback || 0} (${Math.round((matchTypeStats.ai_fallback || 0) / matchedCount * 100)}%)`)
  console.log(`   O*NET fallback (AI low/none): ${matchTypeStats.onet_fallback || 0} (${Math.round((matchTypeStats.onet_fallback || 0) / matchedCount * 100)}%)`)

  console.log('\n   Top 10 role categories:')
  topRoles.forEach(([roleId, count], idx) => {
    const role = ENERGY_ROLES[roleId]
    console.log(`   ${idx + 1}. ${role?.label || roleId}: ${count} jobs`)
  })

  // Write output file
  fs.writeFileSync(outputPath, JSON.stringify(mappings, null, 2))

  console.log(`\n💾 Output written to: ${outputPath}`)
  console.log(`   File size: ${Math.round(fs.statSync(outputPath).size / 1024)}KB`)
  console.log('\n🎉 Done!')
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
