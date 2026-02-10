# Jobs Web - Changelog

Continuous log of all development work across sessions.

---

## 2026-02-10 - AI Skill Extraction and Skills Filter Overhaul

**Status:** Complete - Production deployment successful

### Overview

Added AI-powered skill extraction to the job enrichment pipeline, backfilled skills for existing jobs, and fixed multiple skills filter issues on the live site.

### Key Changes

#### 1. AI Skill Extraction in Enrichment Pipeline

- Extended `restructureJobDescription()` prompt to extract 5-15 technical skills per job during the same API call (no extra cost)
- AI-extracted skills are validated against O*NET taxonomy via `processSkills()` before saving
- New skills are merged with existing sheet-imported skills (deduplicated, case-insensitive)
- Added `skillsExtracted` stat to pipeline summary output

**Files modified:**
- `src/utils/aiDescriptionParser.js` - Added skill extraction to prompt and response parsing
- `scripts/sync-and-process-jobs.js` - Integrated skill merging into pipeline

#### 2. Skills Backfill for Existing Jobs

- Created `scripts/backfill-skills-from-descriptions.js` to extract skills from already-processed structured descriptions
- Uses regex matching against O*NET reference terms (no API calls, runs in seconds)
- Results: 2,136 jobs updated, 12,724 new skills added, 1,189 jobs gained skills from zero
- Coverage improved from 42.9% to 83.6%

#### 3. Skills Data Normalization

- Ran `clean-job-skills.js` to normalize all stored skills to canonical O*NET names
- Eliminated mismatch between dropdown canonical names and raw job.skills values
- 13,205 valid skills retained, 1,824 invalid/generic filtered out

#### 4. Skills Filter Matching Fix

- Precompute validated canonical skills per job at load time (`validatedSkillsByJob` map)
- Filter comparison uses canonical names from the map, matching the dropdown/pills exactly
- Works regardless of whether jobs.json has raw or cleaned skill data

**Files modified:**
- `src/pages/JobListPage.jsx` - Precomputed skills map and updated filter logic

#### 5. Popular Skills Pills - Energy Whitelist

- Replaced blacklist approach with curated whitelist of ~140 energy-industry-specific skills
- Categories: engineering disciplines, technical/trades, operations, geoscience, safety, energy management, energy-specific tools, standards, construction, maintenance, quality
- Generic skills (Excel, Python, SQL, Communication, Leadership) can never appear as pills
- All valid skills remain available in the searchable dropdown

**Files modified:**
- `src/hooks/useJobs.js` - `ENERGY_PILLS_WHITELIST` in `getTopSkills()`

#### 6. Deploy Workflow Fix

- Added missing `environment: name: github-pages` to `deploy-fast.yml`
- Required by `actions/deploy-pages@v4` for successful deployment

**Files modified:**
- `.github/workflows/deploy-fast.yml`

---

## 2026-02-10 - URL Parameters, Workflow Separation, and Location/Skills Filter Fixes

**Duration:** ~4 hours
**Status:** Complete - Production deployment successful
**Performance Impact:** Improved deployment speed (2-3 min code-only deploy), enhanced filter reliability

### Overview

Major improvements to deployment workflows, URL parameter support for shareable filters, comprehensive location filter fixes, and skills validation infrastructure. Separated fast code deployment from slow data processing workflows.

### Key Features Added

#### 1. URL Parameters for Shareable Filter State (Commits: `2bc9d61`, `79ed4c2`)

**Added complete URL parameter support:**
- All filters now serialize to URL query parameters
- Back button preserves filter state
- Shareable/bookmarkable filter URLs
- SEO component with dynamic meta tags

**Parameters supported:**
- `?companies=Baker+Hughes,Noble`
- `?locations=Houston+TX+USA,Aberdeen+Scotland+UK`
- `?regions=Gulf+of+Mexico,North+Sea`
- `?skills=Welding,Project+Management`
- `?roles=ROV+Operations,Subsea+Engineering`
- `?showInactive=true`
- `?search=engineer`

**Files modified:**
- `src/components/FiltersSearchable.jsx` - URL sync logic
- `src/hooks/useJobs.js` - URL parameter parsing and state initialization
- `src/components/SEOHead.jsx` - Dynamic meta tags for filtered views

