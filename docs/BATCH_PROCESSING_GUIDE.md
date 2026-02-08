# Batch Job Description Processing Guide

## Overview

The batch processing script (`scripts/process-descriptions.js`) processes all jobs in `jobs.json` and adds AI-restructured descriptions using the `structuredDescription` field.

This script is designed to be part of the data ingestion pipeline, allowing you to enhance job descriptions with structured, AI-parsed content for better presentation in the UI.

## Prerequisites

### 1. AI Parser Implementation

Before running the batch script, you need to create the AI description parser:

**Location:** `/src/utils/aiDescriptionParser.js`

**Required export:**
```javascript
export async function restructureJobDescription(rawDescription) {
  // Your AI parsing logic here
  return {
    summary: string,
    responsibilities: string[],
    requirements: string[],
    benefits: string[],
    workType: string,
    experienceLevel: string,
    sections: Object
  }
}
```

**Reference implementation:** See `src/utils/aiDescriptionParser.example.js`

### 2. Jobs Data

Ensure `public/data/jobs.json` exists and contains job objects with a `description` field.

## Installation

The script is already configured in `package.json`. No additional installation needed.

## Usage

### Basic Commands

```bash
# Process all jobs
npm run process-descriptions

# Test without saving (dry run)
npm run process-descriptions -- --dry-run

# Process first 10 jobs only
npm run process-descriptions -- --limit=10

# Skip jobs that already have structuredDescription
npm run process-descriptions -- --skip-processed
```

### Advanced Options

```bash
# Custom rate limiting (1000ms between requests)
npm run process-descriptions -- --rate-limit=1000

# Combine options
npm run process-descriptions -- --dry-run --limit=5 --skip-processed
```

## Command-Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--dry-run` | Test mode - no changes saved | `false` |
| `--limit=N` | Process only first N jobs | No limit |
| `--skip-processed` | Skip jobs with existing `structuredDescription` | `false` |
| `--rate-limit=MS` | Milliseconds between requests | `500` |

## Features

### 1. Resume Capability

The script can resume from where it left off:

```bash
# First run (processes 50 jobs then fails)
npm run process-descriptions

# Second run (skips the 50 already processed)
npm run process-descriptions -- --skip-processed
```

Jobs with existing `structuredDescription` field are automatically skipped when using `--skip-processed`.

### 2. Automatic Backups

Before processing, the script creates a backup:

```
public/data/jobs.backup.json
```

If something goes wrong, you can restore from this backup:

```bash
cp public/data/jobs.backup.json public/data/jobs.json
```

### 3. Progress Tracking

Visual progress bar shows real-time status:

```
[████████████████████████░░░░░░░░] 60.0% (15/25) ✓ Senior Software Engineer
```

Status indicators:
- `✓` Success
- `✗` Error
- `•` Processing

### 4. Error Logging

Failed jobs are logged to `logs/description-processing-errors.log`:

```
[2026-02-08T10:30:45.123Z] Job: baker-hughes-12345 | Title: Mechanical Engineer
  Error: API rate limit exceeded
  Stack: ...
```

### 5. Rate Limiting

Built-in rate limiting prevents API overload:

- Default: 500ms between requests
- Configurable with `--rate-limit` flag
- Auto-retry with backoff on failures

### 6. Periodic Saves

Progress is saved every 10 jobs to prevent data loss if the script crashes.

### 7. Retry Logic

Failed jobs are automatically retried up to 3 times with exponential backoff.

## Output Format

Each processed job gets a new `structuredDescription` field:

```json
{
  "id": "job-123",
  "title": "Senior Software Engineer",
  "description": "We are seeking a talented...",
  "structuredDescription": {
    "summary": "Senior role focusing on backend development...",
    "responsibilities": [
      "Design and implement scalable APIs",
      "Lead technical architecture decisions"
    ],
    "requirements": [
      "5+ years of backend development",
      "Strong knowledge of Node.js and Python"
    ],
    "benefits": [
      "Competitive salary",
      "Remote work options"
    ],
    "workType": "Full-time",
    "experienceLevel": "Senior"
  }
}
```

## Workflow Integration

### Development Workflow

```bash
# 1. Export jobs from database
npm run export-from-db

# 2. Process descriptions (test first)
npm run process-descriptions -- --dry-run --limit=5

# 3. Process all jobs
npm run process-descriptions

# 4. Geocode locations
npm run geocode-locations

# 5. Start dev server
npm run dev
```

