# Mapbox Integration - Testing Checklist

Use this checklist to verify the Mapbox geocoding integration is working correctly.

## Quick Test (5 minutes)

### 1. Start the Dev Server

```bash
npm run dev
```

Open http://localhost:5173

### 2. Check Key Test Cases

Look for jobs at these locations and verify the display format:

#### Aberdeen (UK) ✅
- **Expected**: "Aberdeen, United Kingdom" (not "Aberdeen, SD" or just "Aberdeen")
- **Test**: Search for "Aberdeen" jobs
- **Why important**: Tests ambiguous city name resolution

#### Houston (US) ✅
- **Expected**: "Houston, TX" (not "Houston, Texas")
- **Test**: Search for "Houston" jobs
- **Why important**: Tests US state abbreviation format

#### Calgary (Canada) ✅
- **Expected**: "Calgary, AB, Canada" (includes country)
- **Test**: Search for "Calgary" jobs
- **Why important**: Tests Canadian province display

#### Rio de Janeiro (Brazil) ✅
- **Expected**: "Rio de Janeiro, Rio de Janeiro, Brazil" (includes state and country)
- **Test**: Search for "Rio" jobs
- **Why important**: Tests international location with state

### 3. Test Location Filter

Open the **Location** filter dropdown:

#### US Locations Should Show State Codes:
- [ ] "Anchorage, AK"
- [ ] "Houston, TX"
- [ ] "Midland, TX"
- [ ] "Carlsbad, NM"
- [ ] "Buckhannon, WV"
- [ ] "Mount Pleasant, PA"

#### International Locations Should Show Country:
- [ ] "Aberdeen, United Kingdom"
- [ ] "Calgary, AB, Canada"
- [ ] "Rio de Janeiro, Rio de Janeiro, Brazil"
- [ ] "Florence, Italy"
- [ ] "Mexico City, Mexico"
- [ ] "Abu Dhabi, United Arab Emirates"

#### Special Locations:
- [ ] "Global Recruiting"
- [ ] "Noble Interceptor (Offshore)"

### 4. Test Filter Grouping

The location filter should ideally group locations hierarchically:

- **United States**
  - TX: Houston, Midland, ...
  - AK: Anchorage
  - NM: Carlsbad
  - etc.

- **Canada**
  - AB: Calgary

- **United Kingdom**
  - Cities: Aberdeen

- **Brazil**
  - Rio de Janeiro: Rio de Janeiro, Petropolis

(Note: Grouping behavior depends on filter implementation)

## Detailed Verification

### Check Console Logs

Open browser DevTools Console and look for:

```
Loaded 19 geocoded locations
```

This confirms the geocoded data is being loaded by `locationParser.js`.

### Verify Data Files

```bash
# Check geocoded data exists and has correct structure
cat public/data/locations-geocoded.json | head -30

# Verify Aberdeen is UK (not US)
grep -A 5 "Aberdeen" public/data/locations-geocoded.json | grep "United Kingdom"
```

### Run Verification Script

```bash
npm run verify-geocoding
```

**Expected output:**
```
✅ Jobs data exists
✅ Geocoded data exists (19 locations)
✅ All core files present
❌ .env file not found (This is OK - not needed for testing with example data)
```

## Before/After Comparison

### Without Geocoded Data (Fallback)

| Location String | Parsed Result | Issue |
|----------------|---------------|-------|
| "Aberdeen" | "Aberdeen" | Ambiguous - could be US or UK |
| "Calgary, AB" | "Calgary, AB" | Missing country context |
| "Houston" | "Houston, TX" | Works (common US city) |

### With Geocoded Data (Current)

| Location String | Parsed Result | Status |
|----------------|---------------|--------|
| "Aberdeen" | "Aberdeen, United Kingdom" | ✅ Clear |
| "Calgary, AB, Canada" | "Calgary, AB, Canada" | ✅ Complete |
| "Houston" | "Houston, TX" | ✅ Consistent |

## Common Issues

### Aberdeen shows as "Aberdeen, SD" (US)

**Problem**: Geocoded data not loaded or fallback parser is being used

**Solution**: Check browser console for "Loaded X geocoded locations" message

### Locations not grouped by state

**Problem**: Filter component may not be using `locationGrouping.js`

**Solution**: Verify `useJobs.js` imports and uses grouping functions

### "Loaded 0 geocoded locations" in console

**Problem**: `locations-geocoded.json` file missing or empty

**Solution**:
```bash
# Check file exists
ls -lh public/data/locations-geocoded.json

# Verify it has data (should be ~9KB with 19 locations)
wc -l public/data/locations-geocoded.json
```

## Success Criteria

✅ All key test cases display correctly:
  - Aberdeen → United Kingdom
  - Houston → TX
  - Calgary → AB, Canada

✅ Console shows "Loaded 19 geocoded locations"

✅ Location filter shows formatted locations

✅ No errors in browser console

✅ `npm run verify-geocoding` passes (except .env is missing - expected)

## When Everything Works

If all test cases pass:

1. **For Development**: You're ready to continue building features
2. **For Production**: Run full geocoding with your own Mapbox token when ready
3. **For Collaboration**: Commit your work - example data is already in repo

## Need Full Geocoding?

See [README_GEOCODING.md](./README_GEOCODING.md) for instructions on:
- Getting a free Mapbox token
- Running full geocoding for all locations
- Committing updated data to repo

---

**Last Updated**: 2026-02-08
**Example Data**: 19 locations included
**Status**: ✅ Ready to test
