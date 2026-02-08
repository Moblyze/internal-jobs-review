# AI-Powered Job Description Parser

## Overview

The AI Description Parser is a utility service that uses Claude API to intelligently restructure messy job descriptions into clean, semantic, mobile-friendly sections.

**Location:** `/src/utils/aiDescriptionParser.js`

## Problem It Solves

Many job descriptions scraped from external sources are poorly formatted "blobs" with:
- No clear section structure
- Long, dense paragraphs that are hard to scan on mobile
- Redundant marketing fluff ("Do you enjoy...", "Would you like...")
- Mixed content types (responsibilities + requirements + benefits all jumbled together)

The existing `contentFormatter.js` only handles explicit formatting markers (bullets, colons, headers). It cannot intelligently parse unstructured text.

## How It Works

1. Takes a raw job description string
2. Sends it to Claude API with structured formatting instructions
3. Claude analyzes the content and returns JSON with semantic sections
4. Each section has:
   - **title**: Clear section name (e.g., "Key Responsibilities", "Requirements")
   - **type**: Either "paragraph" (brief text) or "list" (bullet points)
   - **content**: String for paragraphs, array for lists

## Installation

### 1. Install Dependencies

```bash
npm install @anthropic-ai/sdk
```

### 2. Configure API Key

Get your Anthropic API key from [console.anthropic.com](https://console.anthropic.com/)

Add to `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
```

## Usage

### Basic Usage

```javascript
import { restructureJobDescription } from './utils/aiDescriptionParser.js';

// Raw, messy description
const rawDescription = `Do you enjoy working on Supply Chain projects?
Would you like the opportunity to work for oilfield services company?
Join our team...`;

// Restructure with AI
const structured = await restructureJobDescription(rawDescription);

if (!structured.error) {
  // Successfully parsed
  structured.sections.forEach(section => {
    console.log(section.title); // e.g., "Key Responsibilities"

    if (section.type === 'list') {
      section.content.forEach(item => console.log('• ' + item));
    } else {
      console.log(section.content);
    }
  });
} else {
  // Error occurred, use fallback
  console.error('Parsing failed:', structured.error);
}
```

### Check If Available

```javascript
import { isAiParsingAvailable } from './utils/aiDescriptionParser.js';

if (isAiParsingAvailable()) {
  // API key configured, can use AI parsing
  const structured = await restructureJobDescription(description);
} else {
  // Fallback to traditional parser
  const formatted = formatJobDescription(description);
}
```

### Custom Options

```javascript
const structured = await restructureJobDescription(rawDescription, {
  model: 'claude-3-5-sonnet-20241022', // Default model
  maxTokens: 2048,                      // Default max tokens
  timeout: 30000,                       // 30 second timeout
});
```

## Output Format

### Example Structured Output

```json
{
  "sections": [
    {
      "title": "Role Overview",
      "type": "paragraph",
      "content": "As the Supply Chain Localization Leader you will lead and execute an integrated strategy..."
    },
    {
      "title": "Key Responsibilities",
      "type": "list",
      "content": [
        "Develop and execute Supply Chain Localization Strategy",
        "Perform analysis of current supply chain practices",
        "Revamp supply chain for local sourcing"
      ]
    },
    {
      "title": "Requirements",
      "type": "list",
      "content": [
        "Bachelor's degree in Supply Chain, Engineering, Procurement or Business",
        "Minimum 5 years in Supply Chain function",
        "Strong analytical and data-driven decision making"
      ]
    }
  ]
}
```

### Error Handling

If an error occurs, the function returns a fallback structure with the original text:

```json
{
  "sections": [
    {
      "title": "Description",
      "type": "paragraph",
      "content": "[original text]"
    }
  ],
  "error": "Request timeout"
}
```

## Testing

### Run Test Script

```bash
node scripts/test-ai-parser.js
```

This will:
1. Load the Baker Hughes Supply Chain Localization Leader job description
2. Send it to Claude API for restructuring
3. Display the structured output
4. Save results to `scripts/test-ai-parser-output.json`

### Expected Output

```
================================================================================
AI Job Description Parser - Test Script
================================================================================

✓ Anthropic API key configured

Testing with Baker Hughes Supply Chain Localization Leader job...

Original Description Length: 2544 characters
⏳ Calling Claude API to restructure description...
✓ API call completed in 3200ms

✓ Successfully restructured description

Found 5 sections:

1. Role Overview (paragraph)
   ...

2. Key Responsibilities (list)
   1. Develop and execute Supply Chain Localization Strategy...
   ...
```

## Integration with Existing Code

### Option 1: Replace contentFormatter

For new implementations, use AI parser directly:

```javascript
// Before
import { formatJobDescription } from './utils/contentFormatter.js';
const formatted = formatJobDescription(description);

// After
import { restructureJobDescription } from './utils/aiDescriptionParser.js';
const structured = await restructureJobDescription(description);
```

### Option 2: Hybrid Approach

Use AI parser for "blob" descriptions, fall back to traditional parser:

```javascript
import { formatJobDescription, isWellFormatted } from './utils/contentFormatter.js';
import { restructureJobDescription, isAiParsingAvailable } from './utils/aiDescriptionParser.js';

async function parseDescription(description) {
  // If already well-formatted, use simple parser
  if (isWellFormatted(description)) {
    return formatJobDescription(description);
  }

  // If AI available, use intelligent restructuring
  if (isAiParsingAvailable()) {
    const structured = await restructureJobDescription(description);

    // If no error, return AI result
    if (!structured.error) {
      return structured;
    }
  }

  // Fallback to traditional parser
  return formatJobDescription(description);
}
```

## Cost Considerations

- Model: Claude 3.5 Sonnet
- Average tokens per job: ~1500 input + ~1000 output = 2500 total
- Cost per job: ~$0.01 USD
- For 1000 jobs: ~$10 USD

**Recommendation:** Use AI parser only for poorly formatted descriptions. Cache results.

## Implementation Notes

### Server-Side Only

The Anthropic SDK requires server-side execution. Options:

1. **Pre-processing**: Run AI parser during job scraping/import
2. **API Endpoint**: Create backend endpoint that calls AI parser
3. **Build-time**: Process descriptions during build phase

**Current implementation uses server-side processing in Node.js scripts.**

### Caching Strategy

To minimize API costs:

```javascript
const cache = new Map();

async function getCachedStructuredDescription(jobId, description) {
  if (cache.has(jobId)) {
    return cache.get(jobId);
  }

  const structured = await restructureJobDescription(description);
  cache.set(jobId, structured);

  return structured;
}
```

### Error Handling

The parser gracefully handles:
- Network timeouts (30s default)
- Invalid API responses
- JSON parsing errors
- Missing/invalid sections

Always returns a valid structure, even on error (falls back to original text).

## Example: Baker Hughes Job

### Before (Raw)

```
Do you enjoy working on Supply Chain projects?

Would you like the opportunity to work for oilfield services company?

Join our team

Our Oilfield Services business provides intelligent, connected technologies...

Partner with the best

As the Supply Chain Localization Leader you will be responsible for leading...
```

### After (Structured)

```
Role Overview
  Lead and execute integrated Supply Chain Localization strategy under UAE
  Unified ICV Program v4.0, driving measurable ICV uplift and local value creation.

Key Responsibilities
  • Develop and execute Supply Chain Localization Strategy for Baker Hughes in UAE
  • Perform analysis of current supply chain practices and spend diagnostics
  • Revamp supply chain for local sourcing and supplier development
  • Engage with suppliers to support ICV certifications
  • Collaborate with cross-functional teams on localization strategy
  • Ensure compliance with MoIAT and ADNOC ICV frameworks
  • Identify and lead facility cost optimization projects

Requirements
  • Bachelor's degree in Supply Chain, Engineering, Procurement or Business
  • Minimum 5 years in Supply Chain function (Oil & Gas preferred)
  • Understanding of MoIAT and ADNOC In Country Value frameworks
  • Proven Supply Chain Localization and Supplier Development experience
  • Strong analytical and data-driven decision making
  • Ability to work in matrix organization with executive communication skills
```

## Future Enhancements

1. **Section Customization**: Allow custom section types (e.g., "Certifications", "Travel Requirements")
2. **Multi-language Support**: Parse job descriptions in other languages
3. **Batch Processing**: Process multiple jobs in parallel
4. **Intelligent Caching**: Store AI results in database with content hash
5. **Quality Scoring**: Rate description quality before/after parsing

## Support

For issues or questions:
- Check `.env` configuration
- Review test script output
- Check Anthropic API status
- Verify API key has sufficient credits

## References

- [Anthropic Claude API Docs](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)
- [Claude 3.5 Sonnet Model Card](https://docs.anthropic.com/claude/docs/models-overview)
