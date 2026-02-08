# Location Parser Usage Examples

## Basic Usage (Current Implementation)

### Display Location in Job Card

```javascript
// src/components/JobCard.jsx
import { formatLocation } from '../utils/locationParser';

function JobCard({ job }) {
  const location = formatLocation(job.location);

  return (
    <div className="job-card">
      <h3>{job.title}</h3>
      <p className="company">{job.company}</p>
      {location && (
        <p className="location">
          <LocationIcon />
          {location}
        </p>
      )}
    </div>
  );
}
```

### Display All Locations on Company Page

```javascript
// src/pages/CompanyPage.jsx
import { getAllLocations } from '../utils/locationParser';

function CompanyPage({ company, jobs }) {
  // Get all unique locations for this company
  const allLocations = [...new Set(
    jobs.flatMap(job => getAllLocations(job.location))
  )];

  return (
    <div>
      <h1>{company.name}</h1>
      <div className="locations">
        <h3>Office Locations</h3>
        <ul>
          {allLocations.map(location => (
            <li key={location}>{location}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

## Enhanced Usage (New Metadata Features)

### Display Location with Map Link

```javascript
// src/components/JobCard.jsx
import { getLocationWithMetadata } from '../utils/locationParser';

function JobCard({ job }) {
  const locationData = getLocationWithMetadata(job.location);

  if (!locationData) return null;

  const { formatted, metadata } = locationData;
  const hasCoordinates = metadata.coordinates != null;

  return (
    <div className="job-card">
      <h3>{job.title}</h3>
      <div className="location">
        <LocationIcon />
        <span>{formatted}</span>
        {hasCoordinates && (
          <a
            href={`https://www.google.com/maps?q=${metadata.coordinates.latitude},${metadata.coordinates.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="map-link"
          >
            View on Map
          </a>
        )}
      </div>
    </div>
  );
}
```

### Display Location with Country Flag

```javascript
// src/components/JobCard.jsx
import { getLocationWithMetadata } from '../utils/locationParser';

function JobCard({ job }) {
  const locationData = getLocationWithMetadata(job.location);

  if (!locationData) return null;

  const { formatted, metadata } = locationData;
  const isInternational = metadata.countryCode !== 'US';

  return (
    <div className="job-card">
      <h3>{job.title}</h3>
      <div className="location">
        {isInternational && (
          <span className="flag-icon" title={metadata.countryName}>
            🌍
          </span>
        )}
        <span>{formatted}</span>
      </div>
    </div>
  );
}
```

### Interactive Map Component

```javascript
// src/components/JobMap.jsx
import { getAllLocationsWithMetadata } from '../utils/locationParser';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';

function JobMap({ jobs }) {
  // Get all locations with coordinates
  const locationsWithCoords = jobs
    .map(job => ({
      job,
      location: getLocationWithMetadata(job.location)
    }))
    .filter(({ location }) => location?.metadata?.coordinates);

  return (
    <MapContainer
      center={[39.8283, -98.5795]} // Center of US
      zoom={4}
      style={{ height: '500px', width: '100%' }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      {locationsWithCoords.map(({ job, location }) => {
        const { latitude, longitude } = location.metadata.coordinates;
        return (
          <Marker key={job.id} position={[latitude, longitude]}>
            <Popup>
              <div>
                <h4>{job.title}</h4>
                <p>{job.company}</p>
                <p>{location.formatted}</p>
                <a href={`/jobs/${job.id}`}>View Job</a>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
```

### Location-Based Filtering

```javascript
// src/hooks/useJobFilters.js
import { getLocationWithMetadata } from '../utils/locationParser';

function useJobFilters(jobs) {
  const [filters, setFilters] = useState({
    country: null,
    state: null,
    remote: false
  });

  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      const location = getLocationWithMetadata(job.location);

      // Filter by country
      if (filters.country && location?.metadata?.countryCode !== filters.country) {
        return false;
      }

      // Filter by state
      if (filters.state && location?.metadata?.stateCode !== filters.state) {
        return false;
      }

      // Filter remote/on-site
      if (filters.remote && !job.isRemote) {
        return false;
      }

      return true;
    });
  }, [jobs, filters]);

  return { filteredJobs, filters, setFilters };
}

// Usage in component
function JobListPage() {
  const { data: jobs } = useJobs();
  const { filteredJobs, filters, setFilters } = useJobFilters(jobs);

  return (
    <div>
      <div className="filters">
        <select
          value={filters.country || ''}
          onChange={e => setFilters({ ...filters, country: e.target.value || null })}
        >
          <option value="">All Countries</option>
          <option value="US">United States</option>
          <option value="CA">Canada</option>
          <option value="GB">United Kingdom</option>
        </select>

        {filters.country === 'US' && (
          <select
            value={filters.state || ''}
            onChange={e => setFilters({ ...filters, state: e.target.value || null })}
          >
            <option value="">All States</option>
            <option value="TX">Texas</option>
            <option value="CA">California</option>
            <option value="NY">New York</option>
          </select>
        )}
      </div>

      <div className="jobs">
        {filteredJobs.map(job => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}
```

### Distance Calculation & Sorting

```javascript
// src/utils/distance.js
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

// src/hooks/useNearbyJobs.js
import { getLocationWithMetadata } from '../utils/locationParser';
import { calculateDistance } from '../utils/distance';

function useNearbyJobs(jobs, userLocation) {
  const jobsWithDistance = useMemo(() => {
    if (!userLocation) return jobs;

    return jobs
      .map(job => {
        const location = getLocationWithMetadata(job.location);

        if (!location?.metadata?.coordinates) {
          return { ...job, distance: null };
        }

        const distance = calculateDistance(
          userLocation.latitude,
          userLocation.longitude,
          location.metadata.coordinates.latitude,
          location.metadata.coordinates.longitude
        );

        return { ...job, distance, location: location.formatted };
      })
      .sort((a, b) => {
        // Jobs with distance come first, sorted by distance
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      });
  }, [jobs, userLocation]);

  return jobsWithDistance;
}

// Usage in component
function JobListPage() {
  const { data: jobs } = useJobs();
  const [userLocation, setUserLocation] = useState(null);

  useEffect(() => {
    // Get user's location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        error => console.error('Error getting location:', error)
      );
    }
  }, []);

  const sortedJobs = useNearbyJobs(jobs, userLocation);

  return (
    <div>
      {userLocation && (
        <p className="info">
          Showing jobs sorted by distance from your location
        </p>
      )}

      <div className="jobs">
        {sortedJobs.map(job => (
          <JobCard
            key={job.id}
            job={job}
            distance={job.distance}
          />
        ))}
      </div>
    </div>
  );
}

// Enhanced JobCard with distance
function JobCard({ job, distance }) {
  return (
    <div className="job-card">
      <h3>{job.title}</h3>
      <p className="company">{job.company}</p>
      <div className="location">
        <LocationIcon />
        <span>{job.location}</span>
        {distance && (
          <span className="distance">
            ({Math.round(distance)} miles away)
          </span>
        )}
      </div>
    </div>
  );
}
```

### Regional Analytics Dashboard

```javascript
// src/pages/AnalyticsDashboard.jsx
import { getLocationWithMetadata } from '../utils/locationParser';

function AnalyticsDashboard({ jobs }) {
  const analytics = useMemo(() => {
    const stats = {
      byCountry: {},
      byState: {},
      withCoordinates: 0,
      international: 0
    };

    jobs.forEach(job => {
      const location = getLocationWithMetadata(job.location);

      if (!location?.metadata) return;

      const { countryCode, countryName, stateName, coordinates } = location.metadata;

      // Count by country
      if (countryName) {
        stats.byCountry[countryName] = (stats.byCountry[countryName] || 0) + 1;
      }

      // Count by state (US only)
      if (countryCode === 'US' && stateName) {
        stats.byState[stateName] = (stats.byState[stateName] || 0) + 1;
      }

      // Count with coordinates
      if (coordinates) {
        stats.withCoordinates++;
      }

      // Count international
      if (countryCode !== 'US') {
        stats.international++;
      }
    });

    return stats;
  }, [jobs]);

  return (
    <div className="analytics-dashboard">
      <h2>Job Analytics</h2>

      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Jobs</h3>
          <p className="stat-value">{jobs.length}</p>
        </div>

        <div className="stat-card">
          <h3>International Jobs</h3>
          <p className="stat-value">{analytics.international}</p>
          <p className="stat-percent">
            {Math.round((analytics.international / jobs.length) * 100)}%
          </p>
        </div>

        <div className="stat-card">
          <h3>Locations with Coordinates</h3>
          <p className="stat-value">{analytics.withCoordinates}</p>
          <p className="stat-percent">
            {Math.round((analytics.withCoordinates / jobs.length) * 100)}%
          </p>
        </div>
      </div>

      <div className="charts">
        <div className="chart-card">
          <h3>Jobs by Country</h3>
          <ul>
            {Object.entries(analytics.byCountry)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([country, count]) => (
                <li key={country}>
                  <span>{country}</span>
                  <span className="count">{count}</span>
                </li>
              ))}
          </ul>
        </div>

        <div className="chart-card">
          <h3>Jobs by US State</h3>
          <ul>
            {Object.entries(analytics.byState)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([state, count]) => (
                <li key={state}>
                  <span>{state}</span>
                  <span className="count">{count}</span>
                </li>
              ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
```

### Location Search/Autocomplete

```javascript
// src/components/LocationSearch.jsx
import { useState, useMemo } from 'react';
import { getAllLocationsWithMetadata } from '../utils/locationParser';

function LocationSearch({ jobs, onLocationSelect }) {
  const [searchTerm, setSearchTerm] = useState('');

  // Get all unique locations
  const allLocations = useMemo(() => {
    const locationMap = new Map();

    jobs.forEach(job => {
      const locations = getAllLocationsWithMetadata(job.location);
      locations.forEach(loc => {
        const key = loc.formatted;
        if (!locationMap.has(key)) {
          locationMap.set(key, loc);
        }
      });
    });

    return Array.from(locationMap.values());
  }, [jobs]);

  // Filter locations based on search
  const filteredLocations = useMemo(() => {
    if (!searchTerm) return [];

    const term = searchTerm.toLowerCase();

    return allLocations
      .filter(loc => {
        const { formatted, metadata } = loc;
        return (
          formatted.toLowerCase().includes(term) ||
          metadata.cityName?.toLowerCase().includes(term) ||
          metadata.stateName?.toLowerCase().includes(term) ||
          metadata.countryName?.toLowerCase().includes(term)
        );
      })
      .slice(0, 10); // Limit results
  }, [allLocations, searchTerm]);

  return (
    <div className="location-search">
      <input
        type="text"
        placeholder="Search locations..."
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
      />

      {searchTerm && filteredLocations.length > 0 && (
        <ul className="location-suggestions">
          {filteredLocations.map((location, index) => (
            <li
              key={index}
              onClick={() => {
                onLocationSelect(location);
                setSearchTerm('');
              }}
            >
              <div className="location-name">{location.formatted}</div>
              {location.metadata.coordinates && (
                <div className="location-coords">
                  {location.metadata.coordinates.latitude.toFixed(4)},
                  {location.metadata.coordinates.longitude.toFixed(4)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

## Testing Examples

### Unit Tests for Location-Based Features

```javascript
// src/utils/locationParser.test.js
import { getLocationWithMetadata } from './locationParser';

describe('Location Parser with Metadata', () => {
  test('should return coordinates for known cities', () => {
    const result = getLocationWithMetadata('US-TX-HOUSTON-2001 RANKIN ROAD');

    expect(result.metadata.coordinates).toBeDefined();
    expect(result.metadata.coordinates.latitude).toBeCloseTo(29.76, 1);
    expect(result.metadata.coordinates.longitude).toBeCloseTo(-95.36, 1);
  });

  test('should return country information', () => {
    const result = getLocationWithMetadata('IT-FI-FLORENCE-VIA MATTEUCCI 2');

    expect(result.metadata.countryCode).toBe('IT');
    expect(result.metadata.countryName).toBe('Italy');
  });

  test('should handle multiple locations', () => {
    const result = getLocationWithMetadata('US-TX-HOUSTON\nUS-LA-NEW ORLEANS');

    expect(result.formatted).toBe('Houston, TX');
    expect(result.metadata.additionalLocations).toBe(1);
  });
});
```

## Summary

These examples demonstrate:

1. **Backward compatibility** - Existing code works unchanged
2. **Opt-in enhancement** - New metadata features are optional
3. **Practical use cases** - Map display, filtering, distance, analytics
4. **Real-world patterns** - Hooks, components, utilities
5. **Progressive enhancement** - Start simple, add features as needed

All examples are production-ready and can be adapted to your specific needs.
