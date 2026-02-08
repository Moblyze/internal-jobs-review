# O*NET Phase 5: Occupation Matching & Role Filters - Handoff Document

**Date:** 2026-02-08
**Status:** Ready to Implement
**Priority:** High - Needed for role-based filtering

---

## 🎯 Mission: Add Role-Based Filtering Using O*NET

Implement O*NET occupation matching to enable filtering jobs by energy sector roles (Electricians, Engineers, Technicians, etc.)

---

## 📊 Current Status (Phases 1-4 Complete)

### ✅ What's Working Now

1. **O*NET API Integration** - Credentials working, client built
2. **Skills Standardization** - 1,501 raw skills → 81 standardized skills
3. **Pre-built Cache** - `/public/data/onet-skills-cache.json` (11KB, 81 skills)
4. **Browser Integration** - Skills load from cache on app startup
5. **Quality Filtering** - Improved validator removes task descriptions

### 📈 Current Metrics

| Metric | Value |
|--------|-------|
| Jobs in dataset | 523 |
| Raw skills | 1,501 |
| Standardized skills | 81 |
| O*NET matches | 11 (14%) |
| Cache size | 11KB |
| Processing time | ~100ms |

---

## 🎯 Phase 5 Goal: Role-Based Filtering

### User Request

> "I would like to add roles as filters with a focus on energy sector roles."

**Energy sector role examples:** https://www.notion.so/dc37de1493f743909fc2a3f1129a42f8?v=318ec66caeed493c860a46a65bfac25d

### What This Means

**Add a new "Role" filter dropdown** on the jobs overview page that allows users to filter by occupation type:

- Electricians
- Engineers (Mechanical, Electrical, Solar, etc.)
- Technicians (HVAC, Industrial Machinery, etc.)
- Welders
- Operators (Power Plant, Equipment, etc.)
- Managers (Engineering, Construction, etc.)
- And other energy-relevant roles

### Technical Approach

1. **Match job titles to O*NET occupations**
   - Use O*NET API to match each job's title to an occupation code
   - Example: "Senior Electrician" → O*NET code "47-2111.00" (Electricians)

2. **Group O*NET occupations into role categories**
   - Create energy-focused role taxonomy
   - Map O*NET codes to user-friendly role names

3. **Add role filter to UI**
   - New "Role" dropdown in filters
   - Users can select one or more roles to filter jobs

4. **No changes to job content**
   - Job titles, descriptions stay the same
   - O*NET mapping is background metadata only

---

## 🏗️ Implementation Plan

### Step 1: Build Occupation Matcher (2 hours)

**Create:** `scripts/match-job-occupations.js`

**Purpose:** Match all 523 jobs to O*NET occupations

**Algorithm:**
```javascript
For each job:
  1. Extract job title
  2. Search O*NET API for matching occupations
  3. Prioritize energy/trades occupations (same priority list as cache builder)
  4. Use fuzzy matching to find best match
  5. Assign O*NET code and confidence score
  6. Group into role categories
```

**Output:** `public/data/job-occupations.json`
```json
{
  "job-id-123": {
    "onet_code": "47-2111.00",
    "onet_title": "Electricians",
    "role_category": "Electricians",
    "confidence": "high"
  }
}
```

### Step 2: Define Energy Sector Role Taxonomy (30 mins)

**Create:** `src/utils/energyRoles.js`

