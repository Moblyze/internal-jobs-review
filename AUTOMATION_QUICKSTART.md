# Job Processing Automation - Quick Start

## One-Command Setup

```bash
# Run the full automated pipeline
npm run sync-process
```

This single command:
1. ✅ Fetches latest jobs from Google Sheets
2. ✅ Identifies new/unprocessed jobs
3. ✅ Runs AI processing (only on new jobs)
4. ✅ Saves results to jobs.json

## Common Commands

```bash
# Test run (no changes)
npm run sync-process -- --dry-run

# Process only, skip export
npm run sync-process -- --skip-export

# Limit to 10 jobs (for testing)
npm run sync-process -- --limit=10
```

## Set Up Daily Automation

**macOS/Linux (cron):**

```bash
# Edit crontab
crontab -e

# Add this line (runs daily at 2 AM)
0 2 * * * cd /Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web && /usr/local/bin/npm run sync-process >> logs/sync.log 2>&1
```

**Windows (Task Scheduler):**

1. Create task: Daily at 2:00 AM
2. Program: `npm.cmd`
3. Arguments: `run sync-process`
4. Start in: `C:\path\to\moblyze-jobs-web`

## Cost Estimate

- **Per job**: ~$0.01
- **10 new jobs/day**: ~$3/month
- **50 new jobs/day**: ~$15/month

Only pays for NEW jobs (never re-processes existing).

## Check Status

```bash
# View last run
tail logs/sync-process.log

# Check unprocessed count
npm run sync-process -- --dry-run --skip-export
```

## What It Does

- ✅ Never re-processes jobs with `structuredDescription`
- ✅ Auto-saves progress every 10 jobs
- ✅ Creates backup before processing
- ✅ Rate-limited (500ms between AI calls)
- ✅ Detailed logging to `logs/`

## Full Documentation

See [docs/JOB_INGESTION_PIPELINE.md](./docs/JOB_INGESTION_PIPELINE.md) for complete details.
