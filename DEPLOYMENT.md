# Deployment Guide - Moblyze Jobs Web

Guide for deploying the job board web interface to GitHub Pages with automated updates.

**Live Site**: `https://moblyze.github.io/moblyze-jobs-web/`

## Two-Workflow Deployment System

This project uses **two separate workflows** for different deployment needs:

| Workflow | When | Duration | Use For |
|----------|------|----------|---------|
| **Fast Deploy** | Automatic on code changes | ~2-3 minutes | Bug fixes, features, UI changes |
| **Update Website Data** | Manual trigger or scheduled | ~35 minutes | New jobs, AI reprocessing, data updates |

### When to Use Each Workflow

**Use Fast Deploy (Automatic):**
- Fixing bugs in React components
- Adding new features or UI changes
- Updating styles or configuration
- Any code change that doesn't need new data

**Use Update Website Data (Manual):**
- Fetching new jobs from Google Sheets
- Reprocessing jobs with AI
- Updating geocoded locations
- Any time you need fresh data

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

## Update Website Data Workflow

### What It Does

1. Checks out code
2. Installs dependencies
3. **Exports jobs from Google Sheets** (~5 minutes)
4. **Processes jobs with AI** (~25 minutes for 200 jobs)
5. **Geocodes new locations** (~2 minutes)
6. **Commits updated data files** to repository
7. Builds React app (~15 seconds)
8. Deploys to GitHub Pages (~30 seconds)
9. **Total: ~35 minutes** (varies with number of jobs)

### How to Use

**Manual Trigger (Recommended):**

1. Go to: `https://github.com/moblyze/moblyze-jobs-web/actions`
2. Click **Update Website Data**
3. Click **Run workflow** → **Run workflow**
4. Wait ~35 minutes for completion

**Scheduled (Currently Disabled):**

The workflow can run automatically on a schedule, but it's currently disabled to prevent unnecessary AI reprocessing. To enable:

Edit `.github/workflows/update-website.yml` and uncomment:
```yaml
schedule:
  - cron: '0 * * * *'  # Every hour
```

### When to Run This Workflow

- After jobs are scraped and added to Google Sheets
- When you want to reprocess jobs with updated AI prompts
- When locations need geocoding
- After making changes to data processing scripts

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
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account credentials | Update Website Data |
| `ANTHROPIC_API_KEY` | Claude API key for AI processing | Update Website Data |
| `VITE_MAPBOX_TOKEN` | Mapbox API token for geocoding | Both workflows |
| `VITE_ONET_API_KEY` | O*NET API key (optional) | Both workflows |

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

**Option B: Fetch and deploy new data (Slow)**

To fetch fresh data from Google Sheets:

1. Go to: `https://github.com/moblyze/moblyze-jobs-web/actions`
2. Click **Update Website Data**
3. Click **Run workflow** → **Run workflow**
4. Wait ~35 minutes for completion

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

### Scenario 2: Update Job Data

```bash
# 1. Run Update Website Data workflow manually
#    Go to Actions → Update Website Data → Run workflow
#    Wait ~35 minutes

# 2. Data files are automatically committed by workflow
# 3. Site redeploys with new data
```

### Scenario 3: Update Code AND Data

```bash
# 1. Push code changes first
git add src/components/JobCard.jsx
git commit -m "Add: Certification badges to job cards"
git push origin main

# 2. Fast Deploy runs automatically (~2-3 minutes)

# 3. Manually trigger Update Website Data
#    Go to Actions → Update Website Data → Run workflow
#    Wait ~35 minutes

# Both changes will be live after data workflow completes
```

### Scenario 4: Force Data Refresh

If the site shows stale data:

```bash
# 1. Manually trigger Update Website Data workflow
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
2. If missing, run **Update Website Data** workflow to fetch data
3. If exists, check workflow logs for warnings

### Site Shows Old Jobs

**Cause:** Fast Deploy uses existing committed data files

**Solution:**
1. Run **Update Website Data** workflow to fetch fresh data
2. Wait for workflow to commit updated `jobs.json`
3. Fast Deploy will use new data on next code push

### Data Workflow Takes Too Long

**Cause:** AI processing is rate-limited to ~1 job/second

**Current:** Processing 200 jobs takes ~25 minutes

**Solutions:**
- Reduce `--limit=200` in workflow to process fewer jobs
- Disable AI processing temporarily by commenting out that step
- Run outside business hours when rate limits may be higher

### Both Workflows Run at Same Time

**Cause:** Pushing code while data workflow is running

**Impact:** Data workflow commits files, triggering Fast Deploy

**Solution:**
- Workflows use `concurrency: group: "pages"` to prevent conflicts
- Later workflow waits for earlier one to complete
- No action needed - system handles this automatically

### Fast Deploy Uses Wrong Data

**Cause:** Old data files committed to repository

**Solution:**
1. Run **Update Website Data** workflow
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

**Solution:** Both workflows already have:
```yaml
permissions:
  contents: write  # For committing data (Update Website Data only)
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

Every **Update Website Data** workflow run uploads `jobs.json` as an artifact:

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

### Test Data Workflow Locally

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

### Data Workflow Optimization

**Current Bottlenecks:**
- AI processing: ~25 minutes for 200 jobs (rate-limited)
- Google Sheets export: ~5 seconds per sheet

**Optimization Options:**

1. **Reduce AI processing limit:**
```yaml
# In update-website.yml
npm run sync-process -- --limit=50  # Process only 50 jobs
```

2. **Skip AI processing (emergency):**
```yaml
# Comment out AI processing step
# - name: Sync and process jobs with AI
#   run: npm run sync-process -- --limit=200
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

### Change Data Workflow Schedule

Edit `.github/workflows/update-website.yml`:

```yaml
schedule:
  - cron: '0 */4 * * *'  # Every 4 hours
  - cron: '0 9 * * 1'    # Every Monday at 9am
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
- Push to `main` (code files only)
- Manual dispatch

**What it does:**
- Uses existing data files from repository
- Builds React app with Vite
- Deploys to GitHub Pages

**Duration:** ~2-3 minutes

### Update Website Data Workflow
**File:** `.github/workflows/update-website.yml`

**Triggers:**
- Manual dispatch only (schedule disabled)

**What it does:**
- Exports jobs from Google Sheets
- Processes with AI (Claude)
- Geocodes locations (Mapbox)
- Commits data files
- Builds and deploys

**Duration:** ~35 minutes (varies by job count)

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
| Update job data | Actions → Update Website Data → Run workflow |
| View live site | https://moblyze.github.io/moblyze-jobs-web/ |
| Check deployments | /deployments |
| View workflow runs | /actions |
| Build locally | `npm run build && npm run preview` |
| Test data sync | `npm run sync-process -- --limit=10` |

## Next Steps

After successful deployment:

1. ✅ Verify site loads at GitHub Pages URL
2. ✅ Check that jobs display correctly
3. ✅ Test filtering and navigation
4. ✅ Understand when to use Fast Deploy vs Update Website Data
5. ✅ Set up alerts for workflow failures (optional)
6. 🎯 Consider scheduling data updates during off-hours
7. 🎯 Monitor AI processing costs
8. 🎯 Add custom domain (optional)
