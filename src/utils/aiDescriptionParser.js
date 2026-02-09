/**
 * AI-Powered Job Description Parser
 *
 * Uses Claude API via secure backend proxy to intelligently restructure
 * messy job descriptions into clean, semantic, mobile-friendly sections.
 *
 * This service handles "blob" descriptions with poor or no formatting
 * by leveraging Claude's natural language understanding to:
 * - Identify and extract distinct sections
 * - Convert long paragraphs into scannable bullet points
 * - Separate responsibilities from requirements from benefits
 * - Remove redundant marketing fluff
 *
 * SECURITY: For browser usage, this module makes requests through a secure
 * backend proxy to avoid exposing the API key. For Node.js scripts, it
 * uses the Anthropic SDK directly.
 */

import Anthropic from '@anthropic-ai/sdk';

/**
 * Configuration
 */
const AI_PROXY_URL = import.meta.env.VITE_AI_PROXY_URL || 'http://localhost:3000';

/**
 * Initialize Anthropic client (Node.js only)
 */
let anthropicClient = null;

// Helper to detect if running in browser
function isBrowser() {
  return typeof window !== 'undefined' && typeof import.meta !== 'undefined';
}

// Helper to get API key (Node.js only)
function getApiKey() {
  // Node.js environment only
  if (typeof process !== 'undefined' && process.env) {
    return process.env.ANTHROPIC_API_KEY;
  }
  return null;
}

