/**
 * Unified Description Parser
 *
 * Provides a single interface for parsing job descriptions,
 * with automatic fallback from AI parser to traditional formatter.
 *
 * This module intelligently chooses between:
 * 1. AI-powered restructuring for poorly formatted descriptions
 * 2. Traditional pattern-based parsing for well-formatted descriptions
 */

import { formatJobDescription, isWellFormatted } from './contentFormatter.js';
import {
  restructureJobDescription,
  isAiParsingAvailable,
} from './aiDescriptionParser.js';

/**
 * Parse strategy options
 */
export const ParseStrategy = {
  AUTO: 'auto', // Automatically choose best method
  AI_ONLY: 'ai_only', // Always use AI (fail if unavailable)
  TRADITIONAL_ONLY: 'traditional_only', // Always use traditional formatter
  AI_FIRST: 'ai_first', // Try AI first, fallback to traditional
};

/**
 * Parse a job description using the best available method
 *
 * @param {string} description - Raw job description text
 * @param {Object} options - Parsing options
 * @param {string} [options.strategy='auto'] - Parsing strategy (see ParseStrategy)
 * @param {boolean} [options.forceAi=false] - Force AI parsing even if well-formatted
 * @param {Object} [options.aiOptions] - Options to pass to AI parser
 * @returns {Promise<Object>} - Structured description (compatible with both formats)
 *
 * @example
 * // Automatic strategy (recommended)
 * const parsed = await parseJobDescription(description);
 *
 * // Force AI parsing
 * const parsed = await parseJobDescription(description, {
 *   strategy: ParseStrategy.AI_ONLY
 * });
 *
 * // Use traditional only (synchronous, no API calls)
 * const parsed = await parseJobDescription(description, {
 *   strategy: ParseStrategy.TRADITIONAL_ONLY
 * });
 */
export async function parseJobDescription(description, options = {}) {
  const {
    strategy = ParseStrategy.AUTO,
    forceAi = false,
    aiOptions = {},
  } = options;

  // Validate input
  if (!description || typeof description !== 'string') {
    return {
      sections: [],
      metadata: {
        method: 'none',
        error: 'Invalid input: description must be a non-empty string',
      },
    };
  }

  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return {
      sections: [],
      metadata: {
        method: 'none',
        error: 'Input description is empty',
      },
    };
  }

  // Traditional only strategy
  if (strategy === ParseStrategy.TRADITIONAL_ONLY) {
    return formatTraditional(trimmed);
  }

  // AI only strategy
  if (strategy === ParseStrategy.AI_ONLY) {
    if (!isAiParsingAvailable()) {
      return {
        sections: [],
        metadata: {
          method: 'none',
          error: 'AI parsing unavailable (API key not configured)',
        },
      };
    }
    return formatWithAi(trimmed, aiOptions);
  }

  // Auto strategy: choose based on content quality
  if (strategy === ParseStrategy.AUTO) {
    const wellFormatted = isWellFormatted(trimmed);

    // If well-formatted and AI not forced, use traditional
    if (wellFormatted && !forceAi) {
      return formatTraditional(trimmed);
    }

    // If AI available, use it for poorly formatted content
    if (isAiParsingAvailable()) {
      return formatWithAi(trimmed, aiOptions);
    }

    // Fallback to traditional
    return formatTraditional(trimmed);
  }

  // AI first strategy: try AI, fallback to traditional
  if (strategy === ParseStrategy.AI_FIRST) {
    if (isAiParsingAvailable()) {
      const result = await formatWithAi(trimmed, aiOptions);

      // If AI succeeded, return result
      if (!result.metadata.error) {
        return result;
      }

      // AI failed, fallback to traditional
      console.warn('AI parsing failed, falling back to traditional:', result.metadata.error);
    }

    return formatTraditional(trimmed);
  }

  // Unknown strategy, use traditional
  console.warn(`Unknown parsing strategy "${strategy}", using traditional`);
  return formatTraditional(trimmed);
}

/**
 * Format using traditional pattern-based parser
 * @private
 */
