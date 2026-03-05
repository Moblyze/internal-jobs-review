# Internal Jobs Review Site

## Overview

The Internal Jobs Review Site is a React-based web application hosted on **GitHub Pages** that provides the Moblyze team with a searchable, filterable interface to review job listings collected by the job scraping pipeline. It aggregates jobs from two sources -- employer career pages (scraped directly) and third-party aggregator sites -- and presents them in a single, unified view with rich filtering capabilities.

The site is designed for internal QA and editorial review: verifying job quality, checking data completeness, identifying which jobs are suitable for seeding into the Moblyze mobile app ("app-ready"), and exploring jobs by region, skill, certification, or employment type.

**Current stats (as of March 2026):** 4,871 total jobs (3,975 employer + 896 aggregator), 864 app-ready.

---

## Data Sources

### Employer Sheets (14 companies)

Job data is scraped directly from employer career pages and stored in the **"Job Scraping Results"** Google Spreadsheet. Each employer has its own worksheet tab. The scraper writes 14 columns per row:

| Column | Index | Field |
|--------|-------|-------|
| Title | 0 | Job title |
| Company | 1 | Employer name |
| Location | 2 | City, state, or multi-location string |
| Description | 3 | Full job description text |
| URL | 4 | Link to original posting |
| Requisition ID | 5 | Employer's internal req ID |
| Posted Date | 6 | When the job was posted |
| Skills | 7 | Semicolon-separated skill tags |
| Certifications | 8 | Semicolon-separated certification tags |
| Salary | 9 | Compensation info (if available) |
| Employment Type | 10 | Full-Time, Contractor, etc. |
| Status | 11 | active, removed, paused |
| Status Changed Date | 12 | When status last changed |
| Scraped At | 13 | Timestamp of last scrape |

### Aggregator Sheet (8 sources x 10 profiles)

A separate Google Spreadsheet (`1xb3QBZG9Dtkyo_UmOGu3Oc3zMr2Cg1ohOyt-cd3WT7Y`) contains jobs collected from aggregator sites. This sheet has 16 columns (A-P) and includes two extra fields not present in employer data:

- **Source** -- the aggregator site the job was found on (e.g., Indeed, ZipRecruiter)
- **Profile** -- the search profile used to find the job (e.g., "Solar Installer Texas", "Wind Technician Oklahoma")

Jobs older than 90 days (based on `Posted Date`) are filtered out during export as stale.

---

## Data Pipeline

The data pipeline is handled by `scripts/export-jobs.js`. It runs as an npm script (`npm run export-jobs`) and produces a single JSON file at `public/data/jobs.json`.

### Steps

1. **Authenticate** -- Uses a Google service account (`job-scraping/config/service_account.json`) with read-only Sheets and Drive scopes.

2. **Find the employer spreadsheet** -- Looks up the spreadsheet named "Job Scraping Results" via the Drive API.

3. **Fetch employer jobs** -- Iterates over every worksheet tab in the employer spreadsheet (skipping any tab named "Aggregator Jobs"). For each tab:
   - Reads the header row to build a dynamic column map.
   - Validates that required columns (`Title`, `Company`, `URL`) exist.
   - Parses each data row into a job object via `parseRow()`.
   - Computes the `appReady` flag on each job.

4. **Fetch aggregator jobs** -- Reads from the separate aggregator spreadsheet (`Aggregator Jobs!A2:P`, skipping the header). For each row:
   - Parses via `parseAggregatorRow()` using a fixed column index map.
   - Maps raw employment type values through `EMP_TYPE_MAP`.
   - Filters out stale jobs (posted > 90 days ago).
   - Computes the `appReady` flag.

5. **Merge and write** -- Combines employer jobs (first) and aggregator jobs into a single array. Writes the result as formatted JSON to `public/data/jobs.json`.

### Job ID Generation

- **Employer jobs:** `{sheetName}-{url}` with non-alphanumeric characters replaced by hyphens, lowercased.
- **Aggregator jobs:** `agg-{jobId or url}` with the same sanitization.

---

## App-Ready Flag

