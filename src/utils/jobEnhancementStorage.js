/**
 * Job Enhancement Storage Utility
 *
 * Manages client-side storage of AI-enhanced job descriptions
 * Since this is a static site, enhancements are stored in localStorage
 * per-browser until the jobs.json file is updated with batch processing.
 */

const STORAGE_KEY = 'moblyze_job_enhancements';

/**
 * Get all stored job enhancements
 * @returns {Object} Map of jobId -> structuredDescription
 */
export function getAllEnhancements() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Failed to load job enhancements from localStorage:', error);
    return {};
  }
}

/**
 * Get enhancement for a specific job
 * @param {string} jobId - Job ID
 * @returns {Object|null} Structured description or null
 */
export function getEnhancement(jobId) {
  const enhancements = getAllEnhancements();
  return enhancements[jobId] || null;
}

/**
 * Save enhancement for a specific job
 * @param {string} jobId - Job ID
 * @param {Object} structuredDescription - AI-enhanced description
 * @returns {boolean} Success status
 */
export function saveEnhancement(jobId, structuredDescription) {
  try {
    const enhancements = getAllEnhancements();
    enhancements[jobId] = structuredDescription;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enhancements));
    return true;
  } catch (error) {
    console.error('Failed to save job enhancement to localStorage:', error);
    return false;
  }
}

/**
 * Remove enhancement for a specific job
 * @param {string} jobId - Job ID
 * @returns {boolean} Success status
 */
export function removeEnhancement(jobId) {
  try {
    const enhancements = getAllEnhancements();
    delete enhancements[jobId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enhancements));
    return true;
  } catch (error) {
    console.error('Failed to remove job enhancement from localStorage:', error);
    return false;
  }
}

/**
 * Clear all enhancements
 * @returns {boolean} Success status
 */
export function clearAllEnhancements() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.error('Failed to clear job enhancements from localStorage:', error);
    return false;
  }
}

/**
 * Merge localStorage enhancements with jobs data
 * This should be called when jobs are loaded to apply client-side enhancements
 * @param {Array} jobs - Array of job objects
 * @returns {Array} Jobs array with enhancements merged
 */
export function mergeEnhancements(jobs) {
  const enhancements = getAllEnhancements();

  if (Object.keys(enhancements).length === 0) {
    return jobs;
  }

  return jobs.map(job => {
    const enhancement = enhancements[job.id];
    if (enhancement) {
      return {
        ...job,
        structuredDescription: enhancement,
        // Mark as client-enhanced so we can show indicator
        _clientEnhanced: true
      };
    }
    return job;
  });
}

/**
 * Get count of stored enhancements
 * @returns {number} Number of enhanced jobs
 */
export function getEnhancementCount() {
  const enhancements = getAllEnhancements();
  return Object.keys(enhancements).length;
}
