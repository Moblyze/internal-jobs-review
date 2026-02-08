# StructuredJobDescription Component

A beautiful, mobile-friendly React component for rendering structured job descriptions with support for both legacy and AI-enhanced formats.

## Features

- **Multiple Format Support**: Handles legacy block format, AI-structured format, and plain text
- **Mobile-First Design**: Responsive layout using Tailwind CSS
- **Collapsible Sections**: Optional expandable/collapsible sections for better UX
- **Semantic Icons**: Different icons for section types (responsibilities, requirements, benefits, etc.)
- **Visual Hierarchy**: Clear section headers, proper spacing, and visual separators
- **Graceful Fallbacks**: Handles missing or malformed data elegantly

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `description` | `Array \| Object \| string` | required | The job description data in any supported format |
| `collapsible` | `boolean` | `true` | Whether sections should be collapsible |
| `className` | `string` | `''` | Additional CSS classes to apply |

## Supported Formats

### 1. Legacy Format (Current)

Array of blocks with types: `header`, `list`, `paragraph`

```javascript
const description = [
  { type: 'header', content: 'Responsibilities' },
  { type: 'list', items: ['Task 1', 'Task 2'] },
  { type: 'paragraph', content: 'Additional context...' }
]
```

### 2. AI-Structured Format (New)

Array of sections with semantic structure:

```javascript
const description = [
  {
    title: 'Key Responsibilities',
    items: ['Responsibility 1', 'Responsibility 2']
  },
  {
    title: 'Requirements',
    paragraphs: ['Paragraph 1', 'Paragraph 2']
  },
  {
    title: 'Benefits',
    content: 'Single paragraph content'
  }
]
```

### 3. Nested Structured Format

Object with sections array:

```javascript
const description = {
  sections: [
    {
      title: 'Section Title',
      items: [...],
      // or paragraphs: [...],
      // or content: 'text',
      // or blocks: [...]
    }
  ]
}
```

### 4. Plain Text (Fallback)

```javascript
const description = "Plain text description..."
```

## Usage

### Basic Usage

```jsx
import StructuredJobDescription from './components/StructuredJobDescription'

function JobDetailPage() {
  const formattedDescription = formatJobDescription(job.description)

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Job Description</h2>
      <StructuredJobDescription description={formattedDescription} />
    </div>
  )
}
```

### With Custom Styling

```jsx
<StructuredJobDescription
  description={aiStructuredDescription}
  collapsible={false}
  className="text-lg"
/>
```

## Integration with JobDetailPage.jsx

Replace the current description rendering code (lines 112-183) with:

```jsx
import StructuredJobDescription from '../components/StructuredJobDescription'

// ... in the component
<div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
  <h2 className="text-xl font-semibold text-gray-900 mb-4">Job Description</h2>
  <StructuredJobDescription description={formattedDescription} />

  {/* Keep existing skills section */}
  {(() => {
    const validSkills = filterValidSkills(job.skills);
    if (validSkills.length === 0) return null;

    return (
      <div className="mt-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Required Skills</h3>
        <div className="flex flex-wrap gap-2">
          {validSkills.map((skill, index) => (
            <span
              key={index}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
            >
              {skill}
            </span>
          ))}
        </div>
      </div>
    );
  })()}

  {/* Keep existing apply button */}
  <div className="mt-6 pt-6 border-t border-gray-200">
    <a
      href={job.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
    >
      View Original Posting
      <svg className="ml-2 -mr-1 w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd"></path>
      </svg>
    </a>
  </div>
</div>
```

## Section Type Detection

The component automatically detects section types based on title keywords:

| Section Type | Keywords | Icon | Color |
|-------------|----------|------|-------|
| Responsibilities | "responsibilit", "duties" | Calendar | Blue |
| Requirements | "requirement", "must have" | Checkmark | Purple |
| Qualifications | "qualification", "education", "experience" | Graduation Cap | Indigo |
| Benefits | "benefit", "we offer", "perks" | Heart | Green |
| Compensation | "compensation", "salary", "pay" | Dollar Sign | Green |
| Default | (others) | Info | Gray |

## Styling

The component uses Tailwind CSS classes and follows the existing design patterns from the project:

- Section headers: `text-lg font-semibold text-gray-900`
- Body text: `text-gray-700 leading-relaxed`
- List items: Custom bullet points with `text-blue-600`
- Collapsible sections: Colored backgrounds and borders matching section type

## Mobile Responsiveness

- Touch-friendly collapsible sections
- Adequate spacing for mobile screens
- Readable font sizes and line heights
- Icons that scale appropriately

## Examples

See `StructuredJobDescription.example.jsx` for comprehensive usage examples.

## Future Enhancements

Potential improvements:

- Add animation to collapse/expand transitions
- Support for nested lists
- Support for inline formatting (bold, links, etc.)
- Print-friendly styling
- Dark mode support
- Accessibility improvements (ARIA labels, keyboard navigation)
