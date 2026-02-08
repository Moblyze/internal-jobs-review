# Certifications Filter - Technical Documentation

## Architecture

### Component Hierarchy
```
JobListPage
├── FiltersSearchable (certifications prop)
│   └── react-select (multi-select dropdown)
└── JobCard[] (filtered by certifications)
```

### Data Flow
```
jobs.json
  ↓
useJobs() hook
  ↓
getUniqueCertifications()
  ↓
extractJobCertifications() for each job
  ↓
getAllCertifications() - deduplicate & sort
  ↓
FiltersSearchable component
  ↓
User selects certifications
  ↓
JobListPage filters jobs
  ↓
Display filtered results
```

## API Reference

### `certificationExtractor.js`

#### `extractJobCertifications(job)`
Extracts all certifications from a single job object.

**Parameters:**
- `job` (Object) - Job object with `description` and `skills` fields

**Returns:**
- `string[]` - Array of certification names, sorted alphabetically

**Example:**
```javascript
import { extractJobCertifications } from './utils/certificationExtractor';

const job = {
  title: "Field Engineer",
  description: "Requires OSHA 30-hour certification and valid CDL...",
  skills: ["API 510", "Leadership"]
};

const certs = extractJobCertifications(job);
// Returns: ["API Certification", "CDL", "OSHA"]
```

#### `getAllCertifications(jobs)`
Gets all unique certifications across an array of jobs.

**Parameters:**
- `jobs` (Array) - Array of job objects

**Returns:**
- `string[]` - Deduplicated, sorted array of all certifications

**Example:**
```javascript
import { getAllCertifications } from './utils/certificationExtractor';

const allCerts = getAllCertifications(jobsData);
// Returns: ["AED Certification", "CDL", "CPR/First Aid", ...]
```

### `useJobs.js`

#### `getUniqueCertifications(jobs)`
Hook helper to get unique certifications from jobs.

**Parameters:**
- `jobs` (Array) - Array of job objects

**Returns:**
- `string[]` - Sorted array of unique certification names

**Example:**
```javascript
import { getUniqueCertifications } from '../hooks/useJobs';

const certifications = useMemo(
  () => getUniqueCertifications(jobs),
  [jobs]
);
```

## Pattern Matching

### How Patterns Work

The extractor uses regex patterns to identify certifications in text:

```javascript
const CERTIFICATION_PATTERNS = [
  {
    pattern: /\bOSHA\b/gi,           // Regex to match
    normalized: 'OSHA'                // Normalized output name
  },
  // ... more patterns
];
```

### Adding New Patterns

To add a new certification:

1. Open `/src/utils/certificationExtractor.js`
2. Add pattern to `CERTIFICATION_PATTERNS` array
3. Follow existing format:

```javascript
// Example: Adding IRATA certification
{
  pattern: /\b(IRATA|Industrial Rope Access)\b/gi,
  normalized: 'IRATA Certification'
}
```

4. Test extraction:
```bash
node test-certifications.js
```

### Pattern Best Practices

**DO:**
- Use word boundaries (`\b`) to avoid partial matches
- Make patterns case-insensitive (`/gi` flags)
- Group variations with `|` (OR operator)
- Normalize to a clear, standard name

**DON'T:**
- Make patterns too broad (avoid false positives)
- Include sentence fragments
- Forget to escape special regex characters
- Use patterns that match common words

## Filter Logic

### OR Logic Implementation

Jobs are shown if they have **at least one** selected certification:

```javascript
if (filters.certifications.length > 0) {
  const jobCertifications = extractJobCertifications(job);
  const hasCertification = filters.certifications.some(cert =>
    jobCertifications.includes(cert)
  );
  if (!hasCertification) return false;
}
```

### Why OR Logic?

- Users want jobs matching **any** of their certifications
- More inclusive results
- Better UX for multi-certified professionals

### Alternative: AND Logic

If you need jobs with **all** selected certifications:

```javascript
const hasAllCertifications = filters.certifications.every(cert =>
  jobCertifications.includes(cert)
);
```

## Performance Considerations

### Extraction Caching

Certifications are extracted on-demand during filtering:

```javascript
// In JobListPage.jsx
const filteredJobs = useMemo(() => {
  return jobs.filter(job => {
    // ... other filters
    if (filters.certifications.length > 0) {
      const jobCertifications = extractJobCertifications(job);
      // ...
    }
  });
}, [jobs, filters]);
```

