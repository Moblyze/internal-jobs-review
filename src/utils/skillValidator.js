/**
 * Validate if a "skill" is actually a skill or just generic text
 * Multi-stage processing: normalize, then validate, optionally standardize with O*NET
 */

import * as onetClient from './onetClient.js';
import { matchSkillToReference } from '../data/onetSkillsReference.js';

const GENERIC_STARTING_WORDS = [
  'with', 'be', 'show', 'demonstrate', 'work', 'working', 'have', 'must',
  'should', 'can', 'will', 'able', 'ability', 'experience', 'comprehensive',
  'contemporary', 'candidates', 'additional', 'applies', 'active', 'requires',
  'required', 'preferred', 'minimum', 'ba', 'bs', 'ma', 'ms', 'phd',
  // Recruitment/marketing verbs
  'join', 'partner', 'become', 'explore', 'discover', 'learn', 'grow',
  'take', 'make', 'build', 'create', 'develop', 'pursue', 'achieve'
];

const COMMON_FILLER_WORDS = [
  'a', 'the', 'in', 'for', 'you', 'us', 'and', 'or', 'to', 'that', 'when',
  'your', 'our', 'we', 'are', 'is', 'of', 'on', 'at', 'from', 'as'
];

// Comprehensive list of adjectives and intensifiers to remove
const ADJECTIVES_TO_REMOVE = [
  // Quality adjectives (but NOT "critical" as it's part of "critical thinking")
  'excellent', 'good', 'strong', 'great', 'best', 'top', 'high', 'outstanding',
  'exceptional', 'superior', 'advanced', 'intermediate', 'basic', 'essential',
  'important', 'key', 'necessary', 'vital', 'crucial',

  // Size/quantity adjectives
  'significant', 'substantial', 'extensive', 'comprehensive', 'broad', 'wide',
  'deep', 'thorough', 'detailed', 'complete', 'full', 'total', 'entire',
  'multiple', 'various', 'several', 'many', 'numerous', 'diverse',

  // Experience/skill level adjectives
  'proven', 'demonstrated', 'solid', 'sound', 'professional', 'proficient',
  'competent', 'skilled', 'experienced', 'qualified', 'capable', 'effective',
  'successful', 'accomplished', 'expert', 'seasoned', 'veteran', 'senior',
  'junior', 'entry-level', 'mid-level',

  // Time adjectives
  'relevant', 'recent', 'current', 'contemporary', 'modern', 'up-to-date',
  'latest', 'new', 'emerging', 'developing', 'growing', 'evolving',

  // Degree adjectives
  'highly', 'very', 'extremely', 'particularly', 'especially', 'remarkably',
  'notably', 'significantly', 'considerably', 'substantially', 'thoroughly',

  // Other common adjectives (keep those that have noun mappings out of this list)
  'practical', 'hands-on', 'applied', 'real-world', 'direct', 'active',
  'proactive', 'dynamic', 'functional', 'quantitative', 'qualitative',
  'theoretical', 'conceptual', 'tailored', 'customized', 'specialized',

  // Personality/soft skill adjectives that are too vague
  'positive', 'enthusiastic', 'motivated', 'dedicated', 'committed', 'passionate',
  'energetic', 'driven', 'ambitious', 'flexible', 'adaptable', 'reliable',
  'dependable', 'responsible', 'conscientious', 'diligent', 'meticulous',

  // Adjectives that modify nouns but aren't needed
  'related', 'applicable', 'appropriate', 'suitable', 'relevant', 'pertinent',
  'specific', 'particular', 'certain', 'given', 'respective', 'corresponding',

  // Corporate/business adjectives
  'corporate', 'business', 'commercial', 'industrial', 'enterprise', 'global',
  'international', 'domestic', 'local', 'regional', 'national',

  // Extra descriptors
  'preferred', 'desired', 'required', 'ideal', 'perfect', 'optimal', 'prime'
];

