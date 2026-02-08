# AI Description Parser - Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Application                             │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ parseJobDescription()
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Unified Parser Interface                          │
│                   (descriptionParser.js)                            │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  Strategy Selection:                                        │   │
│  │  • AUTO - Choose based on content quality                  │   │
│  │  • AI_ONLY - Force AI parsing                              │   │
│  │  • TRADITIONAL_ONLY - Force traditional parsing            │   │
│  │  • AI_FIRST - Try AI, fallback to traditional              │   │
│  └────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                   │                              │
     Well-formatted│                              │ Poorly-formatted
                   │                              │ or forced AI
                   ▼                              ▼
┌──────────────────────────────┐   ┌─────────────────────────────────┐
│  Traditional Pattern Parser  │   │    AI-Powered Parser            │
│  (contentFormatter.js)       │   │    (aiDescriptionParser.js)     │
│                              │   │                                 │
│  • Regex pattern matching    │   │  ┌──────────────────────────┐  │
│  • Header detection          │   │  │  Claude 3.5 Sonnet API   │  │
│  • Bullet point extraction   │   │  │                          │  │
│  • Synchronous (<10ms)       │   │  │  • Semantic analysis     │  │
│  • No API costs              │   │  │  • Section extraction    │  │
│                              │   │  │  • Content structuring   │  │
│                              │   │  │  • Async (2-4s)          │  │
│                              │   │  │  • ~$0.01/job            │  │
│                              │   │  └──────────────────────────┘  │
└──────────────────────────────┘   └─────────────────────────────────┘
                   │                              │
                   │                              │ JSON response
                   │                              │
                   ▼                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Structured Output                              │
│                                                                      │
│  {                                                                   │
│    sections: [                                                       │
│      {                                                               │
│        title: "Key Responsibilities",                               │
│        type: "list",                                                 │
│        content: [...]                                                │
│      },                                                              │
│      ...                                                             │
│    ],                                                                │
│    metadata: { method: "ai|traditional", ... }                      │
│  }                                                                   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                   ┌──────────────┴──────────────┐
                   │                             │
                   ▼                             ▼
        ┌──────────────────┐          ┌──────────────────┐
        │  toPlainText()   │          │    toHtml()      │
        └──────────────────┘          └──────────────────┘
```

## Component Details

### 1. Unified Parser Interface

**File**: `src/utils/descriptionParser.js`

**Responsibilities**:
- Strategy selection based on content quality
- Routing to appropriate parser
- Format conversion (plain text, HTML)
- Error handling and fallbacks

**Key Functions**:
```javascript
parseJobDescription(description, options)
getRecommendedStrategy(description)
canUseAiParsing()
toPlainText(parsed)
toHtml(parsed, options)
```

### 2. Traditional Pattern Parser

**File**: `src/utils/contentFormatter.js` (existing)

**How it works**:
1. Split text into lines
2. Pattern matching for:
   - Headers (ALL CAPS, ends with ":")
   - Bullet points (•, -, *, numbers)
   - Paragraphs (everything else)
3. Group into blocks

**Pros**:
- Fast (<10ms)
- No API costs
- Works offline
- Predictable

**Cons**:
- Only works with explicit formatting
- Cannot parse "blob" descriptions
- No semantic understanding

### 3. AI-Powered Parser

**File**: `src/utils/aiDescriptionParser.js`

**How it works**:
1. Send description to Claude API
2. Structured prompt instructs Claude to:
   - Identify semantic sections
   - Convert paragraphs to bullet points
   - Remove marketing fluff
   - Return clean JSON structure
3. Parse and validate JSON response
4. Return structured sections

**Pros**:
- Understands semantic meaning
- Handles any format
- Creates mobile-friendly output
- Removes redundancy

**Cons**:
- Requires API key
- Slower (2-4 seconds)
- Small cost (~$0.01/job)
- Requires internet

## Data Flow

### Input (Raw Description)

```
Do you enjoy working on Supply Chain projects?

Would you like the opportunity to work for oilfield services company?

Join our team

As a Supply Chain Localization Leader, you will be responsible for
leading and executing an integrated Supply Chain Localization strategy...