**Role Categories:**
```javascript
export const ENERGY_ROLES = {
  // Trades & Installation
  'electricians': {
    label: 'Electricians',
    onet_codes: ['47-2111.00', '49-2092.00', '49-2095.00'],
    icon: '⚡'
  },
  'hvac-technicians': {
    label: 'HVAC Technicians',
    onet_codes: ['49-9021.00'],
    icon: '🌡️'
  },
  'welders': {
    label: 'Welders & Metal Workers',
    onet_codes: ['51-4121.00', '51-4122.00', '47-2211.00'],
    icon: '🔥'
  },
  'solar-installers': {
    label: 'Solar Installers',
    onet_codes: ['47-2231.00', '47-2152.04'],
    icon: '☀️'
  },

  // Engineering
  'mechanical-engineers': {
    label: 'Mechanical Engineers',
    onet_codes: ['17-2141.00', '17-2141.01', '17-2141.02'],
    icon: '⚙️'
  },
  'electrical-engineers': {
    label: 'Electrical Engineers',
    onet_codes: ['17-2071.00', '17-2071.01'],
    icon: '🔌'
  },
  'energy-engineers': {
    label: 'Energy Engineers',
    onet_codes: ['17-2199.03', '17-2199.11'],
    icon: '🔋'
  },
  'industrial-engineers': {
    label: 'Industrial Engineers',
    onet_codes: ['17-2112.00', '17-2112.01', '17-2112.02'],
    icon: '🏭'
  },

  // Technicians
  'engineering-technicians': {
    label: 'Engineering Technicians',
    onet_codes: ['17-3023.00', '17-3026.00', '17-3029.00'],
    icon: '🔧'
  },
  'industrial-mechanics': {
    label: 'Industrial Mechanics',
    onet_codes: ['49-9041.00', '49-9043.00', '49-9044.00'],
    icon: '🛠️'
  },

  // Operations
  'power-plant-operators': {
    label: 'Power Plant Operators',
    onet_codes: ['51-8013.00', '51-8011.00', '51-8012.00'],
    icon: '⚡'
  },
  'equipment-operators': {
    label: 'Equipment Operators',
    onet_codes: ['47-2073.00', '53-7021.00'],
    icon: '🏗️'
  },

  // Management
  'engineering-managers': {
    label: 'Engineering Managers',
    onet_codes: ['11-9041.00', '11-9041.01'],
    icon: '👔'
  },
  'construction-managers': {
    label: 'Construction Managers',
    onet_codes: ['11-9021.00'],
    icon: '👷'
  },

  // Other
  'other': {
    label: 'Other Roles',
    onet_codes: [],
    icon: '📋'
  }
};

// Map O*NET code to role category
export function getEnergyRole(onetCode) {
  for (const [roleId, role] of Object.entries(ENERGY_ROLES)) {
    if (role.onet_codes.includes(onetCode)) {
      return { id: roleId, ...role };
    }
  }
  return { id: 'other', ...ENERGY_ROLES.other };
}
```

### Step 3: Update Jobs Hook (1 hour)

**Modify:** `src/hooks/useJobs.js`

**Add new function:**
```javascript
import { getEnergyRole } from '../utils/energyRoles';

// Load occupation mappings
let occupationMappings = null;
async function loadOccupationMappings() {
  if (occupationMappings) return occupationMappings;

  try {
    const response = await fetch('/data/job-occupations.json');
    occupationMappings = await response.json();
    return occupationMappings;
  } catch (error) {
    console.warn('Failed to load occupation mappings:', error);
    return {};
  }
}

/**
 * Get unique energy roles from jobs
 */
export async function getEnergyRoles(jobs) {
  const mappings = await loadOccupationMappings();
  const roleCounts = {};

  jobs.forEach(job => {
    const mapping = mappings[job.id];
    if (!mapping) return;

    const role = getEnergyRole(mapping.onet_code);
    roleCounts[role.id] = (roleCounts[role.id] || 0) + 1;
  });

  // Return roles sorted by count
  return Object.entries(roleCounts)
    .map(([roleId, count]) => ({
      id: roleId,
      label: ENERGY_ROLES[roleId].label,
      count,
      icon: ENERGY_ROLES[roleId].icon
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Filter jobs by energy role
 */
export async function filterJobsByRole(jobs, roleId) {
  if (!roleId) return jobs;

  const mappings = await loadOccupationMappings();

  return jobs.filter(job => {
    const mapping = mappings[job.id];
    if (!mapping) return false;

    const role = getEnergyRole(mapping.onet_code);
    return role.id === roleId;
  });
}
```

### Step 4: Add Role Filter to UI (1 hour)

**Modify:** `src/pages/JobListPage.jsx`

**Add role filter dropdown:**
```jsx
import { useState, useEffect } from 'react';
import { getEnergyRoles, filterJobsByRole } from '../hooks/useJobs';

function JobListPage() {
  const { jobs, loading } = useJobs();
  const [selectedRole, setSelectedRole] = useState('');
  const [roles, setRoles] = useState([]);
  const [filteredJobs, setFilteredJobs] = useState(jobs);

  // Load roles on mount
  useEffect(() => {
    getEnergyRoles(jobs).then(setRoles);
  }, [jobs]);

  // Filter jobs when role selection changes
  useEffect(() => {
    if (selectedRole) {
      filterJobsByRole(jobs, selectedRole).then(setFilteredJobs);
    } else {
      setFilteredJobs(jobs);
    }
  }, [selectedRole, jobs]);

  return (
    <div>
      {/* Role Filter Dropdown */}
      <select
        value={selectedRole}
        onChange={(e) => setSelectedRole(e.target.value)}
      >
        <option value="">All Roles</option>
        {roles.map(role => (
          <option key={role.id} value={role.id}>
            {role.icon} {role.label} ({role.count})
          </option>
        ))}
      </select>

      {/* Jobs List */}
      {filteredJobs.map(job => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}
```

### Step 5: Test & Validate (30 mins)

**Verify:**
- [ ] All jobs matched to occupations (or marked as "Other")
- [ ] Role filter shows correct counts
- [ ] Filtering works properly
- [ ] Performance is acceptable (<100ms filter time)
- [ ] Energy sector roles are well-represented

---

## 🔧 Key Files

