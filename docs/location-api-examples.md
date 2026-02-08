# Location Standardization API Examples

Quick reference for testing and using the Mapbox Geocoding API and location service.

## Mapbox Geocoding API Examples

### Basic Forward Geocoding

**Request:**
```bash
curl "https://api.mapbox.com/geocoding/v5/mapbox.places/Houston,%20TX.json?access_token=YOUR_TOKEN&limit=1&types=place"
```

**Response:**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "id": "place.123",
      "type": "Feature",
      "place_type": ["place"],
      "text": "Houston",
      "place_name": "Houston, Texas, United States",
      "center": [-95.3698, 29.7604],
      "geometry": {
        "type": "Point",
        "coordinates": [-95.3698, 29.7604]
      },
      "context": [
        {
          "id": "region.456",
          "short_code": "US-TX",
          "text": "Texas"
        },
        {
          "id": "country.789",
          "short_code": "us",
          "text": "United States"
        }
      ],
      "relevance": 0.99
    }
  ]
}
```

### Ambiguous Location (Aberdeen)

**Request:**
```bash
curl "https://api.mapbox.com/geocoding/v5/mapbox.places/Aberdeen.json?access_token=YOUR_TOKEN&limit=1&types=place"
```

**Expected:** Should return Aberdeen, Scotland, UK (not Aberdeen, SD, US)

**Response:**
```json
{
  "features": [
    {
      "place_name": "Aberdeen, Scotland, United Kingdom",
      "text": "Aberdeen",
      "center": [-2.0943, 57.1497],
      "context": [
        {
          "id": "region.123",
          "text": "Scotland"
        },
        {
          "id": "country.456",
          "short_code": "gb",
          "text": "United Kingdom"
        }
      ],
      "relevance": 1.0
    }
  ]
}
```

### Canadian Location

**Request:**
```bash
curl "https://api.mapbox.com/geocoding/v5/mapbox.places/Calgary,%20Alberta.json?access_token=YOUR_TOKEN&limit=1&types=place"
```

**Response:**
```json
{
  "features": [
    {
      "place_name": "Calgary, Alberta, Canada",
      "text": "Calgary",
      "center": [-114.0719, 51.0447],
      "context": [
        {
          "id": "region.123",
          "short_code": "CA-AB",
          "text": "Alberta"
        },
        {
          "id": "country.456",
          "short_code": "ca",
          "text": "Canada"
        }
      ]
    }
  ]
}
```

### International Location

**Request:**
```bash
curl "https://api.mapbox.com/geocoding/v5/mapbox.places/Florence,%20Italy.json?access_token=YOUR_TOKEN&limit=1&types=place"
```

**Response:**
```json
{
  "features": [
    {
      "place_name": "Florence, Tuscany, Italy",
      "text": "Florence",
      "center": [11.2558, 43.7696],
      "context": [
        {
          "id": "region.123",
          "text": "Tuscany"
        },
        {
          "id": "country.456",
          "short_code": "it",
          "text": "Italy"
        }
      ]
    }
  ]
}
```

### Constraining to Specific Country

To improve accuracy for ambiguous city names, use the `country` parameter:

**Request:**
```bash
# Aberdeen in United Kingdom
curl "https://api.mapbox.com/geocoding/v5/mapbox.places/Aberdeen.json?access_token=YOUR_TOKEN&country=gb&limit=1"