// Word normalization map (convert adjective forms to noun forms)
const WORD_NORMALIZATIONS = {
  'operational': 'operations',
  'financial': 'finance',
  'analytical': 'analysis',
  'organizational': 'organization',
  'technical': 'technical',  // Keep as-is, very common in job descriptions
  'managerial': 'management',
  'strategic': 'strategy',
  'tactical': 'tactics',
  'administrative': 'administration',
  'supervisory': 'supervision',
  'regulatory': 'regulation',
  'developmental': 'development',
  'educational': 'education',
  'professional': 'professional',  // Keep as-is, commonly used
  'interpersonal': 'interpersonal',  // Keep as-is, standard term
  'computational': 'computing',
  'mechanical': 'mechanical',  // Keep as-is for "mechanical engineering"
  'electrical': 'electrical',  // Keep as-is, standard in trades
  'chemical': 'chemical',  // Keep as-is for "chemical engineering"
  'mathematical': 'mathematics',
  'statistical': 'statistics',
  'logical': 'logic',
  'creative': 'creativity',
  'innovative': 'innovation'
};

// Marketing/recruitment phrases to reject outright
const RECRUITMENT_PHRASES = [
  'join our', 'partner with', 'become part', 'be part of', 'work with us',
  'join us', 'we are', 'we offer', 'our team', 'our company', 'our culture',
  'our mission', 'our vision', 'our values', 'innovating field', 'the best',
  'world-class', 'industry-leading', 'market-leading', 'award-winning',
  'cutting-edge', 'state-of-the-art', 'premier', 'leading provider'
];

// Generic terms that aren't skills by themselves
const TOO_GENERIC = [
  'experience', 'skills', 'knowledge', 'ability', 'abilities', 'qualification',
  'qualifications', 'requirement', 'requirements', 'background', 'expertise',
  'capability', 'capabilities', 'competency', 'competencies', 'proficiency',
  'characteristic', 'characteristics', 'attribute', 'attributes', 'trait', 'traits',
  'thinking skills', 'just experience', 'work experience'
];

// Blacklist of non-skill terms (section headers, generic terms, etc.)
const BLACKLISTED_TERMS = [
  // Section headers
  'basic compensation', 'basic qualifications', 'key responsibilities',
  'job requirements', 'position requirements', 'essential functions',
  'job duties', 'position summary', 'job summary', 'responsibilities',
  'requirements', 'qualifications', 'compensation', 'benefits',
  'job description', 'position description', 'duties',
  'special requirements', 'special qualifications', 'additional requirements',
  "what you'll do", "what you will do", 'what you do',
  'how to apply', 'application process', 'equal opportunity',

  // Generic career terms
  'business career', 'career', 'career path', 'career development',
  'career opportunities', 'professional development', 'growth opportunities',

  // Single generic words that aren't skills
  'key', 'basic', 'essential', 'important', 'critical', 'necessary',
  'various', 'other', 'general', 'additional', 'miscellaneous',
  'etc', 'tbd', 'tba', 'n/a', 'na', 'none', 'all', 'any',
  'special', 'specific', 'particular', 'certain', 'typical',
  'transportation', 'location', 'hours', 'schedule', 'shift',

  // Job posting artifacts
  'job', 'position', 'role', 'opportunity', 'opening', 'vacancy',
  'full-time', 'part-time', 'contract', 'temporary', 'permanent',
  'remote', 'on-site', 'hybrid', 'flexible', 'immediate',

  // Generic descriptors
  'excellent', 'good', 'strong', 'great', 'best', 'top', 'high',
  'outstanding', 'exceptional', 'superior', 'advanced', 'intermediate',
  'entry-level', 'senior', 'junior', 'mid-level'
];

/**
 * Normalize a skill by removing adjectives, splitting compounds, and standardizing word forms
 * Returns normalized skill string or null if it becomes too generic/invalid
 */
