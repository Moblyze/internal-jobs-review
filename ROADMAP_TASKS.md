# Moblyze Jobs Web - Roadmap Tasks

## Session Handoff - 2026-02-08

### What's Complete ✅

1. **Content Formatting** - Job descriptions now have proper structure (headers, lists, paragraphs)
2. **Location Standardization** - Clean location display (e.g., "Florence, Italy" instead of codes)
3. **Skills Validation** - Filters out generic phrases, salary info, dollar amounts
4. **Multiple Locations** - Shows "Houston, TX +2 more" format
5. **Status Tracking** - Active/removed job tracking from scraper
6. **Basic Filtering** - Company, location, skills filters (but no search within)

### Current State

- **523 jobs** from 5 companies (Baker Hughes, Halliburton, KBR, Noble, Subsea7)
- **Data flow**: Scraper → Google Sheets → JSON export → Website
- **Tech stack**: React + Vite + Tailwind CSS
- **Location**: `/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/`

---

## Parallel Tasks for Next Session

### Task 1: Searchable Filter Dropdowns
**Priority**: HIGH (500+ jobs make filtering critical)

**Problem**:
- Hundreds of locations/skills to choose from
- Current checkbox lists are overwhelming
- No way to search within filter options

**Solution**:
- Replace checkbox lists with searchable dropdowns
- Use existing library (react-select, downshift, or headlessui combobox)
- Implement for both Location and Skills filters
- Multi-select support
- Mobile-friendly

**Files to modify**:
- `src/components/Filters.jsx`
- Add new dependency to `package.json`

**Acceptance criteria**:
- User can type to search locations/skills
- Multi-select works
- Mobile responsive
- Fast performance (100s of options)

---

### Task 2: Regional Location Grouping
**Priority**: HIGH (improves location filtering UX)

**Problem**:
- Alphabetical list of all cities is overwhelming
- Hard to find jobs in a region (e.g., "all Texas jobs")
- No geographic context

**Solution**:
- Group locations by region/country
- Show hierarchical structure:
  - United States
    - Texas (Houston, Midland, etc.)
    - Alaska (Anchorage)
  - Italy
    - Florence
    - Rome
- Allow filtering by region OR specific city
- Use existing geocoding library (don't reinvent)

**Files to modify**:
- `src/utils/locationParser.js` - Add region detection
- `src/components/Filters.jsx` - Hierarchical display
- `src/hooks/useJobs.js` - Region-based filtering

**Recommended libraries**:
- `country-region-data` - ISO country/region data
- `world-countries` - Country metadata
- Or use existing location parser and enhance with regions

**Acceptance criteria**:
- Locations grouped by country/region
- Can filter by "All Texas" or "Houston, TX" specifically
- Region hierarchy displayed clearly
- Mobile-friendly

---

### Task 3: Infinite Scroll with Smart Loading
**Priority**: MEDIUM (performance optimization)

**Problem**:
- Loading all 523 jobs at once impacts performance
- Will get worse as job count grows
- Poor mobile experience with long scrolling

**Solution**:
- Implement infinite scroll
- Load 20-30 jobs initially
- Load more as user scrolls
- Use existing library (react-infinite-scroll-component or react-window)
- Smart loading: maintain filters, preserve state

**Files to modify**:
- `src/pages/JobListPage.jsx`
- Add new dependency to `package.json`

**Acceptance criteria**:
- Loads 20-30 jobs initially (fast)
- Loads more on scroll
- Filters work correctly with pagination
- Smooth UX (loading indicator)
- Handles 1000+ jobs gracefully

---

### Task 4: Enhanced Location Normalization
**Priority**: MEDIUM (data quality improvement)

**Problem**:
- Custom location parser may miss edge cases
- Reinventing the wheel
- Hard to maintain country/region mappings

**Solution**:
- Integrate existing geocoding/location library
- Options:
  - `@googlemaps/google-maps-services-js` (Google Geocoding API)
  - `node-geocoder` (supports multiple providers)
  - `geonames-js` (GeoNames API)
  - `country-state-city` (offline data)
- Enhance location parsing with proper geocoding
- Add coordinates for future map feature

**Files to modify**:
- `src/utils/locationParser.js` - Integrate library
- `package.json` - Add dependency
- Consider API keys if using cloud service

**Acceptance criteria**:
- Better location parsing accuracy
- Handles edge cases (international, multi-location jobs)
- Adds geographic metadata (country, region, coordinates)
- Doesn't break existing functionality

---

## Additional Nice-to-Haves

### Task 5: Skills Normalization Enhancement
- Detect and merge similar skills (e.g., "engineering" and "Engineering")
- Tag skill categories (technical, soft skills, certifications)
- Remove duplicates/variations

### Task 6: Company Logos
- Add company logo images
- Display on job cards and company pages
- Use external API or local assets

### Task 7: Job Search
- Full-text search across title, description, company
- Search highlighting
- Fast search implementation

---

## Technical Notes

### Current File Structure
```
moblyze-jobs-web/
├── src/
│   ├── components/
│   │   ├── Filters.jsx         ← Needs searchable dropdowns
│   │   ├── JobCard.jsx         ← Working well
│   │   └── Layout.jsx
│   ├── pages/
│   │   ├── JobListPage.jsx     ← Needs infinite scroll
│   │   ├── JobDetailPage.jsx   ← Working well
│   │   └── CompanyPage.jsx
│   ├── hooks/
│   │   └── useJobs.js          ← Central data logic
│   └── utils/
│       ├── locationParser.js   ← Enhance with library
│       ├── skillValidator.js   ← Working well
│       └── contentFormatter.js ← Working well
├── public/data/
│   └── jobs.json              ← 523 jobs
└── package.json
```

### Data Export
- Manual: `npm run export-jobs` (from Google Sheets)
- Alternative: `npm run export-from-db` (from SQLite)
- Automation: GitHub Actions (daily scraper, hourly export) - see docs

### Dependencies Already Installed
- react, react-dom, react-router-dom
- tailwindcss
- googleapis
- better-sqlite3
- vite

---

## Suggested Parallel Agent Strategy

**Launch 4 agents simultaneously:**

1. **Agent 1**: Searchable filter dropdowns (Task 1)
2. **Agent 2**: Regional location grouping (Task 2)
3. **Agent 3**: Infinite scroll (Task 3)
4. **Agent 4**: Location normalization library (Task 4)

**Estimated time**: 30-45 minutes total (parallel execution)

**Dependencies between tasks**:
- Task 2 depends on Task 4 (location library helps with regions)
- Task 1 and 3 are independent
- All agents can work in parallel with coordination

---

## Success Criteria

After completion, the website should:
- ✅ Handle 1000+ jobs gracefully (infinite scroll)
- ✅ Easy filtering with search (hundreds of options manageable)
- ✅ Geographic context (region-based location grouping)
- ✅ Better data quality (proper location library)
- ✅ Fast, responsive, mobile-friendly throughout

---

## Commands for Next Session

```bash
# Start dev server
cd /Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web
npm run dev

# Export latest jobs
npm run export-jobs

# Run tests (when added)
npm test

# Build for production
npm run build
```

---

*Handoff created: 2026-02-08*
*Current job count: 523*
*Status: Ready for parallel agent implementation*
