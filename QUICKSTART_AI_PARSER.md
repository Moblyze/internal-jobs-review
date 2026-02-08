# AI Description Parser - Quick Start Guide

## 5-Minute Setup

### 1. Get Your API Key (1 minute)

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Create a new API key
4. Copy the key (starts with `sk-ant-api03-...`)

### 2. Configure Environment (30 seconds)

Open `.env` file and add your key:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-your-actual-key-here
```

### 3. Test the Parser (2 minutes)

Run the test script:

```bash
npm run test-ai-parser
```

You should see:

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
   Lead and execute integrated Supply Chain Localization strategy...

2. Key Responsibilities (list)
   1. Develop and execute Supply Chain Localization Strategy...
   2. Perform analysis of current supply chain practices...
   ...
```

### 4. Try the Examples (1 minute)

Run comprehensive examples:

```bash
npm run example-parser
```

## Basic Usage

### Simple Example

```javascript
import { parseJobDescription } from './src/utils/descriptionParser.js';

// This messy description...
const rawDescription = `
Do you enjoy working on projects?
Join our team!
You will do stuff. You will also do other stuff.
Requirements: degree, experience.
`;

// ...becomes this clean structure
const parsed = await parseJobDescription(rawDescription);

console.log(parsed.sections);
// [
//   { title: "Role Overview", type: "paragraph", content: "..." },
//   { title: "Responsibilities", type: "list", content: ["...", "..."] },
//   { title: "Requirements", type: "list", content: ["...", "..."] }
// ]
```

### Display the Sections

```javascript
parsed.sections.forEach(section => {
  console.log(`\n${section.title}`);
  console.log('='.repeat(section.title.length));

  if (section.type === 'list') {
    section.content.forEach(item => console.log(`  • ${item}`));
  } else {
    console.log(section.content);
  }
});
```

## Common Use Cases

### Use Case 1: Check Quality First

```javascript
import { getRecommendedStrategy, parseJobDescription } from './src/utils/descriptionParser.js';

// Get recommendation based on content quality
const strategy = getRecommendedStrategy(description);
console.log(`Recommended: ${strategy}`); // "ai_first" or "traditional_only"

// Parse using recommended strategy
const parsed = await parseJobDescription(description, { strategy });
```

### Use Case 2: Force AI for All Jobs

```javascript
import { parseJobDescription, ParseStrategy } from './src/utils/descriptionParser.js';

const parsed = await parseJobDescription(description, {
  strategy: ParseStrategy.AI_ONLY
});

if (parsed.metadata.error) {
  console.error('AI parsing failed:', parsed.metadata.error);
} else {
  console.log('Successfully parsed with AI');
}
```

### Use Case 3: Fast Traditional Parsing Only

```javascript
import { parseJobDescription, ParseStrategy } from './src/utils/descriptionParser.js';

// Use traditional parser (no API calls, synchronous)
const parsed = await parseJobDescription(description, {
  strategy: ParseStrategy.TRADITIONAL_ONLY
});

console.log(`Parsed in ${Date.now() - start}ms`); // <10ms
```

### Use Case 4: Convert to HTML

```javascript
import { parseJobDescription, toHtml } from './src/utils/descriptionParser.js';

const parsed = await parseJobDescription(description);

// Generate HTML with custom styling
const html = toHtml(parsed, {
  headerTag: 'h3',
  className: 'job'
});

// Result:
// <div class="job-section">
//   <h3 class="job-title">Key Responsibilities</h3>
//   <ul class="job-list">
//     <li>First responsibility</li>
//     <li>Second responsibility</li>
//   </ul>
// </div>
```

### Use Case 5: Batch Process Jobs

```javascript
import { parseJobDescription } from './src/utils/descriptionParser.js';
import jobs from './public/data/jobs.json';

async function processAllJobs() {
  for (const job of jobs) {
    console.log(`Processing: ${job.title}`);

    // Parse description
    const structured = await parseJobDescription(job.description);

    // Save structured version
    job.structuredDescription = structured;

    // Rate limiting (important!)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return jobs;
}
```

## Output Format

All parsers return the same structure:

```javascript
{
  sections: [
    {
      title: "Section Name",           // e.g., "Key Responsibilities"
      type: "paragraph" | "list",       // paragraph or list
      content: string | string[]        // string for paragraph, array for list
    },
    // ... more sections
  ],
  metadata: {
    method: "ai" | "traditional",       // which parser was used
    timestamp: "2026-02-08T...",        // when parsed
    error?: string                      // error message if failed
  }
}
```

## Strategies Explained

| Strategy | When to Use | Speed | Cost |
|----------|------------|-------|------|
| **AUTO** (default) | Most cases - automatically chooses best method | Fast or Slow | $0 or ~$0.01 |
| **AI_ONLY** | Force AI for all jobs | Slow (2-4s) | ~$0.01/job |
| **TRADITIONAL_ONLY** | Fast processing, no API needed | Fast (<10ms) | $0 |
| **AI_FIRST** | Try AI, fallback to traditional on error | Slow (2-4s) | ~$0.01/job |

## Cost Management