The `isAppReady()` function determines whether a job is suitable for seeding into the Moblyze mobile app. It is computed during the export step and stored as a boolean `appReady` field on each job object.

### Criteria (all must be true)

1. **Has a title** -- `job.title` is truthy.
2. **Has a company** -- `job.company` is truthy.
3. **Has a location** -- `job.location` is truthy.
4. **Description is substantial** -- `job.description.length > 50` characters.
5. **Not Full-Time** -- `job.employmentType !== 'Full-Time'`. Moblyze focuses on contract, temporary, and other non-permanent roles.

If any criterion fails, the job is marked `appReady: false`.

---

## Employment Type Mapping

Aggregator jobs arrive with inconsistent employment type labels. The `EMP_TYPE_MAP` normalizes them to a consistent set of values used across the review site:

| Raw Value | Mapped Value |
|-----------|-------------|
| Contract | Contractor |
| Contractor | Contractor |
| Temporary | Temporary |
| Full-time | Full-Time |
| Full-Time | Full-Time |
| Part-time | Part-Time |
| Part-Time | Part-Time |
| Temp-to-Hire | Contractor |
| Unknown | Other |
| Other | Other |

Employer jobs pass their `Employment Type` column value through as-is (no mapping).

---

## Filters

The review site provides a rich filter sidebar (`FiltersSearchable.jsx`) with the following filter dimensions. All filters are multi-select and use `react-select` for typeahead search.

### Company
- Populated from all unique company names in the dataset.
- Quick-select pills show the top companies by job count.
- Full searchable dropdown available when there are more than 10 companies.

### Location
- Locations are parsed, geocoded (via Mapbox), and grouped by country.
- Supports typeahead search across all parsed location strings.

### Region (Energy Regions)
- Pre-defined energy region pills (e.g., Permian Basin, Gulf Coast, Marcellus Shale).
- Selecting a region expands to all locations within that geographic area.
- Region IDs are stored in the URL (not expanded location lists) for clean URLs.
- Split into "Top 5" and "Additional" region groups.

### Skills
- Validated against the O*NET occupational database for canonical skill names.
- Quick-select pills for the top 10 most common skills.
- Filter matching uses precomputed canonical skill names per job for consistency.

### Certifications
- Extracted from job data using a certification extractor utility.
- Displayed with job counts (e.g., "CDL Class A (142 jobs)").

### Employment Type
- Values: Full-Time, Contractor, Part-Time, Temporary, Internship.
- Shown as quick-select pills. Sorted by prevalence.

### Role
- Energy industry roles loaded asynchronously.
- Displayed with job counts. Uses async `filterJobsByRole()` for matching.

### Source
- Only present on aggregator jobs (employer jobs show as "direct").
- Displayed with job counts, sorted by prevalence.

### Search Profile
- Only present on aggregator jobs.
- Shows which search profile found the job.
- Displayed with job counts, sorted by prevalence.

### Show Inactive (toggle)
- Checkbox to include jobs with `status` of "removed" or "paused".
- Off by default -- inactive jobs are hidden.

### App-Ready Only (toggle)
- Toggle switch to show only jobs where `appReady === true`.
- Displays the total count of app-ready jobs.

---

## URL State Management

All filter state is persisted in the URL via `useFilterParams.js`, a custom React hook built on `react-router-dom`'s `useSearchParams`.

### How It Works

1. **Reading filters:** On each render, the hook reads URL search parameters and parses them into a `filters` object. Array values are split on the pipe character (`|`). Commas are also supported for backward compatibility with older bookmarked URLs.

2. **Writing filters:** When `setFilters()` is called, the hook serializes the filters object back to URL parameters. Empty arrays and false booleans are omitted to keep URLs clean.

3. **History integration:** Each filter change creates a new browser history entry, so the back button works as expected.

### URL Parameter Reference

