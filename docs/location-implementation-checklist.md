# Location Standardization Implementation Checklist

## Pre-Implementation Setup

### 1. Mapbox Account Setup
- [ ] Create Mapbox account at https://account.mapbox.com/auth/signup/
- [ ] Navigate to Account > Access Tokens
- [ ] Create new access token with name "Moblyze Jobs Web - Geocoding"
- [ ] Copy access token to secure location
- [ ] Add to `.env` file: `MAPBOX_ACCESS_TOKEN=pk.xxxxx`
- [ ] Restrict token scope to "Geocoding API" only (security best practice)
- [ ] Set token URL restrictions if deploying to production domain

### 2. Environment Configuration

Create/update `.env` file in project root:

```bash
# Mapbox Geocoding API
MAPBOX_ACCESS_TOKEN=pk.ey...your_token_here

# Optional: Rate limiting
MAPBOX_MAX_REQUESTS_PER_MINUTE=600
MAPBOX_BATCH_SIZE=10

# Optional: Caching
LOCATION_CACHE_TTL_DAYS=90
ENABLE_LOCATION_CACHE=true
```

### 3. Dependencies
- [ ] Install required packages (if any new ones needed)
- [ ] Current setup already has `country-state-city` for fallback
- [ ] No additional packages needed (using native fetch API)

## Phase 1: Core Implementation (Week 1)

### Day 1-2: Mapbox Service Implementation
- [ ] Create `src/services/mapboxGeocoder.js`
  - [ ] Implement `geocodeLocation(locationString, options)`
  - [ ] Implement `parseMapboxFeature(feature)`
  - [ ] Implement `formatLocationForDisplay()`
  - [ ] Implement `batchGeocodeLocations(locations, options)`
  - [ ] Add error handling and retries
  - [ ] Add rate limiting logic

- [ ] Create test file `src/services/mapboxGeocoder.test.js`
  - [ ] Test US locations: "Houston, TX", "Houston"
  - [ ] Test Canadian locations: "Calgary, Alberta"
  - [ ] Test international: "Aberdeen", "Florence, Italy"
  - [ ] Test edge cases: "Gulf of Mexico"
  - [ ] Test error handling

### Day 3: Database Migration
- [ ] Create migration file `migrations/XXX_add_location_metadata.sql`
  - [ ] Create `location_metadata` table
  - [ ] Add indexes for performance
  - [ ] Add foreign key to `jobs` table
  - [ ] Add migration rollback script

- [ ] Test migration in development
  - [ ] Run migration up
  - [ ] Verify table structure
  - [ ] Test rollback
  - [ ] Re-run migration up

### Day 4: Hybrid Location Service
- [ ] Create `src/services/locationService.js`
  - [ ] Implement `resolveLocation(locationString, options)`
  - [ ] Implement cache logic (Map or Redis)
  - [ ] Implement fallback to `country-state-city`
  - [ ] Implement `resolveLocations()` for batch
  - [ ] Implement `prewarmLocationCache()`

- [ ] Create test file `src/services/locationService.test.js`
  - [ ] Test Mapbox path
  - [ ] Test fallback path
  - [ ] Test caching
  - [ ] Test error scenarios

### Day 5: Batch Geocoding Script
- [ ] Create `scripts/geocode-existing-locations.js`
  - [ ] Export unique locations from database
  - [ ] Batch geocode with Mapbox
  - [ ] Insert into `location_metadata` table
  - [ ] Update `jobs` table with foreign keys
  - [ ] Generate statistics report

- [ ] Run batch geocoding
  - [ ] Backup database first
  - [ ] Run script on existing locations
  - [ ] Review statistics (Mapbox vs fallback vs failed)
  - [ ] Verify results in database

### Day 6-7: Quality Assurance
- [ ] Manual spot-check of first 100 locations
  - [ ] Verify US locations format: "City, ST"
  - [ ] Verify Canadian locations: "City, AB, Canada"
  - [ ] Verify international: "City, Country"
  - [ ] Check for "Aberdeen" assignment (should be UK, not US)

- [ ] Create QA test suite
  - [ ] Known good locations
  - [ ] Known problematic locations (Aberdeen, Paris, etc.)
  - [ ] Edge cases (offshore, special locations)

- [ ] Performance testing
  - [ ] Measure cache hit rate
  - [ ] Measure API response time
  - [ ] Test batch processing speed

## Phase 2: Integration (Week 2)

### Day 8-9: Update Job Import Pipeline
- [ ] Update `scripts/export-from-db.js` (or equivalent import script)
  - [ ] Add location resolution step
  - [ ] Use `resolveLocation()` for each job
  - [ ] Store results in `location_metadata` table
  - [ ] Link jobs to location_metadata

- [ ] Test import with sample jobs
  - [ ] Verify locations are geocoded
  - [ ] Check database entries
  - [ ] Validate format consistency

### Day 10: Update API Endpoints
- [ ] Create/update `/api/locations` endpoint
  - [ ] Fetch from `location_metadata` table
  - [ ] Group by country and region
  - [ ] Return in format for React Select
  - [ ] Add caching headers