### Estimate Your Costs

```javascript
const jobCount = 1000;
const poorlyFormattedPercent = 0.3; // 30% need AI parsing
const costPerJob = 0.01; // $0.01 per job

const totalCost = jobCount * poorlyFormattedPercent * costPerJob;
console.log(`Estimated cost: $${totalCost.toFixed(2)}`);
// Estimated cost: $3.00
```

### Save Money

1. **Use AUTO strategy** - Only parses poorly-formatted jobs with AI
2. **Cache results** - Store parsed descriptions, don't re-parse
3. **Rate limit** - Add delays between API calls
4. **Filter first** - Only parse jobs that need it

```javascript
// Example: Only parse if description is long and poorly formatted
if (description.length > 500 && !isWellFormatted(description)) {
  parsed = await parseJobDescription(description);
} else {
  // Use fast traditional parser
  parsed = await parseJobDescription(description, {
    strategy: ParseStrategy.TRADITIONAL_ONLY
  });
}
```

## Troubleshooting

### Error: API key not configured

**Problem**: `ANTHROPIC_API_KEY` not set or invalid

**Solution**:
1. Check `.env` file exists
2. Verify key starts with `sk-ant-api03-`
3. Restart dev server after changing `.env`

```bash
# Check current value
cat .env | grep ANTHROPIC_API_KEY

# Test if key is loaded
npm run test-ai-parser
```

### Error: Request timeout

**Problem**: API call taking too long (>30s)

**Solution**: Increase timeout

```javascript
const parsed = await parseJobDescription(description, {
  aiOptions: {
    timeout: 60000 // 60 seconds
  }
});
```

### Error: Invalid JSON response

**Problem**: Claude returned malformed JSON

**Solution**: This is handled automatically with fallback, but you can:
1. Check console for error details
2. The original text will be returned
3. Try again with a shorter description

### High API costs

**Problem**: Too many API calls

**Solution**:
1. Use `AUTO` strategy instead of `AI_ONLY`
2. Add caching layer
3. Only process new jobs, not entire database repeatedly
4. Add rate limiting

## File Reference

### Core Files

| File | Purpose |
|------|---------|
| `src/utils/aiDescriptionParser.js` | Core AI parser with Claude API |
| `src/utils/descriptionParser.js` | Unified interface with strategies |
| `src/utils/contentFormatter.js` | Traditional pattern-based parser |

### Test/Example Files

| File | Command | Purpose |
|------|---------|---------|
| `scripts/test-ai-parser.js` | `npm run test-ai-parser` | Test AI parser with real job |
| `scripts/example-unified-parser.js` | `npm run example-parser` | All strategies and examples |

### Documentation

| File | Content |
|------|---------|
| `docs/AI_DESCRIPTION_PARSER.md` | Complete usage guide |
| `docs/AI_PARSER_ARCHITECTURE.md` | System architecture and design |
| `AI_PARSER_IMPLEMENTATION.md` | Implementation summary |
| `QUICKSTART_AI_PARSER.md` | This file |

## Next Steps

1. ✅ **Setup complete?** - API key configured, tests passing
2. 📖 **Read docs** - See `docs/AI_DESCRIPTION_PARSER.md` for details
3. 🏗️ **Integrate** - Add to your job import/display pipeline
4. 🧪 **Test** - Try with your actual job data
5. 🚀 **Deploy** - Roll out to production

## Getting Help

### Check Logs

```bash
# Run with verbose output
DEBUG=* npm run test-ai-parser

# Check last error
tail -f logs/ai-parser.log
```

### Common Issues

1. **API key rejected** - Key may be expired or invalid
2. **Rate limited** - Too many requests, add delays
3. **Timeout** - Network issue or large input
4. **Invalid output** - Claude returned unexpected format (auto-fallback handles this)

### Support Resources

- Anthropic API Status: [status.anthropic.com](https://status.anthropic.com/)
- Claude API Docs: [docs.anthropic.com](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)
- Project Documentation: `docs/AI_DESCRIPTION_PARSER.md`

## Quick Reference Card

```javascript
// Import
import { parseJobDescription, ParseStrategy, toHtml } from './src/utils/descriptionParser.js';

// Parse (auto-select best method)
const parsed = await parseJobDescription(description);

// Parse with specific strategy
const parsed = await parseJobDescription(description, {
  strategy: ParseStrategy.AI_ONLY
});

// Convert to HTML
const html = toHtml(parsed, { className: 'job' });

// Check if AI available
import { canUseAiParsing } from './src/utils/descriptionParser.js';
if (canUseAiParsing()) { /* ... */ }

// Get recommended strategy
import { getRecommendedStrategy } from './src/utils/descriptionParser.js';
const strategy = getRecommendedStrategy(description);
```

## Success Checklist

- [ ] API key configured in `.env`
- [ ] Test script runs successfully (`npm run test-ai-parser`)
- [ ] Examples work (`npm run example-parser`)
- [ ] Can parse job descriptions
- [ ] Can convert to HTML
- [ ] Understand cost implications
- [ ] Know which strategy to use

**All checked? You're ready to go!** 🚀