| Parameter | Type | Delimiter | Example |
|-----------|------|-----------|---------|
| `companies` | multi-value | `\|` | `?companies=Quanta%20Services\|MasTec` |
| `locations` | multi-value | `\|` | `?locations=Houston%2C%20TX\|Midland%2C%20TX` |
| `regions` | multi-value | `\|` | `?regions=permian-basin\|gulf-coast` |
| `skills` | multi-value | `\|` | `?skills=Welding\|Electrical` |
| `certifications` | multi-value | `\|` | `?certifications=CDL%20Class%20A` |
| `roles` | multi-value | `\|` | `?roles=solar-installer\|wind-technician` |
| `employmentTypes` | multi-value | `\|` | `?employmentTypes=Contractor\|Temporary` |
| `sources` | multi-value | `\|` | `?sources=Indeed\|ZipRecruiter` |
| `profiles` | multi-value | `\|` | `?profiles=Solar%20Installer%20Texas` |
| `showInactive` | boolean | n/a | `?showInactive=true` |
| `appReadyOnly` | boolean | n/a | `?appReadyOnly=true` |

### Shareable URLs

A `ShareFilterButton` component and `buildFilterUrl()` utility function allow users to generate and share URLs with pre-applied filters.

---

## Daily Sync

A GitHub Actions workflow (`.github/workflows/sync-data.yml`) keeps the site data fresh automatically.

### Schedule

- Runs daily at **10:00 AM UTC** (1 hour after scraping completes at 9 AM UTC).
- Can also be triggered manually via `workflow_dispatch`.

### What It Does

1. **Checkout** -- Checks out the repository.
2. **Setup** -- Installs Node.js 20 and runs `npm ci`.
3. **Credentials** -- Writes the Google service account JSON from a GitHub secret to the expected file path.
4. **Export** -- Runs `npm run export-jobs` to fetch fresh data from Google Sheets.
5. **Geocode** -- Optionally geocodes any new locations using Mapbox (non-blocking; continues on failure).
6. **Commit** -- If `jobs.json` or `locations-geocoded.json` changed, commits and pushes to main with a message like `Auto data sync: 4871 jobs (320 AI-processed)`.
7. **Build** -- Runs `npm run build` with environment variables for Mapbox, O*NET, and the AI proxy.
8. **Deploy** -- Uploads the `dist/` directory and deploys to GitHub Pages.
9. **Report** -- Logs deployment stats (total jobs, AI-processed count, site URL).

### Concurrency

Only one sync run is allowed at a time (`concurrency.group: "data-sync"`). Concurrent triggers do not cancel in-progress runs.

### Timeout

15 minutes (typical run is 5-10 minutes without AI processing).

---

## Running Locally

### Prerequisites

- Node.js 20+
- Access to the Google service account credentials file at `../job-scraping/config/service_account.json`

### Export fresh data

```bash
npm run export-jobs
```

This fetches jobs from both Google Sheets and writes `public/data/jobs.json`.

### Start the dev server

```bash
npm run dev
```

Opens a local Vite dev server (typically at `http://localhost:5173`).

### Build for production

```bash
npm run build
```

Outputs to `dist/`. Requires environment variables:
- `VITE_MAPBOX_TOKEN` -- Mapbox API token for geocoding
- `VITE_ONET_API_KEY` -- O*NET API key for skill validation
- `VITE_ONET_BASE_URL` -- O*NET API base URL (`https://api-v2.onetcenter.org`)

### Preview the production build

```bash
npm run preview
```

Serves the built `dist/` directory locally.

---

## UI Features

### Infinite Scroll
Jobs are loaded in pages of 24 (`JOBS_PER_PAGE`). As the user scrolls, more jobs are loaded automatically via `react-infinite-scroll-component`.

### Job Cards
Each job is rendered as a `JobCard` component in a responsive 2-column grid on desktop, single column on mobile.

### Back to Top
A floating button appears after scrolling 500px, allowing quick return to the top of the page.

### Refresh Button
A manual "Refresh Jobs" button re-fetches `jobs.json` from the server without a full page reload.

### Last Updated Display
Shows when the data was last refreshed with both an absolute timestamp and a relative "time ago" label (updated every 60 seconds).

### SEO
Dynamic `<title>` and meta description tags are generated based on active filters (e.g., "Solar Installer - Houston, TX Jobs").

### Mobile Responsive
The filter sidebar collapses on mobile with a show/hide toggle. Quick-select pills show 3 items on mobile vs 5 on desktop.
