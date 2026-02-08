# Mapbox Geocoding Setup

This project uses Mapbox for one-time location geocoding to fix location display issues (Aberdeen showing as US instead of UK, missing country labels, etc.).

## Why Mapbox?

- **FREE tier**: 100,000 geocoding requests per month
- **One-time use**: We geocode locations once and store the results permanently
- **No ongoing costs**: After initial geocoding, no API calls needed
- **Accurate**: Resolves ambiguous locations correctly (Aberdeen, UK vs Aberdeen, SD)

## Setup Instructions

### 1. Create a Free Mapbox Account

1. Go to [https://account.mapbox.com/auth/signup/](https://account.mapbox.com/auth/signup/)
2. Sign up with your email (no credit card required for free tier)
3. Verify your email address

### 2. Get Your Access Token

1. After signing in, go to [https://account.mapbox.com/access-tokens/](https://account.mapbox.com/access-tokens/)
2. Click "Create a token" or use the default public token
3. Copy the token (starts with `pk.`)

### 3. Add Token to Environment File

1. Create a `.env` file in the project root (copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your token:
   ```
   VITE_MAPBOX_TOKEN=pk.your_actual_token_here
   ```

3. Save the file

**IMPORTANT**: The `.env` file is already in `.gitignore` and will NOT be committed to the repository. This keeps your token private.

### 4. Install Dependencies (if not already done)

```bash
npm install
```

### 5. Run the Geocoding Script

This is a **ONE-TIME** operation that geocodes all unique locations from your jobs data:

```bash
npm run geocode-locations
```

The script will:
- Read all unique locations from `public/data/jobs.json`
- Geocode each location via Mapbox API (respects rate limits)
- Save results to `public/data/locations-geocoded.json`
- Show progress and statistics
- Skip already geocoded locations (resume support)

**Expected output:**
```
Starting location geocoding...
Found 150 unique locations to geocode
Progress: [====================] 100% (150/150)
✓ Successfully geocoded: 148
✗ Failed: 2
Results saved to: public/data/locations-geocoded.json
```

### 6. Commit the Results

After geocoding completes successfully:

```bash
git add public/data/locations-geocoded.json
git commit -m "Add geocoded location data"
```

**Note**: This file SHOULD be committed to the repository. It contains permanent location data that never changes and eliminates the need for future API calls.

## What Gets Fixed

After geocoding and using the new location data:

### Before:
- Aberdeen → Shows as US city (wrong)
- Calgary, AB, Canada → Shows as "Calgary, AB" (missing country)
- No state grouping in filters

### After:
- Aberdeen → Aberdeen, United Kingdom (correct)
- Calgary, AB, Canada → Calgary, AB, Canada (complete)
- US locations grouped by state in filters
- International locations grouped by country

## Rate Limits

Mapbox free tier provides:
- **100,000 requests/month** = ~3,300/day
- **600 requests/minute**

With ~150-200 unique locations, you'll use less than 0.2% of your monthly quota.

## Troubleshooting

### "Invalid token" error
- Check that token starts with `pk.`
- Verify token is in `.env` file exactly as: `VITE_MAPBOX_TOKEN=pk.your_token`
- Make sure `.env` is in the project root directory

### Rate limit errors
- The script automatically handles rate limiting
- If errors persist, wait a few minutes and re-run

### Missing locations in output
- Some locations may be too vague to geocode (e.g., "Argentina" with no city)
- These will be logged as warnings but won't break the app

### Script won't start
- Run `npm install` first
- Check that `public/data/jobs.json` exists
- Verify Node.js version is 18+ (`node --version`)

## Re-running Geocoding

If you need to update locations:

1. The script automatically skips already-geocoded locations
2. To force re-geocode, delete `public/data/locations-geocoded.json`
3. Run `npm run geocode-locations` again

## Questions?

- Mapbox docs: https://docs.mapbox.com/api/search/geocoding/
- Free tier details: https://www.mapbox.com/pricing/
