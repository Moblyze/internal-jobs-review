# Moblyze Jobs Web - Scraper Preview Interface

Internal preview tool for visualizing scraped job data from external sources (Baker Hughes, Noble Corporation, KBR, etc.).

## Purpose

**POC/MVP** to demonstrate job scraping capabilities:
- Preview scraped job content in a clean, mobile-friendly interface
- Understand what potential clients are hiring for
- Visualize job quality before importing to production database

**Not public-facing** - Internal team use only.

## Features

✅ **Job Browsing** - Clean, mobile-first job cards
✅ **Searchable Filters** - Type-to-search dropdowns for Company, Location, and Skills (handles 100+ options)
✅ **Multi-Select Filtering** - Select multiple companies, locations, or skills at once
✅ **Job Details** - Full job pages with breadcrumbs
✅ **Company Pages** - View all jobs from a specific employer
✅ **Similar Jobs** - Recommendations based on company/location/skills
✅ **Responsive Design** - Works great on phones and desktops

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Export Jobs from Google Sheets

The scraper writes to Google Sheets. Export that data to JSON:

```bash
npm run export-jobs
```

This fetches data from "Job Scraping Results" Google Sheet and creates `public/data/jobs.json`.

**Note:** Make sure the scraper has run first (`cd ../job-scraping && python main.py`)

### 3. (Optional) Geocode Locations for Accuracy

For accurate location display (Aberdeen showing as UK instead of US, proper country labels, etc.):

```bash
npm run geocode-locations
```

This is a **one-time** operation that uses Mapbox (free tier) to geocode locations. See [README_GEOCODING.md](./README_GEOCODING.md) for setup instructions.

**You can skip this step** - the app includes example geocoded data and works fine without running this command.

### 4. Start Dev Server

```bash
npm run dev
```

Open http://localhost:5173

## Scripts

### Main Commands
- `npm run dev` - Start development server
- `npm run sync-process` - **Automated pipeline**: Fetch jobs from Sheets + AI process new jobs
- `npm run build` - Build for production
- `npm run preview` - Preview production build

### Data Management
- `npm run export-jobs` - Fetch latest jobs from Google Sheets (without AI processing)
- `npm run process-descriptions` - Process jobs with AI descriptions (batch processing)

### Utilities
- `npm run geocode-locations` - One-time location geocoding (see README_GEOCODING.md)
- `npm run verify-geocoding` - Verify geocoding setup
- `npm run match-occupations` - Match jobs to O*NET occupations

### Documentation
- [AUTOMATION_QUICKSTART.md](./AUTOMATION_QUICKSTART.md) - Quick reference for automation
- [docs/JOB_INGESTION_PIPELINE.md](./docs/JOB_INGESTION_PIPELINE.md) - Complete automation guide

## Workflow

### Automated (Recommended)

**One command to fetch and process jobs:**
```bash
npm run sync-process
```

This automatically:
1. Fetches latest jobs from Google Sheets
2. Identifies new/unprocessed jobs
3. Runs AI processing (only on new jobs)
4. Saves results

**Set up daily automation:**
```bash
# Edit crontab
crontab -e

# Add this line (runs daily at 2 AM)
0 2 * * * cd /path/to/moblyze-jobs-web && npm run sync-process >> logs/sync.log 2>&1
```

See [AUTOMATION_QUICKSTART.md](./AUTOMATION_QUICKSTART.md) for details.

### Manual (Step-by-Step)

1. **Run scraper** to populate Google Sheets:
   ```bash
   cd ../job-scraping
   python main.py
   ```

2. **Export and process jobs**:
   ```bash
   npm run sync-process
   ```

3. **Start dev server**:
   ```bash
   npm run dev
   ```

4. **Preview jobs** in browser at http://localhost:5173

## Data Flow

```
External Sources
    ↓
Job Scraper (Python)
    ↓
Google Sheets
    ↓
Export Script (export-jobs.js)
    ↓
jobs.json
    ↓
React App
```

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool
- **React Router** - Navigation
- **Tailwind CSS** - Styling (mobile-first)
- **react-select** - Searchable multi-select dropdowns
- **Google Sheets API** - Data export

## Future

This POC may evolve into:
- Public job board (moblyze-jobs-web full product)
- Direct database integration (skip Google Sheets)
- Production deployment with real-time updates

For now, it's an internal preview tool to validate scraping quality.

## Project Structure

```
moblyze-jobs-web/
├── public/
│   └── data/
│       └── jobs.json          # Exported job data
├── scripts/
│   └── export-jobs.js         # Google Sheets → JSON
├── src/
│   ├── components/
│   │   ├── Breadcrumbs.jsx
│   │   ├── Filters.jsx
│   │   ├── JobCard.jsx
│   │   └── Layout.jsx
│   ├── hooks/
│   │   └── useJobs.js         # Data loading & filtering
│   ├── pages/
│   │   ├── CompanyPage.jsx
│   │   ├── JobDetailPage.jsx
│   │   └── JobListPage.jsx
│   ├── utils/
│   │   └── formatters.js
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
└── package.json
```
