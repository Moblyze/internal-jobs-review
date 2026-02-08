# Location Standardization Solution: Research & Recommendation

**Date:** 2026-02-08
**Project:** Moblyze Jobs Web
**Status:** Recommendation

## Executive Summary

After comprehensive research into global location standardization solutions for the job board, I recommend a **hybrid approach using Mapbox Geocoding API** as the primary solution with a fallback to the existing `country-state-city` library for offline capabilities.

**Key Reasoning:**
- Mapbox offers the best balance of accuracy, pricing, and features for job board use cases
- 100,000 free requests/month covers initial needs (500-1000 locations)
- Superior accuracy compared to current solution (fixes Aberdeen UK → US issue)
- No restrictive caching policies unlike Google Maps
- Can store results permanently for job locations

## Problem Statement

The current implementation using `country-state-city` library has accuracy issues:

### Specific Issues:
1. **Incorrect country assignment**: Aberdeen assigned to US instead of UK
2. **Ambiguous city names**: No way to resolve cities that exist in multiple countries
3. **Limited validation**: Cannot verify if location strings are valid
4. **No address parsing**: Cannot handle full addresses with street information
5. **Static data**: Library updates are infrequent, may have outdated information

### Requirements:
- **United States**: Group by state, show cities (Texas → Houston, TX | Midland, TX)
- **Canada**: Show province clearly (Alberta, Canada → Calgary, AB, Canada)
- **International**: Clear country indicators (Florence, Italy)
- **Accuracy**: No incorrect country assignments
- **Volume**: Handle ~500-1000 job locations
- **Cost**: Reasonable for startup budget

## Solution Comparison

### Top 3 Recommended Options

| Feature | **Mapbox Geocoding** ⭐ RECOMMENDED | **Google Geocoding/Places** | **OpenCage Data** |
|---------|-----------------------------------|----------------------------|-------------------|
| **Free Tier** | 100,000 requests/month | $200 credit (~40,000 requests) | 2,500 requests/day (~75,000/month) |
| **Cost After Free** | $0.75 per 1,000 | $5.00 per 1,000 | $50/month for 10,000 requests/day |
| **Rate Limits** | 600 requests/minute | Standard rate limits | 1 request/second (free tier) |
| **Data Storage** | ✅ Permanent storage allowed | ❌ Max 30 days cache only | ✅ Permanent storage allowed |
| **Global Accuracy** | ⭐⭐⭐⭐ Excellent (OSM + proprietary) | ⭐⭐⭐⭐⭐ Best-in-class | ⭐⭐⭐ Good (OSM-based) |
| **US/Canada Accuracy** | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐⭐⭐ Very Good |
| **Address Parsing** | ✅ Yes | ✅ Yes (best) | ✅ Yes |
| **Reverse Geocoding** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Batch Processing** | ✅ Yes | ❌ No official batch API | ✅ Yes |
| **API Key Management** | Simple token | Complex (requires billing) | Simple token |
| **Documentation** | ⭐⭐⭐⭐ Excellent | ⭐⭐⭐⭐⭐ Comprehensive | ⭐⭐⭐⭐ Good |
| **Best For** | Job boards, apps needing storage | Enterprise with Google ecosystem | Budget-conscious projects |

### Other Options Considered

| Option | Verdict | Reason |
|--------|---------|--------|
| **HERE Location Services** | ❌ Not Recommended | $1 per 1,000 after 250k free, but less accurate for job board use cases |
| **Nominatim (OSM)** | ❌ Not Recommended | 1 req/sec limit too restrictive, not suitable for commercial use |
| **Pelias (Self-hosted)** | ❌ Not Recommended | Requires DevOps overhead, Elasticsearch infrastructure, not cost-effective at this scale |
| **country-state-city (Current)** | ⚠️ Keep as Fallback | Free and offline, but has accuracy issues |

## Detailed Analysis

### 1. Mapbox Geocoding API ⭐ RECOMMENDED

**Strengths:**
- **Generous free tier**: 100,000 requests/month covers 500-1000 locations with room for updates
- **Permanent storage**: Can store geocoded results indefinitely without restrictions
- **Excellent accuracy**: Uses OpenStreetMap + proprietary data, particularly strong in US/Canada
- **Batch processing**: Can geocode multiple locations in a single request
- **Flexible pricing**: $0.75 per 1,000 requests is reasonable for scale
- **Simple integration**: RESTful API with clear documentation
- **Rich response data**: Includes coordinates, bounding boxes, context hierarchy

