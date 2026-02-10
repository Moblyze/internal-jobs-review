# GitHub Actions Workflows

Automated website updates and GitHub Pages deployment.

## Workflows

### 🔄 Update Website Data (`update-website.yml`)

**Schedule:** Every hour, on the hour

**What it does:**
1. Exports latest jobs from Google Sheets to JSON
2. **AI-processes job descriptions** (only new/unprocessed jobs)
3. Builds React app with Vite
4. Deploys to GitHub Pages
5. Uploads jobs data as artifact for debugging

**Triggers:**
- ⏰ **Scheduled:** Every hour (`0 * * * *`)
- 🔧 **Manual:** Via workflow_dispatch
- 📝 **Code changes:** Push to `main` (src, scripts, config files)

**Required secrets:**
- `GOOGLE_SERVICE_ACCOUNT_JSON` - Service account credentials for Google Sheets
- `ANTHROPIC_API_KEY` - Claude API key for AI job description processing

**Permissions:**
- `contents: read` - Checkout code
- `pages: write` - Deploy to GitHub Pages
- `id-token: write` - Verify deployment

**Usage:**
```bash
# Trigger manually via GitHub CLI
gh workflow run update-website.yml

# Or via web UI
# Actions → Update Website Data → Run workflow
```

## Setup

See `../DEPLOYMENT.md` for complete setup instructions.

### Quick Setup Checklist

- [ ] Enable GitHub Pages (Settings → Pages → Source: GitHub Actions)
- [ ] Add `GOOGLE_SERVICE_ACCOUNT_JSON` secret to GitHub
- [ ] Add `ANTHROPIC_API_KEY` secret to GitHub (for AI processing)
- [ ] Push code to `main` branch
- [ ] Trigger first deployment manually
- [ ] Verify site at `https://moblyze.github.io/internal-jobs-review/`

## Monitoring

### View Deployments
```
https://github.com/moblyze/moblyze-jobs-web/deployments
```

### View Workflow Runs
```
https://github.com/moblyze/moblyze-jobs-web/actions
```

### Check Live Site
```
https://moblyze.github.io/moblyze-jobs-web/
```

### Download Data Artifact
Every workflow run uploads the exported `jobs.json` for debugging:
1. Go to workflow run
2. Scroll to bottom → Artifacts section
3. Download `jobs-data-[run-id]`

## Deployment Pipeline

```mermaid
graph LR
    A[Hourly Trigger] --> B[Export from Sheets]
    B --> C[AI Process New Jobs]
    C --> D[Build React App]
    D --> E[Deploy to Pages]
    E --> F[Live Site]

    G[Code Push] --> D
    H[Manual Trigger] --> B
```

## Troubleshooting

**Site shows no jobs**
- Check that scraper has run successfully
- Verify Google Sheet has data
- Download jobs-data artifact to inspect JSON
- Verify service account has Sheet access

**GitHub Pages 404**
- Wait 5-10 minutes after first deployment
- Verify Pages source is "GitHub Actions" in settings
- Check deployment status at /deployments

**Export script fails**
- Verify `GOOGLE_SERVICE_ACCOUNT_JSON` secret is set
- Check Sheet name is "Job Scraping Results"
- Ensure service account has access to Sheet

## Performance

**Typical workflow duration:** ~90 seconds (no new jobs) to ~5 minutes (with AI processing)
- Checkout: 5s
- Install deps: 20s (cached)
- Sync & AI process: 10s - 4 minutes (depends on new job count)
- Build: 15s
- Deploy: 30s

**Build optimization:**
- Dependencies cached via `setup-node@v4`
- Vite build is pre-optimized for production
- Concurrent deployments prevented

## Cost

- **GitHub Actions:** Free for public repositories (unlimited)
- **Expected usage:** ~2,160 minutes/month (hourly updates)
- **GitHub Pages:** Free for public repositories
- **AI Processing (Claude API):** ~$0.01 per new job description
  - Expected: 5-20 new jobs/day = **$1.50-$6/month**
  - Only processes NEW jobs without AI descriptions
  - Zero cost when no new jobs are added

**Recommendation:** Keep repository public to avoid Actions costs.

## Security

**What's safe to expose:**
- ✅ React source code (public repo)
- ✅ Built JavaScript bundles
- ✅ Jobs data (exported from public data source)

**What's protected:**
- 🔒 Service account credentials (GitHub Secret)
- 🔒 Credentials file deleted after each run
- 🔒 Never exposed in logs or artifacts

## Custom Domain (Optional)

To use `jobs.moblyze.com`:

1. Add DNS CNAME: `jobs.moblyze.com → moblyze.github.io`
2. Settings → Pages → Custom domain: `jobs.moblyze.com`
3. Update `vite.config.js` base path to `/`

## Next Steps

After first successful deployment:
- ✅ Bookmark live site URL
- ✅ Monitor first few hourly updates
- ✅ Test manual trigger for emergency updates
- 🎯 Set up custom domain (optional)
- 🎯 Add Google Analytics (optional)
- 🎯 Configure failure alerts (optional)
