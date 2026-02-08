# Deployment Guide - Moblyze Jobs Web

Guide for deploying the job board web interface to GitHub Pages with automated updates.

## Quick Start

This website automatically updates every hour by fetching the latest jobs from Google Sheets and rebuilding the site.

**Live Site** (after deployment): `https://moblyze.github.io/moblyze-jobs-web/`

## Prerequisites

1. Scraper repository (`job-scraping`) must be set up first
2. Google Service Account with access to "Job Scraping Results" sheet
3. GitHub repository pushed to `moblyze/moblyze-jobs-web`

See the full setup guide in `job-scraping/DEPLOYMENT.md`.

## GitHub Pages Setup

### Step 1: Enable GitHub Pages

1. Go to repository settings: `https://github.com/moblyze/moblyze-jobs-web/settings/pages`
2. Under **Source**, select: **GitHub Actions**
3. Click **Save**

That's it! The workflow handles everything else.

### Step 2: Configure Repository Secret

Add the Google service account credentials:

1. Go to: `https://github.com/moblyze/moblyze-jobs-web/settings/secrets/actions`
2. Click **New repository secret**
3. Name: `GOOGLE_SERVICE_ACCOUNT_JSON`
4. Value: Paste the entire contents of your service account JSON file:
   ```json
   {
     "type": "service_account",
     "project_id": "your-project-id",
     "private_key_id": "...",
     "private_key": "-----BEGIN PRIVATE KEY-----\n...",
     "client_email": "job-scraper-bot@project-id.iam.gserviceaccount.com",
     ...
   }
   ```
5. Click **Add secret**

### Step 3: Trigger First Deployment

**Option A: Push a commit**
```bash
git commit --allow-empty -m "Trigger initial deployment"
git push origin main
```

**Option B: Trigger manually**
1. Go to: `https://github.com/moblyze/moblyze-jobs-web/actions`
2. Click **Update Website Data** workflow
3. Click **Run workflow** → **Run workflow**

### Step 4: Verify Deployment

1. Wait 2-3 minutes for workflow to complete
2. Go to: `https://github.com/moblyze/moblyze-jobs-web/deployments`
3. Click the latest `github-pages` deployment
4. Click **View deployment** to see your live site

## Automated Updates

### Schedule

The site automatically updates:
- **Every hour** - Exports latest jobs from Google Sheets and redeploys
- **On code changes** - When you push to `main` branch

### How It Works

```
Every Hour:
1. GitHub Actions triggers workflow
2. Exports jobs from Google Sheets to JSON
3. Builds React app with Vite
4. Deploys to GitHub Pages
```

### Manual Trigger

Force an update anytime:

1. Go to Actions: `https://github.com/moblyze/moblyze-jobs-web/actions`
2. Click **Update Website Data**
3. Click **Run workflow** → **Run workflow**

## Monitoring

### Check Latest Deployment

View all deployments:
```
https://github.com/moblyze/moblyze-jobs-web/deployments
```

### Check Workflow Runs

View automation status:
```
https://github.com/moblyze/moblyze-jobs-web/actions
```

### Download Data Artifact

Every workflow run uploads `jobs.json` as an artifact for debugging:

1. Go to workflow run
2. Scroll to **Artifacts** section at bottom
3. Download `jobs-data-[run-id]`

## Local Development

### Test Export Script Locally

Before deployment, test the export:

```bash
# Ensure service account file exists
ls ../job-scraping/config/service_account.json

# Run export
npm run export-jobs

# Verify output
cat public/data/jobs.json | jq 'length'  # Count jobs
```

### Build and Preview Locally

```bash
# Build production bundle
npm run build

# Preview production build
npm run preview
```

Open `http://localhost:4173` to see the production version.

## Workflow Configuration

### Update Frequency

Edit `.github/workflows/update-website.yml`:

**Current:** Hourly updates
```yaml
schedule:
  - cron: '0 * * * *'  # Every hour
```

**More frequent:** Every 30 minutes
```yaml
schedule:
  - cron: '*/30 * * * *'
```

**Less frequent:** Every 4 hours
```yaml
schedule:
  - cron: '0 */4 * * *'
```

### Trigger Conditions

The workflow runs when:

1. **Scheduled** - Hourly (configurable)
2. **Manual** - Via workflow_dispatch
3. **Code changes** - Push to main affecting:
   - `src/**` - React components
   - `public/**` - Static assets
   - `scripts/**` - Export script
   - `package.json` - Dependencies
   - `vite.config.js` - Build config

To deploy on ANY push:
```yaml
push:
  branches:
    - main
```

## Troubleshooting

### Site Shows No Jobs

**Check 1: Has the scraper run?**
```
Go to: https://github.com/moblyze/job-scraping/actions
Verify "Daily Job Scraping" has run successfully
```

**Check 2: Does Google Sheet have data?**
```
Open: https://sheets.google.com/
Find: "Job Scraping Results"
Check that worksheets have job rows
```

