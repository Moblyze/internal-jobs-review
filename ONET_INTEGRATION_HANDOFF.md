# O*NET Skills Integration - Session Handoff
**Date:** 2026-02-08
**Status:** Ready to Implement
**Priority:** High - Skills standardization needed

---

## 🎯 Mission: Integrate O*NET Skills API

Implement U.S. Department of Labor O*NET Web Services API to standardize job skills across the Moblyze jobs platform.

**Why O*NET:**
- ✅ 100% FREE (no costs, no limits)
- ✅ 33,000+ skills across 891+ occupations
- ✅ Excellent coverage of skilled trades & energy sector
- ✅ Authoritative data from U.S. Department of Labor
- ✅ Commercial use permitted (Creative Commons)
- ✅ Well documented with code samples

---

## 📋 What Was Accomplished This Session

### Major Features Implemented ✅

1. **Auto-Geocoding System**
   - New locations automatically geocoded on job refresh
   - Non-blocking background process with progress notifications
   - Incremental updates (only geocodes new locations)
   - Files: `src/utils/geocoder.js`, `vite-plugin-geocode-api.js`

2. **Advanced Skills Normalization (Client-Side)**
   - Multi-stage processing pipeline
   - Removes 100+ adjectives and suffixes
   - Splits compound skills ("A and B" → ["A", "B"])
   - Normalizes variations: "written communications" → "Written Communication"
   - Deduplication: 50% reduction in duplicate skills
   - File: `src/utils/skillValidator.js` (406 lines)

3. **UI/UX Improvements**
   - "Show Inactive Jobs" checkbox (conditional - only shows when inactive jobs exist)
   - Auto-updating timestamps (updates every 60 seconds)
   - Refresh button with cache-busting and visual feedback
   - Timezone display fixed (shows local time: "2:04 PM")

4. **Location Fixes**
   - Singapore properly categorized (was showing as "Other")
   - Hide locations with 0 jobs from dropdown
   - Deduplicated location variations

### Current State of Skills Processing

**Client-Side Normalization (Current):**
- Removes adjectives: "excellent", "strong", "proven", etc.
- Expands shortcuts: "written" → "written communication"
- Removes suffixes: "skills", "ability"
- Singularizes: "communications" → "communication"
- **Limitation:** Still produces variations that should be the same skill

**Example Current Output:**
- ✅ Merges: "written", "written communications", "written communication skills" → "Written Communication"
- ❌ Still separate: "Communication Skills" vs "Communications" vs "Interpersonal Communication"
- ❌ No standardization to industry taxonomy

**Why We Need O*NET:**
- Map all variations to canonical skill names
- Validate against authoritative skills taxonomy
- Add skill metadata (categories, importance, related skills)
- Industry-standard normalization

---

## 📊 Research Completed

### API Comparison Document
**Location:** `/Users/jesse/Dropbox/development/moblyze/docs/research/skills-standardization-api-comparison.md`

**8 APIs Evaluated:**
1. ✅ **O*NET Web Services** - RECOMMENDED (100% free, comprehensive)
2. ✅ ESCO API - Runner-up (free, European focus)
3. ❌ LinkedIn Skills API - Not publicly available
4. ❌ Lightcast - Free tier too limited
5. ❌ Textkernel - Too expensive
6. ❌ Workforce Data Initiative - Abandoned
7. ❌ SkillGPT - Research project only
8. ❌ Emsi Burning Glass - Commercial only

### O*NET Quick Facts
- **Base URL:** https://services.onetcenter.org/ws/
- **Auth:** HTTP Basic Auth (username from registration)
- **Rate Limits:** None specified (reasonable use)
- **Documentation:** https://services.onetcenter.org/reference/
- **Data Coverage:** 33,000+ skills, 891+ occupations
- **Update Frequency:** Quarterly/annual updates
- **License:** Creative Commons (commercial use OK)

---

## 🗂️ Key Files & Locations

### Skills Processing
- **Current:** `/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/src/utils/skillValidator.js`
  - Contains client-side normalization logic
  - Exports: `processSkills()`, `normalizeSkill()`, `filterValidSkills()`

### Jobs Data
- **Source:** `/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/public/data/jobs.json`
  - 523 jobs from 5 companies
  - Each job has `skills` array (raw, unnormalized)

### Skills Usage Points
1. **Filter dropdown:** `src/components/FiltersSearchable.jsx`
2. **Job cards:** `src/components/JobCard.jsx`
3. **Skills extraction:** `src/hooks/useJobs.js` (getUniqueSkills function)

### Configuration
- **Package.json:** `/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/package.json`
- **Env file:** `/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/.env`

---

## 🎯 O*NET Integration Plan

### Phase 1: Setup & Registration ⏱️ 30 mins

1. **Register for O*NET API Access**
   - Visit: https://services.onetcenter.org/
   - Create developer account (free)
   - Obtain API username
   - Save to `.env` as `VITE_ONET_USERNAME=<your-username>`

2. **Install Dependencies**
   ```bash
   cd /Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web
   npm install axios
   ```

