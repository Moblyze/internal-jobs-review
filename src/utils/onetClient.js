/**
 * O*NET Web Services API v2.0 Client
 *
 * Provides access to U.S. Department of Labor O*NET skills taxonomy
 * for standardizing job skills across the Moblyze platform.
 *
 * API Documentation: https://services.onetcenter.org/reference/
 * Coverage: 33,000+ skills across 891+ occupations
 * License: Creative Commons (commercial use permitted)
 */

// Support both Vite (import.meta.env) and Node.js (process.env) environments
const getEnv = (key, defaultValue) => {
  // Vite environment
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env[key] || defaultValue;
  }
  // Node.js environment
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || defaultValue;
  }
  return defaultValue;
};

const ONET_API_KEY = getEnv('VITE_ONET_API_KEY');
const BASE_URL = getEnv('VITE_ONET_BASE_URL', 'https://api-v2.onetcenter.org');

// Cache configuration
const CACHE_PREFIX = 'onet_cache_';
const CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

// Rate limiting
const RATE_LIMIT_DELAY = 100; // ms between requests
let lastRequestTime = 0;

/**
 * Cache management utilities
 */
const cache = {
  get(key) {
    try {
      const item = localStorage.getItem(CACHE_PREFIX + key);
      if (!item) return null;

      const { data, timestamp } = JSON.parse(item);
      const age = Date.now() - timestamp;

      if (age > CACHE_DURATION) {
        this.remove(key);
        return null;
      }

      return data;
    } catch (error) {
      console.warn('Cache read error:', error);
      return null;
    }
  },

  set(key, data) {
    try {
      const item = {
        data,
        timestamp: Date.now()
      };
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(item));
    } catch (error) {
      console.warn('Cache write error:', error);
      // If localStorage is full, clear old O*NET cache entries
      if (error.name === 'QuotaExceededError') {
        this.clearOld();
      }
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(CACHE_PREFIX + key);
    } catch (error) {
      console.warn('Cache remove error:', error);
    }
  },

  clearOld() {
    try {
      const now = Date.now();
      Object.keys(localStorage)
        .filter(key => key.startsWith(CACHE_PREFIX))
        .forEach(key => {
          const item = localStorage.getItem(key);
          if (item) {
            const { timestamp } = JSON.parse(item);
            if (now - timestamp > CACHE_DURATION) {
              localStorage.removeItem(key);
            }
          }
        });
    } catch (error) {
      console.warn('Cache cleanup error:', error);
    }
  }
};

/**
 * Rate limiter - ensures we don't overwhelm the API
 */
async function rateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
    await new Promise(resolve =>
      setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();
}

/**
 * Make authenticated request to O*NET API with retry logic
 */