**Weaknesses:**
- Not quite as accurate as Google in some international regions
- Requires API key management
- Depends on external service (though offline fallback possible)

**Cost Estimate for Moblyze:**
- Initial load: ~1,000 locations = 1,000 requests = **FREE** (within 100k limit)
- Monthly updates: ~100 new jobs × 30 days = 3,000 requests = **FREE**
- Re-validation (quarterly): 1,000 locations = **FREE**
- **Total estimated annual cost: $0** for first year at current scale

**When you'd pay:**
- Only if you exceed 100,000 requests/month (unlikely at current scale)
- If exceeded: $0.75 per 1,000 = ~$9 for 12,000 additional requests

### 2. Google Geocoding API / Places API

**Strengths:**
- **Best-in-class accuracy**: Most comprehensive and accurate global coverage
- **Places API**: Excellent for place names, businesses, POIs
- **Address parsing**: Superior handling of complex addresses
- **Reliability**: Industry-standard, 99.9% uptime SLA
- **Ecosystem**: Integrates with other Google services

**Weaknesses:**
- **Restrictive caching**: Cannot store results permanently, max 30 days cache
- **Must display on Google Maps**: Geocoded data must be displayed on Google Maps
- **Higher cost**: $5 per 1,000 requests (6.7x more expensive than Mapbox)
- **Complex pricing**: Multiple SKUs, tiered pricing based on fields requested
- **Billing required**: Must set up Google Cloud Platform billing even for free tier

**Cost Estimate for Moblyze:**
- Initial load: ~1,000 locations = $5
- Monthly updates: ~3,000 locations = $15/month = $180/year
- Re-validation: $5 per quarter = $20/year
- **Total estimated annual cost: $200+**

**Deal-breaker for job boards:**
The 30-day caching limit means you'd need to re-geocode locations every 30 days or pay for permanent storage by displaying on Google Maps. This adds ongoing costs and complexity.

### 3. OpenCage Geocoding API

**Strengths:**
- **Good free tier**: 2,500 requests/day = ~75,000/month
- **OpenStreetMap based**: Good accuracy in US/Canada/Europe
- **Permanent storage**: No restrictions on caching
- **Simple pricing**: Clear tiers with no hidden costs
- **Good documentation**: Easy to integrate

**Weaknesses:**
- **Lower accuracy**: Relies primarily on OSM data, gaps in some regions
- **Rate limits**: 1 request/second on free tier (slow for batch processing)
- **Less commercial support**: Smaller company, less enterprise backing
- **Data quality varies**: Accuracy depends on OSM contributor activity in region

**Cost Estimate for Moblyze:**
- Free tier covers 2,500 requests/day
- Initial load: ~1,000 locations = **FREE** (spread over 1-2 days)
- Monthly updates: ~3,000/month = **FREE**
- If you need faster processing: $50/month for 10,000 requests/day
- **Total estimated annual cost: $0** at current scale

**Why Mapbox is preferred:**
While OpenCage is cheaper, Mapbox offers better accuracy, faster rate limits (600 req/min vs 1 req/sec), and more generous free tier (100k vs 75k).

## Implementation Recommendation

### Hybrid Approach: Mapbox + Country-State-City Fallback

**Architecture:**
```
User Input → Parse Location → Check Cache
                                   ↓
                            Is Cached? → YES → Return Cached
                                   ↓ NO
                            Mapbox Geocoding API
                                   ↓
                            Valid Result? → YES → Cache & Return
                                   ↓ NO
                            country-state-city Fallback
                                   ↓
                            Return Best Match
```

**Benefits:**
1. **Cost-effective**: Most requests served from cache, minimal API calls
2. **Offline capability**: Fallback works without internet
3. **High accuracy**: Mapbox fixes issues like Aberdeen UK/US confusion
4. **Future-proof**: Can switch providers if needed
5. **Performance**: Cache reduces latency

### Implementation Phases

#### Phase 1: One-time Geocoding (Week 1)
- Export all existing locations from job database
- Run batch geocoding through Mapbox API
- Store results in new `location_metadata` table
- Update display layer to use standardized locations