function getAnthropicClient() {
  // Browser environment - should use proxy instead
  if (isBrowser()) {
    throw new Error(
      'Direct Anthropic API calls not allowed in browser. Use proxy endpoints instead.'
    );
  }

  if (!anthropicClient) {
    const apiKey = getApiKey();
    if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
      throw new Error(
        'Anthropic API key not configured. Please set ANTHROPIC_API_KEY in .env file.'
      );
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

/**
 * Structured job description format
 * @typedef {Object} StructuredSection
 * @property {string} title - Section title (e.g., "Role Overview", "Key Responsibilities")
 * @property {string} type - Section type: "paragraph" | "list"
 * @property {string|string[]} content - Content (string for paragraph, array for list)
 */

/**
 * @typedef {Object} StructuredDescription
 * @property {StructuredSection[]} sections - Array of structured sections
 * @property {string} [error] - Error message if parsing failed
 */

/**
 * System prompt for Claude to restructure job descriptions
 */
const RESTRUCTURE_PROMPT = `You are an expert job description formatter specializing in skilled trades and energy sector roles.

Your task is to analyze messy, poorly formatted job descriptions and restructure them into clean, scannable, mobile-friendly sections.

**CRITICAL RULE - DO NOT INVENT CONTENT:**
- You must ONLY use content that exists in the original job description
- DO NOT add, infer, or invent ANY requirements, responsibilities, benefits, or qualifications
- DO NOT add industry-standard requirements that aren't explicitly stated
- DO NOT embellish or expand on what's written
- When in doubt, use the EXACT wording from the original
- This is a legal requirement - invented content could expose the employer to liability

**Guidelines:**

1. **Identify distinct sections** such as:
   - Role Overview / About the Role
   - Key Responsibilities / What You'll Do
   - Requirements / Qualifications (separate Required from Preferred if both exist)
   - Benefits / What We Offer
   - About the Company (optional, only if substantial content exists)

2. **Content transformation (restructure ONLY, do not add):**
   - Convert long paragraphs into scannable bullet points where appropriate
   - Keep bullet points concise (1-2 lines each)
   - Remove redundant phrases like "Do you enjoy...", "Would you like to...", "Join our team"
   - Remove boilerplate marketing fluff unless it provides concrete value
   - Preserve technical terms, certifications, and specific requirements EXACTLY as written

3. **Section types:**
   - Use "paragraph" for brief overviews (1-3 sentences)
   - Use "list" for responsibilities, requirements, benefits, and detailed content
   - Each list item should be a complete thought

4. **Mobile-first formatting:**
   - Keep titles clear and scannable
   - Break up dense text into digestible chunks
   - Prioritize the most important information first

**Output format:**
Return ONLY a valid JSON object (no markdown, no code blocks) with this structure:
{
  "sections": [
    {
      "title": "Section Title",
      "type": "paragraph",
      "content": "Brief description text"
    },
    {
      "title": "Section Title",
      "type": "list",
      "content": ["First item", "Second item", "Third item"]
    }
  ]
}

**Important:**
- Return ONLY the JSON object, no other text
- Ensure all JSON is valid and properly escaped
- Do not include markdown code blocks or formatting
- Do not add explanatory text before or after the JSON`;

/**
 * Restructure a raw job description using Claude API
 *
 * @param {string} rawDescription - The raw, unformatted job description text
 * @param {Object} options - Configuration options
 * @param {string} [options.model='claude-sonnet-4-5-20250929'] - Claude model to use
 * @param {number} [options.maxTokens=2048] - Maximum tokens for response
 * @param {number} [options.timeout=30000] - Request timeout in milliseconds
 * @returns {Promise<StructuredDescription>} - Structured job description with sections
 *
 * @example
 * const structured = await restructureJobDescription(messyDescription);
 * if (!structured.error) {
 *   structured.sections.forEach(section => {
 *     console.log(section.title);
 *     if (section.type === 'list') {
 *       section.content.forEach(item => console.log('- ' + item));
 *     } else {
 *       console.log(section.content);
 *     }
 *   });
 * }
 */
export async function restructureJobDescription(rawDescription, options = {}) {
  // Validate input
  if (!rawDescription || typeof rawDescription !== 'string') {
    return {
      sections: [],
      error: 'Invalid input: rawDescription must be a non-empty string',
    };
  }

  // Trim and check if there's actual content
  const trimmed = rawDescription.trim();
  if (trimmed.length === 0) {
    return {
      sections: [],
      error: 'Input description is empty',
    };
  }

  // If description is too short, just return it as-is
  if (trimmed.length < 100) {
    return {
      sections: [
        {
          title: 'Description',
          type: 'paragraph',
          content: trimmed,
        },
      ],
    };
  }

  // Configure options with defaults
  // Adjust maxTokens based on input length for very long descriptions
  const estimatedOutputTokens = Math.min(4096, Math.max(2048, Math.ceil(trimmed.length / 2)));

  const {
    model = 'claude-sonnet-4-5-20250929',
    maxTokens = estimatedOutputTokens,
    timeout = 30000,
  } = options;

  try {
    let textContent;

    // Browser: Use proxy endpoint
    if (isBrowser()) {
      const response = await fetch(`${AI_PROXY_URL}/api/enhance-description`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: trimmed,
          systemPrompt: RESTRUCTURE_PROMPT,
          model,
          maxTokens,
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      textContent = data.content;

      if (!textContent) {
        throw new Error('No content in proxy response');
      }
    }
    // Node.js: Use Anthropic SDK directly
    else {
      const client = getAnthropicClient();

      const response = await Promise.race([
        client.messages.create({
          model,
          max_tokens: maxTokens,
          messages: [
            {
              role: 'user',
              content: `${RESTRUCTURE_PROMPT}\n\n**Job Description to Format:**\n\n${trimmed}`,
            },
          ],
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), timeout)
        ),
      ]);

      textContent = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (!textContent) {
        throw new Error('No text content in API response');
      }
    }

    // Parse JSON response
    let parsed;
    try {
      // Clean up any potential markdown code blocks and extract JSON
      let cleanedContent = textContent.trim();

      // Remove markdown code blocks if present
      if (cleanedContent.startsWith('```')) {
        cleanedContent = cleanedContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      // Handle cases where AI adds explanatory text before/after JSON
      // Look for JSON object boundaries { ... }
      const jsonStart = cleanedContent.indexOf('{');
      const jsonEnd = cleanedContent.lastIndexOf('}');

      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleanedContent = cleanedContent.substring(jsonStart, jsonEnd + 1);
      }

      parsed = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', textContent.substring(0, 500));
      throw new Error(`Invalid JSON response from AI: ${parseError.message}`);
    }

    // Validate response structure
    if (!parsed.sections || !Array.isArray(parsed.sections)) {
      throw new Error('Invalid response structure: missing sections array');
    }

    // Validate each section
    for (const section of parsed.sections) {
      if (!section.title || !section.type || !section.content) {
        throw new Error(
          'Invalid section structure: must have title, type, and content'
        );
      }

      if (section.type !== 'paragraph' && section.type !== 'list') {
        throw new Error(
          `Invalid section type "${section.type}": must be "paragraph" or "list"`
        );
      }

      if (section.type === 'paragraph' && typeof section.content !== 'string') {
        throw new Error('Paragraph sections must have string content');
      }

      if (section.type === 'list' && !Array.isArray(section.content)) {
        throw new Error('List sections must have array content');
      }
    }

    // Return structured description
    return parsed;
  } catch (error) {
    console.error('Error restructuring job description:', error);

    // Return error with fallback structure
    return {
      sections: [
        {
          title: 'Description',
          type: 'paragraph',
          content: trimmed,
        },
      ],
      error: error.message || 'Unknown error occurred during AI processing',
    };
  }
}

/**
 * Check if AI description parsing is available
 *
 * @returns {boolean} - True if AI parsing is available
 */
export function isAiParsingAvailable() {
  // In browser, AI is always available via proxy
  if (isBrowser()) {
    return true;
  }

  // In Node.js, check for API key
  const apiKey = getApiKey();
  return Boolean(apiKey && apiKey !== 'your_anthropic_api_key_here');
}

/**
 * Convert structured description back to plain text
 * Useful for fallback scenarios or exports
 *
 * @param {StructuredDescription} structured - Structured description object
 * @returns {string} - Plain text representation
 */
export function structuredToPlainText(structured) {
  if (!structured || !structured.sections || structured.sections.length === 0) {
    return '';
  }

  return structured.sections
    .map((section) => {
      let text = `${section.title}\n\n`;

      if (section.type === 'paragraph') {
        text += section.content + '\n';
      } else if (section.type === 'list') {
        text += section.content.map((item) => `• ${item}`).join('\n') + '\n';
      }

      return text;
    })
    .join('\n');
}

/**
 * Role classification result
 * @typedef {Object} RoleClassification
 * @property {string} roleId - Role identifier from energyRoles.js (e.g., "rov-pilot-technician")
 * @property {string} roleName - Human-readable role name (e.g., "ROV Pilot/Technician")
 * @property {string} confidence - Classification confidence: "high" | "medium" | "low" | "none"
 * @property {string} reasoning - Brief explanation for the classification
 * @property {string} [error] - Error message if classification failed
 */

/**
 * System prompt for Claude to classify jobs into energy sector roles
 */
const ROLE_CLASSIFICATION_PROMPT = `You are an expert in energy sector job classification, specializing in oil & gas, renewable energy, and skilled trades roles.

Your task is to analyze a job title and description, then classify it into the most appropriate role category from the provided list.

**CRITICAL RULES:**

1. **Semantic Understanding**: Look beyond exact keyword matches. Understand role variations:
   - "ROV Tech III" → "ROV Pilot/Technician" (levels and variations)
   - "Subsea Controls Engineer" → "Subsea Engineer" (specializations)
   - "Senior Wireline Specialist" → "Wireline Operator/Engineer" (seniority)

2. **Confidence Levels**:
   - **high**: Job clearly fits role (80%+ certainty), title/description directly indicates role
   - **medium**: Job likely fits role (50-80% certainty), some ambiguity but reasonable match
   - **low**: Weak match (20-50% certainty), very general or tangential connection
   - **none**: No reasonable match found (<20% certainty)

3. **Reasoning**: Provide 1-2 sentence explanation focusing on:
   - Key indicators from title/description that led to classification
   - Any ambiguity or uncertainty factors
   - Keep it concise and technical

4. **Precision over Recall**:
   - Better to return "none" than force a poor match
   - If job doesn't clearly fit energy sector roles, return "none"
   - Don't match generic roles (accountant, HR) to specialized roles

**Output format:**
Return ONLY a valid JSON object (no markdown, no code blocks) with this structure:
{
  "roleId": "role-id-from-list",
  "roleName": "Role Display Name",
  "confidence": "high|medium|low|none",
  "reasoning": "Brief explanation of classification"
}

**Important:**
- Return ONLY the JSON object, no other text
- Ensure all JSON is valid and properly escaped
- Do not include markdown code blocks or formatting
- If confidence is "none", set roleId to null and roleName to "No suitable match"`;

/**
 * Classify a job into an energy sector role using AI
 *
 * Uses Claude API to intelligently match jobs to energy sector roles based on
 * semantic understanding of job titles and descriptions. More accurate than
 * simple keyword matching for handling variations, seniority levels, and
 * specializations.
 *
 * @param {string} jobTitle - The job title to classify
 * @param {string} jobDescription - The job description text (optional but improves accuracy)
 * @param {Object[]} availableRoles - Array of role objects from energyRoles.js
 * @param {string} availableRoles[].id - Role identifier (e.g., "rov-pilot-technician")
 * @param {string} availableRoles[].label - Human-readable role name
 * @param {string} availableRoles[].category - Role category
 * @param {Object} options - Configuration options
 * @param {string} [options.model='claude-sonnet-4-5-20250929'] - Claude model to use
 * @param {number} [options.maxTokens=1024] - Maximum tokens for response
 * @param {number} [options.timeout=30000] - Request timeout in milliseconds
 * @returns {Promise<RoleClassification>} - Role classification result
 *
 * @example
 * const roles = Object.entries(ENERGY_ROLES).map(([id, role]) => ({
 *   id,
 *   label: role.label,
 *   category: role.category
 * }));
 *
 * const result = await classifyJobRole(
 *   "ROV Tech III",
 *   "Operate and maintain ROV systems...",
 *   roles
 * );
 *
 * if (result.confidence === 'high') {
 *   console.log(`Matched to ${result.roleName}: ${result.reasoning}`);
 * }
 */
export async function classifyJobRole(jobTitle, jobDescription = '', availableRoles = [], options = {}) {
  // Validate input
  if (!jobTitle || typeof jobTitle !== 'string') {
    return {
      roleId: null,
      roleName: 'No suitable match',
      confidence: 'none',
      reasoning: 'Invalid job title provided',
      error: 'Invalid input: jobTitle must be a non-empty string'
    };
  }

  if (!availableRoles || availableRoles.length === 0) {
    return {
      roleId: null,
      roleName: 'No suitable match',
      confidence: 'none',
      reasoning: 'No role definitions provided',
      error: 'Invalid input: availableRoles must be a non-empty array'
    };
  }

  // Trim inputs
  const trimmedTitle = jobTitle.trim();
  const trimmedDescription = (jobDescription || '').trim();

  // Configure options with defaults
  const {
    model = 'claude-sonnet-4-5-20250929',
    maxTokens = 1024,
    timeout = 30000
  } = options;

  try {
    let textContent;

    // Browser: Use proxy endpoint
    if (isBrowser()) {
      const response = await fetch(`${AI_PROXY_URL}/api/classify-role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobTitle: trimmedTitle,
          jobDescription: trimmedDescription,
          availableRoles,
          systemPrompt: ROLE_CLASSIFICATION_PROMPT,
          model,
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      textContent = data.content;

      if (!textContent) {
        throw new Error('No content in proxy response');
      }
    }
    // Node.js: Use Anthropic SDK directly
    else {
      const client = getAnthropicClient();

      // Format role list for prompt
      const rolesList = availableRoles
        .map((role) => `- ${role.id}: ${role.label} (${role.category})`)
        .join('\n');

      // Build user message
      const userMessage = `**Available Roles:**
${rolesList}

**Job to Classify:**

Title: ${trimmedTitle}

${trimmedDescription ? `Description: ${trimmedDescription.substring(0, 1000)}` : 'Description: (not provided)'}

Please classify this job into the most appropriate role from the list above.`;

      const response = await Promise.race([
        client.messages.create({
          model,
          max_tokens: maxTokens,
          messages: [
            {
              role: 'user',
              content: `${ROLE_CLASSIFICATION_PROMPT}\n\n${userMessage}`,
            },
          ],
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), timeout)
        ),
      ]);

      textContent = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (!textContent) {
        throw new Error('No text content in API response');
      }
    }

    // Parse JSON response
    let parsed;
    try {
      // Clean up any potential markdown code blocks and extract JSON
      let cleanedContent = textContent.trim();

      // Remove markdown code blocks if present
      if (cleanedContent.startsWith('```')) {
        cleanedContent = cleanedContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      // Handle cases where AI adds explanatory text before/after JSON
      // Look for JSON object boundaries { ... }
      const jsonStart = cleanedContent.indexOf('{');
      const jsonEnd = cleanedContent.lastIndexOf('}');

      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleanedContent = cleanedContent.substring(jsonStart, jsonEnd + 1);
      }

      parsed = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', textContent.substring(0, 500));
      throw new Error(`Invalid JSON response from AI: ${parseError.message}`);
    }

    // Validate response structure
    if (!parsed.confidence || !parsed.reasoning) {
      throw new Error('Invalid response structure: missing required fields');
    }

    // Validate confidence value
    const validConfidences = ['high', 'medium', 'low', 'none'];
    if (!validConfidences.includes(parsed.confidence)) {
      throw new Error(`Invalid confidence value: ${parsed.confidence}`);
    }

    // Normalize "none" response
    if (parsed.confidence === 'none' || !parsed.roleId) {
      return {
        roleId: null,
        roleName: 'No suitable match',
        confidence: 'none',
        reasoning: parsed.reasoning || 'No suitable role match found'
      };
    }

    // Validate roleId exists in available roles
    const matchedRole = availableRoles.find(r => r.id === parsed.roleId);
    if (!matchedRole) {
      console.warn(`AI returned unknown roleId: ${parsed.roleId}`);
      return {
        roleId: null,
        roleName: 'No suitable match',
        confidence: 'none',
        reasoning: `AI suggested unknown role: ${parsed.roleId}`,
        error: 'Unknown role ID returned by AI'
      };
    }

    // Return validated classification
    return {
      roleId: parsed.roleId,
      roleName: parsed.roleName || matchedRole.label,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning
    };

  } catch (error) {
    console.error('Error classifying job role:', error);

    // Return error with no match
    return {
      roleId: null,
      roleName: 'No suitable match',
      confidence: 'none',
      reasoning: 'Classification failed due to error',
      error: error.message || 'Unknown error occurred during AI classification'
    };
  }
}
