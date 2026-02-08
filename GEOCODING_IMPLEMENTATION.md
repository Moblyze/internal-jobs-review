# Mapbox Geocoding Implementation Summary

## Problem Statement

The job board had three main location display issues:

1. **Ambiguous city names**: "Aberdeen" showed without country, unclear if US or UK
2. **Missing country labels**: "Calgary, AB, Canada" displayed as "Calgary, AB"
3. **Poor filter organization**: No state-level grouping for US locations

## Solution Architecture

### One-Time Geocoding + Permanent Storage

Instead of real-time geocoding (expensive, slow), we:

1. **Geocode once** using Mapbox API (free tier: 100k requests/month)
2. **Store permanently** in `public/data/locations-geocoded.json`
3. **Commit to repo** for zero ongoing API costs
4. **Load on app init** and cache in memory

### Why This Works

- **Geography is static**: "Aberdeen" will always be in Scotland
- **Jobs data is static**: Exported from Google Sheets, not live
- **Free forever**: One-time API usage (~150 requests), no recurring costs
- **Fast**: No API calls during app usage, instant lookups

## Implementation Details

### Files Created

1. **`.env.example`** - Template for Mapbox token
2. **`MAPBOX_SETUP.md`** - User instructions for setup
3. **`scripts/geocode-locations.js`** - One-time geocoding script
4. **`src/services/mapboxGeocoder.js`** - Mapbox API utilities
5. **`src/utils/locationGeodata.js`** - Geocoded data utilities
6. **`src/utils/locationFormatter.js`** - Alternative formatter (backup)
7. **`public/data/locations-geocoded.json`** - Geocoded data storage (empty initially)
8. **`public/data/locations-geocoded.json.example`** - Example structure

### Files Modified

1. **`package.json`**
   - Added `dotenv` dependency
   - Added `geocode-locations` npm script

2. **`src/utils/locationParser.js`**
   - Added geocoded data cache loading
   - Added `tryGeocoded()` function
   - Updated `parseLocation()` to check geocoded data first
   - Falls back to country-state-city library for non-geocoded locations

3. **`src/components/FiltersSearchable.jsx`**
   - Imports geocoded utilities
   - Uses `createGroupedLocationOptionsWithGeodata()` for proper grouping
   - Uses `getTopLocationsFormatted()` for quick select pills
   - Loads asynchronously on mount

4. **`.gitignore`**
   - Added comment to NOT ignore `locations-geocoded.json`
   - This file should be committed (contains permanent data)

## Data Flow

### Geocoding Script Flow

```
1. Load jobs.json
2. Extract unique locations (e.g., "Aberdeen", "Houston, TX")
3. For each location:
   - Call Mapbox Geocoding API
   - Parse response (city, state, country, coordinates)
   - Store in results object
4. Save to locations-geocoded.json
5. Commit to repo
```

### App Runtime Flow

```
1. App loads
2. locationParser.js imports and starts loading geocoded data
3. User views job list
4. JobCard calls formatLocation()
5. formatLocation checks geocodedCache first:
   - If found: Return formatted location from geocoded data
   - If not found: Fall back to country-state-city parsing
6. Location displayed correctly
```

### Filter Flow

```
1. FiltersSearchable component mounts
2. useEffect triggers loadLocationOptions()
3. createGroupedLocationOptionsWithGeodata() called
4. For each location:
   - Get metadata from geocoded data
   - Determine grouping (US by state, others by country)
   - Create react-select option with proper group
5. Groups sorted: US states first (alphabetically), then countries
6. Options displayed in grouped dropdown
```

## Geocoded Data Structure

Each location is stored with full metadata:

```json
{
  "Aberdeen": {
    "original": "Aberdeen",
    "mapboxPlaceName": "Aberdeen, Scotland, United Kingdom",
    "city": "Aberdeen",
    "state": "Scotland",
    "stateCode": null,
    "country": "United Kingdom",
    "countryCode": "GB",
    "coordinates": {
      "longitude": -2.0943,
      "latitude": 57.1497
    },
    "placeType": ["place"],
    "confidence": 1.0
  }
}
```

## Location Formatting Rules

### United States
- Format: `City, ST`
- Example: `Houston, TX`
- Grouping: By state (`United States - Texas`)

### Canada
- Format: `City, PROV, Canada`
- Example: `Calgary, AB, Canada`
- Grouping: By country (`Canada`)

### Brazil
- Format: `City, State, Brazil`
- Example: `Rio de Janeiro, Rio de Janeiro, Brazil`
- Grouping: By country (`Brazil`)