- [ ] Update job listing endpoint
  - [ ] Join with `location_metadata` table
  - [ ] Include formatted location in response
  - [ ] Add location filtering support

### Day 11: Update Frontend Components
- [ ] Update `src/components/LocationFilter.jsx`
  - [ ] Fetch from new `/api/locations` endpoint
  - [ ] Update grouping logic for new data structure
  - [ ] Test filtering functionality

- [ ] Update job listing components
  - [ ] Display standardized location format
  - [ ] Show country groupings clearly
  - [ ] Test US vs international display

- [ ] Visual QA
  - [ ] US jobs show "City, ST"
  - [ ] Canadian jobs show "City, AB, Canada"
  - [ ] International jobs show "City, Country"
  - [ ] Filters work correctly

### Day 12: Staging Testing
- [ ] Deploy to staging environment
  - [ ] Run database migrations
  - [ ] Run batch geocoding script
  - [ ] Deploy updated code

- [ ] End-to-end testing
  - [ ] Test job listing page
  - [ ] Test location filters
  - [ ] Test search functionality
  - [ ] Test mobile responsiveness

- [ ] Performance testing
  - [ ] Check page load times
  - [ ] Monitor API response times
  - [ ] Verify caching is working

### Day 13-14: Production Deployment
- [ ] Pre-deployment checklist
  - [ ] Backup production database
  - [ ] Review migration scripts
  - [ ] Verify Mapbox API key is configured
  - [ ] Set up monitoring alerts

- [ ] Deploy to production
  - [ ] Run database migrations
  - [ ] Run batch geocoding script (monitor API usage)
  - [ ] Deploy application code
  - [ ] Verify deployment

- [ ] Post-deployment verification
  - [ ] Smoke test key pages
  - [ ] Check location filters
  - [ ] Monitor error logs
  - [ ] Check Mapbox API usage dashboard

## Phase 3: Monitoring & Optimization (Ongoing)

### Week 3: Setup Monitoring
- [ ] Set up Mapbox usage tracking
  - [ ] Log all API calls
  - [ ] Track cache hit/miss rate
  - [ ] Monitor daily/monthly usage

- [ ] Create usage dashboard
  - [ ] Daily API call count
  - [ ] Cache hit rate
  - [ ] Fallback usage rate
  - [ ] Cost projection

- [ ] Set up alerts
  - [ ] Alert at 80% of free tier (80,000 requests/month)
  - [ ] Alert on API errors
  - [ ] Alert on low cache hit rate (<70%)

### Month 1: Initial Optimization
- [ ] Review first month metrics
  - [ ] Analyze cache hit rate
  - [ ] Identify locations with low confidence
  - [ ] Review fallback usage

- [ ] Optimize cache strategy
  - [ ] Adjust cache TTL if needed
  - [ ] Implement Redis if memory cache insufficient
  - [ ] Pre-warm cache for common locations

- [ ] Manual review of edge cases
  - [ ] Review locations that fell back to local library
  - [ ] Manually verify ambiguous locations
  - [ ] Update any incorrect assignments

### Quarterly: Re-validation & Review
- [ ] Re-validate location data (quarterly)
  - [ ] Re-geocode all locations with confidence < 0.8
  - [ ] Update any changed location data
  - [ ] Review new job locations

- [ ] Cost review
  - [ ] Review actual API usage vs projections
  - [ ] Adjust budget if needed
  - [ ] Consider optimizations if approaching limits

- [ ] Accuracy review
  - [ ] Spot-check 10% of locations
  - [ ] Review user feedback on locations
  - [ ] Update fallback library if needed

## Testing Checklist

### Unit Tests
- [ ] `mapboxGeocoder.test.js`
  - [ ] Test all location formats
  - [ ] Test error handling
  - [ ] Test rate limiting
  - [ ] Test batch processing

- [ ] `locationService.test.js`
  - [ ] Test caching
  - [ ] Test fallback logic
  - [ ] Test cache prewarm
  - [ ] Test error scenarios

### Integration Tests
- [ ] Test database integration
  - [ ] Insert location metadata
  - [ ] Link to jobs
  - [ ] Query locations
  - [ ] Update locations

- [ ] Test API endpoints
  - [ ] `/api/locations` returns correct format
  - [ ] `/api/jobs` includes location data
  - [ ] Filtering works correctly

### End-to-End Tests
- [ ] Test full user flow
  - [ ] User views job listings
  - [ ] User filters by location
  - [ ] User sees correct location format
  - [ ] User filters by country/region

### Performance Tests
- [ ] Batch geocoding 1000 locations
  - [ ] Should complete in <5 minutes
  - [ ] Should not exceed rate limits
  - [ ] Should have >90% success rate

- [ ] Cache hit rate
  - [ ] Should be >80% after warmup
  - [ ] Should serve cached results in <50ms

### Accuracy Tests
Create test suite with known locations:

```javascript
const accuracyTests = [
  // US - should default to US cities
  { input: 'Houston', expected: { country: 'US', city: 'Houston', region: 'TX' }},
  { input: 'Houston, TX', expected: { country: 'US', city: 'Houston', region: 'TX' }},
  { input: 'Houston, Texas', expected: { country: 'US', city: 'Houston', region: 'TX' }},

  // Ambiguous - should correctly identify country
  { input: 'Aberdeen', expected: { country: 'GB', city: 'Aberdeen' }}, // UK, not US!
  { input: 'Paris', expected: { country: 'FR', city: 'Paris' }}, // France, not Paris, TX

  // Canada
  { input: 'Calgary', expected: { country: 'CA', city: 'Calgary', region: 'AB' }},
  { input: 'Calgary, Alberta', expected: { country: 'CA', city: 'Calgary', region: 'AB' }},
  { input: 'Calgary, AB', expected: { country: 'CA', city: 'Calgary', region: 'AB' }},

  // International
  { input: 'Florence, Italy', expected: { country: 'IT', city: 'Florence' }},
  { input: 'São Paulo, Brazil', expected: { country: 'BR', city: 'São Paulo' }},
  { input: 'Abu Dhabi', expected: { country: 'AE', city: 'Abu Dhabi' }},

  // Edge cases
  { input: 'Gulf of Mexico', expected: { special: true }},
  { input: 'Global Recruiting', expected: { special: true }},
];

// Run tests
accuracyTests.forEach(async (test) => {
  const result = await resolveLocation(test.input);
  assert.equal(result.metadata.countryCode, test.expected.country);
  if (test.expected.region) {
    assert.equal(result.metadata.regionCode, test.expected.region);
  }
});
```

- [ ] Run accuracy test suite
- [ ] Verify 95% pass rate
- [ ] Review failures and adjust

## Rollback Plan

If issues occur in production:

### Immediate Rollback
1. [ ] Revert application code to previous version
2. [ ] Jobs will continue using `location` column (original data intact)
3. [ ] No data loss (location_metadata table preserved)

### Database Rollback
If migration causes issues:
1. [ ] Run migration rollback script
2. [ ] Removes `location_metadata` table
3. [ ] Removes foreign key from `jobs` table
4. [ ] Original `location` column unchanged

### API Key Issues
If Mapbox API fails:
1. [ ] Service automatically falls back to `country-state-city`
2. [ ] No user-facing impact
3. [ ] Check API key configuration
4. [ ] Verify rate limits not exceeded

## Success Criteria

### Accuracy
- [ ] 95%+ locations have correct country assignment
- [ ] 90%+ locations have correct city/region assignment
- [ ] Zero "Aberdeen UK → US" type errors
- [ ] All US locations show "City, ST" format
- [ ] All Canadian locations show "City, AB, Canada" format

### Performance
- [ ] Location filters load in <500ms
- [ ] Job listings load in <1s
- [ ] Cache hit rate >80%
- [ ] Batch geocoding completes in <5 minutes for 1000 locations

### Cost
- [ ] Stay within Mapbox free tier (100k requests/month)
- [ ] Projected Year 1 cost: $0
- [ ] API usage tracking shows <3,000 requests/day

### User Experience
- [ ] Locations display consistently formatted
- [ ] Filters group by country → region → city
- [ ] US locations grouped by state
- [ ] International locations clearly labeled with country

## Post-Implementation Review (After 30 Days)

- [ ] Review metrics dashboard
  - [ ] Total API calls
  - [ ] Cache hit rate
  - [ ] Cost vs projections

- [ ] User feedback review
  - [ ] Any location accuracy complaints?
  - [ ] Filter usability issues?
  - [ ] Performance concerns?

- [ ] Technical review
  - [ ] Any errors or exceptions?
  - [ ] Rate limiting issues?
  - [ ] Database performance?

- [ ] Documentation update
  - [ ] Update with lessons learned
  - [ ] Document any edge cases found
  - [ ] Update cost projections if needed

---

## Quick Reference Commands

### Run batch geocoding:
```bash
node scripts/geocode-existing-locations.js
```

### Check API usage:
```javascript
// In browser console or monitoring dashboard
fetch('/api/location-stats')
  .then(r => r.json())
  .then(console.log)
```

### Clear location cache:
```javascript
// If using in-memory cache
locationCache.clear()

// If using Redis
redis.del('location:*')
```

### Test single location:
```javascript
import { resolveLocation } from './src/services/locationService.js';

const result = await resolveLocation('Aberdeen');
console.log(result);
// Should show: { formatted: "Aberdeen, United Kingdom", metadata: { countryCode: "GB", ... }}
```

### Re-geocode locations with low confidence:
```sql
-- Find low-confidence locations
SELECT original_location, formatted_location, confidence
FROM location_metadata
WHERE confidence < 0.8
ORDER BY confidence ASC;

-- Re-geocode these manually or with script
```

---

**Checklist Version:** 1.0
**Last Updated:** 2026-02-08