**Check 3: Did export succeed?**
```
Go to latest workflow run
Download jobs-data artifact
Check if jobs.json has content
```

**Check 4: Service account access**
```
Verify service account email has Editor access to Sheet
Go to Sheet → Share → Check email is listed
```

### GitHub Pages Shows 404

**Wait for first deployment**
- Initial deployment takes 5-10 minutes
- Check: `https://github.com/moblyze/moblyze-jobs-web/deployments`

**Verify Pages settings**
- Go to: Settings → Pages
- Source must be: "GitHub Actions"

**Check build output**
- Workflow should create `dist/index.html`
- Download Pages artifact to verify

### Deployment Fails

**Error: "Service account not found"**
```yaml
Solution: Verify GOOGLE_SERVICE_ACCOUNT_JSON secret is set correctly
```

**Error: "Cannot find module googleapis"**
```yaml
Solution: Run npm ci instead of npm install in workflow
Already configured correctly in workflow
```

**Error: "Permission denied (GitHub Pages)"**
```yaml
Solution: Workflow needs pages: write permission
Already configured correctly in workflow
```

### Export Script Errors

**Error: "Spreadsheet not found"**
```javascript
// Check SPREADSHEET_NAME in scripts/export-jobs.js
const SPREADSHEET_NAME = 'Job Scraping Results'; // Must match exactly
```

**Error: "credentials.json not found"**
```javascript
// Workflow creates it at ../job-scraping/config/service_account.json
// Verify CREDENTIALS_PATH matches:
const CREDENTIALS_PATH = path.join(__dirname, '../../job-scraping/config/service_account.json');
```

## Security

### Public vs Private Repository

**Current setup:** Public repository (recommended)
- Enables unlimited GitHub Actions minutes
- No secrets in source code
- Service account credentials stored as GitHub secret

**If you need private:**
- Change repository to private in settings
- GitHub Actions free tier: 2,000 min/month
- Hourly updates use ~2,160 min/month (exceeds free tier)

### Secrets Security

The service account JSON is:
- Stored encrypted in GitHub Secrets
- Only accessible to workflows
- Automatically deleted after each run
- Never exposed in logs or artifacts

### Monitoring Access

Review who can:
- Trigger workflows (requires write access)
- Access secrets (GitHub admins only)
- View deployments (public if repo is public)

## Custom Domain (Optional)

### Add Custom Domain

If you want `jobs.moblyze.com` instead of `moblyze.github.io/moblyze-jobs-web`:

1. Add CNAME record in your DNS:
   ```
   jobs.moblyze.com → moblyze.github.io
   ```

2. Configure in GitHub:
   - Settings → Pages
   - Custom domain: `jobs.moblyze.com`
   - Enable HTTPS (wait for certificate)

3. Update `vite.config.js`:
   ```javascript
   export default defineConfig({
     base: '/', // Remove /moblyze-jobs-web/ prefix
     // ...
   })
   ```

### Verify Custom Domain

Wait 24-48 hours for DNS propagation, then check:
```bash
dig jobs.moblyze.com +short
# Should resolve to GitHub Pages IP
```

## Performance

### Build Time

Typical workflow duration:
- Checkout: ~5 seconds
- Install deps: ~20 seconds
- Export jobs: ~10 seconds
- Build: ~15 seconds
- Deploy: ~30 seconds
- **Total: ~80 seconds**

### Optimization Tips

**Cache dependencies:**
```yaml
# Already configured in workflow
- uses: actions/setup-node@v4
  with:
    cache: 'npm'  # Caches node_modules
```

**Skip export if no new data:**
```javascript
// Add to export-jobs.js
const lastExport = fs.existsSync(OUTPUT_PATH)
  ? JSON.parse(fs.readFileSync(OUTPUT_PATH))
  : [];

if (jobs.length === lastExport.length) {
  console.log('No new jobs, skipping build');
  process.exit(0);
}
```

## Analytics (Optional)

### Add Google Analytics

Add to `index.html`:
```html
<head>
  <!-- Google Analytics -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-XXXXXXXXXX');
  </script>
</head>
```

### Track Deployment Metrics

Add to workflow:
```yaml
- name: Report metrics
  run: |
    echo "Jobs exported: $(jq 'length' public/data/jobs.json)"
    echo "Build size: $(du -sh dist)"
    echo "Deployment time: ${{ steps.deployment.outputs.page_url }}"
```

## Next Steps

After successful deployment:

1. ✅ Verify site loads at GitHub Pages URL
2. ✅ Check that jobs display correctly
3. ✅ Test filtering and navigation
4. ✅ Monitor automated hourly updates
5. ✅ Set up alerts for workflow failures (optional)
6. 🎯 Consider custom domain setup
7. 🎯 Add analytics tracking
8. 🎯 Optimize for mobile performance

## Support

Issues? Check:
1. GitHub Actions logs
2. Deployment history
3. Jobs data artifact
4. Main deployment guide: `../job-scraping/DEPLOYMENT.md`