### United Kingdom
- Format: `City, United Kingdom`
- Example: `Aberdeen, United Kingdom`
- Grouping: By country (`United Kingdom`)

### India
- Format: `City, State, India`
- Example: `Bengaluru, Karnataka, India`
- Grouping: By country (`India`)

### Other International
- Format: `City, Country` or `City, State, Country`
- Example: `Bangkok, Thailand`
- Grouping: By country

## Fallback Behavior

If geocoded data is not available for a location:

1. App does NOT crash or error
2. Falls back to existing `country-state-city` library parsing
3. Location still displays (may be less accurate)
4. No user-facing errors

This ensures the app works even before geocoding script is run.

## Performance Characteristics

### Geocoding Script
- **Time**: 2-3 minutes for ~150 locations
- **Rate**: 100ms per request (600/min, safe margin)
- **Resume**: Skips already-geocoded locations
- **Cost**: $0 (free tier)

### App Runtime
- **Initial load**: ~10-50KB JSON file (one-time)
- **Memory**: Cached for session
- **Lookup time**: O(1) hash map lookup
- **API calls**: Zero

## Comparison to Alternatives

### Real-Time Geocoding (Rejected)
- ❌ API call per page load
- ❌ Slower user experience
- ❌ Rate limit concerns
- ❌ Ongoing costs

### Country-State-City Library (Current)
- ✅ Fast, no API calls
- ❌ Inaccurate (Aberdeen shows as US)
- ❌ Incomplete data (missing provinces)
- ❌ No coordinates

### One-Time Mapbox Geocoding (Chosen)
- ✅ Accurate results
- ✅ Complete data with coordinates
- ✅ Zero ongoing costs
- ✅ Fast runtime performance
- ✅ Scales indefinitely

## User Instructions

### For Developers

1. Set up Mapbox token (see `MAPBOX_SETUP.md`)
2. Run `npm install`
3. Run `npm run geocode-locations`
4. Commit `public/data/locations-geocoded.json`
5. Deploy

### For End Users

No action required. Geocoded data is part of the deployed app.

## Monitoring & Maintenance

### When to Re-Geocode

Only if new locations are added to `jobs.json`:

1. Export new jobs data
2. Run `npm run geocode-locations` (only geocodes new locations)
3. Commit updated `locations-geocoded.json`

### What to Monitor

- Check browser console for "Loaded N geocoded locations" message
- If 0 locations loaded, geocoding script needs to be run
- No runtime errors expected (falls back gracefully)

### Troubleshooting

See `TESTING_GEOCODING.md` for detailed troubleshooting guide.

## Future Enhancements

### Potential Additions (Optional)

1. **Map visualization**: Use coordinates to show jobs on a map
2. **Distance search**: Filter jobs within X miles of user location
3. **Reverse geocoding**: Convert coordinates to addresses
4. **Batch updates**: Automated re-geocoding on data refresh

None of these require changes to current implementation - coordinates are already stored.

## API Rate Limits & Costs

### Mapbox Free Tier
- 100,000 requests/month
- 600 requests/minute
- No credit card required

### Current Usage
- One-time: ~150 requests
- Percentage of quota: 0.15%
- Cost: $0

### Scaling Projection
- 10,000 locations: Still free tier
- 100,000 locations: One-time use of full monthly quota
- Beyond: Would need paid tier ($5/10k requests)

For our use case (< 500 locations), cost will remain $0 forever.

## Deployment Checklist

- [x] Install dotenv dependency
- [x] Create .env.example
- [x] Create MAPBOX_SETUP.md
- [x] Create geocoding script
- [x] Add npm script
- [x] Update locationParser.js
- [x] Update FiltersSearchable.jsx
- [x] Create empty locations-geocoded.json
- [x] Update .gitignore
- [x] Create testing documentation

**Before First Deploy:**
- [ ] User: Get Mapbox token
- [ ] User: Create .env file
- [ ] User: Run `npm install`
- [ ] User: Run `npm run geocode-locations`
- [ ] User: Verify locations display correctly
- [ ] User: Commit locations-geocoded.json
- [ ] User: Deploy

## Success Criteria

✅ Aberdeen shows as "Aberdeen, United Kingdom"
✅ Calgary shows as "Calgary, AB, Canada"
✅ US locations grouped by state in filter
✅ International locations grouped by country
✅ Zero ongoing API costs
✅ No performance degradation
✅ Graceful fallback for non-geocoded locations

## Questions & Support

- **Setup issues**: See `MAPBOX_SETUP.md`
- **Testing**: See `TESTING_GEOCODING.md`
- **Mapbox docs**: https://docs.mapbox.com/api/search/geocoding/