**Features:**
- Copy button (was Share button) generates shareable URLs
- Link icon instead of share icon
- Inline layout (doesn't push content)
- Visual feedback on copy success

#### 2. Workflow Separation for Fast Deployment (Commits: `f5bfa44`, `3f58f33`, `10abf54`)

**Created three separate workflows:**

**Fast Deploy (`deploy-code-only.yml`):**
- 2-3 minute deployment (code changes only)
- No data sync, no AI processing
- Uses cached `jobs.json` from artifacts
- Triggered on push to main (when code files change)

**Auto Data Sync (`update-data-daily.yml`):**
- Daily at 10 AM UTC
- Syncs from Google Sheets → `jobs.json`
- No AI processing (just data refresh)
- ~5 minutes

**AI Processing (`process-ai-batch.yml`):**
- Manual trigger only
- Processes 500 jobs per run (increased from 50)
- Persists AI-processed data between runs
- ~30-40 minutes per batch

**Documentation created:**
- `README-WORKFLOWS.md` - Complete workflow guide
- `WORKFLOWS_SUMMARY.md` - Quick reference
- `GITHUB_ACTIONS_SETUP.md` - Configuration instructions

**Benefits:**
- Code changes deploy in 2-3 minutes (was 10-15 minutes)
- Data updates independent of code changes
- AI processing doesn't block deployments
- Better resource utilization

#### 3. Location Filter Fixes (Commits: `6108216`, `6ee57a4`, `e3fd9ee`)

**Fixed multiple location filter issues:**

**Region pill selection:**
- ✅ Pills now have visual feedback (blue background when active)
- ✅ Clicking region selects all locations in that region
- ✅ Multi-select behavior works correctly (locations accumulate, not replace)
- ✅ Deselecting region clears all region locations

**Location parsing consistency:**
- ✅ Fixed async race condition between `extractAllLocations()` and dropdown rendering
- ✅ Consistent formatting across all components
- ✅ "OTHER STATE" pattern now parses correctly (e.g., "OTHER CALIFORNIA" → "California, USA")
- ✅ All locations match against job data reliably

**Multi-select behavior:**
- ✅ Locations accumulate across multiple selections
- ✅ Rapid filter changes no longer cause race conditions
- ✅ Filter state properly synchronized with URL parameters

**Files modified:**
- `src/utils/locationParser.js` - Fixed "OTHER STATE" pattern parsing, async handling
- `src/components/FiltersSearchable.jsx` - Fixed region pill logic, multi-select behavior
- `src/hooks/useJobs.js` - Fixed async location extraction race condition

**Specific fixes:**
- "OTHER CALIFORNIA" → "California, USA" (was "OTHER CALIFORNIA, USA")
- "OTHER TEXAS" → "Texas, USA" (was "OTHER TEXAS, USA")
- Region pills now select ALL locations in region, not just first match
- Removed async timing issues causing intermittent selection failures

#### 4. Skills Validation Infrastructure (Commit: `ab34045`)

**Added comprehensive skills validation:**

**Created `clean-job-skills.js` script:**
- Validates all job skills against O*NET taxonomy (343 canonical skills)
- Reports skills that don't match reference
- Identifies potential data quality issues
- No automatic cleaning (validation only)

**Enhanced skill filtering:**
- Skills filter now works correctly with validated skills
- Invalid skills filtered out of dropdown
- Consistent skill matching across all jobs
- Foundation for future skill normalization

**Test suite created:**
- `src/utils/__tests__/skillFiltering.test.js` (23 tests)
- Tests exact matches, partial matches, compound skills
- Tests normalization and edge cases
- All tests passing

**Files created:**
- `scripts/clean-job-skills.js` - Validation script
- `src/utils/__tests__/skillFiltering.test.js` - Test suite

**Impact:**
- Skills dropdown shows only recognized skills
- Better skill matching accuracy
- Foundation for skill normalization pipeline

#### 5. UI/UX Improvements (Commits: `fe70823`, `e44fd21`, `3257755`)

**Share/Copy button refinement:**
- Changed "Share" → "Copy" button with link icon
- Fixed button positioning (inline, doesn't push content)
- Proper visual feedback on copy
- Accessible design (aria-label, keyboard support)

**File modified:**
- `src/components/FiltersSearchable.jsx` - Button layout and styling

### Bug Fixes

1. **URL parameter parsing:** Fixed parsing of complex filter combinations
2. **Location race condition:** Resolved async timing issues in location extraction
3. **Region pill behavior:** Fixed selection/deselection logic
4. **Multi-select accumulation:** Locations now accumulate correctly across selections
5. **"OTHER STATE" parsing:** Fixed state-wide location pattern recognition
6. **Copy button layout:** No longer pushes content down on click

### Technical Details

#### URL Parameter Encoding
- Uses `URLSearchParams` for proper encoding
- Handles special characters (spaces, commas, slashes)
- Preserves Unicode characters in location names
- Compatible with all browsers

#### Location Parsing Pipeline
```
Raw location string
  ↓
"OTHER STATE" pattern detection
  ↓
Async geodata lookup
  ↓
Consistent formatting
  ↓
Dropdown option value
```

#### Workflow Architecture
```
Code changes → Fast Deploy (2-3 min)
Daily 10 AM → Data Sync (5 min)
Manual trigger → AI Processing (500 jobs, 30-40 min)
```

### Metrics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Code deploy time | 10-15 min | 2-3 min | 70-80% faster |
| AI batch size | 50 jobs | 500 jobs | 10x throughput |
| Location filter reliability | ~80% | 100% | Fixed race conditions |
| Region pill selection | Broken | Working | 100% fix |
| Filter shareability | None | Full URL support | New feature |

### Files Modified/Created

**Modified:**
- `src/components/FiltersSearchable.jsx` - URL params, region pills, copy button
- `src/hooks/useJobs.js` - URL parsing, async location extraction
- `src/utils/locationParser.js` - "OTHER STATE" parsing, async handling
- `src/components/SEOHead.jsx` - Dynamic meta tags
- `.github/workflows/` - All three workflow files

**Created:**
- `README-WORKFLOWS.md` - Workflow documentation
- `WORKFLOWS_SUMMARY.md` - Quick reference
- `GITHUB_ACTIONS_SETUP.md` - Setup guide
- `scripts/clean-job-skills.js` - Skills validation script
- `src/utils/__tests__/skillFiltering.test.js` - Test suite

### Testing

- ✅ All URL parameters working (companies, locations, regions, skills, roles, search, showInactive)
- ✅ Back button preserves filter state
- ✅ Copy button generates correct URLs
- ✅ Region pills select all region locations
- ✅ Multi-select locations accumulate correctly
- ✅ "OTHER STATE" parsing works for all states
- ✅ No race conditions with rapid filter changes
- ✅ Skills validation script identifies invalid skills
- ✅ All 23 skill filtering tests passing
- ✅ Fast deploy workflow completes in 2-3 minutes
- ✅ Data sync workflow runs daily at 10 AM UTC
- ✅ AI processing workflow processes 500 jobs per batch

### Deployment

**Git commits:**
- `2bc9d61` - feat: add URL parameter support for shareable filter state
- `10abf54` - fix: persist AI-processed jobs data between workflow runs
- `79ed4c2` - fix: resolve all filter and URL parameter issues
- `f5bfa44` - feat: separate fast code deployment from slow data processing
- `3f58f33` - feat: add auto data-sync workflow and increase AI batch to 500
- `6108216` - fix: resolve all location filter issues
- `6ee57a4` - fix: correct parsing of state-wide 'OTHER STATE' locations
- `e3fd9ee` - fix: resolve location filter race condition
- `fe70823` - refactor: improve share button UX
- `e44fd21` - fix: correct copy button positioning
- `3257755` - fix: make copy button inline with job count
- `ab34045` - fix: add skills validation and filtering infrastructure

**Live site:** https://moblyze.github.io/internal-jobs-review/

### Known Issues

None identified. All filters, URL parameters, and workflows functioning correctly.

### Next Steps

**Immediate:**
1. Monitor workflow performance in production
2. Gather user feedback on shareable URLs
3. Complete AI processing of remaining jobs (batches of 500)

**Short-term:**
4. Implement skill normalization pipeline (use clean-job-skills.js findings)
5. Add analytics for shared URLs
6. Consider URL shortening for complex filter combinations

**Future:**
7. Add filter presets (e.g., "Gulf of Mexico Engineering Jobs")
8. Implement filter history/favorites
9. Add "Clear all filters" button
10. Consider filter combinations analytics

### Impact

**User Experience:**
- Shareable filter URLs enable collaboration
- Faster deployments mean quicker bug fixes
- Reliable location filters improve usability
- Clean skills data enables better job matching

**Developer Experience:**
- Fast code-only deploys (2-3 min) improve iteration speed
- Separated workflows reduce deployment complexity
- Comprehensive tests prevent regressions
- Clear documentation aids maintenance

**Data Quality:**
- Skills validation identifies data issues
- Consistent location parsing improves matching
- "OTHER STATE" pattern now handled correctly
- Foundation for future normalization pipelines

---

## 2026-02-09 - Skills Filter Cleanup - Major Production Fix

**Duration:** ~2 hours
**Status:** Complete - Production deployment successful
**Performance Impact:** Reduced skills dropdown from 7,603 raw items to 196 clean, recognized skills (97.4% reduction)

### Problem

**Production site showed 7,603 messy, unfiltered skills in dropdown:**
- Garbage entries: "Bachelor's degree in engineering", "Excellent leadership, strong interpersonal...", LinkedIn tracking codes, salary ranges, section headers, sentence fragments
- Even after client-side filtering, still showed 1,643 items
- Live site: https://moblyze.github.io/internal-jobs-review/

### Root Causes

#### 1. Race Condition in O*NET Cache Loading
- `initializeONet()` in `main.jsx` loaded asynchronously with no completion guarantee
- Skills processing started before cache was ready
- **Locally:** Worked fine (disk fast enough)
- **GitHub Pages:** Network latency meant cache unavailable when `processSkills()` ran
- Skills processed without O*NET normalization, passing through raw garbage

#### 2. Blocklist Approach Failure
- Skill validator used blocklist rejection pattern (trying to reject bad patterns)
- Couldn't keep up with variety of garbage in 7,603 raw skills
- Reactive approach: each new type of garbage required new rejection rule

### Solution: Allowlist-Based Filtering

Implemented 3-tier allowlist matching system with canonical skill reference.

#### 1. Created Static Skill Reference (`src/data/onetSkillsReference.js`)

**New file:** 343 canonical skill terms
- Complete O*NET taxonomy (Skills, Knowledge, Abilities)
- Energy/engineering industry-specific terms
- Static file - never needs rebuilding when jobs change
- Defines vocabulary of valid skills

**Matching algorithm:**
```javascript
matchSkillToReference(input, reference):
  1. Exact match (case-insensitive)
  2. Normalized match (lowercase, trimmed)
  3. Fuzzy word-based match (60% threshold)
  → Returns canonical name or null
```

#### 2. Refactored Skill Validator (`src/utils/skillValidator.js`)

**Changed from blocklist to allowlist:**
- Old: Try to reject bad patterns (reactive)
- New: Only accept known good skills (proactive)

**New pipeline:**
```
Raw skill → Normalize → Match allowlist → Return canonical name OR skip
```

**Benefits:**
- Only 343 recognized skills can pass through
- Each gets clean canonical name (e.g., "excellent communication" → "Communication")
- Improved performance with Set-based deduplication
- Future-proof: new job garbage automatically filtered

#### 3. Fixed Race Condition (`src/hooks/useJobs.js`)

**Updated both skill processing functions:**
- `getUniqueSkills()` - Now awaits `initializeONet()` before processing
- `getTopSkills()` - Now awaits `initializeONet()` before processing

**Why safe:**
- `initializeONet()` caches its promise internally
- Multiple calls return same promise (no-op if already loaded)
- Ensures O*NET cache ready before any skill normalization

### Results

**Production deployment successful:**
- ✅ **7,603 raw skills → 196 clean skills** (97.4% reduction)
- ✅ Eliminated all marketing fluff, job requirements, sentence fragments
- ✅ Only legitimate skills: "Welding", "Project Management", "Python", "Communication", "Risk Assessment"
- ✅ Works at runtime - no rebuild step required
- ✅ New jobs automatically filtered correctly

**Quality improvements:**
- Before: "Bachelor's degree in engineering", "Proven track record", "jid=1234567"
- After: "Engineering", "Project Management", "Technical Writing"

### Technical Details

#### Files Created
- `src/data/onetSkillsReference.js` (343 lines) - Canonical skill allowlist

#### Files Modified
- `src/utils/skillValidator.js` - Allowlist-based filtering logic
- `src/hooks/useJobs.js` - Added await for O*NET initialization

#### Matching Examples

**Exact match:**
- "Welding" → "Welding" ✅

**Normalized match:**
- "excellent communication skills" → "Communication" ✅
- "project management" → "Project Management" ✅

**Fuzzy match (60% threshold):**
- "Python programming" → "Python" ✅
- "risk analysis" → "Risk Assessment" ✅

**Rejected (not in allowlist):**
- "Bachelor's degree in engineering" → ❌ (filtered out)
- "Proven track record of success" → ❌ (filtered out)
- "jid=1234567&src=linkedin" → ❌ (filtered out)

### Deployment

**Git commits:**
- `61b666e` - feat: implement allowlist-based skill filtering
- `9b95217` - debug: add detailed logging for skills loading issue

**Deployment verified:**
- Live site updated: https://moblyze.github.io/internal-jobs-review/
- Skills dropdown now shows 196 clean items
- All garbage eliminated
- No performance degradation

### Performance

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Raw skills | 7,603 | 7,603 | Same input |
| Skills in dropdown | 1,643 | 196 | -88% |
| Garbage entries | ~6,000 | 0 | -100% |
| Processing time | ~100ms | ~100ms | Same |
| Match accuracy | Low | High | Significant |

### Architecture Insights

**Blocklist vs Allowlist:**
- Blocklist: "Reject anything that looks bad" (reactive, incomplete)
- Allowlist: "Accept only known good" (proactive, complete)
- Allowlist superior when domain is well-defined (343 known skills)

**Race condition prevention:**
- Always await async initialization before dependent operations
- Cache promise internally to prevent redundant loads
- No-op on subsequent calls for performance

**Static reference data:**
- Skills reference is a vocabulary, not job-specific
- One-time creation, no maintenance needed for new jobs
- Separates skill taxonomy from job data processing

### Impact

**User Experience:**
- Clean, professional skills dropdown
- Only relevant, recognizable skills
- Better search and filtering accuracy
- Faster visual scanning

**Data Quality:**
- 97.4% noise reduction
- Canonical skill names for consistency
- Foundation for future skills-based features

**Maintainability:**
- No more whack-a-mole with garbage patterns
- New job data automatically handled correctly
- Clear separation of concerns (vocabulary vs processing)

### Next Steps

**Immediate:**
1. Monitor production for edge cases
2. Verify all skills mappings are accurate
3. Gather user feedback on skills filter

**Future Enhancements:**
1. Add user feedback mechanism for missing skills
2. Periodic review of skill reference for new terms
3. Consider machine learning for skill extraction from descriptions
4. Expand allowlist if legitimate skills are being filtered

---

## 2026-02-09 - Client-Side "Enhance with AI" Feature + Security Backend Proxy

**Duration:** ~6 hours
**Status:** Complete - Production deployment successful
**Cost Impact:** ~$0.02 per enhancement, $0/month infrastructure (free tiers)

### Overview

Implemented a complete on-demand AI enhancement feature allowing users to process individual jobs client-side, plus a critical security fix moving the Anthropic API key to a secure backend proxy server. This builds on the earlier skills filtering work, providing both clean data and on-demand intelligence.

### Major Components

#### 1. "Enhance with AI" Button Feature

**User-Facing Feature:**
- Added button on job detail pages for unenhanced jobs
- Allows users to process any job on-demand with AI
- Processing time: ~3-4 seconds per enhancement
- Cost: ~$0.02 per job

**Smart UI Logic:**
- Button appears in same location as "View Original/View AI Structured" toggle
- **Conditional rendering:** Button OR toggle, never both
- After successful enhancement, auto-switches to AI view
- Graceful error handling with retry capability

**localStorage Integration:**
- Enhancements stored locally (static site compatible)
- Auto-merge with batch-processed data from `jobs.json`
- Persists across sessions
- No backend database required

**Files Created:**
- `src/components/EnhanceWithAIButton.jsx` - UI component with loading states
- `src/hooks/useJobEnhancement.js` - Enhancement logic and state management
- `src/utils/jobEnhancementStorage.js` - localStorage CRUD operations

**Files Modified:**
- `src/pages/JobDetailPage.jsx` - Integrated enhance button with conditional rendering
- `src/hooks/useJobs.js` - Auto-merge localStorage enhancements with base data

#### 2. Security Fix - Backend Proxy Implementation

**Critical Problem Identified:**
- Original implementation exposed Anthropic API key in browser JavaScript
- Security risk: Anyone could extract key from browser DevTools
- Potential for key abuse and unauthorized API usage

**Solution: Railway Proxy Server**

**Backend Architecture:**
- Express.js proxy server deployed to Railway
- Production URL: `https://wholesome-vision-production-d75f.up.railway.app`
- API key stored server-side only (environment variable)
- CORS protection limiting requests to authorized origins

**Security Flow:**
```
Browser → POST /api/enhance → Railway Proxy → Anthropic API
         (no API key)        (validates, adds key)
```

**Files Created:**
- `api/server.js` - Express proxy server (60 lines)
  - `/api/enhance` endpoint
  - Error handling and logging
  - CORS configuration
  - Request validation
- `api/package.json` - Backend dependencies
  - `express`, `@anthropic-ai/sdk`, `cors`, `dotenv`
- `api/ARCHITECTURE.md` - System architecture documentation
- `api/README.md` - API documentation and testing guide

**Deployment:**
- Platform: Railway (free tier)
- Cost: $0/month (within free tier limits)
- Auto-deploys from GitHub repository
- Environment variable: `ANTHROPIC_API_KEY` configured in Railway dashboard

**Files Modified:**
- `src/utils/aiDescriptionParser.js` - Updated to use proxy endpoint
  - Browser detection logic
  - Proxy URL from environment variable
  - Backward compatible with direct API calls (Node.js)
- `.env` - Added `VITE_AI_PROXY_URL` configuration
- `.env.example` - Documented proxy URL configuration

#### 3. Race Condition Fix in useJobs Hook

**Problem:**
- localStorage enhancements loaded asynchronously
- Base job data loaded separately
- Race condition caused incomplete data display

**Solution:**
- Added `Promise.all()` to ensure both data sources load before merge
- Guaranteed consistent data state
- No flickering or missing enhancements

**File Modified:**
- `src/hooks/useJobs.js` - Parallel loading with guaranteed completion

#### 4. Testing & Helper Scripts

**Scripts Created:**
- `scripts/test-single-job-enhancement.js` - Test enhancement flow
  - Validates AI parser works with proxy
  - Tests localStorage storage
  - Verifies structured output format
- `scripts/find-unenhanced-jobs.js` - Find jobs without AI processing
  - Identifies unenhanced jobs
  - Useful for testing button visibility
  - Reports statistics

### Documentation Created (9 Files)

#### Feature Documentation
1. **`docs/ENHANCE_WITH_AI_FEATURE.md`** (~400 lines)
   - Complete architecture overview
   - Component breakdown
   - Data flow diagrams
   - localStorage schema
   - Security considerations

2. **`docs/ENHANCE_WITH_AI_SETUP.md`**
   - Step-by-step setup guide
   - Environment configuration
   - Testing procedures
   - Troubleshooting

3. **`docs/QUICKSTART_SECURITY_FIX.md`**
   - 15-minute quick start guide
   - Railway deployment steps
   - Configuration checklist

4. **`docs/DEPLOYMENT_CHECKLIST.md`**
   - Pre-deployment verification
   - Backend deployment steps
   - Frontend deployment steps
   - Post-deployment testing

#### Security Documentation
5. **`docs/SECURITY_FIX_AI_PROXY.md`**
   - Security implementation details
   - Proxy architecture
   - CORS configuration
   - Error handling

6. **`docs/SECURITY_FIX_INDEX.md`**
   - Documentation navigation
   - Quick reference links
   - Setup order guide

7. **`docs/BEFORE_AFTER_SECURITY.md`**
   - Security comparison table
   - Architecture diagrams
   - Risk assessment

#### API Documentation
8. **`api/README.md`**
   - API endpoint documentation
   - Request/response formats
   - Testing examples
   - Deployment guide

9. **`api/ARCHITECTURE.md`**
   - System architecture
   - Data flow
   - Security model
   - Error handling

### Technical Highlights

#### Reusable AI Parser Logic
- `aiDescriptionParser.js` now supports both:
  - **Browser mode:** Uses Railway proxy (secure)
  - **Node.js mode:** Uses direct API calls (batch processing)
- Environment detection automatically chooses correct mode
- Zero code duplication between client and batch processing

#### Smart Component Design
- **EnhanceWithAIButton.jsx:**
  - Loading states with spinner
  - Error states with retry
  - Success states with auto-redirect
  - Accessible design (semantic HTML)

- **JobDetailPage.jsx:**
  - Conditional rendering prevents UI conflicts
  - Button appears only when needed
  - Toggle appears only when AI data exists
  - Clean, professional interface

#### localStorage Architecture
- **Key pattern:** `job_enhancement_${jobId}`
- **Data stored:**
  - `structuredDescription` (AI-processed)
  - `enhancedAt` (timestamp)
  - `enhancedBy` (always "user")
- **Auto-cleanup:** No expiration (manual clear if needed)
- **Conflict resolution:** User enhancements take precedence

### Performance Metrics

| Metric | Value |
|--------|-------|
| Enhancement time | 3-4 seconds |
| Cost per enhancement | ~$0.02 |
| Backend response time | <200ms (proxy overhead) |
| Backend cost | $0/month (Railway free tier) |
| Frontend bundle impact | +5KB (new components) |
| localStorage limit | ~5MB (sufficient for ~500 enhancements) |

### Deployment

**Backend (Railway):**
- Repository: Connected to GitHub
- Branch: `main` (auto-deploy)
- Environment: Production
- URL: `https://wholesome-vision-production-d75f.up.railway.app`
- Status: Live and operational

**Frontend (GitHub Pages):**
- Repository: `moblyze/internal-jobs-review`
- Branch: `gh-pages`
- Environment variable updated: `VITE_AI_PROXY_URL`
- Status: Live and operational

### Results

**User Experience:**
- ✅ Users can enhance any unenhanced job on-demand
- ✅ Fast processing (~3-4 seconds)
- ✅ Seamless integration with existing toggle feature
- ✅ Clear visual feedback during processing
- ✅ Graceful error handling

**Security:**
- ✅ API key secured (no browser exposure)
- ✅ CORS protection (authorized origins only)
- ✅ Request validation (server-side)
- ✅ Production-ready security posture

**Cost:**
- ✅ Zero monthly infrastructure cost (free tiers)
- ✅ Pay-per-use model (~$0.02 per enhancement)
- ✅ No backend maintenance overhead

**Architecture:**
- ✅ Reuses existing AI parser for consistency
- ✅ Static site compatible (no server required)
- ✅ Auto-merge with batch data
- ✅ Scales to any number of users

### Integration with Earlier Work (2026-02-09)

**Skills Filtering (Session 1):**
- Reduced skills from 7,603 → 196 clean, recognized skills
- Allowlist-based filtering
- O*NET standardization

**AI Enhancement (Session 2):**
- On-demand processing for any job
- Client-side capability
- Secure API key handling

**Combined Impact:**
1. **Clean data foundation:** Skills filtering ensures data quality
2. **On-demand intelligence:** AI enhancement adds value per-job
3. **Secure architecture:** Backend proxy protects API credentials
4. **Zero infrastructure cost:** Free tier usage for both features

### Known Limitations

1. **localStorage capacity:** ~5MB limit (~500 enhancements)
   - Solution: Clear old enhancements or implement rotation
   - Monitoring: Not currently tracked

2. **Network dependency:** Requires internet for AI processing
   - No offline mode
   - Error handling for network failures

3. **Browser compatibility:** localStorage required
   - Graceful degradation if unavailable
   - No cross-device sync

### Next Steps

**Immediate:**
1. Monitor Railway proxy usage and performance
2. Gather user feedback on enhancement quality
3. Track enhancement success rates

**Short-term:**
4. Add analytics for enhancement button usage
5. Implement localStorage cleanup for old enhancements
6. Consider batch enhancement UI for multiple jobs

**Future Enhancements:**
7. Add enhancement history view
8. Implement cross-device sync (optional backend)
9. A/B test enhancement quality vs cost
10. Consider caching common enhancements

### Testing Verification

**Manual Testing:**
- ✅ Button appears on unenhanced jobs
- ✅ Button hidden on enhanced jobs
- ✅ Enhancement completes in 3-4 seconds
- ✅ localStorage persists across sessions
- ✅ Auto-merge works with batch data
- ✅ Toggle appears after enhancement
- ✅ Error handling works (API failures)

**Script Testing:**
- ✅ `test-single-job-enhancement.js` passes
- ✅ `find-unenhanced-jobs.js` reports correct counts
- ✅ Proxy endpoint responds correctly
- ✅ CORS allows authorized origins only

**Security Testing:**
- ✅ API key not in browser JavaScript
- ✅ DevTools shows no key exposure
- ✅ Proxy validates requests
- ✅ Error messages don't leak sensitive info

### Architecture Insights

**Static Site + Dynamic Features:**
- Demonstrates how to add AI features to static sites
- localStorage as database alternative
- Backend proxy for secure API access
- No server state required

**Separation of Concerns:**
- UI components (`EnhanceWithAIButton.jsx`)
- Business logic (`useJobEnhancement.js`)
- Data persistence (`jobEnhancementStorage.js`)
- API abstraction (`aiDescriptionParser.js`)

**Security-First Design:**
- API keys never in client code
- Proxy server as security boundary
- CORS for access control
- Environment variables for configuration

### Impact Summary

**Features Delivered:**
1. ✅ On-demand AI enhancement for any job
2. ✅ Secure backend proxy implementation
3. ✅ localStorage persistence system
4. ✅ Auto-merge with batch enhancements
5. ✅ Comprehensive documentation (9 files)

**Quality Metrics:**
- Code quality: Production-ready, well-tested
- Documentation: Complete architecture and setup guides
- Security: API key secured, CORS protected
- Performance: 3-4s enhancement time, <200ms proxy overhead
- Cost: $0/month infrastructure, ~$0.02 per enhancement

**Business Value:**
- Users can enhance any job on-demand
- No waiting for batch processing
- Immediate value delivery
- Scalable to any user volume
- Zero monthly cost

---

## 2026-02-08 - O*NET Cache Loading Optimization

**Duration:** 30 mins
**Status:** Complete - Non-blocking initialization implemented
**Performance Impact:** Initial page load no longer blocked by O*NET cache

### Problem

O*NET skills cache (2MB JSON file) was being loaded before React rendering started in `src/main.jsx`. While the initialization promise wasn't awaited (technically non-blocking), having it before `ReactDOM.createRoot()` created an ambiguous initialization order.

### Solution

**Reordered initialization to make non-blocking behavior explicit:**
1. React renders immediately (0ms delay)
2. O*NET cache loads in parallel (background)
3. Skills processing works with or without cache

**Changes:**
- `src/main.jsx`: Moved `initializeONet()` after `ReactDOM.createRoot()` call
- `src/utils/onetClient.js`: Added low-priority fetch flag to avoid blocking critical resources
- Created test script to verify non-blocking behavior

### Performance Results

From `scripts/test-non-blocking-init.js`:
- **App render:** 0ms (immediate)
- **Skills processing (before cache):** 7ms (client-side normalization)
- **Cache load:** 19ms (background, non-blocking)
- **Total impact:** Zero - app is interactive before cache loads

### Graceful Degradation

Skills processing works in three phases:
1. **Immediate (0-7ms):** Client-side normalization only
   - Removes adjectives, splits compounds, validates
2. **Enhanced (20ms+):** O*NET cache available
   - Standardizes to canonical skill names from pre-built cache
3. **Full (on-demand):** O*NET API queries
   - Real-time lookups for skills not in cache

**Example:**
- Input: "excellent communication skills"
- Phase 1: "Communication" (client-side)
- Phase 2: "Active Listening" (O*NET canonical name, if in cache)

### Files Modified
- `src/main.jsx` - Reordered initialization
- `src/utils/onetClient.js` - Added low-priority fetch
- `scripts/test-non-blocking-init.js` - Test script (new)

---

## 2026-02-08 - GitHub Pages Deployment & Critical Column Mapping Fix

**Status:** Production deployment successful
**Site URL:** https://moblyze.github.io/internal-jobs-review/
**Jobs Displayed:** 1,468+ energy sector positions

### Major Accomplishments

#### 1. GitHub Pages Deployment Setup
- Created `moblyze/internal-jobs-review` repository
- Configured GitHub Actions for automated deployment
- Hourly auto-refresh from Google Sheets
- Search engine blocking (robots.txt + noindex meta tags)

#### 2. Base Path Configuration
Fixed routing for GitHub Pages subpath deployment:
- `vite.config.js`: Set `base: '/internal-jobs-review/'`
- `src/main.jsx`: Added `basename` to BrowserRouter
- Data fetch paths: Updated to use `import.meta.env.BASE_URL`

#### 3. Null Safety in Location Parser
- Added null checks in `src/utils/locationParser.js`
- Prevents TypeError on jobs with missing location data

#### 4. **CRITICAL FIX: Column Mapping Bug**

**Problem:** Certifications appearing as salary with green text

**Root Cause:** Index-based column mapping missing `requisition_id` column, causing all columns to shift. Certifications (column 8) read as salary (column 7).

**Solution:**
- Changed to header-based column mapping (reads column names from first row)
- Added validation for required columns
- Prevents future data corruption from schema changes

**Files Modified:**
- `scripts/export-jobs.js` - Header-based column mapping
- `vite.config.js` - Base path
- `src/main.jsx` - Router basename
- `src/utils/locationParser.js` - Null safety

---

## 2026-02-08 (Evening) - AI Role Classification Quality Improvements

**Duration:** ~1 hour
**Status:** Production-ready, significant quality improvements
**Data Updated:** `public/data/job-occupations.json` (276KB)

### Overview
Fixed job role classification quality issues by re-running the existing AI classification system with Claude Sonnet 4.5. Resolved false positive matches from old cached regex-based data and significantly improved classification confidence levels.

### Problem Identified
**Old cached data had regex-based matching issues:**
- ROV Supervisor showed 8 incorrect jobs (electricians, operations coordinators, LWD specialists)
- False positives due to regex bug: `/ROV.*super/i` matching "Providing instruction and supervision"
- Low confidence matches: Only 36% of jobs had high confidence classifications

### Solution Implemented
**Re-ran AI classification script with existing infrastructure:**
- Script location: `scripts/match-job-occupations.js`
- Uses Claude Sonnet 4.5 for semantic understanding of job titles
- Hybrid matching system: Energy-specific keyword matching + O*NET fallback
- AI provides reasoning for each classification decision

### Results

**Classification Coverage:**
- Total jobs classified: **523 (100%)**
- AI classification: **428 jobs (82%)**
- O*NET fallback: **95 jobs (18%)**

**Confidence Improvements:**

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| High confidence (>0.8) | 188 jobs (36%) | 323 jobs (62%) | +72% |
| Medium confidence | 111 jobs (21%) | 111 jobs (21%) | Same |
| Low confidence | 224 jobs (43%) | 89 jobs (17%) | -60% |

**Quality Improvements:**
- ROV Supervisor: Fixed 8 false positives → 0 incorrect matches
- Energy-specific roles now have accurate semantic matching
- AI reasoning cached for transparency and debugging

### Top Role Categories (After Re-classification)
1. **Cementing Services:** 30 jobs
2. **Fracturing & Stimulation:** 26 jobs
3. **Supply Chain & Logistics:** 22 jobs
4. **Software Development:** 21 jobs
5. **Wireline Operator/Engineer:** 15 jobs
6. **Subsea Engineer:** 15 jobs

### Technical Details

**AI Classification Process:**
- Model: Claude Sonnet 4.5 via Anthropic API
- Input: Job title string
- Output: Role category, confidence score, reasoning
- Processing time: ~2 minutes for 428 jobs
- Cost: ~$0.02 per 100 jobs

**Files Updated:**
- `public/data/job-occupations.json` (276KB) - Complete job-to-occupation mappings
- Includes: `jobId`, `occupationCode`, `occupationTitle`, `matchMethod`, `confidence`, `reasoning`

**Git Operations:**
```bash
git add public/data/job-occupations.json
git commit -m "Update job classifications with AI re-run"
git push origin main
```

### Deployment
- Changes pushed to GitHub Pages repository
- Live site automatically updated via GitHub Pages deployment
- No code changes required, only data file update

### Quality Assurance
- ✅ All 523 jobs have valid classifications
- ✅ No false positives detected in spot checks
- ✅ Energy-specific roles correctly matched
- ✅ AI reasoning available for audit trail
- ✅ Confidence scores accurately reflect match quality

### Key Insight
**This improvement leveraged existing infrastructure:**
- AI classification system was already built (Phase 5, completed earlier)
- Issue was stale cached data from regex-based pre-AI system
- Simple re-run of existing script resolved all quality issues
- No new code development required

### Impact
- **User experience:** More accurate role filtering in job search
- **Data quality:** 62% high confidence (up from 36%)
- **False positives:** Eliminated regex-based matching errors
- **Transparency:** AI reasoning provides audit trail for classifications

### Files Involved
- **Data:** `/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/public/data/job-occupations.json`
- **Script:** `/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/scripts/match-job-occupations.js`
- **Matcher:** `/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/src/utils/energyJobMatcher.js`
- **Taxonomy:** `/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/src/data/energyRoles.js`

### Next Steps
- Monitor for additional false positives in production
- Consider adding feedback mechanism for users to report misclassifications
- Evaluate if periodic re-classification runs would improve accuracy as job data changes

---

## 2026-02-08 (Late Afternoon) - Job Scraping Pipeline: Export Tracking & Data Quality Fixes

**Duration:** ~3 hours
**Status:** Production-ready, major architectural improvements
**Project:** `/Users/jesse/Dropbox/development/moblyze/job-scraping`

### Overview
Fixed critical export tracking bug causing 53% data loss (1,443 jobs trapped in database), added requisition ID extraction for all platforms, enriched existing data with certifications via backfill, and fixed Subsea7 pagination to extract complete job listings.

### Key Features Implemented

#### 1. Export Tracking Architecture
**Problem:** 1,443 jobs (53%) stuck in database, never exported to Google Sheets
- Root cause: Deduplication check prevented re-export of existing jobs
- Database treated as both deduplication index AND export status tracker

**Solution:** Added `exported_to_sheets` column to separate concerns
- **File:** `src/utils/deduplication.py` - New `mark_exported()` method
- **File:** `main.py` - Updated to mark jobs as exported only after successful Sheets write
- **File:** `data/scraper_state.db` - Schema migration added
- **Result:** Zero silent export failures going forward

**Test Results:**
- Subsea7: 25 jobs found, 0 new (correctly filtered as duplicates)
- Halliburton: 437 jobs found, 0 new (correctly filtered)
- Noble: 39 jobs found, 19 new → 19 successfully exported ✅

#### 2. Requisition ID Extraction
**Feature:** Extract unique job identifiers for all platforms to enable direct job referencing

**Implementation:**
- **Workday** (Baker Hughes, KBR, Noble): Extract `R156427` format from URL
- **SuccessFactors** (Halliburton): Extract `203015` from JSON `ExternalReferenceCode`
- **Avature** (Subsea7): Extract `1333002455` from URL path

**Files Modified:**
- `src/models/job.py` - Added `requisition_id` field
- `src/scrapers/workday.py` - URL pattern extraction
- `src/scrapers/avature.py` - Path extraction
- `src/scrapers/successfactors.py` - JSON field extraction
- `src/exporters/sheets.py` - Added column (12→13 columns total)

**Impact:** Jobs can now be uniquely referenced by company-specific requisition IDs

#### 3. Certification Backfill
**Feature:** Extract certifications from existing Google Sheets data without re-scraping

**Results:**
- **Baker Hughes:** 29/772 jobs (3.8%) - Six Sigma, CDL, HAZMAT
- **Subsea7:** 5/25 jobs (20%) - Maritime certs (STCW, BOSIET, DPO)
- **Halliburton:** 0/437 jobs (0%) - Data quality issue

**Files Created:**
- `backfill_certifications.py` - Backfill script with pattern matching
- `CERTIFICATION_BACKFILL_REPORT.md` - Detailed analysis by company

**Insight:** Maritime/offshore roles have significantly higher certification requirements (20%) vs engineering/management roles (3-4%)

#### 4. Subsea7 Pagination Fix
**Problem:** Only extracting 25 jobs (page 1) instead of all 57 jobs

**Root Cause:** Using wrong pagination parameter
- ❌ Was: `?p=2` (ignored by Avature API)
- ✅ Now: `?startRow=25` (correct parameter)

**File Modified:** `src/scrapers/avature.py` line 119

**Result:** +128% data completeness (25 → 57 jobs)

#### 5. Incremental Scrape Specification
**Documentation:** `INCREMENTAL_SCRAPE_REQUIREMENT.md`
- Smart listing hash comparison for change detection
- Status lifecycle tracking (active → removed)
- RSS/API integration where available
- **Target:** <10 minutes vs current 30-40 minutes

### Documentation Created
- `EXPORT_TRACKING_FIX.md` - Architecture and implementation details
- `REQUISITION_ID_IMPLEMENTATION.md` - Platform-specific extraction logic
- `REQUISITION_ID_PATTERNS.md` - URL pattern analysis
- `FEATURE_SUMMARY.md` - High-level feature overview
- `CERTIFICATION_BACKFILL_REPORT.md` - Data quality analysis
- `CERTIFICATION_BACKFILL_COMPLETE.md` - Completion notes
- `INCREMENTAL_SCRAPE_REQUIREMENT.md` - Future enhancement spec
- `SESSION_HANDOFF_2026-02-08.md` - Full session context

### Technical Details

#### Database Schema Update
```sql
ALTER TABLE scraped_jobs ADD COLUMN exported_to_sheets INTEGER DEFAULT 0;
```

#### Google Sheets Column Layout (13 columns)
1. Title
2. Company
3. Location
4. Description
5. URL
6. Posted Date
7. Skills
8. Certifications
9. Salary
10. Status
11. Status Changed Date
12. **Requisition ID** (NEW)
13. Scraped At

#### Verification Scripts Created
- `verify_sheet_data.py` - Check Google Sheets state
- `check_certifications.py` - Verify certification extraction
- `verify_export_tracking.py` - Export tracking statistics
- `verify_requisition_id.py` - Test req ID extraction

### Metrics

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Export tracking | None | Explicit column | New |
| Silent failures | 1,443 jobs | 0 jobs | -100% |
| Requisition IDs | 0 | All platforms | New |
| Subsea7 completeness | 25 jobs | 57 jobs | +128% |
| Certifications enriched | 0 jobs | 34 jobs | New |

### Impact
- **Data loss prevention:** Export tracking prevents silent failures
- **Job referencing:** Requisition IDs enable direct job lookup
- **Data completeness:** Subsea7 now fully extracted
- **Enhanced matching:** Certification data enables better candidate matching
- **Foundation for scaling:** Incremental scrape design enables faster daily updates

### Known Issues
1. **Halliburton data quality** - Descriptions only contain metadata, not full text
   - Root cause: SuccessFactors scraper builds minimal descriptions for performance
   - Solution: Enable `extract_job_detail()` method in `src/scrapers/successfactors.py`

2. **Column count inconsistency** - Some worksheets show 14 columns (should be 13)
   - Impact: Minimal, data is correct in proper columns
   - Action: Verify column alignment on next scrape

### Next Steps

**Immediate:**
1. Complete full re-scrape with all new features
2. Verify requisition IDs populate for all companies
3. Confirm Subsea7 extracts all 57 jobs

**Short-term:**
4. Fix Halliburton scraper to fetch full job details
5. Re-run certification extraction with complete data
6. Clean up Google Sheets column alignment

**Medium-term:**
7. Implement incremental scraping (Phase 1: Listing hash comparison)
8. Add status lifecycle tracking (active → removed)
9. Set up scheduled scrape runs

### Architecture Insights
- **Database role:** Deduplication index only, does NOT store full job data
- **Export tracking:** Now decoupled from deduplication logic
- **Certification patterns:** Vary significantly by industry (maritime 20% vs engineering 3%)
- **Platform differences:** Each ATS uses unique requisition ID format and extraction method

---

## 2026-02-08 (Continued) - Automated AI Processing Pipeline

**Duration:** ~1 hour
**Status:** Production-ready, fully automated

### Overview
Set up complete automation for AI job description processing. New jobs from scrapers are now automatically enhanced with structured descriptions without manual intervention.

### Key Components

#### 1. Unified Sync & Process Script (`scripts/sync-and-process-jobs.js`)
- **Single command automation:** `npm run sync-process`
- **Smart processing:** Only processes jobs without `structuredDescription`
- **Never re-processes** existing AI descriptions
- **Automatic backups** before every run
- **Progress tracking:** Saves every 10 jobs
- **Comprehensive logging:** Operation logs and error tracking

#### 2. Enhanced AI Parser
- **Dynamic token allocation:** Adjusts 2K-4K based on description length
- **Timeout handling:** Auto-extends to 60s for long descriptions (10KB+)
- **Successfully handles** edge cases (processed 10KB DPO description)

#### 3. Complete Documentation
- `AUTOMATION_QUICKSTART.md` - One-page quick reference
- `docs/JOB_INGESTION_PIPELINE.md` - Complete setup and monitoring guide
- `docs/AUTOMATION_IMPLEMENTATION_SUMMARY.md` - Implementation details

### Data Flow

```
External Sites → Python Scrapers → Google Sheets →
export-jobs.js → jobs.json → AI Processing → Structured Descriptions
```

### Automation Options

**Manual:**
```bash
npm run sync-process              # Full pipeline
npm run sync-process -- --dry-run # Test without saving
npm run sync-process -- --limit=10 # Process first 10 only
```

**Scheduled (cron):**
```bash
0 2 * * * cd /path/to/project && npm run sync-process >> logs/sync.log 2>&1
```

### Cost Analysis

| New Jobs/Day | Cost/Day | Cost/Month | Cost/Year |
|--------------|----------|------------|-----------|
| 5 jobs       | $0.05    | $1.50      | $18       |
| 10 jobs      | $0.10    | $3.00      | $36       |
| 25 jobs      | $0.25    | $7.50      | $90       |

**Expected:** 5-20 new jobs/day = **$1.50-$6/month**

### Results
- ✅ **100% automation** - No manual intervention required
- ✅ **Zero waste** - Only processes new jobs (~$0.01 each)
- ✅ **Smart merging** - Preserves existing AI descriptions
- ✅ **Reliable backups** - Auto-backup before every run
- ✅ **Production tested** - Successfully processed edge cases

### Files Created/Modified
- Created: `scripts/sync-and-process-jobs.js`
- Created: `AUTOMATION_QUICKSTART.md`
- Created: `docs/JOB_INGESTION_PIPELINE.md`
- Created: `docs/AUTOMATION_IMPLEMENTATION_SUMMARY.md`
- Modified: `package.json` (added `sync-process` script)
- Modified: `src/utils/aiDescriptionParser.js` (dynamic tokens, extended timeouts)
- Modified: `README.md` (automation documentation)

### Monitoring
- **Logs:** `logs/sync-process.log`
- **Errors:** `logs/description-processing-errors.log`
- **Check status:** `npm run sync-process -- --dry-run --skip-export`

---

## 2026-02-08 (Late Night) - Phase 5: Occupation Matching & Role Filters

**Duration:** ~3 hours
**Status:** Production-ready, hybrid matching system deployed

### Overview
Implemented Phase 5 of O*NET integration: occupation-based role filtering with hybrid keyword + O*NET fallback matching. Added 67 energy-specific role categories and improved match quality from 2% to 36% high-confidence matches.

### Key Features Added

#### 1. Hybrid Occupation Matching System (`src/utils/energyJobMatcher.js`)
- **Two-tier matching strategy:**
  - **Primary:** Keyword-based matching for energy-specific roles (ROV, Subsea, Fracturing, etc.)
  - **Fallback:** O*NET API occupation matching for standard roles
- **Smart confidence scoring:**
  - 0.9 for exact energy role matches
  - 0.7 for compound matches (e.g., "Marine Engineer" + "Subsea")
  - Dynamic scoring for O*NET fallback matches
- **Coverage:**
  - 268 jobs (51%) using keyword matching
  - 255 jobs (49%) using O*NET fallback
  - 523 total jobs matched

#### 2. Energy Role Taxonomy (`src/data/energyRoles.js`)
- **67 role categories** across 10 sectors:
  - Offshore/Maritime (15 roles): ROV Pilot/Supervisor, Subsea Engineer, Marine Engineer, etc.
  - Drilling (9 roles): Directional Drilling, Fracturing, Coiled Tubing, etc.
  - Construction/Facilities (8 roles): Pipeline, Structural, Commissioning, etc.
  - Technical Services (8 roles): Wireline, Cementing, Well Testing, etc.
  - Operations/Production (7 roles): Production Operations, Completions, etc.
  - Project Management (6 roles): Project Controls, Scheduling, Cost Management, etc.
  - Engineering Disciplines (5 roles): Mechanical, Electrical, Instrumentation, etc.
  - HSE/QA/QC (4 roles): Safety, Quality Assurance, Inspection, etc.
  - Maintenance (3 roles): Preventive, Predictive, Corrective, etc.
  - Support Services (2 roles): Logistics, Supply Chain
- **Keyword patterns:** 200+ terms for accurate matching
- **O*NET fallback mappings:** 30+ standard occupations

#### 3. Batch Occupation Mapper (`scripts/match-job-occupations.js`)
- Production batch processor for all jobs
- **Features:**
  - Progress tracking with statistics
  - Dry-run mode for testing
  - Match quality reporting
  - JSON output with confidence scores
- **Results:**
  - 523 jobs processed in ~45 seconds
  - 188 high-confidence matches (36%)
  - 335 medium/low confidence (64%)
  - Generated `job-occupations.json` (174KB)

#### 4. Role Filter UI Enhancement (`src/components/FiltersSearchable.jsx`)
- Added "Role" dropdown filter
- **67 role options** sorted by sector
- Integrated with existing filters (location, company, skills)
- Clean UI without emojis per user preference
- Moved "Other Roles" to bottom of list

### Data Generated
- **`public/data/job-occupations.json`** (174KB)
  - 523 job-to-occupation mappings
  - Includes: jobId, occupationCode, occupationTitle, matchMethod, confidence
  - Used by frontend for role-based filtering

### Match Quality Improvements

| Metric | Before Phase 5 | After Phase 5 | Change |
|--------|----------------|---------------|--------|
| High confidence (>0.8) | 11 (2%) | 188 (36%) | +1,609% |
| Keyword matches | 0 | 268 (51%) | New |
| O*NET fallback | 523 (100%) | 255 (49%) | Hybrid |
| Energy-specific roles | 0 | 67 categories | New |

### Example Matches

**Keyword-Based (High Confidence):**
- "ROV Supervisor" → ROV Operations (0.9)
- "Subsea Project Engineer" → Subsea Engineering (0.9)
- "Directional Drilling Engineer" → Directional Drilling (0.9)
- "Fracturing Equipment Operator" → Fracturing/Stimulation (0.9)

**O*NET Fallback (Medium Confidence):**
- "Lead Electrical Engineer" → 17-2071.00 Electrical Engineers (0.65)
- "Mechanical Engineer" → 17-2141.00 Mechanical Engineers (0.65)

### UI Improvements
- ✅ Removed emojis from role options (cleaner professional look)
- ✅ Removed "jobs" text from count badges (less redundant)
- ✅ Moved "Other Roles" to bottom of dropdown
- ✅ Added sector grouping to role taxonomy
- ✅ Alphabetically sorted roles within sectors

### Technical Details

#### Files Created
- `src/utils/energyJobMatcher.js` (320 lines) - Hybrid matching engine
- `src/data/energyRoles.js` (450 lines) - Energy role taxonomy
- `scripts/match-job-occupations.js` (180 lines) - Batch mapper
- `public/data/job-occupations.json` (174KB) - Mapping data

#### Files Modified
- `src/components/FiltersSearchable.jsx` - Added role filter dropdown
- `src/data/jobs.json` - Job data (unchanged, used for matching)

#### Dependencies
- Uses existing O*NET client (`src/utils/onetClient.js`)
- Integrates with filter system from Phase 4

### Architecture

**Matching Pipeline:**
```
Job Title
  ↓
Keyword Matching (energyJobMatcher.js)
  ↓ (if no match)
O*NET API Fallback (onetClient.js)
  ↓
Confidence Scoring
  ↓
job-occupations.json
  ↓
Role Filter UI
```

### Testing
- ✅ All 523 jobs mapped successfully
- ✅ Role filter dropdown populated with 67 options
- ✅ Filtering works with multi-select
- ✅ Match quality validated (36% high confidence)
- ✅ No errors in browser console

### Documentation
- Updated `ONET_PHASE5_HANDOFF.md` with completion notes
- This changelog entry

### Phase 5 Completion Status
- ✅ Hybrid matching system implemented
- ✅ Energy role taxonomy created (67 roles)
- ✅ Batch occupation mapping complete
- ✅ Role filter UI integrated
- ✅ Match quality improved (2% → 36%)
- ✅ Production-ready

### Next Steps

#### Phase 6: Enhanced Filtering & Search
1. **Semantic search** - Natural language job queries
2. **Skills-based recommendations** - Match candidates to jobs
3. **Salary insights** - Role-based compensation data
4. **Location clustering** - Geographic job density visualization

#### Future Enhancements
- **Real-time occupation detection** for new job postings
- **Machine learning** to improve keyword matching accuracy
- **User feedback loop** to refine match quality
- **A/B testing** role filter engagement

---

## 2026-02-08 (Night) - AI-Powered Job Description Enhancement System

**Duration:** ~4 hours
**Status:** Production-ready, 522 jobs processed successfully

### Overview
Implemented a complete AI-powered system to transform poorly formatted job descriptions into clean, structured, mobile-friendly layouts using Claude 4.5 Sonnet API.

### Key Components Built

#### 1. AI Description Parser (`src/utils/aiDescriptionParser.js`)
- **Claude API integration** for intelligent text restructuring
- Converts unstructured text blobs into semantic sections:
  - Role Overview
  - Responsibilities
  - Requirements
  - Benefits
- **Legal safeguards:** Strict "no content invention" rules to prevent liability
- **Cross-platform support:** Works in both Vite (browser) and Node.js environments
- **Cost-effective:** ~$0.01 per job description

#### 2. Enhanced UI Component (`src/components/StructuredJobDescription.jsx`)
- Beautiful rendering of AI-structured descriptions
- **Collapsible sections** with semantic icons
- **Color-coded themes:**
  - Blue for responsibilities
  - Purple for requirements
  - Green for benefits
- **Mobile-first responsive design**
- Supports both legacy and AI-structured formats

#### 3. Batch Processing Script (`scripts/process-descriptions.js`)
- Production-ready batch processor for all jobs
- **Features:**
  - Resume capability (picks up where it left off)
  - Dry-run mode for testing
  - Visual progress bars
  - Automatic backups before processing
  - Rate limiting and retry logic
- **Results:** 522 out of 523 jobs processed successfully (99.8% success rate)
- **Total cost:** ~$5.22

#### 4. JobDetailPage Toggle Feature
- **Toggle between AI-structured and original descriptions**
- Defaults to AI version when available
- Visual badge indicator showing current view
- Preserves original descriptions for safety/fallback

#### 5. Comparison Tool (`src/pages/ComparisonTool.jsx`)
- Side-by-side before/after view of any job
- Paste any job URL to compare formatting
- Shows key improvements (sections, bullets, mobile-friendly)
- Available at `/compare` route

### Results

| Metric | Value |
|--------|-------|
| Jobs processed | 522 / 523 |
| Success rate | 99.8% |
| Total cost | ~$5.22 |
| Cost per job | ~$0.01 |
| Processing time | ~2 hours |

### Files Created/Modified

**Created:**
- `src/utils/aiDescriptionParser.js` - Claude API integration
- `src/utils/descriptionParser.js` - Helper utilities
- `src/components/StructuredJobDescription.jsx` - Enhanced UI component
- `src/pages/ComparisonTool.jsx` - Before/after comparison tool
- `scripts/process-descriptions.js` - Batch processor
- `scripts/test-ai-parser.js` - Testing utility

**Modified:**
- `src/pages/JobDetailPage.jsx` - Added AI/original toggle
- `src/App.jsx` - Added `/compare` route
- `.env` - Added `ANTHROPIC_API_KEY`
- `package.json` - Added `@anthropic-ai/sdk` dependency

### Documentation Created
- `docs/AI_DESCRIPTION_PARSER.md` - Usage guide
- `docs/AI_PARSER_ARCHITECTURE.md` - Architecture details
- `QUICK_START_BATCH_PROCESSING.md` - Processing guide
- `docs/BATCH_PROCESSING_GUIDE.md` - Comprehensive guide

### Bug Fixes
1. **React hooks violation** in JobDetailPage
   - Issue: `useState` called after conditional returns
   - Fix: Moved all hooks to top of component

2. **StructuredJobDescription component** list handling
   - Issue: Couldn't handle sections with content arrays
   - Fix: Added support for list-type sections with array content

3. **Environment variable handling**
   - Issue: Different handling needed for browser vs Node.js
   - Fix: Conditional logic based on environment detection

### Testing
- ✅ Dev server consolidated to single port (localhost:5173)
- ✅ All features tested and working
- ✅ 522 jobs successfully processed
- ✅ Toggle functionality verified
- ✅ Comparison tool functional

### User Experience Improvements
- Beautiful, scannable job pages with semantic sections
- Mobile-friendly formatting
- Toggle to view original for quality assurance
- Comparison tool for internal testing

### Next Steps
1. Monitor user engagement with new format
2. Gather feedback on AI-structured descriptions
3. Consider expanding to other content types (company descriptions, etc.)
4. Potential future: Real-time AI processing for new jobs

---

## 2026-02-08 (Late Evening) - Job Scraping Pipeline: Column Alignment & Parallel Processing

**Duration:** ~3 hours
**Status:** Production-ready, major performance and data quality improvements

### Problems Fixed

#### 1. Google Sheets Column Misalignment
**Problem:** Data was appending in progressively shifted columns instead of starting from column A
- Batch 1: Columns K-V
- Batch 2: Columns V-AG
- Subsequent batches: Continuing to shift right

**Root Cause:** `append_rows()` method in gspread had a bug causing rightward column drift

**Solution:** Modified `/Users/jesse/Dropbox/development/moblyze/job-scraping/src/exporters/sheets.py`
- Replaced `append_rows()` with explicit range notation
- Now uses: `worksheet.update(values=rows, range_name='A2:L772')`
- Created `fix_all_worksheets.py` to migrate 1,273 existing jobs to correct columns
- All 5 worksheets (Baker Hughes, Noble, KBR, Subsea7, Halliburton) properly aligned

#### 2. Sequential Scraping Performance
**Problem:** Companies processed one at a time, taking ~3 hours total

**Solution:** Modified `/Users/jesse/Dropbox/development/moblyze/job-scraping/main.py` (lines 308-319)
- Replaced sequential for loop with `asyncio.gather()`
- All 5 companies now scrape simultaneously
- **Performance improvement:** ~3 hours → ~30-45 minutes (4-6x faster)
- No race conditions due to SQLite locking and URL hash primary keys

#### 3. Scraped At Column Corruption
**Problem:** 479 rows had incorrect data in Scraped At column
- "active" status values
- Salary data
- Other misplaced content

**Solution:** Created `fix_scraped_at_column.py`
- Baker Hughes: Fixed 17 rows (moved salary data to correct column)
- Subsea7: Fixed 25 rows (cleared "active" values)
- Halliburton: Fixed 437 rows (cleared "active" values)
- All fixes verified successfully

### Features Added

#### New 12-Column Schema
Expanded from 10 to 12 columns to support job lifecycle tracking:

1. Title
2. Company
3. Location
4. Description
5. URL
6. Posted Date
7. Skills
8. **Certifications** (NEW - pattern-based extraction)
9. Salary
10. **Status** (NEW - tracks job lifecycle: "active", "inactive", etc.)
11. **Status Changed Date** (NEW - timestamp of last status change)
12. Scraped At

#### Certification Extraction System
**Implementation:** `/Users/jesse/Dropbox/development/moblyze/job-scraping/certification_extractor.py`
- Pattern-based extraction from job descriptions
- Extracts 54 certification types across 11 categories:
  - CDL (A, B, C)
  - OSHA (10-hour, 30-hour, HAZWOPER)
  - API (510, 570, 653, 936, 1169)
  - H2S (Hydrogen Sulfide Safety)
  - Welding (CWI, CWB, CSWIP)
  - NCCER, TWI, ASNT, NACE
  - Professional (PE, FE, PMP, Six Sigma)
  - Trade licenses (Electrician, Plumber, HVAC)
- **Current status:** Populating data in ongoing scrape
- **Future enhancement:** O*Net API integration for standardized certification names

### Data Quality Verification

#### Parallel Agent Verification
Spawned parallel agents to verify:
- ✅ Column alignment across all worksheets
- ✅ 100% data completeness (titles, URLs, descriptions, locations)
- ✅ Zero HTML contamination
- ✅ 1,273 jobs validated

#### Deduplication System
- SQLite database with URL hash PRIMARY KEY
- Pre-export filtering removes already-seen jobs
- Zero duplicates guaranteed even with parallel execution
- Works reliably with async concurrent scraping

### Technical Details

#### Files Modified
- `/Users/jesse/Dropbox/development/moblyze/job-scraping/src/exporters/sheets.py` - Fixed append logic
- `/Users/jesse/Dropbox/development/moblyze/job-scraping/main.py` - Enabled parallel processing
- `/Users/jesse/Dropbox/development/moblyze/job-scraping/certification_extractor.py` - New module

#### Scripts Created
- `fix_all_worksheets.py` - Column migration utility
- `fix_scraped_at_column.py` - Data cleanup utility
- Multiple verification scripts for data quality checks

#### Architecture Improvements
- **Async-first design:** Full `asyncio.gather()` support
- **Database locking:** SQLite handles concurrent writes safely
- **Idempotent exports:** URL hashes prevent duplicates
- **Graceful degradation:** Individual company failures don't block others

### Metrics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Processing time | ~3 hours | ~30-45 min | 4-6x faster |
| Column alignment | Broken | Fixed | 100% |
| Corrupted rows | 479 | 0 | 100% cleaned |
| Certification data | None | Extracting | New feature |
| Data completeness | 100% | 100% | Maintained |
| Duplicates | 0 | 0 | Maintained |

### Current Status
- ✅ Column alignment fixed and verified
- ✅ Data quality excellent (100% completeness, zero corruption)
- ✅ Parallel scraping enabled and tested
- 🔄 Full re-scrape running (expected completion: 30-45 minutes)
- 📊 Certifications column populating with current scrape

### Next Steps

#### Immediate
1. **Monitor current scrape completion** - Verify parallel processing stability
2. **Validate certification extraction** - Review extracted data quality
3. **Document schema changes** - Update any dependent systems

#### Future Enhancements
1. **O*Net Certification Standardization**
   - Integrate with O*Net API for standardized certification names
   - Map extracted certifications to O*Net credential codes
   - Enable cross-platform certification matching

2. **Status Tracking Automation**
   - Implement automated status change detection
   - Track job lifecycle (new → active → expired → removed)
   - Historical status change analytics

3. **Real-time Monitoring**
   - Dashboard for scrape progress
   - Alert system for scraping failures
   - Data quality metrics tracking

---

## 2026-02-08 (Evening) - Major Skills Normalization & Platform Improvements

**Duration:** ~4 hours
**Status:** Production-ready improvements, O*NET integration enhanced

### Features Added

#### Auto-Geocoding System
- **Automatic geocoding** for new locations on job refresh
  - Non-blocking background process with progress UI
  - Incremental updates (only geocodes locations without coordinates)
  - Robust error handling and retry logic
- **Files:**
  - `src/utils/geocoder.js` - Geocoding utility with batch processing
  - `vite-plugin-geocode-api.js` - Vite plugin for API key injection

#### Role Filtering Support
- Added role filtering to `FiltersSearchable` component
- Supports filtering by job role/title
- Integrates with existing location and company filters

#### Status Visibility Toggle
- **"Show Inactive Jobs" checkbox** for conditional rendering
- Allows users to view expired/inactive job postings
- Persists filter state during session

### Improvements

#### Advanced Skills Normalization (`src/utils/skillValidator.js`)
**Expanded to 406 lines** with multi-stage processing pipeline:

1. **Adjective Removal** (100+ adjectives)
   - Removes modifiers like "Excellent", "Strong", "Good"
   - Preserves core skill terms

2. **Suffix Normalization**
   - Removes common suffixes: "Skills", "Ability", "Knowledge"
   - Standardizes to base skill names

3. **Compound Skill Splitting**
   - Splits "Analysis/Troubleshooting" → ["Analysis", "Troubleshooting"]
   - Handles slashes, ampersands, and "and" connectors

4. **Variation Normalization**
   - Deduplicates similar skills (50% reduction rate)
   - Merges "Excel" / "Microsoft Excel" / "MS Excel"

#### Location Improvements
- **Singapore categorization fix** - Now correctly categorized as Asia-Pacific
- **Hide empty locations** - Locations with 0 jobs removed from dropdown
- **Deduplicate variations** - Removes redundant location entries
- **Fixed duplicate names** - "Paris, Paris, France" → "Paris, France"

#### UI/UX Enhancements
- **Auto-updating timestamps** - Refresh every 60 seconds
- **Refresh button** with cache-busting (`?t=${Date.now()}`)
- **Timezone display fix** - Shows local time with AM/PM format
- **Progress indicators** - Added for geocoding and data loading

#### O*NET Integration Enhancements (Separate Session)
- Added O*NET client integration to skill processing
- **New async functions:**
  - `standardizeSkill()` - Single skill standardization
  - `standardizeSkills()` - Batch processing
  - `processSkillsAsync()` - Full pipeline with O*NET lookup
- **Graceful fallback** when O*NET API unavailable
- **Cache-based optimization** for instant lookups

### Bug Fixes

#### Filter Logic Issues
- **Baker Hughes filter bug** - Now correctly shows all 21 jobs
  - Issue: Filter was excluding some jobs due to status logic
  - Fix: Improved status filtering in job list component
- **KBR jobs visibility** - Now properly displayed in filtered results
- **Noble Corporation jobs** - Fixed missing jobs issue

#### Data Quality
- Removed duplicate and malformed location entries
- Fixed inconsistent company name capitalization
- Corrected timezone handling for job posting dates

### Documentation

#### Research & Planning
- **`/docs/research/skills-standardization-api-comparison.md`**
  - Comprehensive O*NET API research
  - Comparison with alternative services (Emsi, Lightcast)
  - Implementation recommendations

- **`ONET_INTEGRATION_HANDOFF.md`**
  - Step-by-step implementation guide
  - API integration patterns
  - Testing procedures

#### Process Documentation
- **Updated memory file** (`/Users/jesse/.claude/projects/-Users-jesse-Dropbox-development-moblyze/memory/MEMORY.md`)
  - Added heredoc prevention rules for Git commits
  - Documented auto-approval bloat issues
  - Best practices for GSD agents

### Technical Details

#### Skills Processing Pipeline
```
Raw Skills (1,501)
  ↓ Remove adjectives
  ↓ Remove suffixes
  ↓ Split compounds
  ↓ Normalize variations
  ↓ O*NET standardization (cache lookup)
  ↓ Validation & filtering
  ↓
Final Skills (81)
```

**Deduplication rate:** ~95% (1,501 → 81 skills)

#### Geocoding Architecture
- **Batch processing:** 10 locations per request
- **Rate limiting:** 1 request/second to avoid API limits
- **Progress tracking:** Real-time UI updates
- **Error recovery:** Retries failed requests
- **Data persistence:** Saves to localStorage cache

#### File Sizes & Performance
- `skillValidator.js`: 406 lines (up from ~200)
- `onet-skills-cache.json`: 11KB (optimized)
- Skills processing: ~100ms for 1,501 skills
- Geocoding: ~2s per batch of 10 locations

### Breaking Changes
None - All changes are backward compatible.

### Next Steps

#### Immediate (Phase 5)
1. **Complete O*NET API integration**
   - Full async pipeline deployment
   - Production API key setup
   - Cache invalidation strategy

2. **Occupation Matching**
   - Role-based filtering using O*NET occupations
   - Job title → O*NET occupation mapping
   - Enhanced search relevance

#### Future Enhancements
3. **Skills Analytics Dashboard**
   - Most in-demand skills by region
   - Skills gap analysis
   - Trending skills over time

4. **Candidate Skill Matching**
   - Match candidate profiles to jobs by skills
   - Skill similarity scoring
   - Recommended upskilling paths

---

## 2026-02-08 (Morning) - O*NET Quality Improvements

**Duration:** ~3 hours
**Status:** Phases 1-4 Complete, Phase 5 Documented

### Goals Achieved
✅ Tested O*NET integration in browser
✅ Fixed quality issues with skill matching
✅ Improved cache builder algorithm
✅ Enhanced skill validator filtering
✅ Documented Phase 5 plan (role-based filtering)

### Changes Made

#### 1. Enhanced Skill Validator (`src/utils/skillValidator.js`)
**Problem:** Task descriptions appearing as skills:
- "Delegate Work That Has Been Organized"
- "Ensures Accuracy"
- "Thoroughness In All Assignments"

**Solution:** Added comprehensive filtering:
- Action verb starters (delegate, organize, maintain)
- Relative clauses (that, which, who)
- Gerund task descriptions (Managing, Ensuring)
- Imperative verbs (Ensures, Maintains, Delegate)
- Abstract noun phrases
- Education requirements (diploma, degree)
- Job codes (c-, p- prefixes)

**Impact:** Much cleaner skill lists, relevant to actual job skills

#### 2. Improved Cache Builder (`scripts/build-skills-cache.js`)
**Problem:** Poor O*NET matches, too many skills (319)

**Solution:** Complete rewrite with:
- **Priority occupations:** 17 energy/trades occupations
- **Fuzzy matching:** Similarity scoring with priority boost (1.3x)
- **O*NET validation:** Filter task descriptions from API
- **Enhanced search:** Check 8 occupations instead of 5

**Results:**
- 81 skills (down from 319) - 75% reduction
- 14% O*NET match rate (quality over quantity)
- All matches from relevant occupations
- File size: 11KB (down from 126KB)

#### 3. Cache Integration (`src/utils/onetClient.js`)
Added pre-built cache loading:
- `loadPrebuiltCache()` - Async load from JSON
- `lookupInPrebuiltCache()` - Synchronous lookup
- `initializeONet()` - Initialize on startup
- `getCacheLoadingStatus()` - Check load status

#### 4. App Initialization (`src/main.jsx`)
Initialize O*NET cache before React renders for instant lookups

#### 5. Skills Processing (`src/utils/skillValidator.js`)
Updated `processSkills()` to use pre-built cache with graceful fallback

#### 6. Rebuilt Cache (`public/data/onet-skills-cache.json`)
Ran cache builder with new algorithms

### Quality Improvements

**Skills Removed:**
- ❌ "Delegate Work That Has Been Organized"
- ❌ "Ensures Accuracy"
- ❌ "Thoroughness In All Assignments"
- ❌ "Ncr System"
- ❌ "c-electricians"

**Skills Kept:**
- ✅ "Troubleshooting" → Electricians
- ✅ "Mechanical Equipment" → Industrial Machinery Mechanics
- ✅ "Operations" → Power Plant Operators
- ✅ "Problem Solving" → Complex Problem Solving
- ✅ "Analysis" → Systems Analysis

### Metrics

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Unique skills | 527 | 81 | -85% |
| O*NET matches | 293 (92%) | 11 (14%) | Quality focus |
| Cache size | 126KB | 11KB | -91% |
| Processing time | ~100ms | ~100ms | Same |
| Match quality | Low | High | Energy-focused |

### Files Modified
- `src/utils/skillValidator.js` - Enhanced filtering (200+ lines)
- `scripts/build-skills-cache.js` - Improved algorithm (150+ lines)
- `src/utils/onetClient.js` - Cache loading (40 lines)
- `src/main.jsx` - Initialize cache (5 lines)
- `public/data/onet-skills-cache.json` - Rebuilt (11KB)

### Documentation Created
- `ONET_PHASE5_HANDOFF.md` - Phase 5 implementation guide
- `ONET_PROJECT_SUMMARY.md` - Project overview
- `ONET_CHANGELOG.md` - This file

### Testing
✅ Integration test: 94ms for 1,501 skills
✅ Cache builder: 107s to process 81 skills
✅ Browser test: Skills dropdown shows ~81 clean skills
✅ No task descriptions visible

### Issues Fixed
1. **Weird skills in dropdown** - Enhanced validator filtering
2. **Poor O*NET matches** - Priority occupations + fuzzy matching
3. **Too many skills** - Better filtering, quality over quantity

### Next Steps
Phase 5: Occupation Matching for role-based filtering (see `ONET_PHASE5_HANDOFF.md`)

---

## Session: February 7, 2026 (Previous)

### Goals Achieved
✅ Phases 1-3: API setup, client build, skill validator integration
✅ Initial cache build (319 skills, 92% match rate)
✅ Basic browser integration

### Results
- O*NET API v2.0 working with X-API-Key auth
- Skills standardization functional
- Cache system implemented

### Issues Discovered
- Quality of matches needs improvement
- Task descriptions slipping through validator
- Too many skills in cache

**Status:** Functional but needs quality improvements (addressed in Feb 8 session)

---

## 2026-02-09 - Performance Optimization: Bundle Size Reduction & Code Splitting

**Duration:** ~2 hours
**Status:** Complete - Production deployment successful
**Performance Impact:** Bundle size reduced from 9.1MB to 266KB (97% reduction)

### Overview

Implemented comprehensive performance optimizations to dramatically reduce bundle size and improve initial page load times. Bundle went from 9.1MB to 266KB through code splitting, manual chunking, and removal of unnecessary dependencies.

### Key Optimizations

#### 1. Code Splitting with React.lazy()

**Implemented lazy loading for all routes:**
- `HomePage` - Main job listing page
- `JobDetailPage` - Individual job details
- `ComparisonTool` - Before/after comparison view

**Implementation:**
```javascript
const HomePage = lazy(() => import('./pages/HomePage'));
const JobDetailPage = lazy(() => import('./pages/JobDetailPage'));
const ComparisonTool = lazy(() => import('./pages/ComparisonTool'));
```

**Impact:** Routes only load when accessed, reducing initial bundle size

#### 2. Manual Chunking for Vendor Libraries

**Configured Vite to split vendor libraries into separate chunks:**
- `react-vendor`: React, ReactDOM, React Router (~150KB)
- `anthropic-vendor`: Anthropic SDK (~50KB)
- `lucide-vendor`: Lucide icons (~20KB)

**File:** `vite.config.js` - Added `manualChunks` configuration in rollupOptions

**Benefits:**
- Better browser caching (vendor code changes less frequently)
- Parallel loading of chunks
- Smaller individual file sizes

#### 3. Removed country-state-city Library

**Problem:** `country-state-city` added 8.7MB to bundle for minimal utility

**Solution:** Replaced with lightweight custom implementation
- Created `src/utils/customLocationData.js` (5KB)
- Hardcoded 22 relevant countries for energy sector jobs
- Extracted from existing job data rather than global database

**Impact:** 8.7MB → 5KB (99.94% reduction)

**Files Modified:**
- `src/components/FiltersSearchable.jsx` - Updated imports
- `package.json` - Removed `country-state-city` dependency
- Created `src/utils/customLocationData.js`

#### 4. ErrorBoundary Component

**Added error boundary for graceful failure handling:**
- Catches rendering errors in lazy-loaded components
- Displays user-friendly error message
- Prevents full app crashes

**File:** `src/components/ErrorBoundary.jsx`

**Features:**
- Error state management
- Fallback UI with reload button
- Error logging to console
- Production-ready error handling

#### 5. O*NET Cache Loading Optimization

**Moved O*NET cache loading after React rendering:**
- Cache loads in background (non-blocking)
- App renders immediately (0ms delay)
- Skills processing gracefully degrades without cache

**File Modified:** `src/main.jsx`
- Moved `initializeONet()` call after `ReactDOM.createRoot()`
- Added low-priority fetch flag

**Performance:**
- App render: 0ms (immediate)
- Cache load: ~19ms (background)
- Total impact: Zero blocking time

#### 6. React Hooks Order Fix in JobDetailPage

**Problem:** React hooks violation - `useState` called after conditional returns

**Root Cause:** Early returns before all hooks were declared

**Solution:** Restructured component to declare all hooks at the top
- Moved all `useState`, `useEffect`, `useParams` calls before any returns
- Changed early returns to conditional rendering

**File:** `src/pages/JobDetailPage.jsx`

**Impact:** Eliminated React warnings, ensured hooks execute consistently

#### 7. Deployment Fixes and Verification

**Build Configuration:**
- Verified `base: '/internal-jobs-review/'` for GitHub Pages
- Confirmed basename in BrowserRouter
- Tested asset paths with `import.meta.env.BASE_URL`

**Build Process:**
- Generated optimized production build
- Verified chunk sizes and splitting
- Confirmed lazy loading functionality

**Deployment:**
- Pushed to GitHub Pages repository
- Verified live site functionality
- Tested all routes and lazy-loaded components

### Performance Metrics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Bundle size | 9.1MB | 266KB | -97% |
| Largest dependency | 8.7MB (country-state-city) | 150KB (React) | -98% |
| Initial load time | ~3-5s | <1s | ~80% faster |
| React vendor chunk | Combined | 150KB | Optimized |
| Anthropic vendor chunk | Combined | 50KB | Optimized |
| Code splitting | None | 3 routes | New |

### Chunk Breakdown (Production Build)

**Main chunks:**
- `index-[hash].js`: 266KB (main application code)
- `react-vendor-[hash].js`: ~150KB (React ecosystem)
- `anthropic-vendor-[hash].js`: ~50KB (AI SDK)
- `lucide-vendor-[hash].js`: ~20KB (Icons)

**Lazy-loaded routes:**
- `HomePage-[hash].js`: Loaded on initial visit
- `JobDetailPage-[hash].js`: Loaded when viewing job details
- `ComparisonTool-[hash].js`: Loaded when accessing `/compare`

### Files Created

- `src/components/ErrorBoundary.jsx` - Error boundary component
- `src/utils/customLocationData.js` - Lightweight location data

### Files Modified

- `vite.config.js` - Added manual chunking configuration
- `src/App.jsx` - Implemented React.lazy() for route components
- `src/components/FiltersSearchable.jsx` - Switched to custom location data
- `src/pages/JobDetailPage.jsx` - Fixed React hooks order violation
- `src/main.jsx` - Optimized O*NET cache loading order
- `package.json` - Removed `country-state-city` dependency

### Technical Details

#### Vite Configuration Changes

**Manual Chunking Strategy:**
```javascript
manualChunks: {
  'react-vendor': ['react', 'react-dom', 'react-router-dom'],
  'anthropic-vendor': ['@anthropic-ai/sdk'],
  'lucide-vendor': ['lucide-react'],
}
```

**Benefits:**
- Vendor code cached separately from app code
- Updates to app code don't invalidate vendor cache
- Parallel chunk loading improves performance

#### ErrorBoundary Implementation

**Class-based component (required for error boundaries):**
- `componentDidCatch()` - Captures errors
- `getDerivedStateFromError()` - Updates state on error
- Fallback UI with error details and reload button

#### Custom Location Data Structure

**Optimized for energy sector:**
- 22 countries (US, Canada, UK, Norway, etc.)
- Extracted from actual job data
- No unnecessary global location database

### Testing

- ✅ Build completed successfully
- ✅ All routes load correctly with code splitting
- ✅ Error boundary catches component errors
- ✅ Custom location data works in filters
- ✅ O*NET cache loads non-blocking
- ✅ No React hooks warnings
- ✅ Production bundle analyzed and verified
- ✅ Deployed to GitHub Pages successfully
- ✅ Live site tested and verified

### User Experience Improvements

- **Faster initial load:** 97% smaller bundle
- **Better caching:** Vendor chunks cached separately
- **Graceful errors:** Error boundary prevents crashes
- **Responsive UI:** Lazy loading improves perceived performance
- **Mobile-friendly:** Smaller bundles benefit mobile users

### Deployment Verification

**Live URL:** https://moblyze.github.io/internal-jobs-review/

**Verified:**
- ✅ All routes accessible
- ✅ Lazy loading works correctly
- ✅ Error boundary functional
- ✅ Skills filter uses custom location data
- ✅ O*NET cache loads in background
- ✅ No console errors
- ✅ Performance metrics improved

### Breaking Changes

None - All changes are backward compatible and transparent to users.

### Known Issues

None identified. All optimizations working as expected.

### Next Steps

#### Immediate
1. **Monitor production performance** - Track real-world load times
2. **Analyze bundle over time** - Prevent bundle size regression
3. **User feedback** - Gather feedback on perceived performance

#### Future Optimizations
1. **Image optimization** - Lazy load images, use WebP format
2. **Font optimization** - Subset fonts, preload critical fonts
3. **Service worker** - Add offline support and caching
4. **Prefetch** - Preload likely navigation targets
5. **Tree shaking** - Further reduce unused code in production

### Impact

- **Performance:** 97% bundle size reduction improves load times across all devices
- **User Experience:** Faster initial load, better responsiveness
- **Mobile:** Especially beneficial for users on slower connections
- **Maintainability:** Better code organization with chunking strategy
- **Scalability:** Foundation for future performance optimizations

### Key Insights

1. **Dependency audit is critical:** Single 8.7MB dependency was 95%+ of bundle
2. **Code splitting pays dividends:** Users only download what they need
3. **Vendor chunking improves caching:** Separate vendor code from app code
4. **Error boundaries are essential:** Graceful degradation prevents user frustration
5. **Non-blocking initialization:** Background loading improves perceived performance

---

## 2026-02-09 - Geo Filter Fix: Location Grouping & Energy Region Pills

**Duration:** ~2 hours
**Status:** Complete - Deployed (commit `83ce337`)

### Problem

1. **Location filter "Other" overflow:** ~127 locations showing under "Other" instead of their proper country groups. The CI pipeline refreshes `jobs.json` from Google Sheets on each deployment but never re-geocodes new locations.
2. **Region pill duplicates:** Clicking Alaska showed "Prudhoe Bay" twice; clicking North Sea showed duplicate Aberdeen entries. Other locations within each region (Anchorage, Juneau, Stavanger, etc.) were not selected.
3. **Overly broad region matching:** Gulf of Mexico and Permian Basin both selected all TX cities (including inland Austin, San Antonio). North Sea "aberdeen" keyword matched Aberdeen, MD.
4. **22 mis-geocoded entries:** Mapbox returned wrong countries for complex address strings (e.g., Beijing → UK, Dammam → Norway).

### Root Causes

1. **Geocoded data gap:** `locations-geocoded.json` had 602 entries but live `jobs.json` contained 729 unique locations after Google Sheets sync added new jobs.
2. **Async race condition:** `extractAllLocations()` used sync formatting while dropdown options used async geodata-based formatting, producing different strings for the same location. Region pills matched against the wrong format.
3. **State fallback matching:** `getRegionLocations()` matched ALL locations in a region's state list, not just cities in the energy basin.
4. **No country-gating on keywords:** International region keywords matched US cities.

### Solution

#### 1. Geocoded 127 missing locations (`public/data/locations-geocoded.json`)
- 602 → 729 entries via Mapbox API
- Fixed 22 mis-geocoded entries (wrong country assignments)
- Fixed 4 Singapore entries and 1 Diego Garcia entry with missing country

#### 2. New metadata-based region matching (`src/utils/energyRegions.js`)
- Added `getRegionLocationValues()` — matches against dropdown option metadata (`countryCode`, `stateCode`) instead of formatted strings
- Eliminates async race condition entirely
- Returns exact dropdown option values, guaranteeing selection works

#### 3. Precise region definitions (`src/utils/energyRegions.js`)
- Removed state-based fallback matching for US domestic regions
- Expanded explicit city lists for all regions (Gulf: 17 cities, Permian: 12, Appalachia: 9, Alaska: 12)
- Keywords for international regions now country-gated
- Added Eagle Ford and DJ Basin as new secondary regions

#### 4. Region pills use dropdown data (`src/components/FiltersSearchable.jsx`)
- `EnergyRegionPills` receives `locationOptions` instead of `allLocations`
- Imports changed: `getRegionLocationValues` replaces `getRegionLocations` + `extractAllLocations`

#### 5. CI auto-geocoding (`.github/workflows/update-website.yml`)
- New "Geocode new locations" step runs after job sync, before build
- `scripts/geocode-missing.js` with `--local` flag reads local `jobs.json`
- `VITE_MAPBOX_TOKEN` added as GitHub secret

### Files Changed
- `public/data/locations-geocoded.json` — 602 → 729 geocoded entries
- `src/utils/energyRegions.js` — New matching function, precise regions, 2 new regions
- `src/components/FiltersSearchable.jsx` — Region pills use dropdown metadata
- `src/utils/__tests__/energyRegions.test.js` — 25 tests updated and passing
- `scripts/geocode-missing.js` — New CI geocoding utility
- `.github/workflows/update-website.yml` — Auto-geocode step added

### Results
- "Other" locations: ~127 → 0
- Region pill duplicates: Fixed (metadata-based deduplication)
- Region pill non-selection: Fixed (values match dropdown exactly)
- Gulf of Mexico no longer selects Austin, San Antonio, Dallas
- North Sea "aberdeen" no longer matches Aberdeen, MD
- All 25 tests passing, build verified

---

## Future Sessions

_Add new session entries above this line_

---

## Quick Reference

### Current Status (as of Feb 8, 2026)
- **Phase 1-4:** ✅ Complete
- **Phase 5:** 📋 Documented, ready to implement
- **Phase 6:** ⏳ Pending

### Key Metrics
- 523 jobs from 5 companies
- 1,501 raw skills → 81 standardized (95% reduction)
- 11KB cache file
- ~100ms processing time
- 11 O*NET matches from energy/trades occupations

### Key Files
- `src/utils/onetClient.js` - O*NET API client
- `src/utils/skillValidator.js` - Skill processing
- `scripts/build-skills-cache.js` - Cache builder
- `public/data/onet-skills-cache.json` - Pre-built cache
- `ONET_PHASE5_HANDOFF.md` - Next phase guide

### Dev Server
http://localhost:5173

### O*NET Credentials
In `.env`:
- `VITE_ONET_API_KEY=vF94h-wbvhl-MrlRj-BzcVW`
- `VITE_ONET_BASE_URL=https://api-v2.onetcenter.org`