export function normalizeSkill(skill) {
  if (!skill || typeof skill !== 'string') return null;

  let normalized = skill.trim();

  // Quick rejection: must start with a letter (catches #hashtags, &fragments, (parens, -dashes, .bullets, /slashes, digits, ●⦁ bullets, etc.)
  if (!/^[a-zA-Z]/.test(normalized)) return null;

  // Quick rejection: contains commas (unsplit compound lists - should have been split upstream)
  if (normalized.includes(',')) return null;

  // Quick rejection: years of experience patterns
  if (/\b\d+\+?\s*(years?|yrs?|months?)\b/i.test(normalized)) return null;

  // Quick rejection: contains parentheses (fragments, acronym expansions, not standalone skills)
  if (/[()]/.test(normalized)) return null;

  // Quick rejection: marketing/recruitment phrases
  const lower = normalized.toLowerCase();
  for (const phrase of RECRUITMENT_PHRASES) {
    if (lower.includes(phrase)) {
      return null;
    }
  }

  // Quick rejection: contains company-focused words
  if (/\b(our|we|us)\b/i.test(normalized)) {
    return null;
  }

  // Remove adjectives (word boundary aware to avoid partial matches)
  for (const adj of ADJECTIVES_TO_REMOVE) {
    const pattern = new RegExp(`\\b${adj}\\b`, 'gi');
    normalized = normalized.replace(pattern, ' ');
  }

  // Clean up extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Apply word normalizations (adjective → noun)
  const words = normalized.split(/\s+/);
  const normalizedWords = words.map(word => {
    const lowerWord = word.toLowerCase();
    // First check exact match
    if (WORD_NORMALIZATIONS[lowerWord]) {
      return WORD_NORMALIZATIONS[lowerWord];
    }
    // Keep the original word
    return word;
  }).filter(word => word.length > 0); // Remove empty strings

  normalized = normalizedWords.join(' ').trim();

  // Remove common suffixes: "skills", "skill", "ability", "abilities"
  normalized = normalized.replace(/\s+(skills?|abilities|ability)$/i, '').trim();

  // Remove "understanding" prefix (too generic)
  normalized = normalized.replace(/^understanding\s+/i, '').trim();

  // If it's just "understanding" by itself, reject it
  if (normalized.toLowerCase() === 'understanding') {
    return null;
  }

  // Normalize common incomplete skills to full forms
  const skillExpansions = {
    'written': 'written communication',
    'verbal': 'verbal communication',
    'oral': 'oral communication',
    'interpersonal': 'interpersonal communication'
  };

  const lowerForExpansion = normalized.toLowerCase();
  if (skillExpansions[lowerForExpansion]) {
    normalized = skillExpansions[lowerForExpansion];
  }

  // Reject comma-separated verb lists (e.g., "Guides, Develops")
  if (/^[A-Z][a-z]+,\s*[A-Z][a-z]+/.test(normalized)) {
    return null;
  }

  // Reject phrases starting with action verbs (likely task descriptions, not skills)
  const actionVerbStarters = [
    'delegate', 'organize', 'establish', 'maintain', 'develop', 'implement',
    'create', 'manage', 'coordinate', 'supervise', 'direct', 'oversee',
    'monitor', 'evaluate', 'assess', 'review', 'update', 'prepare',
    'conduct', 'perform', 'execute', 'complete', 'ensure', 'provide',
    'support', 'assist', 'help', 'facilitate', 'lead', 'guide',
    'train', 'teach', 'instruct', 'mentor', 'coach', 'advise'
  ];

  const firstWord = normalized.toLowerCase().split(/\s+/)[0];
  if (actionVerbStarters.includes(firstWord)) {
    return null;
  }

  // Reject phrases with "that has been" or "that have been" constructions
  if (/that (has|have|had) been/i.test(normalized)) {
    return null;
  }

  // Reject phrases starting with "the ability to" or "ability to"
  if (/^(the )?ability to/i.test(normalized)) {
    return null;
  }

  // Reject phrases with "with the" or "for the" (likely sentence fragments)
  if (/^(with|for) the\b/i.test(normalized)) {
    return null;
  }

  // Remove common filler words at start/end
  normalized = normalized.replace(/^(and|or|with|the|a|an|of)\s+/gi, '');
  normalized = normalized.replace(/\s+(and|or|with|the|a|an|of)$/gi, '');
  normalized = normalized.trim();

  // If nothing left after cleanup, reject
  if (!normalized || normalized.length < 2) {
    return null;
  }

  // Normalize plural forms to singular for better deduplication
  // "Communications" → "Communication", "Operations" → "Operation" (but keep "Operations" as a field name)
  // Only do this for specific common skill terms
  const singularize = (text) => {
    const lower = text.toLowerCase();
    // Don't singularize these - they're proper nouns or field names
    if (['operations', 'systems', 'analytics', 'logistics', 'mathematics', 'statistics', 'economics'].includes(lower)) {
      return text;
    }
    // Singularize common skill terms
    if (text.endsWith('ications')) {
      return text.replace(/ications$/, 'ication');
    }
    if (text.endsWith('ions') && !text.endsWith('sions')) {
      return text.replace(/ions$/, 'ion');
    }
    return text;
  };

  normalized = normalized.split(' ').map(singularize).join(' ');

  // Check if too generic after normalization
  if (TOO_GENERIC.includes(normalized.toLowerCase())) {
    return null;
  }

  // Check minimum meaningful content
  const meaningfulWords = normalized.split(/\s+/).filter(word => {
    return word.length >= 3 && !COMMON_FILLER_WORDS.includes(word.toLowerCase());
  });

  // Need at least 1 meaningful word with 3+ chars
  if (meaningfulWords.length < 1) {
    return null;
  }

  // If only 1 meaningful word remains and it's too short or too generic, reject
  if (meaningfulWords.length === 1) {
    const word = meaningfulWords[0].toLowerCase();
    // Single words that are too generic/vague
    const vagueSingleWords = ['thinking', 'just', 'programs', 'values', 'benefits',
                               'work', 'tasks', 'duties', 'activities', 'functions',
                               'customers', 'drive', 'equivalent', 'competitive'];
    if (word.length < 4 || vagueSingleWords.includes(word)) {
      return null;
    }
  }

  // Reject if contains "diploma", "degree", "certification", "license" (education requirements)
  if (/\b(diploma|degree|certification|license|certified|licensed)\b/i.test(normalized)) {
    return null;
  }

  // Reject if ends with roman numerals or "Iv" (likely job titles like "Field Specialist IV")
  if (/\s+(I{1,3}V?|VI{1,3}|I{1,3}|Iv|Iii|Ii)$/i.test(normalized)) {
    return null;
  }

  // Reject if contains "system" or "software" followed by brand name (e.g., "NCR System")
  if (/\b(system|software|tool|platform)\b/i.test(normalized)) {
    const words = normalized.split(/\s+/);
    // If "system"/"software" is paired with a single capitalized word, likely a brand
    if (words.length === 2 && /^[A-Z][a-z]*$/.test(words[0])) {
      return null;
    }
  }

  // Reject phrases that look like job requirements artifacts
  const requirementArtifacts = [
    'work-life balance', 'wellbeing', 'policies', 'approach',
    'stakeholders', 'colleagues', 'teammates', 'coworkers',
    'work location', 'upon study', 'administrators'
  ];
  const lowerNorm = normalized.toLowerCase();
  for (const artifact of requirementArtifacts) {
    if (lowerNorm.includes(artifact)) {
      return null;
    }
  }

  // Reject entries starting with single letter + dash (job codes like "c-", "p-")
  if (/^[a-z]-/i.test(normalized)) {
    return null;
  }

  // Reject entries ending with comma (incomplete phrases)
  if (normalized.endsWith(',')) {
    return null;
  }

  // Reject entries ending with parenthesis without opening (fragments)
  if (/\)$/.test(normalized) && !normalized.includes('(')) {
    return null;
  }

  // Reject vague single words that aren't skills
  if (meaningfulWords.length === 1) {
    const vagueSingleWords = [
      'college', 'university', 'attitude', 'rules', 'human', 'italian',
      'spanish', 'french', 'german', 'chinese', 'japanese', 'portuguese',
      'arabic', 'russian', 'hindi', 'marketing', 'design', 'organization',
      'isolation', 'activation', 'deactivation', 'parts', 'lists', 'system',
      'systems', 'operator', 'networking', 'projects', 'front-end', 'peers'
    ];
    if (vagueSingleWords.includes(lowerNorm)) {
      return null;
    }
  }

  // Reject phrases starting with infinitive "to" (likely tasks, not skills)
  if (/^to\s+/i.test(normalized)) {
    return null;
  }

  // Reject phrases with verb + "with" pattern (tasks not skills)
  if (/\b(interact|work|communicate|collaborate|interface|react)\s+(with|across)\b/i.test(normalized)) {
    return null;
  }

  // Reject phrases starting with "continuously", "constantly", "regularly" (ongoing tasks)
  if (/^(continuously|constantly|regularly|routinely)\s+/i.test(normalized)) {
    return null;
  }

  // Check for problematic combinations
  const lowerNormalized = normalized.toLowerCase();
  const wordsCheck = lowerNormalized.split(/\s+/);

  // Reject "just/only X" patterns
  if (wordsCheck.length === 2 && ['just', 'only', 'some'].includes(wordsCheck[0])) {
    return null;
  }

  // Reject standalone "X thinking" unless it's a real skill like "critical thinking"
  if (wordsCheck.length === 2 && wordsCheck[1] === 'thinking') {
    const validThinkingTypes = ['critical', 'analytical', 'strategic', 'creative', 'logical', 'systems'];
    if (!validThinkingTypes.includes(wordsCheck[0])) {
      return null;
    }
  }

  // Reject standalone "X programs/values" unless specific
  if (wordsCheck.length === 2 && ['programs', 'values'].includes(wordsCheck[1])) {
    return null;
  }

  // Title case the result
  normalized = normalized
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return normalized;
}

