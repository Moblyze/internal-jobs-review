# Quick Start: Batch Job Description Processing

## 1-Minute Setup

### Prerequisites

✅ **ALREADY IMPLEMENTED!** The AI parser exists at `src/utils/aiDescriptionParser.js`

Just add your Anthropic API key to `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

The parser is production-ready and returns structured sections format.

## Quick Commands

```bash
# Test with 5 jobs (no changes saved)
npm run process-descriptions -- --dry-run --limit=5

# Process all jobs
npm run process-descriptions

# Process only new jobs (skip already processed)
npm run process-descriptions -- --skip-processed
```

## What It Does

```
Input (jobs.json):
{
  "id": "job-123",
  "title": "Software Engineer",
  "description": "Long raw text blob with poor formatting..."
}

Output (jobs.json):
{
  "id": "job-123",
  "title": "Software Engineer",
  "description": "Long raw text blob with poor formatting...",
  "structuredDescription": {
    "sections": [
      {
        "title": "Role Overview",
        "type": "paragraph",
        "content": "Brief overview of the role..."
      },
      {
        "title": "Key Responsibilities",
        "type": "list",
        "content": ["Build scalable APIs", "Lead architecture", "..."]
      },
      {
        "title": "Requirements",
        "type": "list",
        "content": ["5+ years experience", "Node.js expertise", "..."]
      }
    ]
  }
}
```

## Common Options

| Command | Description |
|---------|-------------|
| `--dry-run` | Test without saving |
| `--limit=N` | Process first N jobs |
| `--skip-processed` | Skip jobs with existing data |
| `--rate-limit=MS` | Delay between API calls |

## Files Created

```
public/data/
  ├── jobs.json              ← Updated with structuredDescription
  └── jobs.backup.json       ← Auto-backup (restore if needed)

logs/
  └── description-processing-errors.log  ← Error details
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "AI parser not found" | Create `src/utils/aiDescriptionParser.js` |
| "Jobs file not found" | Run `npm run export-jobs` first |
| Rate limit errors | Increase delay: `--rate-limit=2000` |
| Script crashes | Resume: `--skip-processed` |

## Full Documentation

See `/docs/BATCH_PROCESSING_GUIDE.md` for complete details.

## Example Workflow

```bash
# 1. Test with small batch
npm run process-descriptions -- --dry-run --limit=3

# 2. Check output looks good
cat public/data/jobs.json | grep structuredDescription

# 3. Process all jobs
npm run process-descriptions

# 4. Monitor progress
# Watch the progress bar: [████░░] 65%

# 5. If it fails, resume
npm run process-descriptions -- --skip-processed
```

## Quick Tips

✅ Always test with `--dry-run` first
✅ Start small with `--limit=10`
✅ Monitor API costs (especially OpenAI/Anthropic)
✅ Backup is automatic but check `jobs.backup.json` exists
✅ Errors are logged - check `logs/` if jobs fail

## Support

- **Script issues:** Check `logs/description-processing-errors.log`
- **Parser issues:** Review `src/utils/aiDescriptionParser.example.js`
- **API issues:** Verify `.env` has correct API keys

---

**Ready to start?**

```bash
npm run process-descriptions -- --dry-run --limit=5
```