3. **Test API Connection**
   - Verify credentials work
   - Test basic skill lookup
   - Understand response format

### Phase 2: Build O*NET Client ⏱️ 2 hours

**Create:** `src/utils/onetClient.js`

**Key Functions:**
```javascript
// Search for skills by name
async function searchSkills(skillName)

// Get skill details by ID
async function getSkillDetails(skillId)

// Map job title to O*NET occupation
async function findOccupation(jobTitle)

// Get all skills for an occupation
async function getOccupationSkills(occupationCode)
```

**Features:**
- HTTP Basic Auth with O*NET credentials
- Rate limiting (reasonable use)
- Caching (localStorage or in-memory)
- Error handling
- Retry logic

### Phase 3: Skills Taxonomy Cache ⏱️ 1 hour

**Create:** `public/data/onet-skills-cache.json`

**Purpose:** Cache commonly used skills to reduce API calls

**Structure:**
```json
{
  "communication": {
    "id": "2.A.1.a",
    "name": "Active Listening",
    "category": "Basic Skills",
    "element": "Content"
  },
  "written communication": {
    "id": "2.A.1.b",
    "name": "Written Comprehension",
    "category": "Basic Skills"
  }
}
```

**Build script:** `scripts/build-skills-cache.js`
- Extract unique skills from current jobs
- Map to O*NET taxonomy
- Save cache file

### Phase 4: Integrate with Skill Validator ⏱️ 1 hour

**Modify:** `src/utils/skillValidator.js`

**New function:**
```javascript
export async function standardizeSkill(skill) {
  // 1. Normalize with current logic (remove adjectives, etc.)
  const normalized = normalizeSkill(skill);

  // 2. Try exact match in cache
  const cached = lookupInCache(normalized);
  if (cached) return cached.name;

  // 3. Try O*NET API search
  const onetResult = await searchONetSkill(normalized);
  if (onetResult) {
    cacheResult(normalized, onetResult);
    return onetResult.name;
  }

  // 4. Return normalized version if no match
  return normalized;
}
```

**Update:** `processSkills()` to call `standardizeSkill()`

### Phase 5: Occupation Matching ⏱️ 1.5 hours

**Create:** `src/utils/occupationMatcher.js`

**Purpose:** Match job titles to O*NET occupations to get recommended skills

**Functions:**
```javascript
// Match job title to O*NET occupation
async function matchJobToOccupation(jobTitle)

// Get recommended skills for a job
async function getRecommendedSkills(jobTitle)

// Enrich job with O*NET data
async function enrichJobWithONet(job)
```

**Use cases:**
- Show "Recommended Skills" badge on jobs that match O*NET taxonomy
- Auto-suggest skills when posting jobs
- Validate skill relevance for specific occupations

### Phase 6: Testing & Validation ⏱️ 1 hour

**Create test suite:**
- Test skill normalization accuracy
- Verify O*NET API integration
- Check cache hit rates
- Validate occupation matching
- Performance testing (API response times)

**Metrics to track:**
- Skills normalized: before/after count
- API calls saved by cache: percentage
- Standardization accuracy: manual review sample
- Performance: avg response time

---

## 🔧 Technical Decisions Made

### 1. Client-Side First, API Second
- Current normalization runs client-side (fast, no API calls)
- O*NET integration will be **enhancement layer**
- Fallback to client-side logic if API unavailable