/**
 * Split compound skills on "and", "&", "or"
 * Example: "Communication and Presentation Skills" → ["Communication Skills", "Presentation Skills"]
 */
export function splitCompoundSkill(skill) {
  if (!skill || typeof skill !== 'string') return [];

  // Split on "and", "&", "or" but preserve the rest
  const parts = skill.split(/\s+(?:and|&|or)\s+/i);

  if (parts.length === 1) {
    return [skill];
  }

  // Try to preserve suffix (like "Skills", "Experience", "Engineering") if it appears after the split
  const lastPart = parts[parts.length - 1];
  const suffixMatch = lastPart.match(/\b(skills?|experience|knowledge|ability|abilities|engineering|management|analysis)\b/i);

  if (suffixMatch && parts.length > 1) {
    const suffix = suffixMatch[0];
    // Add suffix to all parts except the last one (which already has it)
    return parts.map((part, idx) => {
      if (idx === parts.length - 1) {
        return part.trim();
      }
      // Check if part already ends with a similar suffix
      if (/\b(skills?|experience|knowledge|ability|abilities|engineering|management|analysis)\b/i.test(part)) {
        return part.trim();
      }
      return `${part.trim()} ${suffix}`;
    });
  }

  return parts.map(p => p.trim());
}

export function isValidSkill(skill) {
  if (!skill || typeof skill !== 'string') return false;

  const trimmed = skill.trim();

  // Must start with a letter
  if (!/^[a-zA-Z]/.test(trimmed)) return false;

  // Too many words (likely a sentence/requirement, not a skill)
  if (trimmed.split(/\s+/).length > 4) return false;

  // Too long (likely a sentence)
  if (trimmed.length > 50) return false;

  // Empty or too short
  if (trimmed.length < 2) return false;

  // Ends with colon (section headers like "basic compensation:")
  if (trimmed.endsWith(':')) return false;

  // Ends with punctuation (sentences, not skills)
  if (/[.!?]$/.test(trimmed)) return false;

  // Contains dollar amounts or salary info
  if (/\$|USD|EUR|GBP|\d+k|\d{3,}/.test(trimmed)) return false;

  const lower = trimmed.toLowerCase();

  // Check blacklist - exact match or contained in blacklist
  if (BLACKLISTED_TERMS.includes(lower)) return false;

  // Check if it's a substring of any blacklisted term (catches variations)
  const isBlacklistedSubstring = BLACKLISTED_TERMS.some(term => {
    // Only check multi-word blacklist terms to avoid false positives
    if (term.includes(' ')) {
      return term.includes(lower) || lower.includes(term);
    }
    // For single-word blacklist terms, require exact match
    return term === lower;
  });
  if (isBlacklistedSubstring) return false;

  // Contains relative clauses (task descriptions, not skills)
  // Examples: "Delegate Work That Has Been Organized", "Skills Which Are Required"
  if (/\b(that|which|who|whom|whose)\b/i.test(trimmed)) return false;

  // Starts with gerund (verb+ing) - likely a task description
  // Examples: "Managing Projects", "Ensuring Quality", "Delegating Tasks"
  // BUT allow common skill names like "Welding", "Programming", "Engineering"
  const startsWithGerund = /^[A-Z][a-z]+ing\b/i.test(trimmed);
  if (startsWithGerund) {
    // Whitelist common gerund-based skills
    const allowedGerunds = [
      'welding', 'programming', 'engineering', 'accounting', 'banking', 'nursing',
      'teaching', 'training', 'marketing', 'advertising', 'consulting', 'recruiting',
      'troubleshooting', 'debugging', 'testing', 'planning', 'modeling', 'forecasting',
      'budgeting', 'scheduling', 'networking', 'drafting', 'drawing', 'painting',
      'building', 'manufacturing', 'processing'
    ];

    const firstWord = lower.split(/\s+/)[0];
    if (!allowedGerunds.includes(firstWord)) {
      return false;
    }
  }

  // Starts with imperative verbs (commands/requirements, not skills)
  // Examples: "Ensures Accuracy", "Maintains Standards", "Delegate Work"
  const imperativeVerbs = [
    'ensure', 'ensures', 'maintain', 'maintains', 'delegate', 'delegates',
    'perform', 'performs', 'complete', 'completes', 'execute', 'executes',
    'deliver', 'delivers', 'achieve', 'achieves', 'demonstrate', 'demonstrates',
    'provide', 'provides', 'support', 'supports', 'assist', 'assists',
    'conduct', 'conducts', 'implement', 'implements', 'follow', 'follows',
    'adhere', 'adheres', 'comply', 'complies', 'meet', 'meets',
    'fulfill', 'fulfills', 'satisfy', 'satisfies', 'handle', 'handles'
  ];

  const words = lower.split(/\s+/);
  const firstWord = words[0];
  if (imperativeVerbs.includes(firstWord)) return false;

  // Reject vague abstract noun phrases (requirements, not skills)
  // Examples: "Thoroughness In All Assignments", "Attention To Detail In Work"
  const vagueNouns = ['thoroughness', 'accuracy', 'precision', 'consistency', 'reliability'];
  if (vagueNouns.includes(firstWord) && words.length > 1) {
    // Allow if it's just the single word (normalized to a skill), reject if it's a phrase
    return false;
  }

  // Contains degree or experience requirements
  if (/degree|years? of experience|years? experience|clearance|certification required|elected|voluntary/i.test(trimmed)) return false;

  // Contains work experience/internship requirements
  if (/\b(internships?|work experience|up to\s+\d+|one year|two years|three years)\b/i.test(trimmed)) return false;

  // Contains travel/citizenship/schedule requirements
  if (/travel \d+|us citizen|citizenship required|general hours|flexible hours|willing to travel/i.test(trimmed)) return false;

  // Contains percentage or range (likely travel/time requirement)
  if (/\d+%|\d+\s*to\s*\d+%|\d+\s*-\s*\d+%/i.test(trimmed)) return false;

  // Starts with "this role" or "this position" (job description fragments)
  if (/^this (role|position|job|opportunity)/i.test(trimmed)) return false;

  // Starts with generic phrase words (including recruitment verbs)
  if (GENERIC_STARTING_WORDS.includes(firstWord)) return false;

  // Count filler words
  const fillerCount = words.filter(w => COMMON_FILLER_WORDS.includes(w)).length;

  // If more than 30% are filler words, it's probably not a skill
  if (words.length > 2 && (fillerCount / words.length) > 0.3) return false;

  // Contains multiple common verbs/phrases (likely a sentence)
  const sentenceIndicators = ['you', 'your', 'we', 'our', 'must', 'should', 'will'];
  const indicatorCount = sentenceIndicators.filter(word => lower.includes(word)).length;
  if (indicatorCount >= 2) return false;

  // Reject full sentences with multiple capitalized words (Title Case Phrases)
  // Examples: "Delegate Work That Has Been Organized" - every word capitalized
  const capitalizedWords = trimmed.split(/\s+/).filter(word => /^[A-Z]/.test(word));
  if (capitalizedWords.length >= 4 && capitalizedWords.length === words.length) {
    // All words capitalized and 4+ words = likely a requirement/task description
    return false;
  }

  // Passed all checks - likely a real skill
  return true;
}

