/**
 * Content Formatter Utility
 *
 * Formats job descriptions to be more readable by:
 * - Removing excessive whitespace
 * - Detecting and formatting section headers
 * - Creating proper list structures
 * - Adding semantic HTML elements
 */

/**
 * Identifies common section headers in job descriptions
 */
const SECTION_HEADERS = [
  'responsibilities',
  'qualifications',
  'requirements',
  'desired characteristics',
  'essential responsibilities',
  'key responsibilities',
  'required skills',
  'preferred skills',
  'what you will do',
  'what we offer',
  'about the role',
  'about you',
  'working with us',
  'working for you',
  'partner with the best',
  'fuel your passion',
  'work in a way that works for you',
  'benefits',
  'compensation',
  'education',
  'experience',
  'skills',
  'key changes',
  'implementation details',
  'testing',
  'summary',
  'duties',
  'job description',
];

/**
 * Detects if a line is a section header
 */
function isSectionHeader(line) {
  const trimmed = line.trim().toLowerCase();

  // Check if line ends with colon and matches a header pattern
  if (trimmed.endsWith(':')) {
    const withoutColon = trimmed.slice(0, -1);
    return SECTION_HEADERS.some(header =>
      withoutColon === header || withoutColon.includes(header)
    );
  }

  // Check if line is all caps and short (likely a header)
  if (line.trim() === line.trim().toUpperCase() && line.trim().length < 50) {
    return SECTION_HEADERS.some(header =>
      trimmed === header || trimmed.includes(header)
    );
  }

  return false;
}

/**
 * Detects if a line is a bullet point
 */
function isBulletPoint(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('•') ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('*') ||
    /^\d+\./.test(trimmed) || // numbered lists
    trimmed.startsWith('o ') ||
    trimmed.startsWith('▪')
  );
}

/**
 * Cleans up bullet point formatting
 */
function cleanBulletPoint(line) {
  return line
    .trim()
    .replace(/^[•\-*▪o]\s*/, '') // Remove bullet characters
    .replace(/^\d+\.\s*/, '') // Remove numbers
    .trim();
}

/**
 * Cleans up section header formatting
 */
function cleanSectionHeader(line) {
  return line
    .trim()
    .replace(/:$/, '') // Remove trailing colon
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Parses raw text into structured content blocks
 */
function parseContent(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Split into lines and remove excessive blank lines
  const lines = text
    .split('\n')
    .map(line => line.trimEnd())
    .filter((line, index, array) => {
      // Keep non-empty lines
      if (line.trim()) return true;
      // Keep single blank lines but remove consecutive ones
      return index === 0 || array[index - 1].trim() !== '';
    });

  const blocks = [];
  let currentBlock = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Skip empty lines at boundaries
    if (!trimmedLine) {
      if (currentBlock && currentBlock.type !== 'paragraph') {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }

    // Check for section headers
    if (isSectionHeader(line)) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = {
        type: 'header',
        content: cleanSectionHeader(line)
      };
      blocks.push(currentBlock);
      currentBlock = null;
      continue;
    }

    // Check for bullet points
    if (isBulletPoint(line)) {
      if (currentBlock?.type !== 'list') {
        if (currentBlock) {
          blocks.push(currentBlock);
        }
        currentBlock = {
          type: 'list',
          items: []
        };
      }
      currentBlock.items.push(cleanBulletPoint(line));
      continue;
    }

    // Regular paragraph text
    if (currentBlock?.type === 'paragraph') {
      // Continue current paragraph if it's a continuation line
      currentBlock.content += ' ' + trimmedLine;
    } else {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = {
        type: 'paragraph',
        content: trimmedLine
      };
    }
  }

  // Push final block
  if (currentBlock) {
    blocks.push(currentBlock);
  }

  // Remove empty blocks
  return blocks.filter(block => {
    if (block.type === 'list') return block.items.length > 0;
    if (block.type === 'paragraph' || block.type === 'header') return block.content;
    return true;
  });
}

/**
 * Formats job description text into structured HTML-ready content
 *
 * @param {string} text - Raw job description text
 * @returns {Array} Array of content blocks with type and content
 */
export function formatJobDescription(text) {
  return parseContent(text);
}

/**
 * Cleans location strings (removes "locations\n" prefix, etc.)
 *
 * DEPRECATED: Use formatLocation from locationParser.js instead
 * This is kept for backwards compatibility
 *
 * @param {string} location - Raw location string
 * @returns {string} Cleaned location string
 */
export function cleanLocation(location) {
  // Import the proper formatter
  const { formatLocation } = require('./locationParser');
  return formatLocation(location) || '';
}

/**
 * Checks if content is already well-formatted
 * (has minimal formatting issues)
 */
export function isWellFormatted(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const lines = text.split('\n');

  // Check for excessive blank lines (more than 3 consecutive)
  let consecutiveBlank = 0;
  for (const line of lines) {
    if (!line.trim()) {
      consecutiveBlank++;
      if (consecutiveBlank > 3) return false;
    } else {
      consecutiveBlank = 0;
    }
  }

  return true;
}
