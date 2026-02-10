# Deployment Guide - Moblyze Jobs Web

Guide for deploying the job board web interface to GitHub Pages with automated updates.

**Live Site**: `https://moblyze.github.io/moblyze-jobs-web/`

## Three-Workflow Deployment System

This project uses **three separate workflows** for different deployment needs:

| Workflow | Trigger | Duration | Use For |
|----------|---------|----------|---------|
| **Fast Deploy** | Automatic on push | ~2-3 minutes | Bug fixes, features, UI changes |
| **Data Sync** | Scheduled daily | ~5-10 minutes | Fresh job data from Sheets |
| **AI Processing** | Manual only | ~60 minutes | AI reprocessing (500 jobs/batch) |

### When to Use Each Workflow

**Fast Deploy (Automatic):**
- Fixing bugs in React components
- Adding new features or UI changes
- Updating styles or configuration
- Any code change that doesn't need new data
- **Triggers:** Automatically on push to main

**Data Sync (Scheduled):**
- Fetching new jobs from Google Sheets
- Updating geocoded locations
- Daily refresh of job data
- **Triggers:** Automatically at 10 AM UTC daily, or manual
- **Does NOT run AI processing**

**AI Processing (Manual):**
- Reprocessing jobs with AI (Claude)
- Processing structured descriptions
- **Triggers:** Manual only
- **Batch size:** 500 jobs per run
- **Duration:** ~60 minutes for 500 jobs

## Fast Deploy Workflow

### What It Does

1. Checks out code (uses existing `jobs.json` and `locations-geocoded.json`)
2. Installs dependencies (~20 seconds)
3. Builds React app (~15 seconds)
4. Deploys to GitHub Pages (~30 seconds)
5. **Total: ~2-3 minutes**

### How to Use

**Automatic:** Just push code changes to `main` branch

```bash
git add src/components/MyComponent.jsx
git commit -m "Fix: Update job card styling"
git push origin main
```

The workflow triggers automatically when you push changes to:
- `src/**` - React components
- `public/**` - Static assets (except data files)
- `*.config.js` - Configuration files
- `package.json` - Dependencies
- `index.html` - HTML template

**Manual:** Trigger from GitHub Actions UI

1. Go to: `https://github.com/moblyze/moblyze-jobs-web/actions`
2. Click **Fast Deploy (Code Only)**
3. Click **Run workflow** → **Run workflow**

### What If Data Is Missing?

If you deploy code but the data files (`jobs.json`, `locations-geocoded.json`) are not committed to the repository:

1. The workflow will warn you with: `⚠️ No jobs.json found - build will proceed with empty data`
2. The site will deploy successfully but show no jobs
3. **Solution:** Run the **Update Website Data** workflow to fetch and commit data

## Data Sync Workflow

### What It Does

1. Checks out code
2. Installs dependencies
3. **Exports jobs from Google Sheets** (~5 minutes)
4. **Geocodes new locations** (~2 minutes)
5. **Commits updated data files** to repository
6. Builds React app (~15 seconds)
7. Deploys to GitHub Pages (~30 seconds)
8. **Total: ~5-10 minutes**

### How to Use

**Automatic (Scheduled):**

Runs daily at **10 AM UTC** automatically. No action required.

**Manual Trigger:**

1. Go to: `https://github.com/moblyze/moblyze-jobs-web/actions`
2. Click **Data Sync (Sheets Export)**
3. Click **Run workflow** → **Run workflow**
4. Wait ~5-10 minutes for completion

### When to Run This Workflow

- After jobs are scraped and added to Google Sheets (runs automatically)
- When you want to force an immediate data refresh
- When locations need geocoding
- After making changes to data export scripts

## AI Processing Workflow

### What It Does

1. Checks out code
2. Installs dependencies
3. **Exports jobs from Google Sheets** (~5 minutes)
4. **Processes jobs with AI** (~60 minutes for 500 jobs)
5. **Geocodes new locations** (~2 minutes)
6. **Commits updated data files** to repository
7. Builds React app (~15 seconds)
8. Deploys to GitHub Pages (~30 seconds)
9. **Total: ~60 minutes** (varies with number of jobs)

### How to Use

**Manual Trigger Only:**

1. Go to: `https://github.com/moblyze/moblyze-jobs-web/actions`
2. Click **AI Processing (Update Website)**
3. Click **Run workflow** → **Run workflow**
4. Wait ~60 minutes for completion

**Not Scheduled:** This workflow must be triggered manually to prevent unnecessary AI costs.

### When to Run This Workflow