/**
 * Standardize a skill using O*NET taxonomy
 * This is the enhancement layer on top of basic normalization
 *
 * @param {string} skill - Skill to standardize
 * @param {object} options - Options including useONet flag
 * @returns {Promise<string|null>} Standardized skill name or null
 */
export async function standardizeSkill(skill, options = {}) {
  const { useONet = true } = options;

  // Stage 1: Client-side normalization (fast, always works)
  const normalized = normalizeSkill(skill);
  if (!normalized) return null;

  // Stage 2: O*NET standardization (optional, async)
  if (!useONet) {
    return normalized;
  }

  try {
    // Search O*NET for this skill
    const onetMatches = await onetClient.searchSkills(normalized, {
      useCache: true
    });

    // If we found a good match, use O*NET's canonical name
    if (onetMatches && onetMatches.length > 0) {
      const bestMatch = onetMatches[0];

      // Use O*NET name if it's a strong match
      // We can add fuzzy matching logic here if needed
      const normalizedLower = normalized.toLowerCase();
      const matchLower = bestMatch.name.toLowerCase();

      // Strong match: exact or contains
      if (matchLower === normalizedLower ||
          matchLower.includes(normalizedLower) ||
          normalizedLower.includes(matchLower)) {
        return bestMatch.name;
      }
    }

    // No good match - return client-side normalized version
    return normalized;
  } catch (error) {
    // O*NET unavailable - graceful fallback to client-side normalization
    console.warn('O*NET standardization unavailable:', error.message);
    return normalized;
  }
}

