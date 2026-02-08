# Energy Job Matcher - Documentation

## Overview

The `energyJobMatcher.js` utility provides keyword-based matching for energy sector job titles, specifically designed for oilfield services companies (Baker Hughes, Halliburton, Schlumberger, etc.).

**Location:** `/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/src/utils/energyJobMatcher.js`

## Key Features

- **87.3% match rate** on actual job titles from the dataset
- **30+ role categories** covering drilling, well services, production, and support roles
- **Multi-language support** (English, Spanish, Portuguese)
- **Confidence levels** (high, medium, low) for match quality
- **Specificity prioritization** - matches most specific roles first

## Usage

### Basic Matching

```javascript
import { matchEnergyRole } from './utils/energyJobMatcher.js';

const result = matchEnergyRole("Field Professional - MWD, II");
// Returns:
// {
//   roleId: 'mwd-lwd',
//   roleName: 'MWD/LWD Specialist',
//   confidence: 'high',
//   matchedKeyword: 'MWD'
// }
```

### Batch Matching

```javascript
import { batchMatchEnergyRoles } from './utils/energyJobMatcher.js';

const jobs = [
  { title: "Wireline Field Operator" },
  { title: "Cementing Service Operator" }
];

const results = batchMatchEnergyRoles(jobs);
// Returns array with match property added to each job
```

### Statistics

```javascript
import { getMatchStatistics } from './utils/energyJobMatcher.js';

const stats = getMatchStatistics(jobs);
console.log(stats);
// {
//   total: 55,
//   matched: 48,
//   unmatched: 7,
//   matchRate: '87.3%',
//   byRole: { ... },
//   byConfidence: { high: 39, medium: 8, low: 1 }
// }
```

## Role Categories

### Offshore & Subsea
- **ROV Pilot/Technician** - ROV operations
- **Subsea Engineer** - Subsea systems and well testing
- **Offshore Operations** - General offshore work
- **Diving & Marine** - Commercial diving operations

### Drilling Operations
- **Directional Drilling** - DD, geosteering, MWD/LWD directional
- **MWD/LWD Specialist** - Measurement/logging while drilling
- **Drilling Engineer** - Drilling engineering, drill bits, MPD
- **Driller & Rig Crew** - Driller, well site supervisor, rig mechanics
- **Mud Engineer** - Drilling fluids, Baroid services

### Well Services
- **Wireline Operator/Engineer** - Wireline, logging & perforating
- **Coiled Tubing Operator** - CT operations
- **Cementing Services** - Cementing operations
- **Fracturing & Stimulation** - Frac, acidizing, production enhancement
- **Well Testing** - Surface well testing
- **Completions Specialist** - Completions, completion tools
- **Workover & Well Intervention** - Workover, intervention
- **Slickline Operator** - Slickline operations

### Artificial Lift
- **Artificial Lift Specialist** - ESP, rod pump, PCP

### Production Operations
- **Production Operator** - Lease operator, well operator, gauger, pumper
- **Production Engineer** - Production engineering, production advisor

### Reservoir & Geoscience
- **Reservoir Engineer** - Reservoir engineering
- **Petrophysicist** - Petrophysics
- **Geologist** - Geology, geosteering, logging geology
- **Geophysicist** - Geophysics, seismic
- **Geoscientist** - General geoscience

### Petroleum Engineering
- **Petroleum Engineer** - Petroleum/well engineering

### Field Operations
- **Field Engineer** - General field engineering
- **Field Specialist/Technician** - Field service roles
- **Service Operator** - Service operations

### Equipment & Maintenance
- **Rig Mechanic** - Rig mechanic, diesel mechanic
- **Electrician (Oilfield)** - Electrical technician, power systems
- **Instrumentation Technician** - Instrumentation, electronics, electro/mechanical
- **Hydraulic Specialist** - Hydraulic systems
- **Mechanic/Technician (General)** - General maintenance

### Support Roles
- **Laboratory Technician** - Lab work, chemistry
- **Materials Specialist** - Materials science, metallics, welding
- **HSE Specialist** - Health, safety, environment, well control

## Match Quality

### High Confidence (81% of matches)
- Direct keyword matches (e.g., "MWD", "wireline", "cementing")
- Specific technical terms (e.g., "geosteering", "coiled tubing")
- Role-specific patterns (e.g., "Field Prof-DD", "Production Enhancement")

