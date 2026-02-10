# Fast Deployment Workflow

## Overview

Created a fast deployment workflow (`.github/workflows/deploy-fast.yml`) that deploys code changes without data processing, reducing deployment time from ~35 minutes to ~2-3 minutes.

## Workflow Comparison

| Feature | `update-website.yml` | `deploy-fast.yml` (NEW) |
|---------|---------------------|------------------------|
| **Duration** | ~35 minutes | ~2-3 minutes |
| **Triggers** | Manual only (workflow_dispatch) | Push to main (code paths only) + manual |
| **Data Sync** | ✅ Google Sheets export | ❌ Uses existing data |
| **AI Processing** | ✅ Anthropic API calls | ❌ Skipped |
| **Geocoding** | ✅ Mapbox API calls | ❌ Skipped |
| **Data Commit** | ✅ Commits updated jobs.json | ❌ Read-only |
| **Build & Deploy** | ✅ GitHub Pages | ✅ GitHub Pages |
| **Use Case** | Periodic data updates | Quick code changes |

## Triggers

The fast workflow triggers on:

```yaml
push:
  branches:
    - main
  paths:
    - 'src/**'          # React components
    - 'public/**'       # Static assets (excluding data/)
    - '*.config.js'     # Vite, Tailwind, PostCSS configs
    - 'package.json'    # Dependencies
    - 'package-lock.json'
    - 'index.html'
    - '!public/data/**' # EXCLUDE data files
```

**Path exclusions prevent:**
- Triggering on `jobs.json` updates from `update-website.yml`
- Triggering on `locations-geocoded.json` updates
- Creating deployment loops

## What Gets Deployed

The fast workflow:
1. ✅ Checks out the repo (including committed `public/data/*.json`)
2. ✅ Installs npm dependencies
3. ✅ Verifies existing data files (informational only)
4. ✅ Builds the Vite app with existing data
5. ✅ Deploys to GitHub Pages

**Key behavior:** Uses whatever `jobs.json` and `locations-geocoded.json` are committed in the repo. No API calls, no data processing.

## When to Use Each Workflow

### Use `deploy-fast.yml` for:
- ✅ UI component changes (`src/components/**`)
- ✅ Styling updates (CSS, Tailwind classes)
- ✅ Configuration changes (Vite, routing)
- ✅ Dependency updates
- ✅ Bug fixes in frontend code
- ✅ Any change that doesn't require new job data

### Use `update-website.yml` for:
- ✅ Updating job listings from Google Sheets
- ✅ Running AI processing on new jobs
- ✅ Geocoding new locations
- ✅ Periodic data refreshes (via manual trigger)

## Permissions

Fast workflow has **read-only** access to repo contents:
```yaml
permissions:
  contents: read      # Can't commit changes
  pages: write        # Can deploy to GitHub Pages
  id-token: write     # For Pages authentication
```

## Secrets Required

Fast workflow needs these GitHub secrets:
- `VITE_MAPBOX_TOKEN` - For map component (no API calls made)
- `VITE_ONET_API_KEY` - For occupation data (no API calls made)

**NOT required:**
- ❌ `ANTHROPIC_API_KEY` - No AI processing
- ❌ `GOOGLE_SERVICE_ACCOUNT_JSON` - No Sheets sync

## Verification Steps

The workflow includes verification to confirm data files exist:

```bash
# Checks public/data/jobs.json
# Checks public/data/locations-geocoded.json
# Reports counts but continues even if missing
```

If data files are missing, the build proceeds with empty data (frontend handles this gracefully).

## Monitoring

Workflow outputs:
- ✅ Data file verification (job count, AI-processed count)
- ✅ Build artifact verification (file counts)
- ✅ Deployment URL
- ✅ Duration timing

## Example Output

```
✅ Fast deployment completed successfully
🚀 Deployment type: Code-only (no data processing)
🌐 Site URL: https://username.github.io/moblyze-jobs-web

ℹ️  This workflow deployed code changes using existing data files.
   To update job data, use the 'Update Website Data' workflow.
```

## Workflow File Location

```
.github/workflows/deploy-fast.yml
```

## Implementation Details

**Timeout:** 10 minutes (typical: 2-3 minutes)
**Concurrency group:** `pages` (shared with full workflow to prevent conflicts)
**Cancel in progress:** `false` (lets current deployment finish)

## Testing

To test the fast workflow:

1. Make a small code change (e.g., update a component)
2. Commit and push to main
3. Workflow should trigger automatically
4. Check GitHub Actions tab for progress
5. Verify deployment completes in ~2-3 minutes

## Rollback Strategy

If fast deployment fails:
1. Check workflow logs in GitHub Actions
2. Fix the issue locally
3. Push fix to main (triggers fast workflow again)
4. Or manually trigger `update-website.yml` for full rebuild

## Future Enhancements

Potential improvements:
- [ ] Add branch preview deployments
- [ ] Add build caching for even faster builds
- [ ] Add smoke tests before deployment
- [ ] Add Slack notifications on deployment
- [ ] Add deployment status badge to README

## Related Files

- `.github/workflows/update-website.yml` - Full data processing workflow
- `scripts/sync-and-process-jobs.js` - Data pipeline (not used in fast workflow)
- `vite.config.js` - Build configuration
- `public/data/jobs.json` - Job data (committed to repo)
- `public/data/locations-geocoded.json` - Location data (committed to repo)

---

**Created:** 2026-02-10
**Purpose:** Separate code deployment from data processing for faster iteration