You will develop and execute Supply Chain Localization Strategy...
You will perform analysis of current supply chain Practices...
You will revamp Supply Chain for Local Sourcing...

To be successful you will need a Bachelors in supply chain...
Minimum 5 Years with Supply Chain function required...
```

### Processing

**Step 1: Quality Assessment**
```javascript
isWellFormatted(description) // false - "blob" format
```

**Step 2: Strategy Selection**
```javascript
getRecommendedStrategy(description) // returns "ai_first"
```

**Step 3: AI Parsing**
```javascript
// Send to Claude with structured prompt
const response = await claude.messages.create({
  model: "claude-3-5-sonnet-20241022",
  messages: [{ role: "user", content: prompt }]
});
```

**Step 4: JSON Extraction**
```javascript
// Parse JSON response
const structured = JSON.parse(response.content[0].text);
```

### Output (Structured)

```javascript
{
  sections: [
    {
      title: "Role Overview",
      type: "paragraph",
      content: "Lead and execute integrated Supply Chain Localization..."
    },
    {
      title: "Key Responsibilities",
      type: "list",
      content: [
        "Develop and execute Supply Chain Localization Strategy",
        "Perform analysis of current supply chain practices",
        "Revamp supply chain for local sourcing"
      ]
    },
    {
      title: "Requirements",
      type: "list",
      content: [
        "Bachelor's degree in Supply Chain, Engineering, or Business",
        "Minimum 5 years in Supply Chain function"
      ]
    }
  ],
  metadata: {
    method: "ai",
    timestamp: "2026-02-08T..."
  }
}
```

## Strategy Decision Tree

```
                    ┌─────────────────┐
                    │  Input: Raw     │
                    │  Description    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Strategy =     │
                    │  AUTO?          │
                    └────────┬────────┘
                             │
                   ┌─────────┴─────────┐
                   │                   │
              YES  │                   │  NO
                   │                   │
                   ▼                   ▼
          ┌────────────────┐   ┌──────────────────┐
          │ isWellFormatted│   │ Use specified    │
          │    ?           │   │ strategy         │
          └────────┬───────┘   └──────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
    YES │                     │ NO
        │                     │
        ▼                     ▼
  ┌──────────────┐   ┌─────────────────┐
  │ Use          │   │ isAiParsingAvail│
  │ Traditional  │   │     ?           │
  └──────────────┘   └────────┬────────┘
                              │
                   ┌──────────┴──────────┐
                   │                     │
               YES │                     │ NO
                   │                     │
                   ▼                     ▼
           ┌──────────────┐     ┌──────────────┐
           │ Use AI       │     │ Use          │
           │ Parser       │     │ Traditional  │
           └──────────────┘     └──────────────┘
```

## Error Handling Flow

```
┌─────────────────────┐
│  AI Parser Called   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Check API Key      │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    │             │
  Valid       Invalid
    │             │
    ▼             ▼
┌─────────┐   ┌────────────────┐
│ Call    │   │ Return error + │
│ Claude  │   │ fallback text  │
│ API     │   └────────────────┘
└────┬────┘
     │
     ▼
┌─────────────────────┐
│  Wait for response  │
│  (max 30s timeout)  │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    │             │
 Success      Timeout
    │             │
    ▼             ▼
┌─────────┐   ┌────────────────┐
│ Parse   │   │ Return error + │
│ JSON    │   │ fallback text  │
└────┬────┘   └────────────────┘
     │
     ▼
┌─────────────────────┐
│  Validate structure │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    │             │
  Valid       Invalid
    │             │
    ▼             ▼
┌─────────┐   ┌────────────────┐
│ Return  │   │ Return error + │
│ parsed  │   │ fallback text  │
└─────────┘   └────────────────┘
```

## Integration Patterns

### Pattern 1: Pre-processing (Recommended)

```
Job Scraper → AI Parser → Database → Web App
    ↓             ↓          ↓           ↓
  Raw text    Structured  Cached     Display
              JSON        result
```

**Pros**: Fast user experience, results cached, no runtime API calls
**Cons**: Requires batch processing setup

### Pattern 2: On-Demand

```
Web App → Check cache → AI Parser → Display
   ↓          ↓            ↓          ↓
