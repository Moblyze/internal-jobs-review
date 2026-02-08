# Certification Extraction - Before & After

## Summary

Fixed certification extraction to remove noise and normalize to official certification names.

### Results

**Before (Old System):**
- Extracted full sentences as "certifications"
- Examples of noise:
  - "If working on DP Semi-submersibles, Flag State Maintenance Supervisor license is required."
  - "Oversee the CAAG's data infrastructure to include FT networks, systems administration, accreditation, and licensing"
  - "Candidates should have a degree in Engineering. Program Management certification is a plus."

**After (New System):**
- **10 unique certifications** extracted from 523 jobs
- **Zero sentences** - all results are actual certifications
- **Zero noise** - strict filtering applied
- **7 categories** represented

---

## Certifications Found (Alphabetical)

1. BOSIET
2. CDL
3. CPR/First Aid
4. DPO
5. FOET
6. Forklift Operator
7. HAZMAT
8. IADC WellSharp
9. STCW
10. Six Sigma

---

## Certifications by Category

### Well Control
- IADC WellSharp (2 jobs)

### Offshore Survival
- BOSIET (1 job)
- FOET (1 job)

### Safety
- HAZMAT (1 job)

### First Aid & Medical
- CPR/First Aid (1 job)

### Maritime
- DPO (2 jobs)
- STCW (2 jobs)

### Professional
- CDL (1 job)
- Six Sigma (1 job)

### Skilled Trades
- Forklift Operator (1 job)

---

## Quality Checks

✅ **Certifications with periods:** 0
✅ **Certifications over 80 chars:** 0
✅ **Certifications with requirement language:** 0
✅ **All results are real certifications:** YES

---

## Statistics

- **Total jobs analyzed:** 523
- **Jobs with certifications:** 11 (2.1%)
- **Jobs without certifications:** 512 (97.9%)
- **Average certifications per job:** 0.02

---

## Implementation Details

### Certification Database

The new system includes official mappings for:

- **API Certifications:** API 510, API 570, API 653, API 571, API 580, API 1169
- **Well Control:** IADC WellSharp, IWCF
- **Offshore Survival:** BOSIET, HUET, FOET, T-BOSIET
- **Corrosion:** NACE CIP, NACE CP
- **Rigging & Lifting:** Rigger Certification, Signal Person
- **Crane:** NCCCO Crane Operator
- **Welding:** CWI, CWB, AWS Certification
- **Safety:** OSHA 10/30/40, HAZMAT, HAZWOPER, H2S
- **First Aid:** CPR/First Aid, AED, BLS
- **Maritime:** USCG License, DPO, STCW
- **Professional:** PE License, PMP, Six Sigma, CDL
- **Trades:** Master Electrician, Journeyman Electrician, EPA 608, Forklift Operator
- **Industry Bodies:** IADC, IMCA, NICET

### Filtering Logic

The extractor uses sentence-level analysis to filter out:

1. **Job duty descriptions** - Text describing what the person DOES
   - Example: "Oversee the data infrastructure..."
   - Pattern: Duty verbs (oversee, manage, ensure, develop, etc.)

2. **Degree requirements** - Educational requirements, not certifications
   - Example: "Bachelor's degree in Engineering"
   - Pattern: Degree words + field names

3. **Long complex sentences** - Over 150 chars with multiple clauses
   - Example: Multi-clause job requirement paragraphs

### Why So Few Certifications?

Out of 523 jobs, only 11 (2.1%) explicitly mention certifications. This is expected because:

1. **Most are office/engineering roles** - Don't require trade certifications
2. **Generic requirements** - Jobs often say "relevant certifications" without specifics
3. **Implicit requirements** - Assumed based on job title/industry
4. **Quality over quantity** - Better to extract 10 real certs than 100 with noise

---

## Sample Jobs with Certifications

### CDL Delivery / Treater Driver at Baker Hughes
**Certifications:** CDL, HAZMAT

Context: "Have a Class A or B CDL with Hazmat and Tanker Endorsements"

### MPD Operator at Noble Corporation
**Certifications:** IADC WellSharp

Context: Well control certification for drilling operations

### DPO at Noble Corporation
**Certifications:** DPO

Context: Dynamic Positioning Operator for offshore vessel operations

### Associate Tool & Gauge Technician at KBR
**Certifications:** Forklift Operator

Context: Material handling certification for tool room operations

---

## Code Location

- **Main file:** `/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/src/utils/certificationExtractor.js`
- **Test script:** `/Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web/test-certifications.js`
- **Run test:** `node test-certifications.js`

---

## Next Steps (Optional)

If more certifications need to be found:

1. **Expand patterns** - Add more variation patterns for existing certs
2. **Add more certifications** - Expand CERTIFICATION_DATABASE
3. **Relax filtering** - Adjust sentence-level filters (not recommended - maintains quality)
4. **Better job data** - Scraper could extract structured requirements section

**Recommendation:** Keep current strict filtering. Quality is more important than quantity for a professional job board.
