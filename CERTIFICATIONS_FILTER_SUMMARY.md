# Certifications Filter Implementation

## Overview
Added a new "Certifications" filter to allow job seekers to search for positions requiring specific industry certifications.

## What Was Implemented

### 1. Certification Extractor (`src/utils/certificationExtractor.js`)
- Pattern-based extraction from job descriptions and skills
- Recognizes 40+ common energy industry certifications including:
  - **Safety**: OSHA, HAZMAT, HAZWOPER, CPR/First Aid, AED
  - **Industry**: API, IADC, NACE, NICET, IMCA
  - **Professional**: PE License, PMP, PRINCE2, Program Management
  - **Welding**: CWI, CWB, AWS
  - **Quality**: Six Sigma, Lean Six Sigma
  - **Operators**: CDL, Forklift, Crane Operator, Rigger
  - **Maritime**: USCG licenses, Flag State licenses, DPO, Well Control
  - **Trades**: Master Electrician, Journeyman Electrician
  - **HVAC**: EPA 608
  - **Investigation**: TapRooT, ICAM, Topset, COMET

### 2. Updated Hooks (`src/hooks/useJobs.js`)
- Added `getUniqueCertifications(jobs)` function
- Imports certification extractor utility
- Returns sorted array of all unique certifications found across jobs

### 3. Enhanced Filters Component (`src/components/FiltersSearchable.jsx`)
- Added `certifications` prop and state
- New certification multi-select dropdown
- Searchable with react-select
- Displays selected count
- Included in "Clear all" and active filter count
- Same UI/UX pattern as Skills and other filters

### 4. Updated Job List Page (`src/pages/JobListPage.jsx`)
- Added `certifications` to filter state
- Extracts unique certifications from jobs data
- Filters jobs by selected certifications (OR logic - job must have at least one)
- Passes certifications to FiltersSearchable component

## How It Works

1. **Extraction**: On page load, the system scans all job descriptions and skills fields for certification-related keywords
2. **Pattern Matching**: Uses regex patterns to identify certifications (e.g., "CDL", "OSHA 30-hour", "API 510")
3. **Normalization**: Converts variations to standard names (e.g., "Commercial Driver's License" → "CDL")
4. **Filtering**: When user selects certifications, shows only jobs that mention those certifications

## Test Results

From 523 jobs in the dataset:
- **24 jobs (4.6%)** have identifiable certifications
- **23 unique certifications** found
- **Most common**:
  1. Well Control Certification (4 jobs)
  2. Investigation Methodology Certification (3 jobs)
  3. CDL (2 jobs)
  4. HAZMAT (2 jobs)
  5. Six Sigma (2 jobs)

## Files Created
- `/src/utils/certificationExtractor.js` - Main extraction logic

## Files Modified
- `/src/hooks/useJobs.js` - Added certification functions
- `/src/components/FiltersSearchable.jsx` - Added certifications filter UI
- `/src/pages/JobListPage.jsx` - Added certifications filtering logic

## Usage

Users can now:
1. See all available certifications in the filter dropdown
2. Search/type to find specific certifications
3. Select multiple certifications
4. View only jobs requiring those certifications
5. See selected count and clear filters

## Future Enhancements

Potential improvements:
1. Add more certification patterns as new ones are discovered
2. Group certifications by category (Safety, Maritime, Quality, etc.)
3. Add certification quick-select pills like other filters
4. Show certification count per job in job cards
5. Extract certification expiration/renewal requirements
6. Link to certification provider websites

## Testing

Run the test script to verify extraction:
```bash
node test-certifications.js
```

This will show:
- All certifications found
- Sample jobs with certifications
- Statistics (jobs with/without certs)
- Certification frequency distribution
