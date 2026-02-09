/**
 * Hook for AI-enhancing individual jobs
 *
 * Provides functionality to enhance a single job with AI on-demand
 * Stores results in localStorage for persistence across sessions
 */

import { useState, useCallback } from 'react';
import { restructureJobDescription, isAiParsingAvailable } from '../utils/aiDescriptionParser';
import { saveEnhancement } from '../utils/jobEnhancementStorage';

/**
 * Hook for enhancing a job with AI
 * @returns {Object} Enhancement state and functions
 */
export function useJobEnhancement() {
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  /**
   * Enhance a job with AI
   * @param {Object} job - Job object with id and description
   * @returns {Promise<Object|null>} Structured description or null on error
   */
  const enhanceJob = useCallback(async (job) => {
    // Reset state
    setEnhancing(true);
    setError(null);
    setSuccess(false);

    try {
      // Validate AI parsing is available
      if (!isAiParsingAvailable()) {
        throw new Error('AI parsing is not available. Please configure ANTHROPIC_API_KEY in .env file.');
      }

      // Validate job has description
      if (!job.description || job.description.trim() === '') {
        throw new Error('Job has no description to enhance.');
      }

      console.log(`[useJobEnhancement] Enhancing job: ${job.id}`);

      // Call AI parser
      const structuredDescription = await restructureJobDescription(job.description);

      // Check for errors in response
      if (structuredDescription.error) {
        throw new Error(structuredDescription.error);
      }

      // Validate response has sections
      if (!structuredDescription.sections || structuredDescription.sections.length === 0) {
        throw new Error('AI returned empty response.');
      }

      // Save to localStorage
      const saved = saveEnhancement(job.id, structuredDescription);
      if (!saved) {
        console.warn('[useJobEnhancement] Failed to save to localStorage, but enhancement succeeded');
      }

      console.log(`[useJobEnhancement] Successfully enhanced job: ${job.id}`);
      setSuccess(true);
      setEnhancing(false);

      return structuredDescription;

    } catch (err) {
      console.error('[useJobEnhancement] Enhancement failed:', err);
      setError(err.message || 'Failed to enhance job description');
      setEnhancing(false);
      return null;
    }
  }, []);

  /**
   * Reset state (useful for clearing error/success messages)
   */
  const reset = useCallback(() => {
    setError(null);
    setSuccess(false);
  }, []);

  return {
    enhanceJob,
    enhancing,
    error,
    success,
    reset
  };
}
