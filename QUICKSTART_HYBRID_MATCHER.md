# Hybrid Job Matcher - Quick Start

**Last Updated:** 2026-02-08

---

## What Is This?

A **hybrid job matching system** that combines:
1. **Keyword-based energy sector matching** (60+ specialized patterns)
2. **O*NET API fallback** (standard occupational database)

**Why?** O*NET doesn't handle energy sector specializations well. ROV Pilots were being matched as "Telecommunications Equipment Installers" - completely wrong!

---

## Quick Commands

### Test the Keyword Patterns
```bash
node scripts/test-keyword-matcher.js
```

**Expected output:** 35/35 tests passing

### Run the Hybrid Matcher
```bash
npm run match-occupations
```

**What it does:**
- Reads jobs from `public/data/jobs.json`
- Matches using hybrid approach
- Outputs to `public/data/job-occupations.json`
- Shows detailed statistics

**Runtime:** ~3-5 minutes (150ms delay between O*NET API calls)

---

## How It Works

### Step-by-Step

```
1. Job Title: "ROV Pilot - Offshore"
   ↓
2. Try Keyword Matcher
   ✅ Match: "ROV Pilot/Technician" (high confidence)
   ↓
3. High confidence → DONE (no O*NET call needed)

Result: {
  match_type: 'keyword',
  role_id: 'rov-pilot-technician',
  role_name: 'ROV Pilot/Technician',
  confidence: 'high',
  matched_keyword: 'ROV'
}
```

### When O*NET Is Used

```
1. Job Title: "Mechanical Engineer"
   ↓
2. Try Keyword Matcher
   ❌ No specialized pattern
   ↓
3. Query O*NET API
   ✅ Match: "Mechanical Engineers" (17-2141.00) (high confidence)
   ↓
4. Use O*NET result

Result: {
  match_type: 'onet_only',
  onet_code: '17-2141.00',
  onet_title: 'Mechanical Engineers',
  confidence: 'high'
}
```

### When Keyword Overrides O*NET

```
1. Job Title: "Subsea Engineer - Production Systems"
   ↓
2. Try Keyword Matcher
   ✅ Match: "Subsea Engineer" (high confidence)
   ↓
3. High confidence → USE IT

But also:
   Query O*NET API
   ❌ Match: "Marine Engineers" (low confidence, too generic)

Result: Keyword match used (better than generic O*NET)
```

---

## What Gets Matched

### High-Priority Energy Roles (Keyword Patterns)

**Subsea & Marine:**
- ROV Pilot, ROV Supervisor, Subsea Engineer
- Saturation Diver, DP Operator, Chief Engineer (Marine)

**Drilling & Wells:**
- Driller, Assistant Driller, Directional Driller
- MWD/LWD Specialist, Mud Engineer, Drilling Engineer

**Well Services:**
- Wireline Operator, Coiled Tubing, Cementing
- Fracturing, Completions, Well Testing

**Operations:**
- Process Operator, Plant Operator, Control Room Operator
- Production Operator, Reactor Operator, Crane Operator

**Technical Trades:**
- Welder, Pipefitter, Scaffolder, Rigger
- Electrician (oilfield context)

**Inspection & Integrity:**
- NDT Inspector, Pipeline Inspector, Coating Inspector

**Digital & Automation:**
- SCADA Engineer, PLC Technician, Automation Engineer

**Wind Energy:**
- Wind Turbine Technician, Blade Technician

**Energy Transition:**
- CCS Engineer, Hydrogen Engineer/Technician

### Standard Roles (O*NET Works Fine)

- Mechanical Engineer
- Electrical Engineer
- Civil Engineer
- Project Engineer
- Safety Coordinator

---

## Output Schema

Each matched job has:

```javascript
{
  // Match approach used
  match_type: 'keyword' | 'keyword_preferred' | 'onet_preferred' | 'onet_only',

  // Keyword match fields (if used)
  role_id: 'rov-pilot-technician',
  role_name: 'ROV Pilot/Technician',
  matched_keyword: 'ROV',

  // O*NET fields (if used)
  onet_code: '17-3028.00',
  onet_title: 'Calibration Technologists',
  onet_confidence: 'low',

  // Always present
  confidence: 'high' | 'medium' | 'low',

  // Optional: when O*NET preferred but keyword available
  keyword_alternative: {
    role_id: 'subsea-engineer',
    role_name: 'Subsea Engineer',
    confidence: 'medium'
  }
}
```

---

## Common Issues

### Issue: Test Fails with Pattern Conflict

**Problem:** More specific pattern overshadowed by broader pattern

**Example:**
```
❌ FAIL: "ROV Supervisor"
   Expected: rov-supervisor
   Got: rov-pilot-technician (because /\bROV\b/i matched first)
```

**Solution:** Move specific pattern BEFORE general pattern in array

```javascript
// ❌ Wrong order
{ keywords: [/\bROV\b/i] },           // Matches everything with "ROV"
{ keywords: [/ROV.*supervisor/i] },   // Never reached!

// ✅ Correct order
{ keywords: [/ROV.*supervisor/i] },   // Specific first
{ keywords: [/\bROV\b/i] },           // General second
```