### 2. Caching Strategy
- Cache O*NET results in localStorage
- Cache expiry: 30 days (skills don't change often)
- Pre-build cache for common skills

### 3. Async Processing
- Skills standardization will be async
- Show loading states while standardizing
- Progressive enhancement (show normalized while waiting for O*NET)

### 4. Occupation Focus
Target O*NET occupations for energy/trades:
- 47-2111.00 - Electricians
- 49-9021.00 - Heating, A/C, Refrigeration Mechanics
- 47-2152.01 - Pipe Fitters and Steamfitters
- 17-2199.11 - Solar Energy Systems Engineers
- 17-2141.02 - Automotive Engineers
- 47-5012.00 - Rotary Drill Operators, Oil and Gas

---

## 📝 Example Implementation Snippets

### O*NET API Request Example
```javascript
// Search for "welding" skills
const response = await fetch(
  'https://services.onetcenter.org/ws/online/search?keyword=welding',
  {
    headers: {
      'Authorization': 'Basic ' + btoa(ONET_USERNAME + ':'),
      'Accept': 'application/json'
    }
  }
);

// Response structure
{
  "occupation": [
    {
      "code": "51-4121.00",
      "title": "Welders, Cutters, Solderers, and Brazers",
      "href": "https://services.onetcenter.org/ws/online/occupations/51-4121.00"
    }
  ]
}
```

### Skills Standardization Flow
```
Raw Skill Input → Client Normalization → Cache Lookup → O*NET API → Cache Update → Standardized Output

Example:
"excellent written communication skills"
  ↓ normalize
"Written Communication"
  ↓ cache miss
"2.A.1.b - Reading Comprehension" (O*NET)
  ↓ cache
"Reading Comprehension" ✅
```

---

## 🚀 Next Session: Step-by-Step Implementation

### Start Here:

```bash
cd /Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web
```

### Follow This Order:

1. **Register & Test** (30 mins)
   - Get O*NET credentials
   - Test API with curl/Postman
   - Add credentials to `.env`

2. **Build Client** (2 hours)
   - Create `src/utils/onetClient.js`
   - Implement basic search and lookup
   - Add error handling and caching

3. **Build Cache** (1 hour)
   - Create `scripts/build-skills-cache.js`
   - Extract current skills from jobs
   - Map to O*NET and save cache

4. **Integrate** (1 hour)
   - Update `skillValidator.js`
   - Add async standardization
   - Update UI components

5. **Test** (1 hour)
   - Verify accuracy
   - Check performance
   - Manual QA on skills dropdown

---

## 📊 Success Metrics

### Quantitative Goals:
- ✅ Reduce unique skills by 60%+ (currently ~300 → target ~120)
- ✅ 90%+ cache hit rate (minimize API calls)
- ✅ <200ms avg standardization time
- ✅ 100% of energy/trades jobs matched to O*NET occupations

### Qualitative Goals:
- ✅ Skills follow industry-standard naming
- ✅ No more weird fragments ("Guides, Develops", "understanding")
- ✅ Consistent capitalization and formatting
- ✅ Users can find jobs by any skill variation

---

## ⚠️ Known Issues & Edge Cases

### Current Skills Issues (Will be fixed by O*NET):
1. Variations still exist: "Communication", "Communications", "Communication Skills"
2. Some technical terms not recognized: "HVAC", "AutoCAD" (proper nouns)
3. Soft skills too generic: "Problem Solving", "Teamwork" (need O*NET categories)

### O*NET Integration Challenges:
1. **API Rate Limits:** Unknown - need to implement conservative caching
2. **Skill Matching:** Fuzzy matching needed for typos/variations
3. **Offline Mode:** App should work without O*NET (graceful degradation)
4. **Manual Override:** Some company-specific skills won't map (e.g., "SAP", "Salesforce")

---

## 🔗 Resources & References

### O*NET Documentation
- **Getting Started:** https://services.onetcenter.org/
- **API Reference:** https://services.onetcenter.org/reference/
- **Code Samples:** https://github.com/onetcenter/web-services-samples
- **Skill Search:** https://www.onetonline.org/find/descriptor/browse/Skills

### Skills Taxonomy
- **Skills List:** https://www.onetonline.org/find/descriptor/browse/Skills/
- **Occupation Search:** https://www.onetonline.org/find/
- **Energy Careers:** https://www.onetonline.org/find/career?c=13

### Project Documentation
- **API Comparison:** `/docs/research/skills-standardization-api-comparison.md`
- **Auto-Geocoding:** `/docs/AUTO-GEOCODING.md`
- **Skills Validator:** `/src/utils/skillValidator.js`

---

## 💾 Current Project State

### Environment
- **Working Directory:** `/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web`
- **Dev Server:** Running at http://localhost:5173/ (background task b7f0234)
- **Package Manager:** npm
- **Node Version:** 20.19.4

### Recent Changes (Git Status)
- Modified: `src/utils/skillValidator.js` (enhanced normalization)
- Modified: `src/utils/locationGeodata.js` (Singapore fix, 0-job filtering)
- Modified: `src/pages/JobListPage.jsx` (timestamp fix, inactive checkbox)
- Added: `src/utils/geocoder.js` (auto-geocoding)
- Added: `docs/research/skills-standardization-api-comparison.md`

### Database
- **Jobs:** 523 active jobs
- **Companies:** 5 (Baker Hughes, Halliburton, KBR, Noble Corporation, Subsea7)
- **Locations:** 164 (all geocoded)
- **Raw Skills:** ~800 unique variations
- **Target (Post-O*NET):** ~120 standardized skills

---

## 🎬 Prompt for Next Session

**Copy/paste this to start the O*NET integration:**

```
I need to implement O*NET skills standardization for the Moblyze jobs platform.

Please read the handoff document at:
/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/ONET_INTEGRATION_HANDOFF.md

After reading it, let's start with Phase 1: Setup & Registration. Walk me through:
1. Registering for O*NET API access
2. Testing the API connection
3. Understanding the response format

Then we'll build the O*NET client and integrate it with the existing skills validator.
```

---

## 📞 Contact & Support

- **O*NET Support:** https://www.onetcenter.org/contact.html
- **API Issues:** onet@onetcenter.org
- **Project Context:** See `/Users/jesse/Dropbox/development/moblyze/CLAUDE.md`

---

**Status:** Ready to implement. All research complete. Client-side normalization working well as foundation. O*NET will take it to the next level with authoritative industry-standard taxonomy.

**Est. Time to Complete:** 4-6 hours of focused development + testing

**Next Step:** Register for O*NET API access → Build client → Integrate → Test

---

*Last updated: 2026-02-08 - Ready for implementation*