### Existing Files (Don't Change)
- ✅ `src/utils/onetClient.js` - O*NET API client (working)
- ✅ `src/utils/skillValidator.js` - Skill filtering (working)
- ✅ `public/data/onet-skills-cache.json` - Skills cache (working)

### New Files to Create
- 📝 `scripts/match-job-occupations.js` - Build occupation mappings
- 📝 `public/data/job-occupations.json` - Job → O*NET mappings (output)
- 📝 `src/utils/energyRoles.js` - Role taxonomy & mappings

### Files to Modify
- 📝 `src/hooks/useJobs.js` - Add role filtering functions
- 📝 `src/pages/JobListPage.jsx` - Add role filter UI

---

## 📊 Expected Results

### Before
**Filters available:**
- Company (5 companies)
- Location (164 locations)
- Skills (81 skills)

### After
**Filters available:**
- Company (5 companies)
- Location (164 locations)
- Skills (81 skills)
- **Role (10-15 energy sector roles)** ← NEW!

### Example Roles with Counts
- ⚡ Electricians (45 jobs)
- ⚙️ Mechanical Engineers (78 jobs)
- 🔌 Electrical Engineers (52 jobs)
- 🌡️ HVAC Technicians (23 jobs)
- 🔥 Welders & Metal Workers (18 jobs)
- ☀️ Solar Installers (12 jobs)
- 👔 Engineering Managers (34 jobs)
- 🏭 Industrial Engineers (29 jobs)
- ...and more

---

## ⚠️ Important Notes

### Priority O*NET Occupations (Same as Skills Cache)
```javascript
const PRIORITY_OCCUPATIONS = [
  '47-2111.00', // Electricians
  '49-9021.00', // HVAC Mechanics and Installers
  '51-4121.00', // Welders, Cutters, Solderers, and Brazers
  '17-2199.11', // Solar Energy Systems Engineers
  '17-2141.00', // Mechanical Engineers
  '47-2152.00', // Plumbers, Pipefitters, and Steamfitters
  '17-2071.00', // Electrical Engineers
  '17-2141.01', // Fuel Cell Engineers
  '47-2221.00', // Structural Iron and Steel Workers
  '49-9051.00', // Electrical Power-Line Installers and Repairers
  '17-3023.00', // Electrical and Electronic Engineering Technologists
  '17-3026.00', // Industrial Engineering Technologists
  '51-8013.00', // Power Plant Operators
  '47-2031.00', // Carpenters
  '49-9041.00', // Industrial Machinery Mechanics
  '17-2112.00', // Industrial Engineers
  '11-9041.00', // Architectural and Engineering Managers
];
```

### Matching Strategy
1. **Exact title match** - "Electrician" → Electricians (high confidence)
2. **Fuzzy match** - "Senior Electrical Engineer" → Electrical Engineers (medium)
3. **Keyword match** - "HVAC Technician II" → HVAC Mechanics (medium)
4. **Fallback** - Unmatched → "Other" category (low confidence)

### Confidence Levels
- **High (>0.85):** Exact or very close match
- **Medium (0.5-0.85):** Fuzzy match with good overlap
- **Low (<0.5):** Weak match or "Other" category

---

## 🚀 Estimation

| Task | Time | Complexity |
|------|------|------------|
| Build occupation matcher script | 2 hours | Medium |
| Define role taxonomy | 30 mins | Easy |
| Update jobs hook | 1 hour | Medium |
| Add UI filter | 1 hour | Easy |
| Test & validate | 30 mins | Easy |
| **Total** | **5 hours** | **Medium** |

---

## 📝 Next Session Prompt

```
I need to implement Phase 5 of the O*NET integration: Occupation Matching and Role Filters.

Please read the handoff document at:
/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/ONET_PHASE5_HANDOFF.md

After reading it:
1. Build the occupation matcher script (match-job-occupations.js)
2. Create the energy roles taxonomy (energyRoles.js)
3. Update the jobs hook to support role filtering
4. Add the role filter UI to the jobs page

Reference for energy sector roles:
https://www.notion.so/dc37de1493f743909fc2a3f1129a42f8?v=318ec66caeed493c860a46a65bfac25d

Goal: Add a "Role" filter dropdown that lets users filter jobs by energy sector occupations (Electricians, Engineers, Technicians, etc.)
```

---

## 🔗 Resources

- **O*NET API Documentation:** https://services.onetcenter.org/reference/
- **Energy Sector Roles (Notion):** https://www.notion.so/dc37de1493f743909fc2a3f1129a42f8?v=318ec66caeed493c860a46a65bfac25d
- **Current Project State:** Everything from Phases 1-4 is working in production
- **O*NET Credentials:** Already configured in `.env` file

---

**Status:** Complete documentation. Ready for implementation in next session.

**Last Updated:** 2026-02-08