#### Phase 2: Real-time Validation (Week 2)
- Add geocoding to job import pipeline
- Validate and standardize locations on ingestion
- Cache results to minimize API calls
- Add fallback to country-state-city

#### Phase 3: Monitoring & Refinement (Ongoing)
- Track geocoding success rate
- Monitor API usage and costs
- Refine parsing rules for edge cases
- Quarterly re-validation of cached locations

## Code Implementation Example

### 1. Mapbox Geocoding Service

```javascript
// src/services/mapboxGeocoder.js

const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
const MAPBOX_GEOCODING_API = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

/**
 * Geocodes a location using Mapbox Geocoding API
 *
 * @param {string} locationString - Raw location string (e.g., "Houston, TX" or "Aberdeen")
 * @param {object} options - Additional options (country code, types, etc.)
 * @returns {Promise<object>} - Geocoded location data
 */
export async function geocodeLocation(locationString, options = {}) {
  if (!MAPBOX_ACCESS_TOKEN) {
    throw new Error('MAPBOX_ACCESS_TOKEN not configured');
  }

  const params = new URLSearchParams({
    access_token: MAPBOX_ACCESS_TOKEN,
    limit: options.limit || 1,
    types: options.types || 'place,locality,address', // Focus on cities and addresses
    language: options.language || 'en',
  });

  // Add country restriction if provided (helps with accuracy)
  if (options.country) {
    params.append('country', options.country); // e.g., 'us', 'ca', 'gb'
  }

  const url = `${MAPBOX_GEOCODING_API}/${encodeURIComponent(locationString)}.json?${params}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Mapbox API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.features || data.features.length === 0) {
      return null; // No results found
    }

    const feature = data.features[0]; // Take the best match

    // Parse Mapbox response into our standardized format
    return parseMapboxFeature(feature);
  } catch (error) {
    console.error('Mapbox geocoding error:', error);
    throw error;
  }
}

/**
 * Parses Mapbox feature into standardized location format
 */
function parseMapboxFeature(feature) {
  const { place_name, center, context, place_type } = feature;

  // Extract country, region, city from context
  const country = context?.find(c => c.id.startsWith('country.'));
  const region = context?.find(c => c.id.startsWith('region.')); // State/province
  const place = context?.find(c => c.id.startsWith('place.')); // City

  // Determine country code
  const countryCode = country?.short_code?.toUpperCase() || null;
  const countryName = country?.text || null;

  // Extract region/state
  const regionCode = region?.short_code?.split('-')[1]?.toUpperCase() || null; // e.g., "US-TX" → "TX"
  const regionName = region?.text || null;

  // City name
  const cityName = place?.text || feature.text;

  // Format display name based on country conventions
  let formatted = formatLocationForDisplay({
    cityName,
    regionCode,
    regionName,
    countryCode,
    countryName
  });

  return {
    formatted,
    metadata: {
      countryCode,
      countryName,
      regionCode, // State/province code (e.g., "TX", "AB")
      regionName, // Full state/province name (e.g., "Texas", "Alberta")
      cityName,
      coordinates: {
        longitude: center[0],
        latitude: center[1]
      },
      confidence: feature.relevance, // Mapbox confidence score (0-1)
      placeType: place_type[0],
      fullPlaceName: place_name,
      source: 'mapbox',
      geocodedAt: new Date().toISOString()
    }
  };
}

/**
 * Formats location for display based on country conventions
 */
function formatLocationForDisplay({ cityName, regionCode, regionName, countryCode, countryName }) {
  // US locations: "City, ST"
  if (countryCode === 'US' && regionCode) {
    return `${cityName}, ${regionCode}`;
  }

  // Canadian locations: "City, AB, Canada"
  if (countryCode === 'CA' && regionCode) {
    return `${cityName}, ${regionCode}, Canada`;
  }

  // Brazilian locations: "City, State, Brazil"
  if (countryCode === 'BR' && regionName) {
    return `${cityName}, ${regionName}, Brazil`;
  }

  // Other international locations: "City, Country"
  if (countryName) {
    return `${cityName}, ${countryName}`;
  }

  // Fallback: just the city name
  return cityName;
}

/**
 * Batch geocodes multiple locations (up to 50 at a time)
 */
