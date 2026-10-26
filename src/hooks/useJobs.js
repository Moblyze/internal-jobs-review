import { useState, useEffect, useCallback } from 'react';
import { mergeEnhancements } from '../utils/jobEnhancementStorage';
import { decodeLiteIndex } from '../utils/liteIndexDecoder';
import { jobShardIndex, shardKey } from '../utils/jobShard';
import { companyToSlug } from '../utils/formatters';
import { normalizeCompanyName } from '../utils/companyNormalizer';

const LAST_UPDATED_KEY = 'jobs_last_updated';

// Lazy-load utility modules to enable code splitting
const getGeocoderModule = () => import('../utils/geocoder');

// ── Singleton filter options cache ──────────────────────────────────────────
let filterOptionsCache = null;
let filterOptionsPromise = null;

/**
 * Load pre-computed filter options (tiny file, loads instantly).
 * Cached after first load.
 */
export async function loadFilterOptions() {
  if (filterOptionsCache) return filterOptionsCache;
  if (filterOptionsPromise) return filterOptionsPromise;

  filterOptionsPromise = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/filter-options.json`);
      if (!res.ok) {
        console.warn('[useJobs] filter-options.json not found, falling back to runtime computation');
        return null;
      }
      const data = await res.json();
      filterOptionsCache = data;
      console.log(`[useJobs] Loaded pre-computed filter options (${data.totalJobs} jobs, ${data.companies.length} companies)`);
      return data;
    } catch (err) {
      console.warn('[useJobs] Failed to load filter-options.json:', err.message);
      filterOptionsPromise = null;
      return null;
    }
  })();

  return filterOptionsPromise;
}

/**
 * Hook to access pre-computed filter options.
 * Returns null while loading, then the filter options object.
 */
export function useFilterOptions() {
  const [options, setOptions] = useState(filterOptionsCache);

  useEffect(() => {
    if (filterOptionsCache) {
      setOptions(filterOptionsCache);
      return;
    }
    loadFilterOptions().then(data => {
      if (data) setOptions(data);
    });
  }, []);

  return options;
}

// ── Jobs manifest (index shard list + detail shard map) ─────────────────────
let manifestCache = null;

async function loadJobsManifest(forceRefresh = false) {
  if (manifestCache && !forceRefresh) return manifestCache;
  const res = await fetch(`${import.meta.env.BASE_URL}data/jobs-manifest.json`, {
    cache: forceRefresh ? 'no-store' : 'no-cache', // always revalidate (ETag), never serve a stale shard list
  });
  if (!res.ok) throw new Error('Failed to load jobs manifest');
  manifestCache = await res.json();
  detailShardCache.clear();
  return manifestCache;
}

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

    // Start loading filter options in parallel (tiny file, instant)
    loadFilterOptions();

    if (forceRefresh) {
      console.log('[useJobs] Force refresh requested - revalidating manifest');
    }

    try {
      // The manifest is tiny and always revalidated. Index shards are content-hashed
      // (immutable, cached forever), so a refresh only downloads shards that changed.
      const manifest = await loadJobsManifest(forceRefresh);
      const shards = await Promise.all(
        manifest.index.map(async ({ file }) => {
          const res = await fetch(`${import.meta.env.BASE_URL}data/jobs/${file}`);
          if (!res.ok) throw new Error(`Failed to load jobs shard ${file}`);
          return decodeLiteIndex(await res.json());
        })
      );
      const data = shards.flat();
      console.log(`[useJobs] Loaded ${data.length} current jobs from ${shards.length} index shards`);

      const now = new Date();

      // Merge localStorage enhancements with jobs data
      const enhancedJobs = mergeEnhancements(data);
      console.log('[useJobs] Merged client-side enhancements');

      setJobs(enhancedJobs);
      setLastUpdated(now);
      localStorage.setItem(LAST_UPDATED_KEY, now.toISOString());
      setLoading(false);
      console.log('[useJobs] Loading complete');

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

// Per-job detail (description, structuredDescription, url) lives in content-hashed
// shards keyed by FNV-1a(id). A detail page fetches exactly one shard (~0.6 MB raw).
const detailShardCache = new Map(); // shard key -> Promise<object>

function loadDetailShard(manifest, id) {
  const count = manifest.detail.shards;
  const key = shardKey(jobShardIndex(id, count), count);
  if (!detailShardCache.has(key)) {
    const file = manifest.detail.files[key];
    const p = fetch(`${import.meta.env.BASE_URL}data/jobs/detail/${file}`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load detail shard ${file}`);
        return res.json();
      })
      .catch(err => {
        detailShardCache.delete(key);
        throw err;
      });
    detailShardCache.set(key, p);
  }
  return detailShardCache.get(key);
}