### Issue: False Matches

**Problem:** Pattern too broad, matches unrelated jobs

**Example:**
```
Pattern: /offshore/i
Matches: "Offshore Software Engineer" ❌ (not energy sector)
```

**Solution:** Add context to pattern or lower confidence

```javascript
// Better:
{
  keywords: [/offshore.*(?:platform|rig|drilling)/i],
  confidence: 'high'
}

// Or:
{
  keywords: [/\boffshore\b/i],
  confidence: 'medium'  // Let O*NET help decide
}
```

---

## Adding New Patterns

### 1. Identify Gap

Check if role is well-handled by O*NET:
```bash
# Test a job title manually
node -e "
import('./src/utils/onetClient.js').then(m =>
  m.search('YOUR_JOB_TITLE').then(console.log)
)
"
```

If O*NET result is poor → add keyword pattern

### 2. Add Pattern

Edit `src/utils/energyJobMatcher.js`:

```javascript
{
  roleId: 'new-role-id',
  roleName: 'New Role Name',
  keywords: [
    /primary.*pattern/i,
    /alternative.*pattern/i,
  ],
  confidence: 'high',  // or 'medium' or 'low'
  description: 'Catches: Job Title 1, Job Title 2'
},
```

### 3. Test Pattern

Add test to `scripts/test-keyword-matcher.js`:

```javascript
{
  title: 'New Role Title',
  expected: 'new-role-id',
  category: 'Category'
},
```

Run test:
```bash
node scripts/test-keyword-matcher.js
```

### 4. Update Docs

Update `NOTION_ROLES_MAPPING.md` with new pattern

---

## Performance Notes

### API Rate Limiting

O*NET API has rate limits:
- ~6-7 requests per second
- Script uses 150ms delay between calls
- **DO NOT** remove the delay or you'll get throttled

### Keyword Performance

- Keyword matching is **instant** (no API call)
- High-confidence keyword matches skip O*NET entirely
- Expected ~40% of jobs matched by keyword only → big performance win

---

## Statistics to Watch

After running matcher, check:

1. **Match Rate**
   - Target: >95%
   - If lower: identify unmatched jobs, add patterns

2. **Confidence Distribution**
   - Target: >70% high confidence
   - If lower: adjust keyword patterns or O*NET priority list

3. **Match Type Breakdown**
   - Keyword only: ~40%
   - Keyword preferred: ~10%
   - O*NET preferred: ~20%
   - O*NET only: ~30%

4. **Critical Role Accuracy**
   - ROV Pilot → `rov-pilot-technician` ✅
   - Subsea Engineer → `subsea-engineer` ✅
   - MWD Specialist → `mwd-lwd` ✅

---

## Files Overview

### Source
- `src/utils/energyJobMatcher.js` - Keyword patterns (60+)
- `scripts/match-job-occupations.js` - Hybrid matcher script
- `scripts/test-keyword-matcher.js` - Pattern tests

### Documentation
- `INTEGRATION_COMPLETE_SUMMARY.md` - Full integration docs
- `NOTION_ROLES_MAPPING.md` - Pattern → Notion role mapping
- `QUICKSTART_HYBRID_MATCHER.md` - This file

### Data
- `public/data/jobs.json` - Input (job listings)
- `public/data/job-occupations.json` - Output (matches)

---

## Getting Help

### Pattern Not Matching?

1. Test the pattern in isolation:
   ```javascript
   const pattern = /your.*pattern/i
   const text = "Your Job Title"
   console.log(pattern.test(text))
   ```

2. Check pattern order in `ENERGY_ROLE_PATTERNS` array

3. Verify confidence level is appropriate

### O*NET Returning Wrong Results?

1. Try keyword pattern instead
2. If O*NET is close, add to `PRIORITY_OCCUPATIONS` list
3. Lower confidence threshold to prefer keyword

### Need More Context?

Read the full docs:
- `HYBRID_MATCHER_INTEGRATION.md` - Complete technical documentation
- `NOTION_ROLES_MAPPING.md` - All pattern mappings and examples

---

## Summary

```
┌─────────────────────────────────────────┐
│  Hybrid Matcher Flow                    │
├─────────────────────────────────────────┤
│                                         │
│  1. Try Keyword Match                   │
│     ├─ High confidence? → DONE ✅       │
│     └─ No match/low? → Continue         │
│                                         │
│  2. Query O*NET API                     │
│     ├─ Good result? → Use it ✅         │
│     └─ Poor result? → Check keyword     │
│                                         │
│  3. Compare Results                     │
│     ├─ Keyword better? → Use keyword ✅ │
│     └─ O*NET better? → Use O*NET ✅     │
│                                         │
└─────────────────────────────────────────┘
```

**Goal:** Best possible match using both specialized knowledge (keywords) and general occupational data (O*NET).

---

**Ready to run?**

```bash
# Test patterns
node scripts/test-keyword-matcher.js

# Generate matches
npm run match-occupations
```