function formatTraditional(description) {
  const blocks = formatJobDescription(description);

  return {
    sections: blocks.map((block) => {
      if (block.type === 'header') {
        // Convert header to section title
        // (Traditional parser outputs headers separately)
        return {
          title: block.content,
          type: 'header',
          content: '',
        };
      }

      if (block.type === 'list') {
        return {
          title: '', // Traditional parser doesn't associate headers with lists
          type: 'list',
          content: block.items,
        };
      }

      if (block.type === 'paragraph') {
        return {
          title: '',
          type: 'paragraph',
          content: block.content,
        };
      }

      return block;
    }),
    metadata: {
      method: 'traditional',
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Format using AI-powered parser
 * @private
 */
async function formatWithAi(description, aiOptions) {
  try {
    const structured = await restructureJobDescription(description, aiOptions);

    return {
      sections: structured.sections,
      metadata: {
        method: 'ai',
        timestamp: new Date().toISOString(),
        error: structured.error,
      },
    };
  } catch (error) {
    return {
      sections: [
        {
          title: 'Description',
          type: 'paragraph',
          content: description,
        },
      ],
      metadata: {
        method: 'ai',
        timestamp: new Date().toISOString(),
        error: error.message,
      },
    };
  }
}

/**
 * Check if AI parsing is currently available
 * @returns {boolean}
 */
export function canUseAiParsing() {
  return isAiParsingAvailable();
}

/**
 * Get recommended parsing strategy for a description
 *
 * @param {string} description - Raw description text
 * @returns {string} - Recommended strategy
 */
export function getRecommendedStrategy(description) {
  if (!description || description.trim().length === 0) {
    return ParseStrategy.TRADITIONAL_ONLY;
  }

  const wellFormatted = isWellFormatted(description);

  // Well-formatted descriptions don't need AI
  if (wellFormatted) {
    return ParseStrategy.TRADITIONAL_ONLY;
  }

  // Poorly formatted descriptions benefit from AI
  if (isAiParsingAvailable()) {
    return ParseStrategy.AI_FIRST;
  }

  // AI not available, use traditional
  return ParseStrategy.TRADITIONAL_ONLY;
}

/**
 * Convert parsed sections to plain text
 *
 * @param {Object} parsed - Parsed description object
 * @returns {string} - Plain text representation
 */
export function toPlainText(parsed) {
  if (!parsed || !parsed.sections || parsed.sections.length === 0) {
    return '';
  }

  return parsed.sections
    .map((section) => {
      let text = '';

      // Add title if present
      if (section.title) {
        text += `${section.title}\n\n`;
      }

      // Add content
      if (section.type === 'paragraph') {
        text += section.content + '\n';
      } else if (section.type === 'list') {
        text += section.content.map((item) => `• ${item}`).join('\n') + '\n';
      } else if (section.type === 'header') {
        // Header only (already included above)
        text += '\n';
      }

      return text;
    })
    .join('\n');
}

/**
 * Convert parsed sections to HTML
 *
 * @param {Object} parsed - Parsed description object
 * @param {Object} options - HTML generation options
 * @param {string} [options.headerTag='h3'] - HTML tag for section headers
 * @param {string} [options.className=''] - CSS class prefix for elements
 * @returns {string} - HTML representation
 */
export function toHtml(parsed, options = {}) {
  const { headerTag = 'h3', className = '' } = options;

  if (!parsed || !parsed.sections || parsed.sections.length === 0) {
    return '';
  }

  const escapeHtml = (text) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  return parsed.sections
    .map((section) => {
      let html = '';

      // Section wrapper
      const sectionClass = className ? `${className}-section` : 'section';
      html += `<div class="${sectionClass}">`;

      // Add title if present
      if (section.title) {
        const titleClass = className ? `${className}-title` : 'section-title';
        html += `<${headerTag} class="${titleClass}">${escapeHtml(section.title)}</${headerTag}>`;
      }

      // Add content
      if (section.type === 'paragraph') {
        const paraClass = className ? `${className}-paragraph` : 'section-paragraph';
        html += `<p class="${paraClass}">${escapeHtml(section.content)}</p>`;
      } else if (section.type === 'list') {
        const listClass = className ? `${className}-list` : 'section-list';
        html += `<ul class="${listClass}">`;
        section.content.forEach((item) => {
          html += `<li>${escapeHtml(item)}</li>`;
        });
        html += '</ul>';
      }

      html += '</div>';

      return html;
    })
    .join('\n');
}
