# Mapbox Geocoding for Location Accuracy

## Quick Start

### 1. Verify Setup

```bash
npm install
npm run verify-geocoding
```

This checks that everything is configured correctly.

### 2. Get Mapbox Token

1. Sign up at https://account.mapbox.com/auth/signup/ (free, no credit card)
2. Get your access token from https://account.mapbox.com/access-tokens/
3. Create `.env` file:
   ```bash
   cp .env.example .env
   ```
4. Add your token to `.env`:
   ```
   VITE_MAPBOX_TOKEN=pk.your_actual_token_here
   ```

### 3. Run Geocoding

```bash
npm run geocode-locations
```

This geocodes all locations once and saves results to `public/data/locations-geocoded.json`.

### 4. Test

```bash
npm run dev
```

Open http://localhost:5173 and verify:
- Aberdeen shows as "Aberdeen, United Kingdom" (not just "Aberdeen")
- Calgary shows as "Calgary, AB, Canada" (with country)
- US locations grouped by state in filter

### 5. Commit

```bash
git add public/data/locations-geocoded.json
git commit -m "Add geocoded location data"
```

## What This Fixes

| Issue | Before | After |
|-------|--------|-------|
| Ambiguous cities | "Aberdeen" | "Aberdeen, United Kingdom" |
| Missing country | "Calgary, AB" | "Calgary, AB, Canada" |
| Filter grouping | By country only | US by state, others by country |

## Documentation

- **[MAPBOX_SETUP.md](./MAPBOX_SETUP.md)** - Detailed setup instructions
- **[TESTING_GEOCODING.md](./TESTING_GEOCODING.md)** - Testing guide
- **[GEOCODING_IMPLEMENTATION.md](./GEOCODING_IMPLEMENTATION.md)** - Technical details

## How It Works

1. **One-time geocoding**: Script geocodes all locations using Mapbox API
2. **Permanent storage**: Results saved in `locations-geocoded.json`
3. **Zero ongoing costs**: No API calls during app usage
4. **Instant lookups**: Data loaded on app start and cached

## Cost

**$0** - Uses Mapbox free tier (100k requests/month), only geocodes ~150 locations once.

## Commands

```bash
# Verify setup
npm run verify-geocoding

# Run geocoding (one-time)
npm run geocode-locations

# Start dev server
npm run dev

# Build for production
npm run build
```

## Questions?

See detailed documentation in:
- Setup: `MAPBOX_SETUP.md`
- Testing: `TESTING_GEOCODING.md`
- Implementation: `GEOCODING_IMPLEMENTATION.md`
