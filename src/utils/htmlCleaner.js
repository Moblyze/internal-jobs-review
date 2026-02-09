/**
 * HTML Cleaner Utility
 *
 * Defensive utility to strip HTML tags from job descriptions.
 * While the scraper should already clean HTML, this provides
 * an additional safety layer in case any HTML slips through.
 */

/**
 * Strips all HTML tags from a string and returns clean plain text
 *
 * @param {string} text - Text that may contain HTML tags
 * @returns {string} Clean plain text without HTML tags
 */
export function stripHtml(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Create a temporary DOM element to parse HTML
  // This is safer than regex for handling malformed HTML
  const doc = new DOMParser().parseFromString(text, 'text/html');

  // Get text content (automatically strips all HTML)
  let cleanText = doc.body.textContent || '';

  // Clean up whitespace
  // - Replace multiple spaces with single space
  // - Remove blank lines but preserve paragraph breaks
  cleanText = cleanText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n');

  return cleanText;
}

/**
 * Checks if a string contains HTML tags
 *
 * @param {string} text - Text to check
 * @returns {boolean} True if HTML tags are detected
 */
export function containsHtml(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // Check for common HTML tags
  const htmlPattern = /<\/?[a-z][\s\S]*>/i;
  return htmlPattern.test(text);
}

/**
 * Ensures text is clean by stripping HTML if present
 * Only processes if HTML is detected to avoid unnecessary work
 *
 * @param {string} text - Text that may contain HTML
 * @returns {string} Clean text
 */
export function ensureCleanText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Only strip HTML if it's actually present
  if (containsHtml(text)) {
    console.warn('HTML detected in job description, cleaning...', text.substring(0, 100));
    return stripHtml(text);
  }

  return text;
}

/**
 * Cleans HTML from job description with proper line break handling
 * Specifically designed for job descriptions that may have <br> tags
 *
 * @param {string} description - Job description that may contain HTML
 * @returns {string} Clean description with preserved line breaks
 */
export function cleanJobDescription(description) {
  if (!description || typeof description !== 'string') {
    return '';
  }

  // If no HTML detected, return as-is
  if (!containsHtml(description)) {
    return description;
  }

  // Replace <br> tags with newlines before stripping HTML
  let cleaned = description.replace(/<br\s*\/?>/gi, '\n');

  // Replace closing block-level tags with newlines
  cleaned = cleaned.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n');

  // Strip remaining HTML
  cleaned = stripHtml(cleaned);

  return cleaned;
}
