# Automatic Location Geocoding

## Overview

The job refresh process now includes automatic geocoding of new locations. When you click "Refresh Jobs" in the UI, any new locations from the jobs data are automatically geocoded using the Mapbox API and saved to `locations-geocoded.json`.

## How It Works

### 1. User Triggers Refresh
- User clicks "Refresh Jobs" button in the Job List page
- Jobs data is fetched from `jobs.json`

### 2. Automatic Detection
- System extracts all unique locations from the jobs data
- Compares against existing `locations-geocoded.json`
- Identifies any new locations that need geocoding

### 3. Background Geocoding
- If new locations are found, geocoding begins automatically
- Mapbox API is called for each new location (rate-limited to 100ms between requests)
- Results are saved incrementally to `locations-geocoded.json`

### 4. User Feedback
- Progress notification shows current geocoding status
- Success message displays number of locations geocoded
- Errors are handled gracefully (jobs still work without geocoding)

## Key Features

### Incremental Updates
- Only geocodes NEW locations (doesn't re-geocode existing ones)
- Preserves all existing geocoded data
- Efficient and fast even with large location datasets

### Non-Blocking
- Jobs load immediately
- Geocoding happens in the background
- User can interact with the app while geocoding runs

### Graceful Error Handling
- If Mapbox API fails, jobs still work
- Fallback location parsing still functions
- Dev-mode only feature (requires Vite dev server API)

### Visual Progress Feedback
- Blue notification while geocoding is in progress
- Shows current location being processed
- Green success message with count of new locations
- Yellow warning if geocoding fails (non-fatal)

## Technical Architecture

### Files Modified

#### `/src/utils/geocoder.js` (NEW)
- `geocodeNewLocations()` - Main geocoding function
- `checkForNewLocations()` - Detects new locations
- `geocodeLocation()` - Single location geocoding
- `parseMapboxResponse()` - Parse Mapbox API response
- Browser-compatible (uses fetch API)

#### `/src/hooks/useJobs.js`
- Added `geocodingStatus` state
- Modified `fetchJobs()` to check for new locations on refresh
- Calls geocoding automatically when `forceRefresh=true`
- Provides progress updates via `geocodingStatus`

#### `/src/pages/JobListPage.jsx`
- Displays geocoding status notification
- Shows progress and results to user
- Auto-dismisses after 5 seconds

#### `/vite-plugin-geocode-api.js` (NEW)
- Vite plugin that adds `/api/geocode/save` endpoint
- Allows browser to persist geocoded data to file system
- Development-mode only (production uses pre-geocoded data)

#### `/vite.config.js`
- Registered the geocode API plugin

### Data Flow

```
User clicks "Refresh Jobs"
  ↓
fetchJobs(forceRefresh=true)
  ↓
Load jobs.json
  ↓
Extract unique locations
  ↓
Compare with locations-geocoded.json
  ↓
[If new locations found]
  ↓
For each new location:
  - Call Mapbox API
  - Parse response
  - Update geocodingStatus (triggers UI update)
  - Rate limit (100ms delay)
  ↓
POST /api/geocode/save (Vite plugin)
  ↓
Write to locations-geocoded.json
  ↓
Show success message
```

### Environment Requirements

#### Development Mode
- Requires `npm run dev` (Vite dev server)
- `/api/geocode/save` endpoint available
- Auto-saves to `locations-geocoded.json`
- Progress feedback in console

#### Production Mode
- Uses pre-geocoded `locations-geocoded.json`
- No API calls during refresh (static file only)
- Auto-geocoding is skipped gracefully

## Configuration

### Mapbox API Token
Set in `.env`:
```bash
VITE_MAPBOX_TOKEN=pk.eyJ1Ijoi...
```

### Rate Limiting
Configured in `src/utils/geocoder.js`:
```javascript
const RATE_LIMIT_DELAY = 100; // 100ms = ~600 requests/minute
```

Mapbox free tier allows 600 requests/minute. Current setting is safe.

## Usage

### For Developers

1. **Start dev server:**
   ```bash
   npm run dev
   ```

2. **Open the app and click "Refresh Jobs"**

3. **Watch automatic geocoding:**
   - Blue notification appears if new locations found
   - Progress shows in real-time
   - Green success message when complete
   - Check `locations-geocoded.json` for new entries

### For Users

Nothing to do! Just click "Refresh Jobs" and new locations are automatically geocoded.

## Testing

### Test for New Locations
```bash
npm run test-geocode
```

This script:
- Loads jobs.json
- Extracts unique locations
- Compares with locations-geocoded.json
- Reports how many new locations would be geocoded

### Manual Geocoding (Original Script)
```bash
npm run geocode-locations
```

The original script still works for bulk geocoding all locations from scratch.

## Troubleshooting

### "Geocoding API only works in development mode"
- You're running production build (`npm run build`)
- Auto-geocoding requires dev server (`npm run dev`)
- Production uses pre-geocoded data only

### Geocoding Seems Slow
- Normal! Each location takes ~100ms due to rate limiting
- For 50 new locations = ~5 seconds
- This prevents hitting Mapbox API rate limits

### Some Locations Failed to Geocode
- Some locations may be too vague (e.g., just country names)
- Mapbox may not recognize certain addresses
- Jobs still work with fallback location parser
- Failed locations can be manually added to locations-geocoded.json

### Changes Not Persisting
- Make sure you're running `npm run dev` (not production build)
- Check console for API errors
- Verify `locations-geocoded.json` file permissions

## Future Enhancements

Potential improvements:
- [ ] Background worker for geocoding (don't block refresh)
- [ ] Retry failed locations with different queries
- [ ] Cache geocoding results in localStorage
- [ ] Batch geocoding API calls (if Mapbox supports it)
- [ ] Production-mode geocoding via backend API
- [ ] Show geocoded locations on a map view

## Related Files

- `/scripts/geocode-locations.js` - Original bulk geocoding script
- `/scripts/test-geocode-integration.js` - Integration test script
- `/public/data/locations-geocoded.json` - Geocoded location data
- `/src/utils/locationParser.js` - Uses geocoded data for display