- When you want to reprocess jobs with updated AI prompts
- After making changes to AI processing logic
- When you need to generate structured descriptions for new jobs
- Typically run weekly or as needed (not daily)

## Setup Guide

### Prerequisites

1. Scraper repository (`job-scraping`) must be set up first
2. Google Service Account with access to "Job Scraping Results" sheet
3. GitHub repository pushed to `moblyze/moblyze-jobs-web`

### Step 1: Enable GitHub Pages

1. Go to: `https://github.com/moblyze/moblyze-jobs-web/settings/pages`
2. Under **Source**, select: **GitHub Actions**
3. Click **Save**

### Step 2: Configure Repository Secrets

Add these secrets at: `https://github.com/moblyze/moblyze-jobs-web/settings/secrets/actions`

**Required Secrets:**

| Secret Name | Description | Used By |
|-------------|-------------|---------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account credentials | Data Sync, AI Processing |
| `ANTHROPIC_API_KEY` | Claude API key for AI processing | AI Processing only |
| `VITE_MAPBOX_TOKEN` | Mapbox API token for geocoding | All workflows |
| `VITE_ONET_API_KEY` | O*NET API key (optional) | All workflows |

**How to Add a Secret:**

1. Click **New repository secret**
2. Enter name (e.g., `GOOGLE_SERVICE_ACCOUNT_JSON`)
3. Paste value
4. Click **Add secret**

### Step 3: First Deployment

**Option A: Deploy existing data (Fast)**

If `public/data/jobs.json` is already committed:

```bash
git commit --allow-empty -m "Trigger initial deployment"
git push origin main
```

Wait ~2-3 minutes for Fast Deploy workflow to complete.

**Option B: Fetch and deploy new data**

To fetch fresh data from Google Sheets:

1. Go to: `https://github.com/moblyze/moblyze-jobs-web/actions`
2. Click **Data Sync (Sheets Export)**
3. Click **Run workflow** → **Run workflow**
4. Wait ~5-10 minutes for completion

### Step 4: Verify Deployment

1. Go to: `https://github.com/moblyze/moblyze-jobs-web/deployments`
2. Click the latest `github-pages` deployment
3. Click **View deployment** to see your live site
4. Verify jobs display correctly

## Common Workflows

### Scenario 1: Fix a Bug in the UI

```bash
# Edit component
vim src/components/JobCard.jsx

# Commit and push
git add src/components/JobCard.jsx
git commit -m "Fix: Job card title truncation"
git push origin main

# Fast Deploy runs automatically (~2-3 minutes)
```

### Scenario 2: Update Job Data (Daily)

```bash
# Data Sync runs automatically at 10 AM UTC daily
# No action needed - just wait for scheduled run

# To force immediate update:
# Go to Actions → Data Sync → Run workflow
# Wait ~5-10 minutes
```

### Scenario 3: Reprocess Jobs with AI

```bash
# Manually trigger AI Processing workflow
# Go to Actions → AI Processing → Run workflow
# Wait ~60 minutes (processes 500 jobs)

# This is separate from daily data sync
# Run only when needed (weekly or after AI prompt changes)
```

### Scenario 4: Update Code AND Data

```bash
# 1. Push code changes first
git add src/components/JobCard.jsx
git commit -m "Add: Certification badges to job cards"
git push origin main

# 2. Fast Deploy runs automatically (~2-3 minutes)

# 3. Data Sync will run at 10 AM UTC automatically
#    Or manually trigger for immediate update

# 4. If AI reprocessing needed, manually trigger AI Processing
```

### Scenario 5: Force Data Refresh

If the site shows stale data:

```bash
# 1. Manually trigger Data Sync workflow
#    This will fetch latest jobs from Google Sheets

# 2. Verify new data was committed:
git pull origin main
cat public/data/jobs.json | jq 'length'

# 3. If still showing old data, clear browser cache or use incognito mode
```

## Troubleshooting

### Site Shows No Jobs After Fast Deploy

**Cause:** Data files (`jobs.json`) not committed to repository

**Solution:**
1. Check if file exists: `ls public/data/jobs.json`
2. If missing, run **Data Sync** workflow to fetch data
3. If exists, check workflow logs for warnings

### Site Shows Old Jobs

**Cause:** Fast Deploy uses existing committed data files

**Solution:**
1. Run **Data Sync** workflow to fetch fresh data (or wait for daily 10 AM UTC run)
2. Wait for workflow to commit updated `jobs.json`
3. Fast Deploy will use new data on next code push

### AI Processing Takes Too Long

**Cause:** AI processing is rate-limited to ~1 job/second

