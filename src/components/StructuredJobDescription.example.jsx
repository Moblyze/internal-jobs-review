/**
 * Example Usage of StructuredJobDescription Component
 *
 * This file demonstrates how to use the StructuredJobDescription component
 * with different data formats.
 */

import StructuredJobDescription from './StructuredJobDescription'

// Example 1: Legacy format (from current contentFormatter)
const legacyFormatExample = [
  {
    type: 'header',
    content: 'Responsibilities'
  },
  {
    type: 'list',
    items: [
      'Design and implement scalable backend services',
      'Collaborate with cross-functional teams',
      'Participate in code reviews and technical discussions'
    ]
  },
  {
    type: 'header',
    content: 'Requirements'
  },
  {
    type: 'list',
    items: [
      '5+ years of experience in software development',
      'Strong knowledge of Go, Python, or Java',
      'Experience with cloud platforms (AWS, GCP, Azure)'
    ]
  },
  {
    type: 'paragraph',
    content: 'We offer competitive compensation and comprehensive benefits package.'
  }
]

// Example 2: AI-structured format (new format)
const aiStructuredExample = [
  {
    title: 'Key Responsibilities',
    items: [
      'Design and implement scalable backend services using Go',
      'Collaborate with product and design teams to deliver features',
      'Mentor junior engineers and conduct code reviews',
      'Participate in on-call rotation for production systems'
    ]
  },
  {
    title: 'Required Qualifications',
    items: [
      '5+ years of experience in backend software development',
      'Strong proficiency in Go and distributed systems',
      'Experience with Kubernetes and Docker',
      'Excellent communication and collaboration skills'
    ]
  },
  {
    title: 'Benefits',
    paragraphs: [
      'We offer a comprehensive benefits package including health insurance, 401k matching, and unlimited PTO.',
      'Our team values work-life balance and offers flexible remote work options.'
    ]
  },
  {
    title: 'About the Team',
    content: 'Join our growing engineering team working on cutting-edge technology in the energy sector. We build products that connect skilled workers with meaningful careers.'
  }
]

// Example 3: Nested structured format
const nestedStructuredExample = {
  sections: [
    {
      title: 'Role Overview',
      blocks: [
        {
          type: 'paragraph',
          content: 'We are seeking a Senior Go Developer to join our backend team.'
        }
      ]
    },
    {
      title: 'Responsibilities',
      items: [
        'Build and maintain API services',
        'Optimize database queries and system performance',
        'Write comprehensive tests and documentation'
      ]
    }
  ]
}

// Usage in a component
function ExampleJobPage() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Example Job Descriptions</h1>

      {/* Legacy format */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Legacy Format</h2>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <StructuredJobDescription description={legacyFormatExample} />
        </div>
      </section>

      {/* AI-structured format with collapsible sections */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">AI-Structured Format (Collapsible)</h2>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <StructuredJobDescription
            description={aiStructuredExample}
            collapsible={true}
          />
        </div>
      </section>

      {/* AI-structured format without collapsible sections */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">AI-Structured Format (Expanded)</h2>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <StructuredJobDescription
            description={aiStructuredExample}
            collapsible={false}
          />
        </div>
      </section>

      {/* Nested format */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Nested Structured Format</h2>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <StructuredJobDescription description={nestedStructuredExample} />
        </div>
      </section>

      {/* Plain text fallback */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Plain Text Fallback</h2>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <StructuredJobDescription
            description="This is a simple plain text job description. It will be rendered as-is with basic formatting."
          />
        </div>
      </section>
    </div>
  )
}

export default ExampleJobPage
