# Skills Filter Bug Analysis

## Problem
User clicks skill pills (e.g., "Welding", "Electrical") → 0 jobs match

## Root Cause

**Data Format Mismatch between Skill Pills and Job Skills**

### What's Happening:

1. **Skill Pills Generation** (`getTopSkills()` in `useJobs.js` lines 306-331):
   ```javascript
   const validSkills = filterValidSkills(job.skills);
   // Returns CLEANED/PROCESSED skills: "Welding", "Electrical", "Communication"
   ```

2. **Job Skills Storage** (`jobs.json`):
   ```javascript
   job.skills = [
     "Bachelor's degree in engineering",
     "Excellent leadership, strong interpersonal, influencing and planning skills",
     "Welding experience required"
   ]
   // Contains RAW, UNPROCESSED text from job descriptions
   ```

3. **Filter Logic** (`JobListPage.jsx` lines 143-146):
   ```javascript
   if (filters.skills.length > 0) {
     const hasSkill = filters.skills.some(skill => job.skills.includes(skill))
     // Checks if "Welding" is in ["Welding experience required", ...]
     // Result: FALSE - exact string match fails!
   }
   ```

## The Flow

```
getTopSkills() flow:
  jobs.json raw skills → filterValidSkills() → processSkills() → normalizeSkill()
  "Welding experience required" → "Welding Experience" → "Welding" → "Welding"
  Result: Skill pills show "Welding"

Filter check flow:
  filters.skills = ["Welding"]  // From pill click
  job.skills = ["Welding experience required"]  // From jobs.json
  job.skills.includes("Welding") → FALSE  // Exact match fails!
```

## Evidence

### Jobs Data
- Total jobs: 2,919
- Jobs with skills: 2,103
- Unique raw skills: 7,603

### Sample Raw Skills in jobs.json:
```json
[
  "Bachelor's degree in engineering",
  "Excellent leadership, strong interpersonal, influencing and planning skills",
  "Ability to be on call outside of normal business hours",
  "Excellent communication and presentation skills"
]
```

### What Skill Pills Show (after processing):
```
["Engineering", "Leadership", "Communication", "Problem Solving", "Welding"]
```

### Why Filtering Fails:
```javascript
// Filter contains: "Engineering"
// Job contains: "Bachelor's degree in engineering"
// "Bachelor's degree in engineering".includes("Engineering") → FALSE (case-sensitive)
```

## Solution Options

### Option 1: Process Job Skills Before Filtering (Recommended)
**File:** `/src/pages/JobListPage.jsx` line 143-146

**Current:**
```javascript
if (filters.skills.length > 0) {
  const hasSkill = filters.skills.some(skill => job.skills.includes(skill))
  if (!hasSkill) return false
}
```

**Fix:**
```javascript
if (filters.skills.length > 0) {
  // Import filterValidSkills at top of useEffect
  const { filterValidSkills } = await import('../utils/skillValidator');
  const processedJobSkills = filterValidSkills(job.skills);
  const hasSkill = filters.skills.some(skill => processedJobSkills.includes(skill))
  if (!hasSkill) return false
}
```

**Pros:**
- No data migration needed
- Uses existing skill processing logic
- Consistent with how skill pills are generated

**Cons:**
- Slower filtering (processes skills on every filter change)
- Could cache processed skills per job

### Option 2: Store Processed Skills in jobs.json
**File:** Job export script (wherever jobs.json is generated)

Add a new field `processedSkills` to each job:
```json
{
  "id": "...",
  "title": "...",
  "skills": ["Welding experience required", ...],
  "processedSkills": ["Welding", ...]
}
```

**Pros:**
- Fast filtering (no processing needed)
- Clean separation of raw vs processed data

**Cons:**
- Requires data migration
- Increases jobs.json file size
- Need to update export script

### Option 3: Case-Insensitive Substring Match
**File:** `/src/pages/JobListPage.jsx` line 143-146

```javascript
if (filters.skills.length > 0) {
  const hasSkill = filters.skills.some(filterSkill =>
    job.skills.some(jobSkill =>
      jobSkill.toLowerCase().includes(filterSkill.toLowerCase())
    )
  )
  if (!hasSkill) return false
}
```

**Pros:**
- Simple fix
- No imports needed
- Handles partial matches

**Cons:**
- False positives (e.g., "Lead" matches "Leadership")
- Not consistent with how skills are processed elsewhere
- Doesn't use the sophisticated skill validation logic

## Recommended Solution

**Option 1 with Caching**

```javascript
// At top of applyFilters function
const processedJobSkillsCache = new Map();

// In filter logic
if (filters.skills.length > 0) {
  let processedJobSkills = processedJobSkillsCache.get(job.id);
  if (!processedJobSkills) {
    const { filterValidSkills } = await import('../utils/skillValidator');
    processedJobSkills = filterValidSkills(job.skills);
    processedJobSkillsCache.set(job.id, processedJobSkills);
  }
  const hasSkill = filters.skills.some(skill => processedJobSkills.includes(skill))
  if (!hasSkill) return false
}
```

This approach:
1. Uses the same skill processing as skill pills
2. Caches processed skills per job per filter operation
3. Requires minimal code changes
4. Maintains consistency across the app

## Files Involved

1. **`/src/pages/JobListPage.jsx`** - Contains broken filter logic (lines 143-146)
2. **`/src/hooks/useJobs.js`** - Contains getTopSkills() that processes skills (lines 306-331)
3. **`/src/utils/skillValidator.js`** - Contains skill processing logic (filterValidSkills, processSkills, normalizeSkill)
4. **`/public/data/jobs.json`** - Contains raw, unprocessed job skills

## Testing the Fix

1. Load job list page
2. Click a skill pill (e.g., "Welding")
3. Verify jobs with "Welding" in their raw skills appear
4. Verify count matches skill pill expectations
5. Test multiple skill filters
6. Test combining skill filters with other filters