**Current:** Processing 500 jobs takes ~60 minutes

**Solutions:**
- Reduce `--limit=500` in workflow to process fewer jobs
- Use Data Sync for quick updates without AI processing
- Run AI Processing outside business hours or during low-traffic periods

### Multiple Workflows Run at Same Time

**Cause:** Pushing code while data workflow is running, or workflows overlapping

**Impact:** Data workflow commits files, triggering Fast Deploy

**Solution:**
- Workflows use `concurrency: group: "pages"` to prevent conflicts
- Later workflow waits for earlier one to complete
- No action needed - system handles this automatically

### Fast Deploy Uses Wrong Data

**Cause:** Old data files committed to repository

**Solution:**
1. Run **Data Sync** workflow (or wait for daily 10 AM UTC run)
2. Verify updated data was committed:
```bash
git pull origin main
git log -1 public/data/jobs.json  # Check last commit time
```
3. Next Fast Deploy will use updated data

### Deployment Succeeds But Site Shows 404

**Cause:** Build artifacts not created correctly

**Solution:**
1. Check workflow logs for build errors
2. Verify `dist/index.html` was created
3. Download Pages artifact from workflow run
4. Check GitHub Pages settings: Source = "GitHub Actions"

### Permission Denied Error

**Cause:** Workflow lacks necessary permissions

**Solution:** All workflows already have:
```yaml
permissions:
  contents: write  # For committing data (Data Sync and AI Processing only)
  pages: write     # For deployment
  id-token: write  # For authentication
```

If error persists, check repository settings → Actions → General → Workflow permissions

## Monitoring

### Check Deployment Status

**Latest Deployment:**
```
https://github.com/moblyze/moblyze-jobs-web/deployments
```

**All Workflow Runs:**
```
https://github.com/moblyze/moblyze-jobs-web/actions
```

### Download Data Artifacts

Both **Data Sync** and **AI Processing** workflow runs upload `jobs.json` as an artifact:

1. Go to workflow run
2. Scroll to **Artifacts** section
3. Download `jobs-data-[run-id]`
4. Inspect with: `jq . jobs.json`

### Check Data Freshness

```bash
# Last time data was updated
git log -1 --format="%ai" public/data/jobs.json

# Number of jobs
jq 'length' public/data/jobs.json

# AI-processed jobs
jq '[.[] | select(.structuredDescription != null)] | length' public/data/jobs.json
```

## Local Development

### Test Fast Deploy Locally

```bash
# Use existing data files
npm ci
npm run build
npm run preview

# Open http://localhost:4173
```

### Test Data Sync Locally

```bash
# Ensure service account file exists
ls ../job-scraping/config/service_account.json

# Run data sync only (no AI processing)
npm run sync-only

# Geocode new locations
node scripts/geocode-missing.js --local

# Build and preview
npm run build
npm run preview
```

### Test AI Processing Locally

```bash
# Ensure service account file exists
ls ../job-scraping/config/service_account.json

# Run full pipeline (exports + AI processing)
npm run sync-process -- --limit=10

# Geocode new locations
node scripts/geocode-missing.js --local

# Build and preview
npm run build
npm run preview
```

### Verify Data Files

```bash
# Check jobs.json structure
cat public/data/jobs.json | jq '.[0]' | head -20

# Count total vs AI-processed jobs
jq '[.[] | select(.structuredDescription != null)] | length' public/data/jobs.json

# Check locations
cat public/data/locations-geocoded.json | jq 'keys | length'
```

## Performance Optimization

### Fast Deploy Optimization

**Already Optimized:**
- Dependency caching with `actions/setup-node@v4`
- Skips data processing entirely
- Uses Vite's fast build system

**Typical Timing:**
- Checkout: ~5s
- Install deps (cached): ~15s
- Build: ~15s
- Deploy: ~25s
- **Total: ~60s** (excluding queue time)

### Data Sync Optimization

**Already Optimized:**
- Dependency caching with `actions/setup-node@v4`
- Skips AI processing for speed
- Scheduled to run daily at 10 AM UTC

**Typical Timing:**
- Google Sheets export: ~5 minutes
- Geocoding: ~2 minutes
- Build and deploy: ~1 minute
- **Total: ~5-10 minutes**

### AI Processing Optimization

**Current Bottlenecks:**
- AI processing: ~60 minutes for 500 jobs (rate-limited)
- Rate limit: ~1 job/second for Claude API

**Optimization Options:**

1. **Reduce batch size:**
```yaml
# In update-website.yml
npm run sync-process -- --limit=100  # Process only 100 jobs
```