export async function batchGeocodeLocations(locations, options = {}) {
  const results = [];
  const batchSize = 10; // Process 10 at a time to respect rate limits

  for (let i = 0; i < locations.length; i += batchSize) {
    const batch = locations.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(location =>
        geocodeLocation(location, options)
          .catch(error => {
            console.error(`Failed to geocode "${location}":`, error);
            return null; // Return null for failed geocoding
          })
      )
    );

    results.push(...batchResults);

    // Rate limiting: Wait 100ms between batches (600 requests/min = 10 per second)
    if (i + batchSize < locations.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}
```

### 2. Hybrid Location Service with Fallback

```javascript
// src/services/locationService.js

import { geocodeLocation } from './mapboxGeocoder.js';
import { parseLocation } from '../utils/locationParser.js'; // Existing country-state-city parser

// In-memory cache (or use Redis for production)
const locationCache = new Map();

/**
 * Resolves a location string to standardized format with fallback
 *
 * @param {string} locationString - Raw location string
 * @param {object} options - Options (useCache, forceMapbox, etc.)
 * @returns {Promise<object>} - Standardized location data
 */
export async function resolveLocation(locationString, options = {}) {
  const { useCache = true, forceMapbox = false } = options;

  // Check cache first
  const cacheKey = locationString.toLowerCase().trim();
  if (useCache && locationCache.has(cacheKey)) {
    return locationCache.get(cacheKey);
  }

  let result = null;

  try {
    // Try Mapbox first
    result = await geocodeLocation(locationString);

    if (result) {
      result.metadata.source = 'mapbox';
    }
  } catch (error) {
    console.warn('Mapbox geocoding failed, falling back to local library:', error.message);
  }

  // Fallback to country-state-city if Mapbox fails
  if (!result && !forceMapbox) {
    const localResult = parseLocation(locationString, true);

    if (localResult) {
      result = {
        formatted: localResult.formatted,
        metadata: {
          ...localResult.metadata,
          source: 'country-state-city',
          geocodedAt: new Date().toISOString()
        }
      };
    }
  }

  // Final fallback: return original string
  if (!result) {
    result = {
      formatted: locationString,
      metadata: {
        source: 'original',
        parsed: false,
        originalText: locationString
      }
    };
  }

  // Cache the result
  if (useCache) {
    locationCache.set(cacheKey, result);
  }

  return result;
}

/**
 * Batch resolves multiple locations with caching
 */
export async function resolveLocations(locations, options = {}) {
  return Promise.all(
    locations.map(location => resolveLocation(location, options))
  );
}

/**
 * Pre-warms cache with known locations
 */
export async function prewarmLocationCache(locations) {
  console.log(`Pre-warming location cache with ${locations.length} locations...`);

  const results = await resolveLocations(locations, { useCache: false });

  const stats = {
    total: results.length,
    mapbox: results.filter(r => r.metadata.source === 'mapbox').length,
    fallback: results.filter(r => r.metadata.source === 'country-state-city').length,
    original: results.filter(r => r.metadata.source === 'original').length
  };

  console.log('Cache pre-warming complete:', stats);
  return stats;
}
```

### 3. Database Schema for Cached Locations

```sql
-- Migration: Add location_metadata table

CREATE TABLE location_metadata (
  id SERIAL PRIMARY KEY,

  -- Original location string from job posting
  original_location TEXT NOT NULL UNIQUE,

  -- Standardized location display
  formatted_location TEXT NOT NULL,

  -- Geographic data
  country_code CHAR(2),
  country_name VARCHAR(100),
  region_code VARCHAR(10), -- State/province code (e.g., "TX", "AB")
  region_name VARCHAR(100), -- Full state/province name
  city_name VARCHAR(100),

  -- Coordinates
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),

  -- Metadata
  confidence DECIMAL(3, 2), -- 0.00 to 1.00 (from geocoding API)
  place_type VARCHAR(50), -- "place", "locality", "address"
  source VARCHAR(50) NOT NULL, -- "mapbox", "country-state-city", "original"

  -- Timestamps
  geocoded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Indexes for common queries
  INDEX idx_formatted_location (formatted_location),
  INDEX idx_country_region (country_code, region_code),
  INDEX idx_source (source)
);

-- Add foreign key to jobs table
ALTER TABLE jobs
ADD COLUMN location_metadata_id INTEGER REFERENCES location_metadata(id);

-- Create index for location lookups
CREATE INDEX idx_jobs_location_metadata ON jobs(location_metadata_id);
```

### 4. Migration Script to Geocode Existing Locations

```javascript
// scripts/geocode-existing-locations.js