async function onetRequest(endpoint, options = {}) {
  const {
    useCache = true,
    retries = 2,
    timeout = 10000
  } = options;

  // Check cache first
  const cacheKey = endpoint;
  if (useCache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Validate API key
  if (!ONET_API_KEY) {
    throw new Error('O*NET API key not configured. Set VITE_ONET_API_KEY in .env file.');
  }

  // Rate limiting
  await rateLimit();

  const url = `${BASE_URL}${endpoint}`;
  let lastError;

  // Retry loop
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        headers: {
          'X-API-Key': ONET_API_KEY,
          'Accept': 'application/json',
          'User-Agent': 'Moblyze-Jobs/1.0'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          // 404 is not a retry-able error
          return null;
        }
        throw new Error(`O*NET API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Cache successful response
      if (useCache) {
        cache.set(cacheKey, data);
      }

      return data;

    } catch (error) {
      lastError = error;

      // Don't retry on abort (timeout) or client errors
      if (error.name === 'AbortError' || error.message.includes('404')) {
        break;
      }

      // Wait before retry (exponential backoff)
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw lastError || new Error('O*NET API request failed after retries');
}

/**
 * Search for skills or occupations by keyword
 *
 * @param {string} keyword - Search term
 * @param {object} options - Search options
 * @returns {Promise<object>} Search results with occupations array
 */
export async function search(keyword, options = {}) {
  if (!keyword || keyword.trim().length === 0) {
    return { occupation: [] };
  }

  const cleanKeyword = keyword.trim().toLowerCase();
  const endpoint = `/online/search?keyword=${encodeURIComponent(cleanKeyword)}`;

  try {
    const data = await onetRequest(endpoint, options);
    return data || { occupation: [] };
  } catch (error) {
    console.error('O*NET search error:', error);
    return { occupation: [] };
  }
}

/**
 * Get detailed information about a specific occupation
 *
 * @param {string} occupationCode - O*NET-SOC code (e.g., "51-4121.00")
 * @param {object} options - Request options
 * @returns {Promise<object|null>} Occupation details or null if not found
 */
export async function getOccupation(occupationCode, options = {}) {
  if (!occupationCode) {
    return null;
  }

  const endpoint = `/online/occupations/${occupationCode}`;

  try {
    return await onetRequest(endpoint, options);
  } catch (error) {
    console.error('O*NET occupation lookup error:', error);
    return null;
  }
}

/**
 * Get all skills for a specific occupation
 *
 * @param {string} occupationCode - O*NET-SOC code
 * @param {object} options - Request options
 * @returns {Promise<Array>} Array of skill objects
 */
export async function getOccupationSkills(occupationCode, options = {}) {
  if (!occupationCode) {
    return [];
  }

  const endpoint = `/online/occupations/${occupationCode}/summary/skills`;

  try {
    const data = await onetRequest(endpoint, options);
    return data?.element || [];
  } catch (error) {
    console.error('O*NET skills lookup error:', error);
    return [];
  }
}

/**
 * Get abilities for a specific occupation
 *
 * @param {string} occupationCode - O*NET-SOC code
 * @param {object} options - Request options
 * @returns {Promise<Array>} Array of ability objects
 */
export async function getOccupationAbilities(occupationCode, options = {}) {
  if (!occupationCode) {
    return [];
  }

  const endpoint = `/online/occupations/${occupationCode}/summary/abilities`;

  try {
    const data = await onetRequest(endpoint, options);
    return data?.element || [];
  } catch (error) {
    console.error('O*NET abilities lookup error:', error);
    return [];
  }
}

/**
 * Get knowledge requirements for a specific occupation
 *
 * @param {string} occupationCode - O*NET-SOC code
 * @param {object} options - Request options
 * @returns {Promise<Array>} Array of knowledge objects
 */
export async function getOccupationKnowledge(occupationCode, options = {}) {
  if (!occupationCode) {
    return [];
  }

  const endpoint = `/online/occupations/${occupationCode}/summary/knowledge`;

  try {
    const data = await onetRequest(endpoint, options);
    return data?.element || [];
  } catch (error) {
    console.error('O*NET knowledge lookup error:', error);
    return [];
  }
}

/**
 * Find the best matching O*NET occupation for a job title
 * Uses search API and returns top match with confidence score
 *
 * @param {string} jobTitle - Job title to match
 * @param {object} options - Search options
 * @returns {Promise<object|null>} Best match with code, title, and confidence
 */
export async function findOccupation(jobTitle, options = {}) {
  if (!jobTitle || jobTitle.trim().length === 0) {
    return null;
  }

  try {
    const results = await search(jobTitle, options);

    if (!results.occupation || results.occupation.length === 0) {
      return null;
    }

    // Return top result with confidence indicator
    const topMatch = results.occupation[0];
    const totalResults = results.total || results.occupation.length;

    return {
      code: topMatch.code,
      title: topMatch.title,
      href: topMatch.href,
      confidence: totalResults === 1 ? 'high' : totalResults <= 5 ? 'medium' : 'low',
      alternates: results.occupation.slice(1, 5) // Include top 4 alternatives
    };
  } catch (error) {
    console.error('O*NET occupation matching error:', error);
    return null;
  }
}

/**
 * Search for a skill by name and return best matches
 * Searches occupations and extracts relevant skills
 *
 * @param {string} skillName - Skill to search for
 * @param {object} options - Search options
 * @returns {Promise<Array>} Array of matching skills with metadata
 */
export async function searchSkills(skillName, options = {}) {
  if (!skillName || skillName.trim().length === 0) {
    return [];
  }

  try {
    // Search for occupations related to this skill
    const results = await search(skillName, options);

    if (!results.occupation || results.occupation.length === 0) {
      return [];
    }

    // Get skills from top 3 matching occupations
    const topOccupations = results.occupation.slice(0, 3);
    const skillPromises = topOccupations.map(occ =>
      getOccupationSkills(occ.code, options)
    );

    const skillResults = await Promise.all(skillPromises);

    // Flatten and deduplicate skills
    const skillMap = new Map();
    skillResults.flat().forEach(skill => {
      if (!skillMap.has(skill.id)) {
        skillMap.set(skill.id, {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          // Include scale information if available
          level: skill.scale?.value,
          importance: skill.scale_importance?.value
        });
      }
    });

    return Array.from(skillMap.values());
  } catch (error) {
    console.error('O*NET skill search error:', error);
    return [];
  }
}

/**
 * Batch search for multiple skills
 * Optimized to search for several skills at once with caching
 *
 * @param {Array<string>} skillNames - Array of skill names to search
 * @param {object} options - Search options
 * @returns {Promise<Map>} Map of skill name to O*NET matches
 */
export async function batchSearchSkills(skillNames, options = {}) {
  if (!Array.isArray(skillNames) || skillNames.length === 0) {
    return new Map();
  }

  const results = new Map();
  const uniqueSkills = [...new Set(skillNames.filter(s => s && s.trim()))];

  // Process skills sequentially to respect rate limiting
  for (const skillName of uniqueSkills) {
    try {
      const matches = await searchSkills(skillName, options);
      results.set(skillName, matches);

      // Small delay between batch requests
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      console.error(`Batch skill search error for "${skillName}":`, error);
      results.set(skillName, []);
    }
  }

  return results;
}

/**
 * Get recommended skills for a job based on O*NET occupation match
 *
 * @param {string} jobTitle - Job title
 * @param {object} options - Options
 * @returns {Promise<object>} Recommended skills with metadata
 */
export async function getRecommendedSkills(jobTitle, options = {}) {
  try {
    const occupation = await findOccupation(jobTitle, options);

    if (!occupation) {
      return {
        matched: false,
        skills: []
      };
    }

    const skills = await getOccupationSkills(occupation.code, options);

    return {
      matched: true,
      occupation: {
        code: occupation.code,
        title: occupation.title,
        confidence: occupation.confidence
      },
      skills: skills.map(skill => ({
        id: skill.id,
        name: skill.name,
        level: skill.scale?.value,
        importance: skill.scale_importance?.value,
        category: skill.category
      }))
    };
  } catch (error) {
    console.error('O*NET recommended skills error:', error);
    return {
      matched: false,
      skills: []
    };
  }
}

/**
 * Enrich a job object with O*NET data
 *
 * @param {object} job - Job object with title property
 * @param {object} options - Options
 * @returns {Promise<object>} Enriched job object
 */
export async function enrichJobWithONet(job, options = {}) {
  if (!job || !job.title) {
    return job;
  }

  try {
    const recommended = await getRecommendedSkills(job.title, options);

    return {
      ...job,
      onet: {
        matched: recommended.matched,
        occupation: recommended.occupation,
        recommendedSkills: recommended.skills,
        enrichedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('O*NET job enrichment error:', error);
    return job;
  }
}

/**
 * Clear all O*NET cache
 */
export function clearCache() {
  try {
    Object.keys(localStorage)
      .filter(key => key.startsWith(CACHE_PREFIX))
      .forEach(key => localStorage.removeItem(key));
  } catch (error) {
    console.warn('Cache clear error:', error);
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  try {
    const keys = Object.keys(localStorage)
      .filter(key => key.startsWith(CACHE_PREFIX));

    let totalSize = 0;
    let oldestTimestamp = Date.now();

    keys.forEach(key => {
      const item = localStorage.getItem(key);
      if (item) {
        totalSize += item.length;
        const { timestamp } = JSON.parse(item);
        if (timestamp < oldestTimestamp) {
          oldestTimestamp = timestamp;
        }
      }
    });

    return {
      entries: keys.length,
      sizeBytes: totalSize,
      oldestAge: Date.now() - oldestTimestamp,
      maxAge: CACHE_DURATION
    };
  } catch (error) {
    console.warn('Cache stats error:', error);
    return { entries: 0, sizeBytes: 0, oldestAge: 0, maxAge: CACHE_DURATION };
  }
}

/**
 * Pre-built cache loaded from file
 * This is populated on first use for fast synchronous lookups
 */
let prebuiltCache = null;
let cacheLoadPromise = null;

/**
 * Load pre-built skills cache from file
 * Returns cached promise to avoid multiple simultaneous fetches
 */
async function loadPrebuiltCache() {
  if (prebuiltCache) return prebuiltCache;
  if (cacheLoadPromise) return cacheLoadPromise;

  cacheLoadPromise = (async () => {
    try {
      const response = await fetch('/data/onet-skills-cache.json');
      if (!response.ok) {
        console.warn('O*NET pre-built cache not found, will use API');
        return null;
      }
      const data = await response.json();
      prebuiltCache = data.cache || {};
      console.log(`✅ Loaded O*NET cache: ${Object.keys(prebuiltCache).length} skills`);
      return prebuiltCache;
    } catch (error) {
      console.warn('Failed to load O*NET pre-built cache:', error);
      return null;
    }
  })();

  return cacheLoadPromise;
}

/**
 * Look up skill in pre-built cache (synchronous)
 * Returns O*NET canonical name if found, null otherwise
 */
export function lookupInPrebuiltCache(skillName) {
  if (!prebuiltCache || !skillName) return null;

  const key = skillName.toLowerCase();
  const cached = prebuiltCache[key];

  if (cached && cached.onet) {
    return cached.onet.name;
  }

  return null;
}

/**
 * Initialize O*NET client by loading pre-built cache
 * Call this early in app lifecycle for best performance
 */
export async function initializeONet() {
  return await loadPrebuiltCache();
}

/**
 * Get cache loading status
 */
export function getCacheLoadingStatus() {
  return {
    loaded: prebuiltCache !== null,
    loading: cacheLoadPromise !== null && prebuiltCache === null,
    skillCount: prebuiltCache ? Object.keys(prebuiltCache).length : 0
  };
}

// Export configuration for testing/debugging
export const config = {
  apiKey: ONET_API_KEY ? '***' + ONET_API_KEY.slice(-4) : 'not configured',
  baseUrl: BASE_URL,
  cacheDuration: CACHE_DURATION,
  rateLimit: RATE_LIMIT_DELAY
};