2. **Use Data Sync instead:**
```yaml
# For quick updates without AI, use sync-data.yml workflow
# Runs in ~5-10 minutes vs 60 minutes
```

3. **Process only unprocessed jobs:**
Script already checks for `structuredDescription` and skips processed jobs

## Security

### Secrets Management

All secrets are:
- Stored encrypted in GitHub Secrets
- Only accessible to workflows
- Never exposed in logs or artifacts
- Automatically deleted from runner after use

### Service Account Permissions

The Google Service Account should have:
- **Editor** access to "Job Scraping Results" sheet only
- No access to other sheets or Google Drive files
- Key rotation recommended every 90 days

### Monitoring Access

Review who can:
- **Trigger workflows:** Requires write access to repository
- **Access secrets:** GitHub admins only
- **View deployments:** Public (if repository is public)

## Advanced Configuration

### Change Data Sync Schedule

Edit `.github/workflows/sync-data.yml`:

```yaml
schedule:
  - cron: '0 10 * * *'   # Current: Daily at 10 AM UTC
  - cron: '0 */6 * * *'  # Alternative: Every 6 hours
  - cron: '0 9 * * 1'    # Alternative: Every Monday at 9am UTC
```

### Adjust AI Processing Rate Limits

Edit `scripts/sync-and-process-jobs.js`:

```javascript
// Current: 1 second delay between jobs
await new Promise(resolve => setTimeout(resolve, 1000));

// Faster (may hit rate limits):
await new Promise(resolve => setTimeout(resolve, 500));

// Slower (safer):
await new Promise(resolve => setTimeout(resolve, 2000));
```

### Deploy to Custom Domain

1. Add CNAME record: `jobs.moblyze.com → moblyze.github.io`
2. Configure in GitHub: Settings → Pages → Custom domain
3. Update `vite.config.js`:
```javascript
export default defineConfig({
  base: '/',  // Remove /moblyze-jobs-web/ prefix
})
```

## Workflow Files Reference

### Fast Deploy Workflow
**File:** `.github/workflows/deploy-fast.yml`

**Triggers:**
- Automatic on push to `main` (code files only)
- Manual dispatch

**What it does:**
- Uses existing data files from repository
- Builds React app with Vite
- Deploys to GitHub Pages

**Duration:** ~2-3 minutes

### Data Sync Workflow
**File:** `.github/workflows/sync-data.yml`

**Triggers:**
- Scheduled daily at 10 AM UTC
- Manual dispatch

**What it does:**
- Exports jobs from Google Sheets
- Geocodes locations (Mapbox)
- Commits data files
- Builds and deploys
- **Does NOT run AI processing**

**Duration:** ~5-10 minutes

### AI Processing Workflow
**File:** `.github/workflows/update-website.yml`

**Triggers:**
- Manual dispatch only

**What it does:**
- Exports jobs from Google Sheets
- Processes 500 jobs with AI (Claude)
- Geocodes locations (Mapbox)
- Commits data files
- Builds and deploys

**Duration:** ~60 minutes for 500 jobs

## Support

If you encounter issues:

1. **Check workflow logs**: Actions tab → Click failed run → View logs
2. **Download artifacts**: Scroll to bottom of workflow run
3. **Check data files**: Verify `public/data/*.json` exist and are valid
4. **Review this guide**: Search for your error message
5. **Check main deployment guide**: `../job-scraping/DEPLOYMENT.md`

## Quick Reference

| Action | Command/Link |
|--------|-------------|
| Deploy code changes | `git push origin main` (automatic) |
| Update job data (daily) | Runs automatically at 10 AM UTC, or Actions → Data Sync → Run workflow |
| Reprocess with AI | Actions → AI Processing → Run workflow (~60 min) |
| View live site | https://moblyze.github.io/moblyze-jobs-web/ |
| Check deployments | /deployments |
| View workflow runs | /actions |
| Build locally | `npm run build && npm run preview` |
| Test data sync | `npm run sync-only` |
| Test AI processing | `npm run sync-process -- --limit=10` |

## Next Steps

After successful deployment:

1. ✅ Verify site loads at GitHub Pages URL
2. ✅ Check that jobs display correctly
3. ✅ Test filtering and navigation
4. ✅ Understand when to use Fast Deploy vs Data Sync vs AI Processing
5. ✅ Confirm daily Data Sync schedule (10 AM UTC)
6. 🎯 Set up alerts for workflow failures (optional)
7. 🎯 Monitor AI processing costs and frequency
8. 🎯 Add custom domain (optional)
