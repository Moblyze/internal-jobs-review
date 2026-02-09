import { useState } from 'react'
import { ensureCleanText } from '../utils/htmlCleaner'

/**
 * StructuredJobDescription Component
 *
 * Renders job descriptions with support for both:
 * 1. Legacy format: Array of blocks (header, list, paragraph)
 * 2. AI-structured format: Sections with semantic types
 *
 * Features:
 * - Mobile-first responsive design
 * - Collapsible sections for long content
 * - Icons for different section types
 * - Graceful handling of missing sections
 */

// Section type icons and colors
const SECTION_STYLES = {
  responsibilities: {
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
      </svg>
    ),
    color: 'blue',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    iconColor: 'text-blue-600'
  },
  requirements: {
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
    color: 'purple',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    iconColor: 'text-purple-600'
  },
  qualifications: {
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
      </svg>
    ),
    color: 'indigo',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    iconColor: 'text-indigo-600'
  },
  benefits: {
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
      </svg>
    ),
    color: 'green',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    iconColor: 'text-green-600'
  },
  compensation: {
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
      </svg>
    ),
    color: 'green',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    iconColor: 'text-green-600'
  },
  default: {
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
      </svg>
    ),
    color: 'gray',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    iconColor: 'text-gray-600'
  }
}

/**
 * Determines the style configuration for a section based on its title or type
 */
function getSectionStyle(section) {
  const title = (section.title || section.content || '').toLowerCase()

  if (title.includes('responsibilit') || title.includes('duties')) {
    return SECTION_STYLES.responsibilities
  }
  if (title.includes('requirement') || title.includes('must have')) {
    return SECTION_STYLES.requirements
  }
  if (title.includes('qualification') || title.includes('education') || title.includes('experience')) {
    return SECTION_STYLES.qualifications
  }
  if (title.includes('benefit') || title.includes('we offer') || title.includes('perks')) {
    return SECTION_STYLES.benefits
  }
  if (title.includes('compensation') || title.includes('salary') || title.includes('pay')) {
    return SECTION_STYLES.compensation
  }

  return SECTION_STYLES.default
}

/**
 * CollapsibleSection Component
 * Renders a section that can be expanded/collapsed
 */
function CollapsibleSection({ section, children, style }) {
  const [isExpanded, setIsExpanded] = useState(true)

  return (
    <div className={`rounded-lg border ${style.borderColor} ${style.bgColor} overflow-hidden`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-opacity-80 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={style.iconColor}>{style.icon}</span>
          <h3 className="text-lg font-semibold text-gray-900 text-left">
            {section.title || section.content}
          </h3>
        </div>
        <svg
          className={`w-5 h-5 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pt-1">
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * Renders a list block
 */
function ListBlock({ items }) {
  return (
    <ul className="space-y-2 ml-2">
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2">
          <span className="text-blue-600 mt-1.5 flex-shrink-0">
            <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 8 8">
              <circle cx="4" cy="4" r="3" />
            </svg>
          </span>
          <span className="text-gray-700 leading-relaxed flex-1">{ensureCleanText(item)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Renders a paragraph block
 */
function ParagraphBlock({ content }) {
  return (
    <p className="text-gray-700 leading-relaxed">
      {ensureCleanText(content)}
    </p>
  )
}

/**
 * Renders legacy format blocks (header, list, paragraph)
 */
function LegacyFormatRenderer({ blocks }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'header':
            return (
              <h3 key={index} className="text-lg font-semibold text-gray-900 mt-6 mb-3 first:mt-0">
                {block.content}
              </h3>
            )
          case 'list':
            return <ListBlock key={index} items={block.items} />
          case 'paragraph':
            return <ParagraphBlock key={index} content={block.content} />
          default:
            return null
        }
      })}
    </div>
  )
}

/**
 * Renders AI-structured format sections
 */
function StructuredFormatRenderer({ sections, collapsible = true }) {
  if (!sections || sections.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      {sections.map((section, index) => {
        const style = getSectionStyle(section)

        // Render section content based on its structure
        const content = section.items ? (
          <ListBlock items={section.items} />
        ) : section.type === 'list' && Array.isArray(section.content) ? (
          <ListBlock items={section.content} />
        ) : section.paragraphs ? (
          <div className="space-y-3">
            {section.paragraphs.map((para, paraIndex) => (
              <ParagraphBlock key={paraIndex} content={para} />
            ))}
          </div>
        ) : section.content && typeof section.content === 'string' ? (
          <ParagraphBlock content={section.content} />
        ) : section.blocks ? (
          <LegacyFormatRenderer blocks={section.blocks} />
        ) : null

        // If collapsible and has content, wrap in CollapsibleSection
        if (collapsible && content) {
          return (
            <CollapsibleSection key={index} section={section} style={style}>
              {content}
            </CollapsibleSection>
          )
        }

        // Otherwise render as a simple section
        return (
          <div key={index} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={style.iconColor}>{style.icon}</span>
              <h3 className="text-lg font-semibold text-gray-900">
                {section.title}
              </h3>
            </div>
            {content}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Main StructuredJobDescription Component
 */
function StructuredJobDescription({
  description,
  collapsible = true,
  className = ''
}) {
  // Handle null/undefined
  if (!description) {
    return null
  }

  // Determine format type
  const isLegacyArray = Array.isArray(description) &&
    description.length > 0 &&
    (description[0].type === 'header' || description[0].type === 'list' || description[0].type === 'paragraph')

  const isStructuredFormat = Array.isArray(description) &&
    description.length > 0 &&
    (description[0].title || description[0].sections)

  const isStructuredObject = description.sections && Array.isArray(description.sections)

  return (
    <div className={`prose prose-sm max-w-none ${className}`}>
      {isLegacyArray ? (
        <LegacyFormatRenderer blocks={description} />
      ) : isStructuredFormat ? (
        <StructuredFormatRenderer sections={description} collapsible={collapsible} />
      ) : isStructuredObject ? (
        <StructuredFormatRenderer sections={description.sections} collapsible={collapsible} />
      ) : typeof description === 'string' ? (
        // Fallback for plain text
        <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{ensureCleanText(description)}</p>
      ) : (
        // Unknown format
        <p className="text-gray-500 italic">Unable to display job description format</p>
      )}
    </div>
  )
}

export default StructuredJobDescription