// Closed (removed/expired) jobs are not in the list index. Their pages are served from the
// private archive: closed shards keyed by FNV-1a(slug), behind the Access-protected Function.
const closedShardCache = new Map();

/**
 * Look up a removed/expired job by its page slug. Resolves null when the slug never existed
 * (or the closed shards are unavailable, e.g. plain `vite preview` without the Function).
 */
export async function getClosedJob(slug) {
  if (!slug) return null;
  try {
    const manifest = await loadJobsManifest();
    const count = manifest.closed?.shards;
    if (!count) return null;
    const key = shardKey(jobShardIndex(slug, count), count);
    if (!closedShardCache.has(key)) {
      closedShardCache.set(key, fetch(`${import.meta.env.BASE_URL}data/closed/${key}.json`)
        .then(res => {
          if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) throw new Error(`closed shard ${key} unavailable`);
          return res.json();
        })
        .catch(err => { closedShardCache.delete(key); throw err; }));
    }
    const row = (await closedShardCache.get(key))[slug];
    return row ? { ...row, closed: true } : null;
  } catch (err) {
    console.warn('[useJobs] Closed job lookup failed:', err.message);
    return null;
  }
}

/**
 * Get a job with its full description (loaded on-demand).
 * The list index carries only a short preview; this merges in the description,
 * structured description and apply URL from the job's detail shard.
 *
 * @param {Object} indexJob - Job from the index (may lack description)
 * @returns {Promise<Object>} - Job with full description
 */
export async function getFullJob(indexJob) {
  if (!indexJob) return null;
  // If the job already has a full description, return as-is
  if (indexJob.description && !indexJob.descriptionPreview) return indexJob;

  try {
    const manifest = await loadJobsManifest();
    const shard = await loadDetailShard(manifest, indexJob.id);
    const detail = shard[indexJob.id];
    if (detail) {
      return {
        ...indexJob,
        description: detail.description,
        structuredDescription: detail.structuredDescription,
        url: detail.url,
      };
    }
  } catch (err) {
    console.error('[useJobs] Error loading job detail:', err);
  }
  return indexJob;
}

export function getJobsByCompany(jobs, companySlug) {
  return jobs.filter(job => {
    const canonical = normalizeCompanyName(job.company);
    return companyToSlug(canonical) === companySlug;
  });
}