# Aberdeen in United States
curl "https://api.mapbox.com/geocoding/v5/mapbox.places/Aberdeen.json?access_token=YOUR_TOKEN&country=us&limit=1"
```

### Batch Geocoding Pattern

Mapbox doesn't have official batch API, but you can batch requests client-side:

```javascript
async function batchGeocode(locations) {
  const results = [];

  // Process in batches of 10
  for (let i = 0; i < locations.length; i += 10) {
    const batch = locations.slice(i, i + 10);

    const batchResults = await Promise.all(
      batch.map(location =>
        fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(location)}.json?access_token=${TOKEN}&limit=1`)
          .then(r => r.json())
      )
    );

    results.push(...batchResults);

    // Rate limit: 600 requests/min = 10 per second
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return results;
}
```

## Location Service Usage Examples

### Resolve Single Location

```javascript
import { resolveLocation } from './src/services/locationService.js';

// US location
const houston = await resolveLocation('Houston, TX');
console.log(houston);
// {
//   formatted: "Houston, TX",
//   metadata: {
//     countryCode: "US",
//     countryName: "United States",
//     regionCode: "TX",
//     regionName: "Texas",
//     cityName: "Houston",
//     coordinates: { latitude: 29.7604, longitude: -95.3698 },
//     source: "mapbox"
//   }
// }

// Ambiguous location (should resolve to UK)
const aberdeen = await resolveLocation('Aberdeen');
console.log(aberdeen);
// {
//   formatted: "Aberdeen, United Kingdom",
//   metadata: {
//     countryCode: "GB",
//     countryName: "United Kingdom",
//     cityName: "Aberdeen",
//     coordinates: { latitude: 57.1497, longitude: -2.0943 },
//     source: "mapbox"
//   }
// }

// Canadian location
const calgary = await resolveLocation('Calgary, Alberta');
console.log(calgary);
// {
//   formatted: "Calgary, AB, Canada",
//   metadata: {
//     countryCode: "CA",
//     countryName: "Canada",
//     regionCode: "AB",
//     regionName: "Alberta",
//     cityName: "Calgary",
//     coordinates: { latitude: 51.0447, longitude: -114.0719 },
//     source: "mapbox"
//   }
// }
```

### Batch Resolve Locations

```javascript
import { resolveLocations } from './src/services/locationService.js';

const locations = [
  'Houston, TX',
  'Calgary, Alberta',
  'Aberdeen',
  'Florence, Italy',
  'Gulf of Mexico' // Special case
];

const results = await resolveLocations(locations);

results.forEach((result, i) => {
  console.log(`${locations[i]} → ${result.formatted}`);
});

// Output:
// Houston, TX → Houston, TX
// Calgary, Alberta → Calgary, AB, Canada
// Aberdeen → Aberdeen, United Kingdom
// Florence, Italy → Florence, Italy
// Gulf of Mexico → Gulf of Mexico
```

### Pre-warm Cache

```javascript
import { prewarmLocationCache } from './src/services/locationService.js';
import Database from 'better-sqlite3';

const db = new Database('./jobs.db');

// Get all unique locations from database
const locations = db.prepare('SELECT DISTINCT location FROM jobs').all()
  .map(row => row.location)
  .filter(Boolean);

console.log(`Pre-warming cache with ${locations.length} locations...`);

const stats = await prewarmLocationCache(locations);

console.log('Cache warming complete:');
console.log(`- Total: ${stats.total}`);
console.log(`- Mapbox: ${stats.mapbox} (${(stats.mapbox/stats.total*100).toFixed(1)}%)`);
console.log(`- Fallback: ${stats.fallback} (${(stats.fallback/stats.total*100).toFixed(1)}%)`);
console.log(`- Failed: ${stats.original} (${(stats.original/stats.total*100).toFixed(1)}%)`);
```

### Check Cache Hit Rate

```javascript
// Monitor cache performance
let cacheHits = 0;
let cacheMisses = 0;

// Wrap resolveLocation to track cache hits
const originalResolve = resolveLocation;
resolveLocation = async (location, options) => {
  const cacheKey = location.toLowerCase().trim();
  const inCache = locationCache.has(cacheKey);

  if (inCache) {
    cacheHits++;
  } else {
    cacheMisses++;
  }

  const result = await originalResolve(location, options);

  console.log(`Cache hit rate: ${(cacheHits/(cacheHits+cacheMisses)*100).toFixed(1)}%`);

  return result;
};
```

## Testing Different Location Formats

### Test Suite

```javascript
const testCases = [
  // US locations - various formats
  { input: 'Houston', expected: 'Houston, TX' },
  { input: 'Houston, TX', expected: 'Houston, TX' },
  { input: 'Houston, Texas', expected: 'Houston, TX' },
  { input: 'US-TX-HOUSTON-2001 RANKIN ROAD', expected: 'Houston, TX' },

  // Ambiguous cities - should pick most prominent
  { input: 'Paris', expected: 'Paris, France' }, // Not Paris, TX
  { input: 'Aberdeen', expected: 'Aberdeen, United Kingdom' }, // Not Aberdeen, SD
  { input: 'Portland', expected: 'Portland, OR' }, // Could be OR or ME, usually OR

  // Canadian locations
  { input: 'Calgary', expected: 'Calgary, AB, Canada' },
  { input: 'Calgary, AB', expected: 'Calgary, AB, Canada' },
  { input: 'Calgary, Alberta', expected: 'Calgary, AB, Canada' },
  { input: 'CA-AB-CALGARY-4839 90TH AVENUE SE', expected: 'Calgary, AB, Canada' },

  // International locations
  { input: 'Florence, Italy', expected: 'Florence, Italy' },
  { input: 'IT-FI-FLORENCE-VIA FELICE MATTEUCCI 2', expected: 'Florence, Italy' },
  { input: 'São Paulo, Brazil', expected: 'São Paulo, São Paulo, Brazil' },
  { input: 'Abu Dhabi', expected: 'Abu Dhabi, United Arab Emirates' },
  { input: 'AE-ABU DHABI-AL GHAITH HOLDING TOWER', expected: 'Abu Dhabi, United Arab Emirates' },

  // Special cases
  { input: 'Gulf of Mexico', expected: 'Gulf of Mexico' },
  { input: 'Global Recruiting', expected: 'Global Recruiting' },
  { input: 'Noble Interceptor', expected: 'Noble Interceptor' },

  // Edge cases
  { input: '', expected: null },
  { input: 'locations', expected: null },
  { input: 'locations\nHouston', expected: 'Houston, TX' },
];

// Run tests
for (const test of testCases) {
  try {
    const result = await resolveLocation(test.input);
    const formatted = result?.formatted || null;

    if (formatted === test.expected) {
      console.log(`✅ PASS: "${test.input}" → "${formatted}"`);
    } else {
      console.error(`❌ FAIL: "${test.input}"`);
      console.error(`   Expected: "${test.expected}"`);
      console.error(`   Got:      "${formatted}"`);
    }
  } catch (error) {
    console.error(`❌ ERROR: "${test.input}" - ${error.message}`);
  }
}
```

## API Usage Monitoring

### Track API Calls

```javascript
// Simple API call tracker
let apiCallCount = 0;
let apiCallsByDay = {};

function trackApiCall() {
  apiCallCount++;

  const today = new Date().toISOString().split('T')[0];
  if (!apiCallsByDay[today]) {
    apiCallsByDay[today] = 0;
  }
  apiCallsByDay[today]++;

  console.log(`Total API calls: ${apiCallCount}`);
  console.log(`Today: ${apiCallsByDay[today]}`);

  // Check if approaching free tier limit
  const monthStart = new Date();
  monthStart.setDate(1);

  const monthlyTotal = Object.entries(apiCallsByDay)
    .filter(([date]) => new Date(date) >= monthStart)
    .reduce((sum, [, count]) => sum + count, 0);

  if (monthlyTotal > 80000) {
    console.warn(`⚠️  Warning: ${monthlyTotal}/100,000 API calls this month (${(monthlyTotal/100000*100).toFixed(1)}%)`);
  }

  return monthlyTotal;
}

// Wrap geocodeLocation to track calls
const originalGeocode = geocodeLocation;
geocodeLocation = async (...args) => {
  trackApiCall();
  return originalGeocode(...args);
};
```

### Cost Estimation

```javascript
function estimateApiCost(apiCalls) {
  const FREE_TIER = 100000;
  const COST_PER_1000 = 0.75;

  if (apiCalls <= FREE_TIER) {
    return {
      calls: apiCalls,
      cost: 0,
      remaining: FREE_TIER - apiCalls,
      percentUsed: (apiCalls / FREE_TIER * 100).toFixed(1)
    };
  }

  const overage = apiCalls - FREE_TIER;
  const cost = (overage / 1000) * COST_PER_1000;

  return {
    calls: apiCalls,
    cost: cost.toFixed(2),
    overage,
    percentUsed: 100
  };
}

// Usage
const estimate = estimateApiCost(120000);
console.log(`API Calls: ${estimate.calls}`);
console.log(`Cost: $${estimate.cost}`);
console.log(`Free tier: ${estimate.percentUsed}% used`);
```

## Error Handling Examples

### Retry with Exponential Backoff

```javascript
async function geocodeWithRetry(location, maxRetries = 3) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await geocodeLocation(location);
    } catch (error) {
      lastError = error;

      // Don't retry on 4xx errors (bad request, auth, etc.)
      if (error.status >= 400 && error.status < 500) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, i) * 1000;
      console.warn(`Retry ${i + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

### Fallback Chain

```javascript
async function resolveLocationWithFallback(location) {
  // Try Mapbox first
  try {
    const result = await geocodeLocation(location);
    if (result) {
      return { ...result, source: 'mapbox' };
    }
  } catch (error) {
    console.warn('Mapbox failed:', error.message);
  }

  // Try country-state-city library
  try {
    const result = parseLocation(location, true);
    if (result && result.metadata.parsed) {
      return { ...result, source: 'country-state-city' };
    }
  } catch (error) {
    console.warn('country-state-city failed:', error.message);
  }

  // Last resort: return original string
  return {
    formatted: location,
    metadata: {
      source: 'original',
      parsed: false,
      originalText: location
    }
  };
}
```

## Database Queries

### Get All Locations with Metadata

```sql
-- Get all locations with metadata
SELECT
  lm.id,
  lm.original_location,
  lm.formatted_location,
  lm.country_code,
  lm.country_name,
  lm.region_code,
  lm.region_name,
  lm.city_name,
  lm.latitude,
  lm.longitude,
  lm.confidence,
  lm.source,
  COUNT(j.id) as job_count
FROM location_metadata lm
LEFT JOIN jobs j ON j.location_metadata_id = lm.id
GROUP BY lm.id
ORDER BY job_count DESC;
```

### Locations Needing Re-validation

```sql
-- Find locations with low confidence
SELECT
  original_location,
  formatted_location,
  confidence,
  source,
  geocoded_at
FROM location_metadata
WHERE confidence < 0.8 OR source = 'country-state-city'
ORDER BY confidence ASC;
```

### Location Statistics

```sql
-- Get location statistics
SELECT
  source,
  COUNT(*) as count,
  AVG(confidence) as avg_confidence
FROM location_metadata
GROUP BY source;

-- Output:
-- source              | count | avg_confidence
-- -------------------|-------|---------------
-- mapbox             | 850   | 0.95
-- country-state-city | 120   | NULL
-- original           | 30    | NULL
```

### Top Cities by Job Count

```sql
-- Top cities with most jobs
SELECT
  lm.formatted_location,
  lm.country_name,
  lm.region_name,
  COUNT(j.id) as job_count
FROM location_metadata lm
JOIN jobs j ON j.location_metadata_id = lm.id
GROUP BY lm.id
ORDER BY job_count DESC
LIMIT 20;
```

---

## Quick Reference

### Mapbox API Limits (Free Tier)
- **Monthly requests**: 100,000
- **Rate limit**: 600 requests/minute
- **Concurrent requests**: Up to 60

### Recommended Caching Strategy
- **Cache TTL**: 90 days
- **Re-validate**: Quarterly for all locations
- **Pre-warm**: On application startup
- **Target cache hit rate**: >80%

### Format Conventions
- **US**: "City, ST" (e.g., "Houston, TX")
- **Canada**: "City, AB, Canada"
- **Brazil**: "City, State, Brazil"
- **International**: "City, Country"
- **Special**: Keep as-is (e.g., "Gulf of Mexico")

---

**Document Version:** 1.0
**Last Updated:** 2026-02-08
