# Testing the Mapbox Geocoding Implementation

This guide explains how to test the new geocoded location feature.

## Overview

The implementation adds Mapbox-based geocoding for accurate location display:

### Before Geocoding
- Aberdeen → Shows as "Aberdeen" (ambiguous - could be US or UK)
- Calgary, AB, Canada → Shows as "Calgary, AB" (missing country)
- No state-based grouping in location filter

### After Geocoding
- Aberdeen → "Aberdeen, United Kingdom" (correctly identified)
- Calgary, AB, Canada → "Calgary, AB, Canada" (complete)
- US locations grouped by state in filters
- International locations grouped by country

## Quick Start (Without Geocoding)

The app will work immediately using fallback parsing:

```bash
npm install
npm run dev
```

Open http://localhost:5173 and you'll see locations parsed using the existing country-state-city library.

## Full Setup (With Geocoding)

### Step 1: Install Dependencies

```bash
npm install
```

This adds the `dotenv` package needed for the geocoding script.

### Step 2: Get Mapbox Token

Follow the detailed instructions in `MAPBOX_SETUP.md`:

1. Create free account at https://account.mapbox.com/auth/signup/
2. Get your access token (starts with `pk.`)
3. Create `.env` file:
   ```
   VITE_MAPBOX_TOKEN=pk.your_actual_token_here
   ```

### Step 3: Run Geocoding Script

```bash
npm run geocode-locations
```

Expected output:
```
🗺️  Mapbox Location Geocoding Script

📂 Loading jobs data...
   Found 523 jobs

📍 Extracting unique locations...
   Found 150 unique locations

🔄 Geocoding 150 new locations...

[========================================] 100.0% (150/150)

✅ Geocoding complete!

   Total locations: 150
   Previously geocoded: 0
   Newly geocoded: 145
   Failed: 5

   Results saved to: public/data/locations-geocoded.json
```

### Step 4: Verify Results

Check `public/data/locations-geocoded.json`:

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
    }
  }
}
```

### Step 5: Test the Application

```bash
npm run dev
```

#### Check Location Display

1. **Job Cards** - Locations should show correctly formatted:
   - "Aberdeen, United Kingdom" (not "Aberdeen")
   - "Houston, TX" (US format)
   - "Calgary, AB, Canada" (Canadian format with country)

2. **Location Filter** - Should have proper grouping:
   - United States section with state subsections:
     - United States - Texas
       - Houston, TX
       - Midland, TX
     - United States - Alaska
       - Anchorage, AK
   - International sections:
     - United Kingdom
       - Aberdeen, United Kingdom
       - London, United Kingdom
     - Canada
       - Calgary, AB, Canada

#### Check Quick Select Pills

The location filter should show popular locations with correct formatting in the quick select pills.

### Step 6: Commit Results

```bash
git add public/data/locations-geocoded.json
git commit -m "Add geocoded location data from Mapbox"
```

## Testing Specific Issues

### Issue #1: Aberdeen Shows as US Instead of UK

**Before geocoding:**
```
Location: "Aberdeen"
Display: "Aberdeen" (ambiguous)
```

**After geocoding:**
```
Location: "Aberdeen"
Display: "Aberdeen, United Kingdom"
Coordinates: -2.0943, 57.1497 (Scotland)
```

**Test:** Search for "Aberdeen" in the location filter and verify it shows under "United Kingdom" group.

### Issue #2: Alberta Missing Canada Label

**Before geocoding:**
```
Location: "Calgary, AB, Canada"
Display: "Calgary, AB"
```

**After geocoding:**
```
Location: "Calgary, AB, Canada"
Display: "Calgary, AB, Canada"
```

**Test:** Find a Calgary job and verify the location shows "Calgary, AB, Canada" on the job card.

### Issue #3: No State Grouping for US Locations

**Before geocoding:**
```
Filter groups:
- United States
  - Houston, TX
  - Anchorage, AK
  - Midland, TX
```

**After geocoding:**
```
Filter groups:
- United States - Texas
  - Houston, TX
  - Midland, TX
- United States - Alaska
  - Anchorage, AK
```

**Test:** Open the location filter and verify US cities are grouped by state.

## Troubleshooting

### Geocoding Script Issues

**Error: "VITE_MAPBOX_TOKEN not found"**
- Make sure `.env` file exists in project root
- Check token is formatted as: `VITE_MAPBOX_TOKEN=pk.your_token`

**Warning: "No results for: [location]"**
- Some locations are too vague (e.g., just country names)
- These will use fallback parsing in the app
- This is normal and doesn't break functionality

**Rate limit errors**
- Script includes automatic rate limiting
- If errors persist, wait a few minutes and re-run
- Script resumes from where it left off

### Application Issues

**Locations still show old format**
- Check that `public/data/locations-geocoded.json` exists and has data
- Check browser console for loading errors
- Try hard refresh (Cmd/Ctrl + Shift + R)

**Some locations not geocoded**
- This is expected for very new/obscure locations
- App falls back to original parser automatically
- No errors will occur

**Filter grouping not working**
- Make sure geocoding script completed successfully
- Check that locationGeodata.js is being imported correctly
- Verify FiltersSearchable component is using the new utilities

## Performance Notes

### Initial Load Time

- Geocoded data file loads once when app starts (~10-50KB)
- Cached in memory for the session
- No API calls after initial load
- No impact on page navigation

### Geocoding Script Performance

- Processes ~150 locations in 2-3 minutes
- Rate limited to 100ms per request (600/min, well under limit)
- Resume support: re-running only geocodes new locations
- One-time operation: never needs to run again unless data changes

## API Usage

### Free Tier Limits

- 100,000 requests/month
- 600 requests/minute
- Our usage: ~150 requests ONE TIME
- Percentage used: 0.15% of monthly quota

### Cost Analysis

- Current: $0/month (free tier)
- After geocoding: $0/month (no ongoing calls)
- Scaling: Even with 10,000 locations, still free tier

## File Structure

```
moblyze-jobs-web/
├── .env                                    # Your Mapbox token (not committed)
├── .env.example                            # Template for .env
├── MAPBOX_SETUP.md                         # Setup instructions
├── TESTING_GEOCODING.md                    # This file
├── scripts/
│   └── geocode-locations.js                # One-time geocoding script
├── src/
│   ├── services/
│   │   └── mapboxGeocoder.js               # Mapbox API utilities (unused in app)
│   └── utils/
│       ├── locationParser.js               # Updated to use geocoded data
│       ├── locationGeodata.js              # Geocoded data utilities
│       ├── locationOptions.js              # Original location options (fallback)
│       └── locationFormatter.js            # Alternative formatter (unused)
└── public/
    └── data/
        ├── locations-geocoded.json         # COMMIT THIS FILE
        └── locations-geocoded.json.example # Example structure
```

## Next Steps

1. Run the geocoding script
2. Test the application
3. Verify the three main issues are fixed
4. Commit the geocoded data file
5. Deploy to production

The geocoded data file can be safely committed to version control - it contains only public location information (city names, coordinates) and no sensitive data.
