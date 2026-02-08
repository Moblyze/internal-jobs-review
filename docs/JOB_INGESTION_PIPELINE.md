# Job Ingestion and AI Processing Pipeline

## Overview

Automated pipeline that fetches job data from Google Sheets, identifies new jobs, and processes them with AI-structured descriptions.

## Current Data Flow

```
External Job Sites (Baker Hughes, Noble, KBR, etc.)
    ↓
Python Scraper (job-scraping/)
    ↓
Google Sheets (Job Scraping Results)
    ↓
Export Script (export-jobs.js) → jobs.json
    ↓
AI Processing (process-descriptions.js) → Add structuredDescription
    ↓
React Web App (displays jobs)
```

## Automated Pipeline (NEW)

The new `sync-and-process-jobs.js` script combines export + AI processing into one command:

```
Google Sheets
    ↓
sync-and-process-jobs.js
    ├─ Fetch latest jobs
    ├─ Identify new/unprocessed jobs
    ├─ Run AI processing (only on new jobs)
    └─ Save results
    ↓
Updated jobs.json (with AI descriptions)
```

## Usage

### Manual Run (Recommended First Time)

```bash
# Full pipeline: fetch from Sheets + AI process new jobs
npm run sync-process

# Dry run (test without saving)
npm run sync-process -- --dry-run

# Only process existing jobs (skip fetch)
npm run sync-process -- --skip-export

# Limit AI processing to first 10 jobs (for testing)
npm run sync-process -- --limit=10
```

### Scheduled Automation (Cron Job)

For fully automated daily updates:

#### macOS/Linux

```bash
# Edit crontab
crontab -e

# Add this line (runs daily at 2 AM)
0 2 * * * cd /Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web && /usr/local/bin/npm run sync-process >> logs/sync.log 2>&1

# Save and exit
```

**Important**: Use full paths in cron:
- `/usr/local/bin/npm` (find with `which npm`)
- Full path to project directory

#### Alternative: launchd (macOS)

Create `~/Library/LaunchAgents/com.moblyze.job-sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.moblyze.job-sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/npm</string>
        <string>run</string>
        <string>sync-process</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>2</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/logs/sync.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/logs/sync-error.log</string>
</dict>
</plist>
```

Then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.moblyze.job-sync.plist
launchctl start com.moblyze.job-sync
```

#### Windows (Task Scheduler)

1. Open Task Scheduler
2. Create Basic Task
3. Set trigger: Daily at 2:00 AM
4. Action: Start a program
   - Program: `C:\Program Files\nodejs\npm.cmd`
   - Arguments: `run sync-process`
   - Start in: `C:\path\to\moblyze-jobs-web`

## How It Works

### Step-by-Step Process

1. **Fetch Jobs from Google Sheets**
   - Authenticates with service account
   - Fetches all worksheets (one per company)
   - Parses rows into job objects

2. **Identify New Jobs**
   - Compares fetched jobs with existing `jobs.json`
   - Identifies:
     - Completely new jobs (new IDs)
     - Existing jobs without `structuredDescription`

3. **AI Processing**
   - Only processes jobs without `structuredDescription`
   - Uses Claude Sonnet 4.5 to restructure descriptions
   - Rate-limited to avoid API overload (500ms between requests)
   - Auto-saves progress every 10 jobs

4. **Save Results**
   - Updates `jobs.json` with new structured descriptions
   - Preserves all existing structured descriptions (never re-processes)
   - Creates backup before processing

### Smart Processing

The script is **intelligent about what it processes**:

- ✅ **Never re-processes** jobs that already have `structuredDescription`
- ✅ **Preserves existing** AI descriptions when merging new data from Sheets
- ✅ **Only bills API** for new/unprocessed jobs
- ✅ **Incremental saves** - progress isn't lost if script crashes
- ✅ **Automatic backups** - `jobs.backup.json` created before processing

## Cost Analysis

### API Costs

Claude Sonnet 4.5 pricing (approximate):
- Input: $3 per million tokens
- Output: $15 per million tokens
- **Effective cost per job: ~$0.01** (avg 500 input tokens, 400 output tokens)

### Daily Cost Scenarios

| New Jobs/Day | Cost/Day | Cost/Month | Cost/Year |
|--------------|----------|------------|-----------|
| 5 jobs       | $0.05    | $1.50      | $18       |
| 10 jobs      | $0.10    | $3.00      | $36       |
| 25 jobs      | $0.25    | $7.50      | $90       |
| 50 jobs      | $0.50    | $15.00     | $180      |
| 100 jobs     | $1.00    | $30.00     | $360      |

**Current rate**: Based on your existing 523 jobs, you're likely getting 5-20 new jobs per day.

**Estimated monthly cost**: $3-$6

### One-Time Processing

If you need to process a large backlog:

```bash
# Process all unprocessed jobs
npm run sync-process -- --skip-export