### Production Pipeline

```bash
#!/bin/bash
# Automated data ingestion pipeline

echo "Exporting jobs..."
npm run export-jobs

echo "Processing descriptions..."
npm run process-descriptions --skip-processed

echo "Geocoding locations..."
npm run geocode-locations

echo "Building production bundle..."
npm run build

echo "Pipeline complete!"
```

## Troubleshooting

### Script Won't Run

**Error:** `AI parser not found`

**Solution:** Create `src/utils/aiDescriptionParser.js` with required export (see Prerequisites)

---

**Error:** `Jobs file not found`

**Solution:** Ensure `public/data/jobs.json` exists. Run `npm run export-jobs` first.

---

### API Rate Limits

**Symptom:** Many failed jobs with rate limit errors

**Solution:** Increase rate limit delay:

```bash
npm run process-descriptions -- --rate-limit=2000
```

---

### Script Crashes Mid-Process

**Solution:** The script saves progress every 10 jobs. Resume with:

```bash
npm run process-descriptions -- --skip-processed
```

Check `logs/description-processing-errors.log` for details.

---

### Invalid Parser Output

**Error:** `Invalid response from AI parser (expected object)`

**Solution:** Ensure your parser returns a proper object structure (see Output Format above)

---

## Performance Tips

### 1. Start Small

Test with a small batch first:

```bash
npm run process-descriptions -- --dry-run --limit=10
```

### 2. Monitor API Costs

If using a paid API (OpenAI, Anthropic), monitor token usage:

- Average job description: ~500-1000 tokens
- 1000 jobs ≈ 500k-1M tokens
- Check your API pricing

### 3. Optimize Rate Limits

Find the sweet spot between speed and reliability:

- Too fast → API errors
- Too slow → Unnecessarily long processing
- Test different values: 500ms, 1000ms, 2000ms

### 4. Use Local Models

For large-scale processing, consider local LLMs:

- **Ollama** - Run models locally
- **llama.cpp** - Fast inference
- No rate limits or API costs
- Requires setup and compute resources

## Best Practices

### 1. Version Control

**Do commit:**
- The script itself (`scripts/process-descriptions.js`)
- Updated `jobs.json` with `structuredDescription` fields
- Documentation updates

**Don't commit:**
- Backup files (`jobs.backup.json`)
- Error logs (`logs/*.log`)
- API keys (`.env`)

Add to `.gitignore`:

```
# Batch processing artifacts
public/data/*.backup.json
logs/description-processing-errors.log
```

### 2. Testing Strategy

```bash
# Step 1: Dry run with small sample
npm run process-descriptions -- --dry-run --limit=5

# Step 2: Real run with small sample
npm run process-descriptions -- --limit=5

# Step 3: Check output manually
# Review public/data/jobs.json

# Step 4: Process remainder
npm run process-descriptions -- --skip-processed
```

### 3. Monitoring

Monitor the process:

```bash
# In one terminal
npm run process-descriptions

# In another terminal
tail -f logs/description-processing-errors.log
```

## API Configuration Examples

### Using Anthropic Claude

```javascript
// src/utils/aiDescriptionParser.js
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.VITE_ANTHROPIC_API_KEY
})

export async function restructureJobDescription(rawDescription) {
  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Parse this job description into structured format: ${rawDescription}`
    }]
  })

  // Parse response and return structured format
  return parseClaudeResponse(response)
}
```

### Using OpenAI GPT

```javascript
// src/utils/aiDescriptionParser.js
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.VITE_OPENAI_API_KEY
})

export async function restructureJobDescription(rawDescription) {
  const response = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [{
      role: 'user',
      content: `Parse this job description: ${rawDescription}`
    }]
  })

  // Parse response and return structured format
  return parseGPTResponse(response)
}
```

## Future Enhancements

Potential improvements to the script:

1. **Parallel Processing** - Process multiple jobs concurrently
2. **Smart Batching** - Group similar jobs for more efficient API usage
3. **Caching** - Cache common patterns to reduce API calls
4. **Quality Checks** - Validate structured output quality
5. **Analytics** - Track processing metrics and costs
6. **Webhooks** - Notify when processing completes

## Support

If you encounter issues:

1. Check error logs: `logs/description-processing-errors.log`
2. Try dry-run mode: `npm run process-descriptions -- --dry-run`
3. Review parser implementation
4. Check API key configuration in `.env`

---

**Last Updated:** 2026-02-08
**Script Version:** 1.0.0
