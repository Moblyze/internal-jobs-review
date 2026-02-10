import { useState, useEffect, useCallback } from 'react';
import { mergeEnhancements } from '../utils/jobEnhancementStorage';

const LAST_UPDATED_KEY = 'jobs_last_updated';

// Lazy-load utility modules to enable code splitting
const getGeocoderModule = () => import('../utils/geocoder');

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
      console.log('[useJobs] First job sample:', data[0]);

      // Merge localStorage enhancements with jobs data
      const enhancedJobs = mergeEnhancements(data);
      console.log('[useJobs] Merged client-side enhancements');

      setJobs(enhancedJobs);
      setLastUpdated(now);
      localStorage.setItem(LAST_UPDATED_KEY, now.toISOString());
      setLoading(false);
      console.log('[useJobs] Loading state set to false, jobs set');

      // After loading jobs, check for new locations and auto-geocode them
      if (forceRefresh) {
        console.log('[useJobs] Checking for new locations to geocode...');

        try {
          const { checkForNewLocations, geocodeNewLocations } = await getGeocoderModule();
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

export async function getSimilarJobs(jobs, currentJob, limit = 5) {
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
  const { getAllLocationsAsync } = await import('../utils/locationParser');
  const currentJobLocations = await getAllLocationsAsync(currentJob.location);

  // Pre-compute locations for all candidate jobs
  const candidateJobs = jobs.filter(job => job.id !== currentJob.id && job.company !== currentJob.company);
  const jobLocationsMap = new Map();
  await Promise.all(
    candidateJobs.map(async job => {
      const locations = await getAllLocationsAsync(job.location);
      jobLocationsMap.set(job.id, locations);
    })
  );

  const similar = candidateJobs
    .map(job => {
      let score = 0;

      // Same location (check if any formatted location matches)
      const jobLocations = jobLocationsMap.get(job.id) || [];
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
  // Only include companies from ACTIVE jobs (exclude removed/paused jobs)
  const activeJobs = jobs.filter(job => job.status !== 'removed' && job.status !== 'paused');
  const companies = [...new Set(activeJobs.map(job => job.company))];
  return companies.sort();
}

export async function getUniqueLocations(jobs) {
  // Get all formatted locations from ACTIVE jobs only (exclude removed/paused jobs)
  const { getAllLocationsAsync } = await import('../utils/locationParser');
  const activeJobs = jobs.filter(job => job.status !== 'removed' && job.status !== 'paused');
  const allLocationArrays = await Promise.all(
    activeJobs.map(async job => await getAllLocationsAsync(job.location))
  );
  const validArrays = allLocationArrays.filter(locs => locs.length > 0);

  // Flatten and deduplicate
  const locations = [...new Set(validArrays.flat())];
  return locations.sort();
}

export async function getGroupedLocations(jobs) {
  // Get all unique locations
  const locations = await getUniqueLocations(jobs);

  // Group them by country and region
  const { groupLocationsByRegion } = await import('../utils/locationGrouping');
  return groupLocationsByRegion(locations);
}

export async function getUniqueSkills(jobs) {
  // Ensure O*NET cache is loaded before processing skills
  const { initializeONet } = await import('../utils/onetClient');
  await initializeONet();

  const { filterValidSkills } = await import('../utils/skillValidator');
  // Only include skills from ACTIVE jobs (exclude removed/paused jobs)
  const activeJobs = jobs.filter(job => job.status !== 'removed' && job.status !== 'paused');
  const allSkills = activeJobs.flatMap(job => job.skills || []);
  const validSkills = filterValidSkills(allSkills);

  // Deduplicate case-insensitively, keeping canonical form
  const seen = new Map();
  for (const skill of validSkills) {
    const lower = skill.toLowerCase();
    if (!seen.has(lower)) {
      seen.set(lower, skill);
    }
  }
  return [...seen.values()].sort();
}

export async function getUniqueCertifications(jobs) {
  const { getAllCertifications } = await import('../utils/certificationExtractor');
  return getAllCertifications(jobs);
}

/**
 * Get all certifications with job counts (including zero-count certifications)
 * @param {Array} jobs - Array of job objects
 * @returns {Promise<Array>} - Array of {name, count} objects sorted by count (desc) then name (asc)
 */
export async function getCertificationsWithCounts(jobs) {
  const { getAllCertificationsWithCounts } = await import('../utils/certificationExtractor');
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

  // Only count ACTIVE jobs (exclude removed/paused jobs)
  jobs.forEach(job => {
    // Skip inactive jobs
    if (job.status === 'removed' || job.status === 'paused') {
      return;
    }

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
 * @returns {Promise<Array>} Array of location names sorted by frequency
 */
export async function getTopLocations(jobs, limit = 5) {
  const { getAllLocationsAsync } = await import('../utils/locationParser');
  const locationCounts = {};

  // Only count ACTIVE jobs (exclude removed/paused jobs)
  const activeJobs = jobs.filter(job => job.status !== 'removed' && job.status !== 'paused');

  // Process all jobs async to ensure consistent formatting
  const jobLocationArrays = await Promise.all(
    activeJobs.map(async job => await getAllLocationsAsync(job.location))
  );

  jobLocationArrays.forEach(locations => {
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
 * @returns {Promise<Array>} Array of skill names sorted by frequency
 */
export async function getTopSkills(jobs, limit = 5) {
  // Ensure O*NET cache is loaded before processing skills
  const { initializeONet } = await import('../utils/onetClient');
  await initializeONet();

  const { filterValidSkills } = await import('../utils/skillValidator');
  const { ONET_SKILLS, ONET_KNOWLEDGE, ONET_ABILITIES } = await import('../data/onetSkillsReference.js');

  // Generic O*NET base taxonomy skills are too broad for popular pills
  // (e.g., "Communication", "Writing", "Mathematics", "Speaking")
  // Only show energy/industry-specific skills as popular filters
  const genericSkills = new Set([
    ...ONET_SKILLS, ...ONET_KNOWLEDGE, ...ONET_ABILITIES,
  ].map(s => s.toLowerCase()));

  // Generic/soft skills from INDUSTRY_SKILLS that are too broad for popular pills.
  // These are valid skills for job cards but not useful as filter pills because
  // they appear across nearly every job and don't help users narrow results
  // to specific energy-industry roles.
  const GENERIC_PILLS_EXCLUSIONS = new Set([
    'communication', 'oral communication', 'written communication', 'interpersonal communication',
    'leadership', 'team leadership', 'team building', 'teamwork',
    'problem solving', 'decision making', 'analytical thinking',
    'mentoring', 'coaching', 'conflict resolution',
    'customer service', 'stakeholder engagement',
    'documentation', 'planning', 'scheduling', 'budgeting', 'forecasting',
    'presentation', 'report writing', 'technical writing',
    'strategic planning', 'business development', 'financial analysis',
    'procurement', 'logistics', 'audit',
    'continuous improvement', 'organizational skills', 'attention to detail',
  ]);

  const skillCounts = {};

  // Only count ACTIVE jobs (exclude removed/paused jobs)
  jobs.forEach(job => {
    // Skip inactive jobs
    if (job.status === 'removed' || job.status === 'paused') {
      return;
    }

    const validSkills = filterValidSkills(job.skills);
    validSkills.forEach(skill => {
      // Skip generic O*NET base skills for popular pills
      if (genericSkills.has(skill.toLowerCase())) return;
      // Skip generic soft/business skills that aren't useful as filter pills
      if (GENERIC_PILLS_EXCLUSIONS.has(skill.toLowerCase())) return;
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
  const { getEnergyRole, ENERGY_ROLES } = await import('../utils/energyRoles');
  const mappings = await loadOccupationMappings();
  const roleCounts = {};

  // Only count ACTIVE jobs (exclude removed/paused jobs)
  jobs.forEach(job => {
    // Skip inactive jobs
    if (job.status === 'removed' || job.status === 'paused') {
      return;
    }

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

  const { getEnergyRole, ENERGY_ROLES } = await import('../utils/energyRoles');
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
