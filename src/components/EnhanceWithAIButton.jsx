import { useState, useEffect } from 'react';
import { useJobEnhancement } from '../hooks/useJobEnhancement';

/**
 * EnhanceWithAIButton Component
 *
 * Shows a button to enhance a job description with AI
 * Handles loading state, success feedback, and error messages
 *
 * @param {Object} props
 * @param {Object} props.job - Job object with id and description
 * @param {Function} props.onEnhanced - Callback when enhancement succeeds with structuredDescription
 */
function EnhanceWithAIButton({ job, onEnhanced }) {
  const { enhanceJob, enhancing, error, success, reset } = useJobEnhancement();
  const [showError, setShowError] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Handle enhancement
  const handleEnhance = async () => {
    const structuredDescription = await enhanceJob(job);
    if (structuredDescription) {
      // Call parent callback to update UI
      onEnhanced(structuredDescription);
    }
  };

  // Show error message temporarily
  useEffect(() => {
    if (error) {
      setShowError(true);
      const timer = setTimeout(() => {
        setShowError(false);
        reset();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, reset]);

  // Show success message temporarily
  useEffect(() => {
    if (success) {
      setShowSuccess(true);
      const timer = setTimeout(() => {
        setShowSuccess(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  return (
    <div className="flex items-center gap-3">
      {/* Success Message */}
      {showSuccess && (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          Enhanced!
        </span>
      )}

      {/* Error Message */}
      {showError && error && (
        <div className="flex items-center px-3 py-2 rounded-md text-xs bg-red-50 text-red-700 border border-red-200 max-w-md">
          <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* Enhance Button */}
      {!showSuccess && (
        <button
          onClick={handleEnhance}
          disabled={enhancing}
          className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            enhancing
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
          }`}
        >
          {enhancing ? (
            <>
              {/* Loading spinner */}
              <svg
                className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Enhancing...
            </>
          ) : (
            <>
              {/* AI Icon */}
              <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
              Enhance with AI
            </>
          )}
        </button>
      )}
    </div>
  );
}

export default EnhanceWithAIButton;