import Database from 'better-sqlite3';
import { batchGeocodeLocations } from '../src/services/mapboxGeocoder.js';
import { parseLocation } from '../src/utils/locationParser.js';

async function geocodeExistingLocations() {
  const db = new Database('./jobs.db');

  // Get all unique locations from jobs
  const locations = db.prepare(`
    SELECT DISTINCT location
    FROM jobs
    WHERE location IS NOT NULL
    AND location != ''
  `).all().map(row => row.location);

  console.log(`Found ${locations.length} unique locations to geocode`);

  // Batch geocode with Mapbox
  console.log('Geocoding with Mapbox...');
  const geocoded = await batchGeocodeLocations(locations);

  // Insert into location_metadata table
  const insertStmt = db.prepare(`
    INSERT INTO location_metadata (
      original_location,
      formatted_location,
      country_code,
      country_name,
      region_code,
      region_name,
      city_name,
      latitude,
      longitude,
      confidence,
      place_type,
      source,
      geocoded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (original_location) DO UPDATE SET
      formatted_location = excluded.formatted_location,
      country_code = excluded.country_code,
      updated_at = NOW()
  `);

  const stats = {
    total: locations.length,
    mapbox: 0,
    fallback: 0,
    failed: 0
  };

  for (let i = 0; i < locations.length; i++) {
    const location = locations[i];
    let result = geocoded[i];

    // If Mapbox failed, try local fallback
    if (!result) {
      result = parseLocation(location, true);
      if (result) {
        result.metadata.source = 'country-state-city';
        stats.fallback++;
      } else {
        stats.failed++;
        continue;
      }
    } else {
      stats.mapbox++;
    }

    const { formatted, metadata } = result;

    insertStmt.run(
      location,
      formatted,
      metadata.countryCode,
      metadata.countryName,
      metadata.regionCode,
      metadata.regionName,
      metadata.cityName,
      metadata.coordinates?.latitude,
      metadata.coordinates?.longitude,
      metadata.confidence || null,
      metadata.placeType || null,
      metadata.source,
      metadata.geocodedAt || new Date().toISOString()
    );
  }

  // Update jobs table with location_metadata_id
  console.log('Linking jobs to location metadata...');
  db.prepare(`
    UPDATE jobs
    SET location_metadata_id = (
      SELECT id FROM location_metadata
      WHERE location_metadata.original_location = jobs.location
    )
    WHERE location IS NOT NULL
  `).run();

  console.log('Geocoding complete!');
  console.log('Stats:', stats);
  console.log(`Mapbox: ${stats.mapbox} (${(stats.mapbox/stats.total*100).toFixed(1)}%)`);
  console.log(`Fallback: ${stats.fallback} (${(stats.fallback/stats.total*100).toFixed(1)}%)`);
  console.log(`Failed: ${stats.failed} (${(stats.failed/stats.total*100).toFixed(1)}%)`);

  db.close();
}

geocodeExistingLocations().catch(console.error);
```

### 5. Updated Location Filter Component

```javascript
// src/components/LocationFilter.jsx

import { useEffect, useState } from 'react';
import Select from 'react-select';

export function LocationFilter({ selectedLocation, onLocationChange }) {
  const [locationOptions, setLocationOptions] = useState([]);

  useEffect(() => {
    // Fetch locations from API (already geocoded and cached)
    fetch('/api/locations')
      .then(res => res.json())
      .then(data => {
        // Group locations by country, then by region
        const grouped = groupLocationsByCountryAndRegion(data);
        setLocationOptions(grouped);
      });
  }, []);

  return (
    <Select
      options={locationOptions}
      value={selectedLocation}
      onChange={onLocationChange}
      placeholder="Filter by location..."
      isClearable
      className="w-full"
    />
  );
}

