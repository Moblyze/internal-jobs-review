# Energy Regions Feature

## Overview

The Energy Regions feature provides quick-select regional filters for major global energy production areas. Users can click a region to instantly see all jobs in that area without manually selecting individual cities.

## Implementation

### Files Added

1. **`src/utils/energyRegions.js`**
   - Defines top 5 global energy regions + 5 additional regions
   - Regional matching logic for location filtering
   - Utility functions for extracting and mapping locations

2. **`scripts/test-energy-regions.js`**
   - Verification script to test region matching against actual jobs data
   - Run with: `node scripts/test-energy-regions.js`

### Files Modified

1. **`src/components/FiltersSearchable.jsx`**
   - Added `EnergyRegionPills` component for region quick-select
   - Integrated region pills above location filter
   - Visual hierarchy: Regions (teal/green, larger) → Cities (blue, smaller) → Search

## Top 5 Global Energy Regions

Based on major oil & gas operational areas:

1. **Permian Basin** - West Texas & SE New Mexico
   - Largest US oil field
   - Cities: Midland, Odessa, Carlsbad

2. **Gulf of Mexico** - US Gulf Coast & Offshore
   - Houston, New Orleans, Lafayette
   - Includes offshore locations

3. **Middle East** - Saudi Arabia, UAE, Qatar, Kuwait
   - Dubai, Abu Dhabi, Doha
   - Major global energy hub

4. **North Sea** - UK & Norway Offshore
   - Aberdeen, Stavanger
   - European offshore energy

5. **Asia Pacific** - Singapore, Malaysia, Indonesia, Australia
   - Singapore, Kuala Lumpur, Perth
   - Growing energy market

## Additional Regions (5 more)

Shown when user clicks "Show more regions":

- **Bakken** - North Dakota & Montana
- **Eagle Ford** - South Texas
- **Marcellus/Utica** - Pennsylvania & Ohio
- **Western Canada** - Alberta & Saskatchewan
- **Latin America** - Brazil, Mexico, Colombia

## User Experience

### Visual Hierarchy

```
Location Filter
━━━━━━━━━━━━━━━
POPULAR ENERGY REGIONS (larger, teal/green)
[Permian Basin] [Gulf of Mexico] [Middle East] [North Sea] [Asia Pacific] +5 more

POPULAR CITIES (smaller, blue)
[Houston, TX] [Midland, TX] [Singapore] ...

Search locations...
↓ (dropdown with normalized locations)
```

### Interaction States

- **Not Selected**: Emerald green background with border
- **Partially Selected**: Teal background (some region locations selected)
- **Fully Selected**: Solid teal background (all region locations selected)

### Behavior

1. Click region → Selects all locations in that region
2. Click again → Deselects all locations in that region
3. User can refine by deselecting specific cities after selecting a region
4. Region shows as "partially selected" if only some cities are selected

## Region Matching Logic

The `getRegionLocations()` function matches locations using:

1. **Explicit location names**: Direct city name matches
2. **State/Province codes**: US-TX-, CA-AB-, etc.
3. **Country codes**: AE-, GB-, etc.
4. **Keywords**: Industry-standard region terms

Matching uses word boundaries to avoid false positives (e.g., "AR" in Arkansas won't match "Saudi AR abia").

## Testing

Run the verification script to see how regions match against current jobs data:

```bash
node scripts/test-energy-regions.js
```

Output shows:
- Jobs matched per region
- Sample locations matched
- Regions ranked by job count

## Future Enhancements

Potential improvements:

1. **Dynamic region detection**: Auto-detect top regions from jobs data
2. **Job counts on pills**: Show "(84 jobs)" on each region pill
3. **Custom regions**: Let users save their own regional groupings
4. **Map view**: Visual region selection on a map
5. **Region analytics**: Track which regions are most popular

## Design Decisions

### Why These Regions?

These are industry-standard energy production areas recognized globally:
- Permian Basin: Largest US oil producer
- Gulf of Mexico: Historic energy hub
- Middle East: Global energy center
- North Sea: European offshore leader
- Asia Pacific: Emerging energy market

### Why Teal/Green Color?

- **Differentiation**: Visually distinct from blue city pills
- **Energy branding**: Green/teal associated with energy industry
- **Hierarchy**: Larger regions feel more important than individual cities
- **Accessibility**: Good contrast with white background

### Why Above City Pills?

- **Progressive disclosure**: Regional → City → Search
- **Common use case**: Most users want regional filtering
- **Reduces cognitive load**: Fewer clicks to find relevant jobs

## Related Files

- `/src/utils/locationGeodata.js` - Location formatting utilities
- `/src/utils/locationParser.js` - Location parsing logic
- `/public/data/locations-geocoded.json` - Geocoded location data
