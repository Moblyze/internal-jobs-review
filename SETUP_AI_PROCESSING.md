# Setup: AI Job Description Processing in GitHub Actions

## Overview

The GitHub Actions workflow now automatically processes job descriptions with AI to create clean, structured, mobile-friendly layouts. This only processes **new jobs** without AI descriptions, so costs are minimal (~$0.01 per new job).

## Setup Steps

### 1. Get Your Anthropic API Key

If you already have one:
- Find it in your `.env` file under `ANTHROPIC_API_KEY`

If you need a new one:
1. Go to https://console.anthropic.com/
2. Navigate to API Keys
3. Create a new key
4. Copy the key (starts with `sk-ant-`)

### 2. Add Secret to GitHub

**Via GitHub Web UI:**
1. Go to https://github.com/Moblyze/internal-jobs-review/settings/secrets/actions
2. Click "New repository secret"
3. Name: `ANTHROPIC_API_KEY`
4. Value: Paste your API key
5. Click "Add secret"

**Via GitHub CLI:**
```bash
gh secret set ANTHROPIC_API_KEY --body "sk-ant-your-key-here"
```

### 3. Deploy the Changes

```bash
# Stage the workflow changes
git add .github/workflows/update-website.yml .github/README.md SETUP_AI_PROCESSING.md

# Commit
git commit -m "Add AI job description processing to deployment pipeline

- Modified workflow to run sync-and-process script
- Processes only new jobs without AI descriptions
- Cost: ~$0.01 per new job (~$1.50-6/month expected)
- Updated documentation with AI processing details"

# Push to GitHub
git push origin main
```

### 4. Verify Deployment

After pushing, the workflow will automatically run. Monitor it:

1. **Watch the run:** https://github.com/Moblyze/internal-jobs-review/actions
2. **Check the logs** for "AI-processed descriptions" count
3. **View the live site:** https://moblyze.github.io/internal-jobs-review/
4. **Test:** Open any job page and verify:
   - ✅ Clean, structured description with sections
   - ✅ Toggle button to view original vs AI version
   - ✅ No messy blob of text

## What Happens Now

### Every Hour
1. Workflow exports latest jobs from Google Sheets
2. Identifies jobs without `structuredDescription`
3. Processes those jobs with Claude API (~2s per job)
4. Builds and deploys site with AI-enhanced descriptions

### Cost Breakdown
- **0 new jobs:** $0 (just syncs existing data)
- **5 new jobs:** ~$0.05
- **10 new jobs:** ~$0.10
- **Expected monthly:** $1.50-$6/month (5-20 new jobs/day)

## Monitoring

### View Processing Stats
Each workflow run shows:
```
✅ Deployed successfully with 523 jobs
🤖 AI-processed descriptions: 522/523
```

### Check Logs
```bash
# Via GitHub web UI
Actions → Latest run → "Sync and process jobs with AI" step

# Or download jobs data artifact from any run
```

### Local Testing
To test AI processing locally before deployment:
```bash
# Dry run (no changes)
npm run sync-process -- --dry-run

# Process up to 5 jobs for testing
npm run sync-process -- --limit=5

# Full run
npm run sync-process
```

## Troubleshooting

**"ANTHROPIC_API_KEY not configured" error:**
- Verify secret is set in GitHub: Settings → Secrets → Actions
- Name must be exactly `ANTHROPIC_API_KEY` (case-sensitive)
- Re-run the workflow after adding secret

**AI processing taking too long:**
- Normal: ~2 seconds per job
- If 100+ new jobs, workflow may timeout (10 min limit)
- Solution: Process in batches locally, then push jobs.json once

**Jobs showing original blob format:**
- Check workflow logs for AI processing errors
- Verify jobs have `structuredDescription` in data artifact
- Browser cache: Hard refresh with Cmd+Shift+R

**Unexpected API costs:**
- Check workflow runs for number of jobs processed
- Script only processes jobs without `structuredDescription`
- If reprocessing all jobs, check for data corruption

## Next Steps

After first successful deployment:
- ✅ Monitor first few runs to verify AI processing
- ✅ Check cost in Anthropic console after 24 hours
- ✅ Verify toggle works on live site
- 🎯 Gather user feedback on AI descriptions
- 🎯 Adjust prompts if needed (see `src/utils/aiDescriptionParser.js`)

## Architecture

```
Google Sheets → export → jobs.json (raw)
                    ↓
              AI Processing (Claude)
                    ↓
          jobs.json (with structuredDescription)
                    ↓
              Vite Build → GitHub Pages
```

Jobs are processed incrementally - only new additions get AI enhancement, keeping costs minimal.

## Questions?

- **Workflow file:** `.github/workflows/update-website.yml`
- **Processing script:** `scripts/sync-and-process-jobs.js`
- **AI parser:** `src/utils/aiDescriptionParser.js`
- **UI component:** `src/components/StructuredJobDescription.jsx`
- **Changelog:** See `JOBS_WEB_CHANGELOG.md` for full history