function groupLocationsByCountryAndRegion(locations) {
  const grouped = {};

  locations.forEach(loc => {
    const country = loc.country_name || 'Other';
    const region = loc.region_name || 'Cities';

    if (!grouped[country]) {
      grouped[country] = {};
    }

    if (!grouped[country][region]) {
      grouped[country][region] = [];
    }

    grouped[country][region].push({
      label: loc.formatted_location,
      value: loc.id
    });
  });

  // Convert to react-select format
  return Object.entries(grouped).map(([country, regions]) => ({
    label: country,
    options: Object.entries(regions).flatMap(([region, locs]) => {
      // For US, show state groupings
      if (country === 'United States') {
        return [{
          label: `${region} ━━━━━`,
          options: locs.sort((a, b) => a.label.localeCompare(b.label))
        }];
      }
      // For other countries, just show cities
      return locs.sort((a, b) => a.label.localeCompare(b.label));
    })
  })).sort((a, b) => {
    // US first, then alphabetical
    if (a.label === 'United States') return -1;
    if (b.label === 'United States') return 1;
    return a.label.localeCompare(b.label);
  });
}
```

## Testing Strategy

### 1. Accuracy Testing

Create test suite with known locations:

```javascript
const testLocations = [
  // US locations
  { input: 'Houston, TX', expectedCountry: 'US', expectedCity: 'Houston' },
  { input: 'Houston', expectedCountry: 'US', expectedCity: 'Houston' },

  // Ambiguous locations (test accuracy)
  { input: 'Aberdeen', expectedCountry: 'GB', expectedCity: 'Aberdeen' }, // Should be UK, not US
  { input: 'Paris', expectedCountry: 'FR', expectedCity: 'Paris' }, // Should be France, not Texas

  // Canadian locations
  { input: 'Calgary, AB', expectedCountry: 'CA', expectedCity: 'Calgary' },
  { input: 'Calgary, Alberta', expectedCountry: 'CA', expectedCity: 'Calgary' },

  // International locations
  { input: 'Florence, Italy', expectedCountry: 'IT', expectedCity: 'Florence' },
  { input: 'São Paulo, Brazil', expectedCountry: 'BR', expectedCity: 'São Paulo' },

  // Edge cases
  { input: 'Gulf of Mexico', expectedCountry: null, special: true },
];
```

### 2. Cost Monitoring

Track API usage:
- Log all Mapbox API calls
- Monitor cache hit rate
- Alert if approaching free tier limit
- Weekly usage reports

### 3. Quality Assurance

- Manual review of first 100 geocoded locations
- Spot-check 10% of locations monthly
- User feedback mechanism for incorrect locations
- Quarterly full re-validation

## Migration Plan

### Week 1: Setup & Initial Geocoding
1. **Day 1-2**: Set up Mapbox account, get API key
2. **Day 3**: Implement `mapboxGeocoder.js` service
3. **Day 4**: Create `location_metadata` table migration
4. **Day 5**: Run batch geocoding on existing locations
5. **Day 6-7**: QA and spot-check results

### Week 2: Integration & Deployment
1. **Day 8-9**: Implement hybrid `locationService.js` with fallback
2. **Day 10**: Update job import pipeline to use new service
3. **Day 11**: Update frontend components to use standardized locations
4. **Day 12**: Testing in staging environment
5. **Day 13-14**: Deploy to production, monitor

### Week 3: Optimization & Documentation
1. Monitor API usage and costs
2. Optimize cache hit rate
3. Document location standardization process
4. Set up alerts for API usage thresholds

## Cost Projections

### Year 1 Projections

| Scenario | Locations | API Calls | Cost |
|----------|-----------|-----------|------|
| **Initial Load** | 1,000 | 1,000 | $0 (within free tier) |
| **Monthly New Jobs** | 100/day × 30 | 3,000/month | $0 (within free tier) |
| **Quarterly Re-validation** | 1,000 × 4 | 4,000/year | $0 (within free tier) |
| **Total Year 1** | ~40,000 locations | ~40,000 calls | **$0** |

### Year 2 Projections (Growth Scenario)

| Scenario | Locations | API Calls | Cost |
|----------|-----------|-----------|------|
| **Monthly New Jobs** | 300/day × 30 | 9,000/month | $0 (within free tier) |
| **Quarterly Re-validation** | 3,000 × 4 | 12,000/year | $0 (within free tier) |
| **Total Year 2** | ~120,000 locations | ~120,000 calls | **$15** |
| (20,000 over free tier) | | 20,000 × $0.75/1000 | |

**Key Insight:** Even with 3x growth, annual cost is only $15/year.

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| **Mapbox API changes pricing** | Medium | Low | Hybrid approach allows switching providers |
| **API rate limits hit** | Medium | Low | Caching + batch processing handles this |
| **Geocoding accuracy issues** | Medium | Low | Fallback to country-state-city, manual review |
| **API downtime** | Low | Low | Fallback to cached data, local library |
| **Over-budget API usage** | Low | Very Low | Monitoring + alerts, caching reduces calls |

## Success Metrics

### Accuracy Metrics
- **Target**: 95% correct country assignment
- **Target**: 90% correct city/region assignment
- **Target**: Zero "Aberdeen UK → US" type errors

### Performance Metrics
- **Cache hit rate**: >80% after initial warmup
- **API response time**: <500ms per location
- **Batch processing**: 100 locations in <2 minutes

### Cost Metrics
- **Year 1**: $0 (stay within free tier)
- **Year 2**: <$50 (even with 3x growth)

## Alternative Considerations

### If Budget Becomes an Issue
1. **Self-host Nominatim**: One-time infrastructure cost, unlimited requests
2. **Pre-geocode only**: Geocode once on ingestion, never re-validate
3. **Switch to OpenCage**: Lower accuracy, but still better than current

### If Accuracy Becomes Critical
1. **Upgrade to Google Places API**: Higher cost, but best accuracy
2. **Hybrid Google + Mapbox**: Use Google for ambiguous locations only
3. **Manual review workflow**: Flag low-confidence locations for human review

## Conclusion

**Recommendation: Implement Mapbox Geocoding API with country-state-city fallback**

This hybrid approach provides:
- ✅ **Best ROI**: 100,000 free requests/month covers needs for 2+ years
- ✅ **High accuracy**: Fixes current issues like Aberdeen misassignment
- ✅ **Flexibility**: Can store results permanently, no restrictive caching
- ✅ **Risk mitigation**: Fallback to existing library if API fails
- ✅ **Simple integration**: RESTful API, clear documentation
- ✅ **Scalable**: Reasonable cost ($0.75/1000) when you exceed free tier

### Next Steps
1. ✅ Review and approve this recommendation
2. Create Mapbox account and get API key
3. Implement Phase 1 (geocoding service)
4. Test with sample locations
5. Roll out to production

## References & Sources

### Geocoding API Pricing
- [Geocoding API Usage and Billing | Google for Developers](https://developers.google.com/maps/documentation/geocoding/usage-and-billing)
- [Google Maps Platform Pricing](https://mapsplatform.google.com/pricing/)
- [Guide To Geocoding API Pricing - February 6, 2026](https://mapscaping.com/guide-to-geocoding-api-pricing/)
- [Mapbox Pricing](https://www.mapbox.com/pricing)
- [OpenCage Pricing](https://opencagedata.com/pricing)

### Mapbox vs Google Comparison
- [Mapbox vs. Google Maps API: 2026 comparison](https://radar.com/blog/mapbox-vs-google-maps-api)
- [Google Maps API Pricing 2025: Distance Matrix, Geocoding & Routes Cost Guide](https://nicolalazzari.ai/articles/understanding-google-maps-apis-a-comprehensive-guide-to-uses-and-costs)
- [The true cost of the Google Maps API and how Radar compares in 2026](https://radar.com/blog/google-maps-api-cost)

### OpenCage & Nominatim
- [OpenCage Geocoding API Review](https://distancematrix.ai/blog/opencage-api-review)
- [8 Best Free Geocoding APIs for Location-Based Apps in 2026](https://publicapis.io/blog/free-geocoding-apis)
- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- [Open‑source Geocoding With Nominatim And Geopy - February 8, 2026](https://mapscaping.com/open%E2%80%91source-geocoding-with-nominatim-and-geopy/)

### HERE Location Services
- [HERE Base Plan | Location Services | Pricing](https://www.here.com/get-started/pricing)
- [HERE Geocoding API Review](https://distancematrix.ai/blog/here-geocoding-api-review)

### Pelias & Open Source
- [Pelias - Modular open-source geocoder](https://github.com/pelias/pelias)
- [Pelias Geocoder](https://pelias.io/)

### Job Board Best Practices
- [Improve Visibility with these Indeed Job Posting Best Practices](https://www.careerplug.com/indeed-job-posting-best-practices/)
- [Post jobs on LinkedIn – Best practices](https://www.linkedin.com/help/linkedin/answer/a529397/)

---

**Document Version:** 1.0
**Author:** Claude (Research Agent)
**Last Updated:** 2026-02-08
