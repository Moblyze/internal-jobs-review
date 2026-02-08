# Location Parser - Before & After Examples

## Implementation Summary

The location parser utility (`src/utils/locationParser.js`) transforms raw location data into clean, human-readable formats.

## Transformation Examples

### International Locations

| Before | After |
|--------|-------|
| `locations\nIT-FI-FLORENCE-VIA FELICE MATTEUCCI 2` | `Florence, Italy` |
| `locations\nAE-ABU DHABI-AL GHAITH HOLDING TOWER, AIRPORT ROAD` | `Abu Dhabi, United Arab Emirates` |
| `locations\nBR-RJ-RIO DE JANEIRO-VENTURA-AV REPUBLICA DO CHILE 330` | `Rio De Janeiro, Rio de Janeiro, Brazil` |
| `locations\nMX-DF-MEXICO CITY-AVENIDA ANTONIO DOVALI JAIME 70` | `Mexico City, Mexico` |

### United States Locations

| Before | After |
|--------|-------|
| `locations\nUS-TX-HOUSTON-2001 RANKIN ROAD` | `Houston, TX` |
| `locations\nUS-AK-ANCHORAGE-795 EAST 94TH AVENUE` | `Anchorage, AK` |
| `locations\nUS-NM-Carlsbad-233 Carrasco Road` | `Carlsbad, NM` |
| `locations\nUS-PA-MOUNT PLEASANT-370 WESTEC DRIVE` | `Mount Pleasant, PA` |

### Canadian Locations

| Before | After |
|--------|-------|
| `locations\nCA-AB-CALGARY-4839 90TH AVENUE SE` | `Calgary, AB, Canada` |

### Multiple Locations

| Before | After |
|--------|-------|
| `locations\nUS-TX-OTHER TEXAS\nUS-NM-OTHER NEW MEXICO\nUS-MS-OTHER MISSISSIPPI` | `Other Texas, TX +2 more` |
| `locations\nUS-TX-HOUSTON-2001 RANKIN ROAD\nUS-TX-HOUSTON-13717 WEST HARDY ROAD` | `Houston, TX +1 more` |

### Simple Locations (Already Clean)

| Before | After |
|--------|-------|
| `locations\nHouston` | `Houston` |
| `locations\nAberdeen` | `Aberdeen` |

### Special Cases

| Before | After |
|--------|-------|
| `locations\nGlobal Recruiting` | `Global Recruiting` |
| `locations\nGulf of Mexico` | `Gulf of Mexico` |
| `locations\nNoble Interceptor` | `Noble Interceptor` |

## Features

1. **Country Code Mapping**: Converts ISO 3166-1 alpha-2 codes to full country names
   - IT → Italy
   - AE → United Arab Emirates
   - BR → Brazil

2. **State/Province Handling**:
   - US states shown as abbreviations (TX, CA, NY)
   - Canadian provinces shown with country (AB, Canada)
   - Brazilian states shown in full (Rio de Janeiro, Brazil)

3. **Address Removal**: Strips street addresses and building details
   - Removes "VIA FELICE MATTEUCCI 2"
   - Removes "2001 RANKIN ROAD"

4. **Multiple Locations**: Shows first location with count
   - "Houston, TX +2 more"

5. **Title Casing**: Proper capitalization
   - "FLORENCE" → "Florence"
   - "RIO DE JANEIRO" → "Rio De Janeiro"

## API

### `formatLocation(location)`

Formats a location string for display.

```javascript
import { formatLocation } from './utils/locationParser';

const formatted = formatLocation("locations\nUS-TX-HOUSTON-2001 RANKIN ROAD");
// Returns: "Houston, TX"
```

### `getAllLocations(location)`

Gets all locations as an array (useful for filtering, company pages).

```javascript
import { getAllLocations } from './utils/locationParser';

const locations = getAllLocations("locations\nUS-TX-HOUSTON\nUS-CA-LOS ANGELES");
// Returns: ["Houston, TX", "Los Angeles, CA"]
```

## Updated Components

1. **JobCard** (`src/components/JobCard.jsx`)
   - Displays formatted location on job cards

2. **JobDetailPage** (`src/pages/JobDetailPage.jsx`)
   - Shows formatted location via existing `cleanLocation()` function (now uses parser)

3. **CompanyPage** (`src/pages/CompanyPage.jsx`)
   - Lists all unique formatted locations for a company

4. **Filters** (via `src/hooks/useJobs.js`)
   - Location filters now use formatted locations
   - Matching works correctly with parsed locations

5. **Similar Jobs** (via `src/hooks/useJobs.js`)
   - Location matching for similar jobs uses formatted locations

## Testing

Run the dev server and verify:

```bash
npm run dev
```

Visit `http://localhost:5173` and check:
- Job cards show clean locations (e.g., "Houston, TX" not "locations\nUS-TX-HOUSTON-2001 RANKIN ROAD")
- Company pages show formatted location list
- Location filters work correctly
- Similar jobs match by formatted location

## Files Modified

- ✅ `src/utils/locationParser.js` (NEW)
- ✅ `src/utils/contentFormatter.js` (updated `cleanLocation()`)
- ✅ `src/components/JobCard.jsx`
- ✅ `src/pages/JobDetailPage.jsx` (already using `cleanLocation()`)
- ✅ `src/pages/CompanyPage.jsx`
- ✅ `src/hooks/useJobs.js`
- ✅ `src/pages/JobListPage.jsx`