/**
 * Batch standardize multiple skills using O*NET
 * More efficient than calling standardizeSkill repeatedly
 *
 * @param {Array<string>} skills - Skills to standardize
 * @param {object} options - Options
 * @returns {Promise<Array<string>>} Standardized skills
 */
export async function standardizeSkills(skills, options = {}) {
  const { useONet = true } = options;

  if (!Array.isArray(skills) || skills.length === 0) {
    return [];
  }

  // First do client-side normalization on all skills
  const normalized = skills
    .map(skill => normalizeSkill(skill))
    .filter(skill => skill !== null);

  if (!useONet || normalized.length === 0) {
    return normalized;
  }

  try {
    // Batch search O*NET for all skills
    const onetResults = await onetClient.batchSearchSkills(normalized, {
      useCache: true
    });

    // Map normalized skills to O*NET canonical names where possible
    const standardized = normalized.map(skill => {
      const onetMatches = onetResults.get(skill);

      if (onetMatches && onetMatches.length > 0) {
        const bestMatch = onetMatches[0];
        const skillLower = skill.toLowerCase();
        const matchLower = bestMatch.name.toLowerCase();

        // Use O*NET name if strong match
        if (matchLower === skillLower ||
            matchLower.includes(skillLower) ||
            skillLower.includes(matchLower)) {
          return bestMatch.name;
        }
      }

      // No O*NET match - use client-side normalized version
      return skill;
    });

    return standardized;
  } catch (error) {
    console.warn('O*NET batch standardization unavailable:', error.message);
    return normalized;
  }
}