# Process in batches of 50
npm run sync-process -- --skip-export --limit=50
```

523 jobs × $0.01 = **~$5.23** (one-time cost for full backlog)

## Monitoring

### Logs

All operations are logged to:

```
logs/
├── sync-process.log              # Main operation log
└── description-processing-errors.log  # AI processing errors
```

### Check Last Run

```bash
# View last sync log
tail -100 logs/sync-process.log

# Check for errors
tail -50 logs/description-processing-errors.log

# Count unprocessed jobs
npm run sync-process -- --dry-run --skip-export
```

### Monitoring Script Output

The script outputs detailed progress:

```
=== Sync and Process Jobs - Starting ===

📊 STEP 1: Fetching jobs from Google Sheets...
   ✓ Fetched 525 jobs from Google Sheets

📂 STEP 2: Analyzing existing jobs...
   Found 523 existing jobs
   🆕 Found 2 new jobs
   📝 2 jobs need AI processing

🤖 STEP 3: Processing descriptions with AI...
   ✓ AI parser loaded
   ✓ Backup created

   Processing 2 jobs...
   [2/2] Supply Chain Analyst - Baker Hughes...

💾 STEP 4: Saving results...
   ✓ Saved to public/data/jobs.json

=== Processing Complete ===

Summary:
  • Jobs fetched from Sheets: 525
  • New jobs discovered: 2
  • Jobs needing AI processing: 2
  • AI processing attempted: 2
  • Successfully processed: 2
  • Failed: 0
  • Skipped (no description): 0
  • Duration: 12.3s
  • Estimated cost: $0.02 (2 jobs × ~$0.01)
```

## Troubleshooting

### Google Sheets Authentication

If you get authentication errors:

1. Verify service account credentials exist:
   ```bash
   ls -la ../job-scraping/config/service_account.json
   ```

2. Ensure the spreadsheet is shared with the service account email

3. Check spreadsheet name matches exactly: "Job Scraping Results"

### Anthropic API Errors

If AI processing fails:

1. Check API key in `.env`:
   ```bash
   grep ANTHROPIC_API_KEY .env
   ```

2. Verify you have API credits:
   - Visit https://console.anthropic.com/
   - Check usage and billing

3. Check rate limits - script has 500ms delay between requests

### No New Jobs Detected

If the script reports 0 new jobs:

```bash
# Check what's in Google Sheets vs local
npm run export-jobs  # Exports to jobs.json (overwrites existing!)

# Better: dry run to see what would happen
npm run sync-process -- --dry-run
```

### Recovery from Failed Run

If the script crashes mid-processing:

```bash
# Restore from backup
cp public/data/jobs.backup.json public/data/jobs.json

# Or just re-run - it will skip already-processed jobs
npm run sync-process
```

## Manual Steps (If Needed)

### Export Only (No AI Processing)

```bash
npm run export-jobs
```

This overwrites `jobs.json` with fresh data from Google Sheets (without AI processing).

### AI Processing Only (No Export)

```bash
npm run sync-process -- --skip-export
```

Processes any unprocessed jobs in existing `jobs.json`.

### Full Manual Pipeline

```bash
# 1. Export from Sheets
npm run export-jobs

# 2. Process with AI
npm run process-descriptions -- --skip-processed

# 3. Start dev server
npm run dev
```

## Future Enhancements

Potential improvements:

1. **Email notifications** on completion (with stats)
2. **Slack/Discord webhook** for new job alerts
3. **Database integration** (skip Google Sheets entirely)
4. **Webhook trigger** when scraper completes
5. **GitHub Actions** for cloud automation
6. **Quality checks** before publishing
7. **Duplicate detection** across companies
8. **Auto-categorization** by role type

## Testing

Before setting up automation:

```bash
# 1. Test dry run (no changes)
npm run sync-process -- --dry-run

# 2. Test with limit (process just 3 jobs)
npm run sync-process -- --limit=3

# 3. Check the results
cat public/data/jobs.json | jq '.[0].structuredDescription'

# 4. View logs
cat logs/sync-process.log
```

## Best Practices

1. **Always test with --dry-run first**
2. **Start with --limit=10** for initial runs
3. **Monitor costs** in Anthropic console
4. **Check logs regularly** (first week of automation)
5. **Keep backups** - don't delete `jobs.backup.json`
6. **Version control** - commit `jobs.json` changes to git
7. **Alert on failures** - set up monitoring if running in production

## Questions?

- Check logs in `logs/sync-process.log`
- Review error details in `logs/description-processing-errors.log`
- Test with `--dry-run` flag
- Check existing script documentation in `scripts/README.md`