### Medium Confidence (17% of matches)
- Broader terms that need context (e.g., "field engineer", "production advisor")
- Technical roles that could span categories (e.g., "electrical technician")

### Low Confidence (2% of matches)
- Very general terms (e.g., "mechanic technician")
- Roles that need additional context to categorize

## Specificity Handling

The matcher prioritizes specificity to avoid false matches:

1. **Specific before general:**
   - "ROV Pilot" matches `rov-pilot-technician` before `field-specialist`
   - "Subsea Engineer" matches `subsea-engineer` before `field-engineer`

2. **Multi-word patterns:**
   - "well testing" (2 words) matches before "well" alone
   - "coiled tubing" matches before "tubing"

3. **Word boundaries:**
   - Uses `\b` regex boundaries to avoid partial matches
   - "MWD" won't match "MLWD" unless explicitly included

## Multi-Language Support

Supports job titles in:
- **English** - Standard oilfield terminology
- **Spanish** - "Ingeniero de Fracturamiento", "Operador Coiled Tubing"
- **Portuguese** - "Coordenadora de Operações Offshore", "Especialista em Serviços"

## Example Matches

### High-Confidence Matches
```
✓ Field Professional - MWD, II
  → MWD/LWD Specialist [high] (matched: "MWD")

✓ Wireline Field Operator
  → Wireline Operator/Engineer [high] (matched: "Wireline")

✓ Ecuador - Francisco De Orellana - Supervisor de Fracturas y Estimulaciones
  → Fracturing & Stimulation [high] (matched: "Production Enhancement")

✓ Geosteering Geologist
  → Directional Drilling [high] (matched: "Geosteering")
```

### Medium-Confidence Matches
```
✓ Production Advisor
  → Production Engineer [medium] (matched: "Production Advisor")

✓ Electrical Technician I
  → Electrician (Oilfield) [medium] (matched: "Electrical Technician")
```

### Non-Matches (As Expected)
```
✗ Administrative Specialist
  → NO MATCH

✗ Angular & Node.js Developer
  → NO MATCH

✗ Supply Chain Localization Leader
  → NO MATCH
```

## Testing

Run the test suite:
```bash
node test-energy-matcher.js
```

The test file validates against 55 actual job titles from the dataset with a **87.3% match rate** (48/55 matches).

### Test Results Summary
- **Total tested:** 55 jobs
- **Matched:** 48 jobs (87.3%)
- **Unmatched:** 7 jobs (12.7%)
- **High confidence:** 39 matches (81%)
- **Medium confidence:** 8 matches (17%)
- **Low confidence:** 1 match (2%)

### Intentionally Unmatched
These roles are correctly NOT matched as they're not field/technical energy roles:
- Administrative Specialist
- Account Manager
- Supply Chain roles
- Software developers (non-domain specific)
- Chemical Engineer (too general without context)

## Edge Cases Handled

1. **Abbreviations:** MWD, LWD, MLWD, CT, ESP, PCP, ROV, DD, MPD
2. **Company-specific terms:** Sperry Drilling Svcs, Baroid, MultiChem
3. **Job level indicators:** I, II, III, Senior, Principal, Advisor
4. **Geographic indicators:** Location prefixes preserved but don't affect matching
5. **Special characters:** Slashes, parentheses, ampersands handled correctly

## Future Enhancements

Potential improvements:
1. Add context from job description for borderline cases
2. Machine learning model for improved accuracy
3. Support for new role categories as they appear
4. Confidence scoring refinement based on match context
5. Synonym expansion (e.g., "ESP" = "Electric Submersible Pump")

## Integration Points

This matcher can be integrated with:
- Job posting classification systems
- Candidate matching algorithms
- Analytics dashboards (role distribution)
- Search/filter functionality
- Career path recommendations

## Maintenance

To add new role patterns:
1. Add pattern to `ENERGY_ROLE_PATTERNS` array
2. Order by specificity (most specific first)
3. Test against actual job titles
4. Document in description field
5. Run test suite to verify no regressions

---

**Last Updated:** 2026-02-08
**Maintainer:** Moblyze Development Team
**Version:** 1.0.0
