/**
 * AI Job Description Parser - Example Implementation
 *
 * This is an EXAMPLE implementation showing the expected interface.
 * The actual implementation should be created at: src/utils/aiDescriptionParser.js
 *
 * Required:
 * - Export a function named: restructureJobDescription(text)
 * - Function should be async (returns Promise)
 * - Function should return an object with structured job description data
 *
 * Example usage:
 *   import { restructureJobDescription } from './aiDescriptionParser.js'
 *   const structured = await restructureJobDescription(rawDescription)
 */

/**
 * Parse and restructure a job description using AI
 *
 * @param {string} rawDescription - The raw job description text
 * @returns {Promise<Object>} Structured description object
 *
 * Expected output structure:
 * {
 *   summary: string,           // Brief 1-2 sentence summary
 *   responsibilities: string[], // List of key responsibilities
 *   requirements: string[],     // List of requirements/qualifications
 *   benefits: string[],         // List of benefits (if mentioned)
 *   workType: string,          // e.g., "Full-time", "Contract", etc.
 *   experienceLevel: string,   // e.g., "Entry Level", "Mid Level", "Senior"
 *   sections: Object           // Optional: other extracted sections
 * }
 */
export async function restructureJobDescription(rawDescription) {
  // EXAMPLE IMPLEMENTATION - Replace with actual AI parsing logic

  if (!rawDescription || typeof rawDescription !== 'string') {
    throw new Error('Invalid description: must be a non-empty string')
  }

  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 100))

  // Example: Simple parsing logic (replace with AI)
  const lines = rawDescription.split('\n').filter(line => line.trim())

  return {
    summary: lines[0]?.substring(0, 200) || 'No summary available',
    responsibilities: extractBulletPoints(rawDescription, /responsibilities|duties/i),
    requirements: extractBulletPoints(rawDescription, /requirements|qualifications/i),
    benefits: extractBulletPoints(rawDescription, /benefits|perks/i),
    workType: extractWorkType(rawDescription),
    experienceLevel: extractExperienceLevel(rawDescription),
    sections: {
      raw: rawDescription,
      processedAt: new Date().toISOString()
    }
  }
}

// Helper functions (examples)

function extractBulletPoints(text, sectionRegex) {
  // Simple bullet point extraction
  const bullets = []
  const lines = text.split('\n')
  let inSection = false

  for (const line of lines) {
    if (sectionRegex.test(line)) {
      inSection = true
      continue
    }

    if (inSection && line.match(/^[\s]*[-•*]/)) {
      bullets.push(line.replace(/^[\s]*[-•*]\s*/, '').trim())
    }

    // Stop at next section
    if (inSection && line.match(/^[A-Z][a-z]+:/)) {
      break
    }
  }

  return bullets
}

function extractWorkType(text) {
  if (/full[-\s]?time/i.test(text)) return 'Full-time'
  if (/part[-\s]?time/i.test(text)) return 'Part-time'
  if (/contract/i.test(text)) return 'Contract'
  if (/temporary/i.test(text)) return 'Temporary'
  return 'Not specified'
}

function extractExperienceLevel(text) {
  if (/senior|lead|principal/i.test(text)) return 'Senior'
  if (/junior|entry[-\s]?level|graduate/i.test(text)) return 'Entry Level'
  if (/mid[-\s]?level|intermediate/i.test(text)) return 'Mid Level'
  return 'Not specified'
}

/**
 * API Configuration Notes:
 *
 * If using Anthropic Claude API:
 * - Add ANTHROPIC_API_KEY to .env
 * - Install: npm install @anthropic-ai/sdk
 * - Rate limit: ~50 requests/min on free tier
 *
 * If using OpenAI API:
 * - Add OPENAI_API_KEY to .env
 * - Install: npm install openai
 * - Rate limit: Varies by tier
 *
 * If using local model:
 * - Consider ollama for local LLM hosting
 * - No rate limits, but requires setup
 */
