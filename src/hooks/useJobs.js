import { useState, useEffect, useCallback } from 'react';
import { filterValidSkills } from '../utils/skillValidator';
import { getAllLocations } from '../utils/locationParser';
import { groupLocationsByRegion } from '../utils/locationGrouping';
import { getAllCertifications, getAllCertificationsWithCounts } from '../utils/certificationExtractor';
import { geocodeNewLocations, checkForNewLocations } from '../utils/geocoder';
import { getEnergyRole, ENERGY_ROLES } from '../utils/energyRoles';

const LAST_UPDATED_KEY = 'jobs_last_updated';

export function useJobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [geocodingStatus, setGeocodingStatus] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(() => {
    const stored = localStorage.getItem(LAST_UPDATED_KEY);
    return stored ? new Date(stored) : null;
  });

  const fetchJobs = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    setGeocodingStatus(null);

    // Add cache-busting timestamp to ensure fresh data on manual refresh
    const url = forceRefresh
      ? `${import.meta.env.BASE_URL}data/jobs.json?t=${Date.now()}`
      : `${import.meta.env.BASE_URL}data/jobs.json`;

    if (forceRefresh) {
      console.log('[useJobs] Force refresh requested - fetching with cache-busting');
    }

    try {
      const res = await fetch(url, {
        // Disable cache for manual refreshes
        cache: forceRefresh ? 'no-store' : 'default'
      });

      if (!res.ok) throw new Error('Failed to load jobs');

      const data = await res.json();
      const now = new Date();
      console.log(`[useJobs] Successfully loaded ${data.length} jobs`);

      setJobs(data);
      setLastUpdated(now);
      localStorage.setItem(LAST_UPDATED_KEY, now.toISOString());
      setLoading(false);

      // After loading jobs, check for new locations and auto-geocode them
      if (forceRefresh) {
        console.log('[useJobs] Checking for new locations to geocode...');

        try {
          const checkResult = await checkForNewLocations(data);

          if (checkResult.hasNewLocations) {
            console.log(`[useJobs] Found ${checkResult.newLocationCount} new locations to geocode`);
            setGeocodingStatus({ type: 'geocoding', count: checkResult.newLocationCount });

            // Geocode new locations
            const geocodeResult = await geocodeNewLocations(data, (current, total, location) => {
              setGeocodingStatus({
                type: 'geocoding',
                current,
                total,
                location
              });
            });

            // Show success message
            setGeocodingStatus({
              type: 'success',
              message: geocodeResult.message,
              newLocations: geocodeResult.newLocations,
              failed: geocodeResult.failed
            });

            // Clear status after 5 seconds
            setTimeout(() => setGeocodingStatus(null), 5000);
          } else {
            console.log('[useJobs] All locations already geocoded');
          }
        } catch (geocodeError) {
          console.warn('[useJobs] Geocoding error (non-fatal):', geocodeError.message);
          setGeocodingStatus({
            type: 'error',
            message: 'Geocoding failed (dev mode only)'
          });
          setTimeout(() => setGeocodingStatus(null), 5000);
        }
      }
    } catch (err) {
      console.error('[useJobs] Error loading jobs:', err);
      setError(err.message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const refresh = useCallback(() => {
    console.log('[useJobs] Refresh button clicked');
    fetchJobs(true); // Force refresh with cache-busting
  }, [fetchJobs]);

  return { jobs, loading, error, lastUpdated, refresh, geocodingStatus };
}

export function getJobById(jobs, jobId) {
  return jobs.find(job => job.id === jobId);
}

export function getJobsByCompany(jobs, companySlug) {
  const company = companySlug.replace(/-/g, ' ');
  return jobs.filter(job =>
    job.company.toLowerCase().replace(/\s+/g, '-') === companySlug
  );
}

export function getSimilarJobs(jobs, currentJob, limit = 5) {
  if (!currentJob) return [];

  // Priority 1: Same company
  const sameCompany = jobs.filter(job =>
    job.id !== currentJob.id &&
    job.company === currentJob.company
  );

  if (sameCompany.length >= limit) {
    return sameCompany.slice(0, limit);
  }

  // Priority 2: Same location or overlapping skills
  const currentJobLocations = getAllLocations(currentJob.location);

  const similar = jobs
    .filter(job => job.id !== currentJob.id && job.company !== currentJob.company)
    .map(job => {
      let score = 0;

      // Same location (check if any formatted location matches)
      const jobLocations = getAllLocations(job.location);
      const hasCommonLocation = jobLocations.some(loc =>
        currentJobLocations.includes(loc)
      );
      if (hasCommonLocation) score += 2;

      // Overlapping skills
      const commonSkills = job.skills.filter(skill =>
        currentJob.skills.includes(skill)
      );
      score += commonSkills.length;

      return { job, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ job }) => job);

  // Combine same company + similar, up to limit
  return [...sameCompany, ...similar].slice(0, limit);
}

export function getUniqueCompanies(jobs) {
  const companies = [...new Set(jobs.map(job => job.company))];
  return companies.sort();
}

export function getUniqueLocations(jobs) {
  // Get all formatted locations from all jobs
  const allLocationArrays = jobs
    .map(job => getAllLocations(job.location))
    .filter(locs => locs.length > 0);

  // Flatten and deduplicate
  const locations = [...new Set(allLocationArrays.flat())];
  return locations.sort();
}

export function getGroupedLocations(jobs) {
  // Get all unique locations
  const locations = getUniqueLocations(jobs);

  // Group them by country and region
  return groupLocationsByRegion(locations);
}

export function getUniqueSkills(jobs) {
  const allSkills = jobs.flatMap(job => job.skills);
  const validSkills = filterValidSkills(allSkills);
  const skills = [...new Set(validSkills)];
  return skills.sort();
}

export function getUniqueCertifications(jobs) {
  return getAllCertifications(jobs);
}

/**
 * Get all certifications with job counts (including zero-count certifications)
 * @param {Array} jobs - Array of job objects
 * @returns {Array} - Array of {name, count} objects sorted by count (desc) then name (asc)
 */
export function getCertificationsWithCounts(jobs) {
  return getAllCertificationsWithCounts(jobs);
}

/**
 * Get the top N most popular companies from jobs data
 * @param {Array} jobs - Array of job objects
 * @param {number} limit - Number of top companies to return (default: 5)
 * @returns {Array} Array of company names sorted by frequency
 */
export function getTopCompanies(jobs, limit = 5) {
  const companyCounts = {};

  jobs.forEach(job => {
    if (job.company) {
      companyCounts[job.company] = (companyCounts[job.company] || 0) + 1;
    }
  });

  return Object.entries(companyCounts)
    .sort((a, b) => b[1] - a[1]) // Sort by count descending
    .slice(0, limit)
    .map(([company]) => company);
}

/**
 * Get the top N most popular locations from jobs data
 * @param {Array} jobs - Array of job objects
 * @param {number} limit - Number of top locations to return (default: 5)
 * @returns {Array} Array of location names sorted by frequency
 */
export function getTopLocations(jobs, limit = 5) {
  const locationCounts = {};

  jobs.forEach(job => {
    const locations = getAllLocations(job.location);
    locations.forEach(loc => {
      locationCounts[loc] = (locationCounts[loc] || 0) + 1;
    });
  });

  return Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1]) // Sort by count descending
    .slice(0, limit)
    .map(([location]) => location);
}