/**
 * Process skills through multi-stage pipeline with optional O*NET cache lookup:
 * 1. Split compounds ("A and B" → ["A", "B"])
 * 2. Normalize (remove adjectives, standardize word forms)
 * 3. O*NET standardization (if cache loaded)
 * 4. Validate (check if still a valid skill)
 * 5. Deduplicate
 *
 * Synchronous version - uses pre-loaded O*NET cache if available
 * Use processSkillsAsync for full O*NET API integration
 */
export function processSkills(skills) {
  if (!Array.isArray(skills)) return [];

  const processed = [];
  const seen = new Set();

  for (const skill of skills) {
    // Stage 1: Split compound skills first
    const parts = splitCompoundSkill(skill);

    for (const part of parts) {
      // Stage 2: Normalize each part
      const normalized = normalizeSkill(part);

      // Skip if normalization rejected it
      if (!normalized) continue;

      // Stage 3: Match against O*NET reference allowlist
      // This is the primary filter - only skills matching the reference get through
      let canonicalName = null;

      // First try O*NET pre-built cache (if loaded)
      try {
        const onetName = onetClient.lookupInPrebuiltCache(normalized);
        if (onetName) {
          canonicalName = onetName;
        }
      } catch (error) {
        // Cache not loaded - continue to reference matching
      }

      // Then try the static reference allowlist
      if (!canonicalName) {
        canonicalName = matchSkillToReference(normalized);
      }

      // Skip if no reference match found - not a recognized skill
      if (!canonicalName) continue;

      // Stage 4: Deduplicate (case-insensitive)
      const lowerCanonical = canonicalName.toLowerCase();
      if (!seen.has(lowerCanonical)) {
        seen.add(lowerCanonical);
        processed.push(canonicalName);
      }
    }
  }

  return processed;
}

