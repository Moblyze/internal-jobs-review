# Location Parser - Quick Reference

## Import

```javascript
import {
  formatLocation,           // Format location (backward compatible)
  getAllLocations,          // Get all locations as array (backward compatible)
  getLocationWithMetadata,  // NEW: Get location with geographic data
  getAllLocationsWithMetadata  // NEW: Get all locations with data
} from './utils/locationParser';
```

## Basic Usage (Existing)

```javascript
// Format single or first location
const formatted = formatLocation(job.location);
// "Houston, TX" or "Houston, TX +2 more"

// Get all locations as array
const locations = getAllLocations(job.location);
// ["Houston, TX", "Dallas, TX", "Austin, TX"]
```

## Enhanced Usage (New)

```javascript
// Get location with metadata
const location = getLocationWithMetadata(job.location);
// {
//   formatted: "Houston, TX",
//   metadata: {
//     countryCode: "US",
//     countryName: "United States",
//     stateCode: "TX",
//     stateName: "Texas",
//     cityName: "Houston",
//     coordinates: { latitude: 29.76328, longitude: -95.36327 },
//     parsed: true
//   }
// }

// Get all locations with metadata
const allLocations = getAllLocationsWithMetadata(job.location);
// Array of location objects with full metadata
```

## Common Patterns

### Display with Map Link

```javascript
const location = getLocationWithMetadata(job.location);

{location?.metadata?.coordinates && (
  <a href={`https://maps.google.com?q=${location.metadata.coordinates.latitude},${location.metadata.coordinates.longitude}`}>
    View on Map
  </a>
)}
```

### Filter by Country

```javascript
const usJobs = jobs.filter(job => {
  const loc = getLocationWithMetadata(job.location);
  return loc?.metadata?.countryCode === 'US';
});
```

### Filter by State

```javascript
const texasJobs = jobs.filter(job => {
  const loc = getLocationWithMetadata(job.location);
  return loc?.metadata?.stateCode === 'TX';
});
```

### Show International Badge

```javascript
const location = getLocationWithMetadata(job.location);
const isInternational = location?.metadata?.countryCode !== 'US';

{isInternational && <span className="badge">International</span>}
```

### Calculate Distance

```javascript
const location = getLocationWithMetadata(job.location);

if (location?.metadata?.coordinates && userLocation) {
  const distance = calculateDistance(
    userLocation.lat, userLocation.lng,
    location.metadata.coordinates.latitude,
    location.metadata.coordinates.longitude
  );
}
```

## Metadata Structure

```typescript
interface LocationMetadata {
  formatted: string;              // "Houston, TX"
  metadata: {
    countryCode: string;          // "US"
    countryName: string;          // "United States"
    stateCode: string | null;     // "TX" or null
    stateName: string | null;     // "Texas" or null
    cityName: string;             // "Houston"
    coordinates: {
      latitude: number;           // 29.76328
      longitude: number;          // -95.36327
    } | null;
    parsed: boolean;              // true if successfully parsed
    special?: boolean;            // true for special cases like "Gulf of Mexico"
    additionalLocations?: number; // Count if multiple locations
    originalText?: string;        // Original input text
  }
}
```

## Edge Cases

### Location without State Code

```javascript
// Input: "AE-ABU DHABI-AL GHAITH TOWER"
const location = getLocationWithMetadata(input);
// {
//   formatted: "Abu Dhabi, United Arab Emirates",
//   metadata: { countryCode: "AE", stateCode: null, ... }
// }
```

### Special Locations

```javascript
// Input: "Gulf of Mexico"
const location = getLocationWithMetadata(input);
// {
//   formatted: "Gulf of Mexico",
//   metadata: { special: true, originalText: "Gulf of Mexico" }
// }
```

### Simple City Names

```javascript
// Input: "Houston"
const location = getLocationWithMetadata(input);
// {
//   formatted: "Houston",
//   metadata: { cityName: "Houston", parsed: false }
// }
```

### Multiple Locations

```javascript
// Input: "US-TX-HOUSTON\nUS-LA-NEW ORLEANS"
const location = getLocationWithMetadata(input);
// {
//   formatted: "Houston, TX",
//   metadata: { ..., additionalLocations: 1 }
// }
```

## Performance Tips

### Cache Parsed Locations

```javascript
const locationCache = new Map();

function getCachedLocation(jobLocation) {
  if (!locationCache.has(jobLocation)) {
    locationCache.set(jobLocation, getLocationWithMetadata(jobLocation));
  }
  return locationCache.get(jobLocation);
}
```

### Check for Coordinates

```javascript
// Only query if coordinates exist
if (location?.metadata?.coordinates) {
  // Do expensive operation
}
```

### Lazy Load Metadata

```javascript
// Use simple format by default
const formatted = formatLocation(job.location);

// Only get metadata when needed (on click, hover, etc.)
function handleMapClick() {
  const location = getLocationWithMetadata(job.location);
  showOnMap(location.metadata.coordinates);
}
```

## Testing

```javascript
// Unit test example
expect(formatLocation('US-TX-HOUSTON-123 MAIN')).toBe('Houston, TX');

const location = getLocationWithMetadata('US-TX-HOUSTON-123 MAIN');
expect(location.metadata.countryCode).toBe('US');
expect(location.metadata.stateCode).toBe('TX');
expect(location.metadata.coordinates).toBeDefined();
```

## Common Use Cases

| Use Case | Function | Example |
|----------|----------|---------|
| Display location | `formatLocation()` | `<p>{formatLocation(job.location)}</p>` |
| List all locations | `getAllLocations()` | `getAllLocations(job.location).map(...)` |
| Show on map | `getLocationWithMetadata()` | `location.metadata.coordinates` |
| Filter by region | `getLocationWithMetadata()` | `loc.metadata.stateCode === 'TX'` |
| Calculate distance | `getLocationWithMetadata()` | `getDistance(userLoc, loc.metadata.coordinates)` |
| International badge | `getLocationWithMetadata()` | `loc.metadata.countryCode !== 'US'` |
| Analytics/grouping | `getAllLocationsWithMetadata()` | `groupBy(locs, 'metadata.countryCode')` |

## Migration Checklist

- [ ] No changes needed for existing code
- [ ] `formatLocation()` works as before
- [ ] `getAllLocations()` works as before
- [ ] All tests still pass
- [ ] Optional: Add map feature using coordinates
- [ ] Optional: Add location filters using metadata
- [ ] Optional: Add distance calculations

## Documentation Files

- `LOCATION_LIBRARY_INTEGRATION.md` - Full integration guide
- `LOCATION_COMPARISON.md` - Before/after code comparison
- `LOCATION_USAGE_EXAMPLES.md` - Detailed usage examples
- `LOCATION_INTEGRATION_SUMMARY.md` - Implementation summary
- `LOCATION_QUICK_REFERENCE.md` - This file

## Support

For issues or questions:
1. Check test files: `src/utils/locationParser.test.js`, `test-location-metadata.js`
2. Review usage examples: `LOCATION_USAGE_EXAMPLES.md`
3. See library docs: https://www.npmjs.com/package/country-state-city

---

**Quick Start:** No changes needed. Existing code works. Use new metadata APIs when you need coordinates, filtering, or enhanced features.