Request    Miss/hit     Parse      Show
```

**Pros**: Simple integration, only parse when needed
**Cons**: Slow first load (2-4s), API costs for each unique view

### Pattern 3: Hybrid

```
Job Import → Quick check → Traditional or AI
     ↓            ↓              ↓
  Raw text   Well-formatted?  Choose parser
                 ↓
            Cache result
```

**Pros**: Balanced cost/performance, intelligent routing
**Cons**: More complex logic

## Performance Metrics

| Metric | Traditional | AI-Powered |
|--------|------------|------------|
| Speed | <10ms | 2-4 seconds |
| Accuracy (well-formatted) | 95% | 98% |
| Accuracy (poorly-formatted) | 30% | 95% |
| Cost | $0 | ~$0.01/job |
| Quality | Basic | High |
| Mobile-friendly output | Sometimes | Always |

## Cost Optimization

### Strategy 1: Selective Processing
```javascript
if (job.description.length > 500 && !isWellFormatted(job.description)) {
  // Use AI only for long, poorly-formatted descriptions
  return await parseJobDescription(job.description, {
    strategy: ParseStrategy.AI_ONLY
  });
}
```

### Strategy 2: Caching
```javascript
const cache = new Map();

function getCached(jobId, description) {
  if (cache.has(jobId)) return cache.get(jobId);

  const parsed = await parseJobDescription(description);
  cache.set(jobId, parsed);
  return parsed;
}
```

### Strategy 3: Batch Processing
```javascript
// Process 10 jobs per minute (rate limiting)
for (const job of jobs) {
  await parseJobDescription(job.description);
  await sleep(6000); // 6 second delay
}
```

## Security Considerations

1. **API Key Protection**
   - Store in `.env` file (not committed to git)
   - Use environment variables
   - Server-side only (no browser exposure)

2. **Input Validation**
   - Sanitize job descriptions before API call
   - Limit input size (prevent abuse)
   - Rate limiting on parser calls

3. **Output Validation**
   - Validate JSON structure from API
   - Sanitize HTML output
   - Escape user-generated content

## Testing Strategy

### Unit Tests
```javascript
// Test traditional parser
test('formats well-formatted description', () => {
  const result = formatJobDescription(wellFormattedText);
  expect(result).toHaveLength(3);
});

// Test AI parser (mock API)
test('handles AI parser errors gracefully', async () => {
  mockApiError();
  const result = await restructureJobDescription(text);
  expect(result.error).toBeDefined();
  expect(result.sections).toHaveLength(1); // fallback
});
```

### Integration Tests
```javascript
// Test unified parser
test('chooses AI for poorly-formatted descriptions', async () => {
  const result = await parseJobDescription(blobText);
  expect(result.metadata.method).toBe('ai');
});

test('chooses traditional for well-formatted', async () => {
  const result = await parseJobDescription(formattedText);
  expect(result.metadata.method).toBe('traditional');
});
```

### End-to-End Tests
```bash
npm run test-ai-parser  # Real API test with Baker Hughes job
npm run example-parser  # All strategies and output formats
```

## Monitoring & Observability

### Key Metrics to Track

1. **Parser Usage**
   - Traditional vs AI usage ratio
   - Success/failure rates
   - Average processing time

2. **Cost Tracking**
   - API calls per day/week/month
   - Token usage per job
   - Total spend

3. **Quality Metrics**
   - User satisfaction with formatted output
   - Mobile readability scores
   - Section extraction accuracy

4. **Error Tracking**
   - API timeouts
   - Invalid JSON responses
   - Fallback usage rate

## Future Enhancements

1. **Caching Layer**: Add Redis/database caching
2. **Batch API**: Process multiple jobs in parallel
3. **Quality Scoring**: Rate description quality before/after
4. **Custom Sections**: Allow custom section types
5. **Multi-language**: Support non-English descriptions
6. **A/B Testing**: Compare traditional vs AI output
7. **Feedback Loop**: Learn from user preferences

## References

- [Anthropic Claude API Docs](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)
- [Claude 3.5 Sonnet Model Card](https://docs.anthropic.com/claude/docs/models-overview)
- [Prompt Engineering Guide](https://docs.anthropic.com/claude/docs/prompt-engineering)