/**
 * Process skills with O*NET standardization (async version)
 * Enhanced version that uses O*NET taxonomy for standardization
 *
 * @param {Array<string>} skills - Raw skills array
 * @param {object} options - Options including useONet flag
 * @returns {Promise<Array<string>>} Processed and standardized skills
 */
export async function processSkillsAsync(skills, options = {}) {
  const { useONet = true } = options;

  if (!Array.isArray(skills)) return [];

  // Stage 1: Split compound skills and normalize
  const splitAndNormalized = [];

  for (const skill of skills) {
    const parts = splitCompoundSkill(skill);

    for (const part of parts) {
      const normalized = normalizeSkill(part);
      if (normalized && isValidSkill(normalized)) {
        splitAndNormalized.push(normalized);
      }
    }
  }

  // Stage 2: O*NET standardization (if enabled)
  let standardized;
  if (useONet) {
    try {
      const onetResults = await onetClient.batchSearchSkills(splitAndNormalized, {
        useCache: true
      });

      standardized = splitAndNormalized.map(skill => {
        const onetMatches = onetResults.get(skill);

        if (onetMatches && onetMatches.length > 0) {
          const bestMatch = onetMatches[0];
          const skillLower = skill.toLowerCase();
          const matchLower = bestMatch.name.toLowerCase();

          // Use O*NET name if strong match
          if (matchLower === skillLower ||
              matchLower.includes(skillLower) ||
              skillLower.includes(matchLower)) {
            return bestMatch.name;
          }
        }

        return skill;
      });
    } catch (error) {
      console.warn('O*NET standardization failed, using client-side normalization:', error.message);
      standardized = splitAndNormalized;
    }
  } else {
    standardized = splitAndNormalized;
  }

  // Stage 3: Deduplicate (case-insensitive)
  const seen = new Set();
  const deduplicated = [];

  for (const skill of standardized) {
    const lowerSkill = skill.toLowerCase();
    if (!seen.has(lowerSkill)) {
      seen.add(lowerSkill);
      deduplicated.push(skill);
    }
  }

  return deduplicated;
}

/**
 * Legacy function - now just calls processSkills
 * Kept for backward compatibility
 */
export function filterValidSkills(skills) {
  return processSkills(skills);
}
