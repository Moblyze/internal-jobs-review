# Bundle Size Reduction - Removed country-state-city

## Summary
Removed the `country-state-city` library dependency (17MB) that was causing an 8.7MB bundle chunk. Replaced with the existing pre-geocoded location data (67KB) and simple fallback logic.

## Changes Made

### 1. `/src/utils/locationParser.js`
- Removed lazy-loaded `country-state-city` import
- Removed helper functions: `getCountryByCode()`, `getStateByCode()`, `findCityByName()`, `startLoadingCountryStateCity()`
- Added simple country name mapping for fallback scenarios
- Added US state name-to-code mapping for common cases
- Added US state code validation set
- All location parsing now relies on pre-geocoded data first, with lightweight fallback

### 2. `/package.json`
- Removed `"country-state-city": "^3.2.1"` from dependencies

### 3. `/test-location-metadata.js`
- Updated documentation to reflect use of pre-geocoded Mapbox data instead of country-state-city

## Results

### Bundle Size
- **Before**: locationParser chunk was bundled with country-state-city (~8.7MB)
- **After**: locationParser chunk is 5.49 KB (gzipped: 2.22 KB)
- **Reduction**: ~8.7MB → 5.49KB = **99.94% size reduction**

### Functionality
All location parsing functionality preserved:
- ✅ US locations: "Houston, TX"
- ✅ Canadian locations: "Calgary, AB, Canada"
- ✅ Italian locations: "Florence, Italy"
- ✅ Special cases: "Gulf of Mexico"
- ✅ Multiple locations with "+X more" indicator
- ✅ Geocoded data provides coordinates and metadata

### Dependencies
- Removed 1 package from node_modules
- No breaking changes to location parsing API

## How It Works Now

1. **Primary**: Geocoded data from `/data/locations-geocoded.json` (67KB, 2,792 locations)
   - Contains pre-geocoded Mapbox data with coordinates
   - Loaded once on first use, cached for session
   - Covers all locations in the job database

2. **Fallback**: Simple static mappings
   - Country code → country name mapping (14 common countries)
   - US state name → state code mapping (all 50 states)
   - US state code validation set
   - No external library, no dynamic lookups

## Testing
```bash
npm install  # Removes country-state-city
npm run build  # Builds successfully with smaller bundle
```

Location parsing still works correctly for all patterns:
- `US-TX-HOUSTON-2001 RANKIN ROAD` → "Houston, TX"
- `IT-FI-FLORENCE-VIA FELICE MATTEUCCI 2` → "Florence, Italy"
- `CA-AB-CALGARY-4839 90TH AVENUE SE` → "Calgary, AB, Canada"

## Impact
- **Bundle size**: 99.94% reduction in location parser chunk
- **Load time**: Faster initial page load (no 8.7MB chunk)
- **Maintenance**: No breaking changes, same API
- **Data freshness**: Pre-geocoded data is accurate and complete for current job database