### Optimization Opportunities

1. **Pre-extract and cache**: Store certifications in job objects
2. **Index certifications**: Build reverse index for faster lookups
3. **Lazy load**: Only extract when certification filter is used

Example pre-extraction:

```javascript
// In data export script
const jobsWithCertifications = jobs.map(job => ({
  ...job,
  certifications: extractJobCertifications(job)
}));
```

## Testing

### Unit Testing Extraction

```javascript
import { extractJobCertifications } from './certificationExtractor';

test('extracts CDL from description', () => {
  const job = {
    description: "Valid CDL required",
    skills: []
  };
  expect(extractJobCertifications(job)).toContain('CDL');
});

test('normalizes OSHA variations', () => {
  const job = {
    description: "OSHA 30-hour certification required",
    skills: []
  };
  expect(extractJobCertifications(job)).toContain('OSHA');
});
```

### Integration Testing

Run the provided test script:

```bash
node test-certifications.js
```

This verifies:
- Extraction accuracy
- Coverage percentage
- Frequency distribution
- Sample outputs

### Manual Testing Checklist

- [ ] Certifications appear in filter dropdown
- [ ] Search/typeahead works
- [ ] Multi-select functions correctly
- [ ] Selected count displays
- [ ] Filter count includes certifications
- [ ] Clear all removes certifications
- [ ] Jobs filter correctly by certification
- [ ] Mobile responsive design works

## Troubleshooting

### No Certifications Found

**Problem**: `getUniqueCertifications()` returns empty array

**Solutions**:
1. Check jobs data has description/skills fields
2. Verify patterns in `CERTIFICATION_PATTERNS`
3. Run test script to see what's being extracted
4. Check console for extraction errors

### Wrong Certifications Extracted

**Problem**: Sentence fragments or incorrect matches

**Solutions**:
1. Refine regex patterns to be more specific
2. Add word boundaries to prevent partial matches
3. Add exclusions for common false positives
4. Test pattern changes with test script

### Filter Not Working

**Problem**: Jobs don't filter when certifications selected

**Solutions**:
1. Verify `extractJobCertifications` is imported in `JobListPage.jsx`
2. Check filter state includes `certifications` array
3. Ensure extraction is called in filter logic
4. Check browser console for errors

## Future Enhancements

### Grouped Certifications

Group by category in dropdown:

```javascript
const certificationOptions = [
  {
    label: 'Safety',
    options: [
      { label: 'OSHA', value: 'OSHA' },
      { label: 'HAZMAT', value: 'HAZMAT' }
    ]
  },
  {
    label: 'Maritime',
    options: [
      { label: 'USCG License', value: 'USCG License' }
    ]
  }
];
```

### Certification Metadata

Store additional information:

```javascript
const CERTIFICATIONS_METADATA = {
  'OSHA': {
    category: 'Safety',
    description: 'Occupational Safety and Health Administration',
    provider: 'OSHA',
    url: 'https://www.osha.gov/'
  }
};
```

### Smart Suggestions

Suggest related certifications:

```javascript
const RELATED_CERTIFICATIONS = {
  'CDL': ['HAZMAT', 'Forklift Certification'],
  'Six Sigma': ['Lean Six Sigma', 'PMP']
};
```

## Code Examples

### Adding to Job Card

Display certifications on job cards:

```jsx
// In JobCard.jsx
import { extractJobCertifications } from '../utils/certificationExtractor';

function JobCard({ job }) {
  const certifications = extractJobCertifications(job);

  return (
    <div className="job-card">
      {/* ... other job info ... */}

      {certifications.length > 0 && (
        <div className="certifications">
          <h4>Required Certifications:</h4>
          <div className="cert-pills">
            {certifications.map(cert => (
              <span key={cert} className="cert-pill">{cert}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

### Quick Select Pills

Add popular certifications as quick-select pills (like other filters):

```jsx
// In FiltersSearchable.jsx
const topCertifications = useMemo(() =>
  getTopCertifications(jobs, 5),
  [jobs]
);

<QuickSelectPills
  items={topCertifications}
  selectedItems={filters.certifications || []}
  onSelect={(newCerts) => onFilterChange({ ...filters, certifications: newCerts })}
  label="Popular certifications"
/>
```

## License & Attribution

Part of Moblyze Jobs Web application.
Certification extraction patterns based on common energy industry standards.