/**
 * Get the top N most popular skills from jobs data
 * @param {Array} jobs - Array of job objects
 * @param {number} limit - Number of top skills to return (default: 5)
 * @returns {Array} Array of skill names sorted by frequency
 */
export function getTopSkills(jobs, limit = 5) {
  const skillCounts = {};

  jobs.forEach(job => {
    const validSkills = filterValidSkills(job.skills);
    validSkills.forEach(skill => {
      skillCounts[skill] = (skillCounts[skill] || 0) + 1;
    });
  });

  return Object.entries(skillCounts)
    .sort((a, b) => b[1] - a[1]) // Sort by count descending
    .slice(0, limit)
    .map(([skill]) => skill);
}

/**
 * Load occupation mappings from JSON file
 * Cached in memory after first load
 */
let occupationMappings = null;
let occupationMappingsPromise = null;

async function loadOccupationMappings() {
  // Return cached data if available
  if (occupationMappings) return occupationMappings;

  // Return existing promise if already loading
  if (occupationMappingsPromise) return occupationMappingsPromise;

  // Start loading
  occupationMappingsPromise = (async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}data/job-occupations.json`);
      if (!response.ok) {
        console.warn('Occupation mappings file not found. Run: npm run match-occupations');
        return {};
      }
      const data = await response.json();
      occupationMappings = data;
      console.log(`✅ Loaded ${Object.keys(data).length} job-to-occupation mappings`);
      return data;
    } catch (error) {
      console.warn('Failed to load occupation mappings:', error);
      return {};
    }
  })();

  return occupationMappingsPromise;
}

/**
 * Get unique energy roles from jobs with counts
 *
 * @param {Array} jobs - Array of job objects
 * @returns {Promise<Array>} Array of role objects with counts
 */
export async function getEnergyRoles(jobs) {
  const mappings = await loadOccupationMappings();
  const roleCounts = {};

  jobs.forEach(job => {
    const mapping = mappings[job.id];
    if (!mapping) return;

    // Use role_id from keyword matching if available, otherwise use onet_code
    let role;
    if (mapping.role_id) {
      // Direct role ID from keyword matcher
      role = { id: mapping.role_id, ...ENERGY_ROLES[mapping.role_id] };
    } else {
      // Fall back to O*NET code matching
      role = getEnergyRole(mapping.onet_code);
    }

    roleCounts[role.id] = (roleCounts[role.id] || 0) + 1;
  });

  // Return roles sorted by count (descending), but "other" always goes last
  return Object.entries(roleCounts)
    .map(([roleId, count]) => ({
      id: roleId,
      label: ENERGY_ROLES[roleId].label,
      count,
      icon: ENERGY_ROLES[roleId].icon,
      category: ENERGY_ROLES[roleId].category
    }))
    .sort((a, b) => {
      // Always move "other" to the bottom
      if (a.id === 'other') return 1;
      if (b.id === 'other') return -1;
      // Sort by count (descending)
      return b.count - a.count;
    });
}

/**
 * Filter jobs by energy role
 *
 * @param {Array} jobs - Array of job objects
 * @param {string|Array<string>} roleIds - Single role ID or array of role IDs
 * @returns {Promise<Array>} Filtered jobs
 */
export async function filterJobsByRole(jobs, roleIds) {
  if (!roleIds || (Array.isArray(roleIds) && roleIds.length === 0)) {
    return jobs;
  }

  const mappings = await loadOccupationMappings();

  // Normalize to array
  const roleIdsArray = Array.isArray(roleIds) ? roleIds : [roleIds];

  return jobs.filter(job => {
    const mapping = mappings[job.id];
    if (!mapping) return false;

    // Use role_id from keyword matching if available, otherwise use onet_code
    let role;
    if (mapping.role_id) {
      // Direct role ID from keyword matcher
      role = { id: mapping.role_id, ...ENERGY_ROLES[mapping.role_id] };
    } else {
      // Fall back to O*NET code matching
      role = getEnergyRole(mapping.onet_code);
    }

    return roleIdsArray.includes(role.id);
  });
}

/**
 * Get occupation mapping for a specific job
 *
 * @param {string} jobId - Job ID
 * @returns {Promise<object|null>} Occupation mapping or null
 */
export async function getJobOccupation(jobId) {
  const mappings = await loadOccupationMappings();
  return mappings[jobId] || null;
}