export async function getSimilarJobs(jobs, currentJob, limit = 5) {
  if (!currentJob) return [];

  // Priority 1: Same company (using normalized names so variants are grouped)
  const currentCanonical = normalizeCompanyName(currentJob.company);
  const sameCompany = jobs.filter(job =>
    job.id !== currentJob.id &&
    normalizeCompanyName(job.company) === currentCanonical
  );

  if (sameCompany.length >= limit) {
    return sameCompany.slice(0, limit);
  }

  // Priority 2: Same location or overlapping skills
  const { getAllLocationsAsync } = await import('../utils/locationParser');
  const currentJobLocations = await getAllLocationsAsync(currentJob.location);

  // Pre-compute locations for all candidate jobs
  const candidateJobs = jobs.filter(job => job.id !== currentJob.id && normalizeCompanyName(job.company) !== currentCanonical);
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
  // Normalize names so variants are deduplicated
  const activeJobs = jobs.filter(job => job.status !== 'removed' && job.status !== 'paused');
  const companies = [...new Set(activeJobs.map(job => normalizeCompanyName(job.company)))];
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
  // Normalize names so variants are grouped together
  jobs.forEach(job => {
    // Skip inactive jobs
    if (job.status === 'removed' || job.status === 'paused') {
      return;
    }

    if (job.company) {
      const canonical = normalizeCompanyName(job.company);
      companyCounts[canonical] = (companyCounts[canonical] || 0) + 1;
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

  // Whitelist approach: ONLY count energy/trades/field-specific skills for popular pills.
  // This is more robust than a blacklist because new generic skills (Excel, Python, etc.)
  // won't leak through. Only skills meaningful to energy sector job seekers appear as pills.
  const ENERGY_PILLS_WHITELIST = new Set([
    // Engineering disciplines
    'petroleum engineering', 'subsea engineering', 'pipeline engineering',
    'drilling engineering', 'completions engineering', 'production engineering',
    'process engineering', 'reservoir engineering', 'chemical engineering',
    'mechanical engineering', 'electrical engineering', 'civil engineering',
    'structural engineering', 'controls engineering', 'facilities engineering',
    'marine engineering', 'environmental engineering', 'nuclear engineering',
    'automation engineering', 'aerospace engineering', 'industrial engineering',

    // Technical/trades
    'welding', 'fabrication', 'machining', 'soldering', 'brazing',
    'pipefitting', 'rigging', 'scaffolding', 'electrical wiring',
    'instrumentation', 'calibration', 'inspection', 'ndt',
    'non-destructive testing', 'pressure testing', 'commissioning',
    'decommissioning', 'hot work', 'confined space entry',

    // Operations
    'drilling', 'completions', 'production operations', 'well testing',
    'well intervention', 'workover', 'artificial lift',
    'subsea operations', 'pipeline operations', 'offshore operations',
    'onshore operations', 'upstream operations', 'midstream operations',
    'downstream operations', 'refinery operations', 'lng',
    'power generation', 'renewable energy', 'solar energy', 'wind energy',
    'grid operations', 'transmission', 'distribution',
    'feed', 'epc', 'turnaround',

    // Geoscience
    'geoscience', 'geology', 'geophysics', 'petrophysics',
    'seismic interpretation', 'reservoir simulation',

    // Safety
    'hse', 'safety management', 'environmental management',
    'process safety', 'occupational safety', 'incident investigation',
    'risk assessment', 'hazard analysis', 'permit to work',
    'lockout tagout', 'emergency response', 'fire safety',

    // Management (energy-relevant)
    'project management', 'construction management',
    'maintenance management', 'operations management',
    'asset management', 'contract management',
    'project controls', 'cost estimation',

    // Tools (energy-specific)
    'scada', 'plc', 'dcs', 'autocad', 'caesar ii',
    'aspen hysys', 'primavera', 'gis', 'arcgis',
    'pdms', 'e3d', 'sp3d', 'smartplant',
    'solidworks', 'revit', 'microstation',
    'staad pro', 'etabs', 'ansys', 'maximo',

    // Standards
    'api standards', 'asme standards', 'iso standards', 'nfpa',

    // Construction and trades
    'crane operations', 'heavy equipment operation', 'carpentry',
    'plumbing', 'hvac', 'refrigeration', 'boiler operations',
    'hydraulics', 'pneumatics',

    // Maintenance
    'mechanical maintenance', 'electrical maintenance',
    'preventive maintenance', 'predictive maintenance',
    'reliability engineering',

    // Quality and improvement (energy-relevant)
    'quality management', 'lean', 'six sigma',
    'root cause analysis', 'regulatory compliance',
    'risk management',
  ].map(s => s.toLowerCase()));

  const skillCounts = {};

  // Only count ACTIVE jobs (exclude removed/paused jobs)
  jobs.forEach(job => {
    // Skip inactive jobs
    if (job.status === 'removed' || job.status === 'paused') {
      return;
    }

    const validSkills = filterValidSkills(job.skills);
    validSkills.forEach(skill => {
      // Only count energy-specific skills for popular pills
      if (!ENERGY_PILLS_WHITELIST.has(skill.toLowerCase())) return;
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
  const { matchEnergyRole } = await import('../utils/energyJobMatcher');
  const mappings = await loadOccupationMappings();
  const roleCounts = {};

  // Only count ACTIVE jobs (exclude removed/paused jobs)
  jobs.forEach(job => {
    // Skip inactive jobs
    if (job.status === 'removed' || job.status === 'paused') {
      return;
    }

    let roleId = null;

    // First try: pre-computed occupation mappings (AI-enhanced, from job-occupations.json)
    const mapping = mappings[job.id];
    if (mapping) {
      if (mapping.role_id) {
        roleId = mapping.role_id;
      } else if (mapping.onet_code) {
        const role = getEnergyRole(mapping.onet_code);
        roleId = role.id;
      }
    }

    // Fallback: keyword-based matching for unmapped jobs
    if (!roleId) {
      const keywordMatch = matchEnergyRole(job.title, '');
      if (keywordMatch) {
        roleId = keywordMatch.roleId;
      }
    }

    if (!roleId) return;

    // Ensure this role exists in ENERGY_ROLES
    if (!ENERGY_ROLES[roleId]) return;

    roleCounts[roleId] = (roleCounts[roleId] || 0) + 1;
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
  const { matchEnergyRole } = await import('../utils/energyJobMatcher');
  const mappings = await loadOccupationMappings();

  // Normalize to array
  const roleIdsArray = Array.isArray(roleIds) ? roleIds : [roleIds];

  return jobs.filter(job => {
    let roleId = null;

    // First try: pre-computed occupation mappings
    const mapping = mappings[job.id];
    if (mapping) {
      if (mapping.role_id) {
        roleId = mapping.role_id;
      } else if (mapping.onet_code) {
        const role = getEnergyRole(mapping.onet_code);
        roleId = role.id;
      }
    }

    // Fallback: keyword-based matching for unmapped jobs
    if (!roleId) {
      const keywordMatch = matchEnergyRole(job.title, '');
      if (keywordMatch) {
        roleId = keywordMatch.roleId;
      }
    }

    if (!roleId) return false;

    return roleIdsArray.includes(roleId);
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
