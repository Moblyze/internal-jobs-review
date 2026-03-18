import { companyToSlug } from './formatters';
import { normalizeCompanyName, loadBrandVariations } from './companyNormalizer';

// Cache for company intelligence data
let companyIntelligence = null;
let companyIntelligencePromise = null;

/**
 * Load static company intelligence data from companies.json
 * Cached after first load.
 */
export async function loadCompanyIntelligence() {
  if (companyIntelligence) return companyIntelligence;
  if (companyIntelligencePromise) return companyIntelligencePromise;

  companyIntelligencePromise = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/companies.json`);
      if (!res.ok) {
        console.warn('[companyData] companies.json not found');
        companyIntelligence = {};
        return companyIntelligence;
      }
      const data = await res.json();

      // Feed brand variations into the company normalizer
      const companies = data.companies || [];
      loadBrandVariations(companies);

      // Index by slug for fast lookup
      const indexed = {};
      companies.forEach(company => {
        const slug = companyToSlug(company.name);
        indexed[slug] = company;

        // Also index by brand variations
        (company.brandVariations || []).forEach(variation => {
          const varSlug = companyToSlug(variation);
          if (!indexed[varSlug]) {
            indexed[varSlug] = company;
          }
        });

        // Also index by normalized name slug (so company detail pages resolve)
        const normalizedSlug = companyToSlug(normalizeCompanyName(company.name));
        if (!indexed[normalizedSlug]) {
          indexed[normalizedSlug] = company;
        }
      });

      companyIntelligence = indexed;
      return companyIntelligence;
    } catch (err) {
      console.warn('[companyData] Failed to load company intelligence:', err);
      companyIntelligence = {};
      return companyIntelligence;
    }
  })();

  return companyIntelligencePromise;
}

/**
 * Aggregate company stats from jobs data.
 * Returns an array of company objects sorted by active job count descending.
 */
export function getCompanyStats(jobs) {
  const companyMap = {};

  jobs.forEach(job => {
    if (!job.company) return;

    // Normalize company name to group variants together
    const canonical = normalizeCompanyName(job.company);
    const slug = companyToSlug(canonical);

    if (!companyMap[slug]) {
      companyMap[slug] = {
        name: canonical,
        slug,
        aliases: new Set(),
        totalJobs: 0,
        activeJobs: 0,
        inactiveJobs: 0,
        locations: new Set(),
        employmentTypes: new Set(),
        sources: new Set(),
        sourceCounts: {},
      };
    }

    const entry = companyMap[slug];
    if (!entry) return; // Safety check

    // Ensure Sets exist (defensive against partial initialization)
    if (!entry.aliases) entry.aliases = new Set();
    if (!entry.locations) entry.locations = new Set();
    if (!entry.employmentTypes) entry.employmentTypes = new Set();
    if (!entry.sources) entry.sources = new Set();

    // Track the raw name variant if it differs from the canonical
    if (job.company !== canonical) {
      entry.aliases.add(job.company);
    }
    entry.totalJobs++;

    const isInactive = job.status === 'removed' || job.status === 'paused';
    if (isInactive) {
      entry.inactiveJobs++;
    } else {
      entry.activeJobs++;
    }

    if (job.location) {
      entry.locations.add(job.location);
    }
    if (job.employmentType) {
      entry.employmentTypes.add(job.employmentType);
    }
    const src = job.source || 'direct';
    entry.sources.add(src);
    entry.sourceCounts[src] = (entry.sourceCounts[src] || 0) + 1;
  });

  // Convert sets to arrays and sort by active job count
  return Object.values(companyMap)
    .map(c => ({
      ...c,
      aliases: c.aliases ? [...c.aliases] : [],
      locations: c.locations ? [...c.locations] : [],
      employmentTypes: c.employmentTypes ? [...c.employmentTypes] : [],
      sources: c.sources ? [...c.sources] : [],
      sourceCounts: c.sourceCounts
        ? Object.entries(c.sourceCounts)
            .sort((a, b) => b[1] - a[1])
            .reduce((obj, [source, count]) => { obj[source] = count; return obj; }, {})
        : {},
    }))
    .sort((a, b) => b.activeJobs - a.activeJobs);
}

/**
 * Get detailed info for a single company by slug.
 * Combines jobs data stats with intelligence data if available.
 */
export function getCompanyDetail(companySlug, jobs) {
  // Match jobs by normalised slug so that all variants are grouped together
  const companyJobs = jobs.filter(job => {
    const canonical = normalizeCompanyName(job.company);
    return companyToSlug(canonical) === companySlug;
  });

  if (companyJobs.length === 0) return null;

  // Use the canonical name, not the first raw variant
  const name = normalizeCompanyName(companyJobs[0].company);
  const rawNames = new Set(companyJobs.map(j => j.company));
  const aliases = [...rawNames].filter(n => n !== name);

  // Aggregate stats
  let activeJobs = 0;
  let inactiveJobs = 0;
  const locationCounts = {};
  const employmentTypeCounts = {};
  const sourceCounts = {};

  companyJobs.forEach(job => {
    const isInactive = job.status === 'removed' || job.status === 'paused';
    if (isInactive) {
      inactiveJobs++;
    } else {
      activeJobs++;
    }

    if (job.location) {
      locationCounts[job.location] = (locationCounts[job.location] || 0) + 1;
    }
    if (job.employmentType) {
      employmentTypeCounts[job.employmentType] = (employmentTypeCounts[job.employmentType] || 0) + 1;
    }
    const src = job.source || 'direct';
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  });

  // Sort locations by count
  const topLocations = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([location, count]) => ({ location, count }));

  // Sort employment types by count
  const employmentTypes = Object.entries(employmentTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));

  // Sort sources by count
  const sources = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ source, count }));

  return {
    name,
    slug: companySlug,
    aliases,
    totalJobs: companyJobs.length,
    activeJobs,
    inactiveJobs,
    topLocations,
    employmentTypes,
    sources,
    jobs: companyJobs,
  };
}

/**
 * Get ATS platform breakdown across all companies with intelligence data.
 * Returns { platformName: count } for companies that have intelligence.
 */
/**
 * Get comparison data for multiple companies.
 * Returns an array of enriched company objects with full detail + intelligence.
 */
export function getComparisonData(slugs, jobs, intelligence) {
  return slugs.map(slug => {
    const detail = getCompanyDetail(slug, jobs)
    const intel = intelligence[slug] || null
    return { ...detail, intel }
  }).filter(Boolean)
}

/**
 * Get aggregate source overview across all companies.
 * Returns { totalSources, sourceTotals: [{ source, jobCount, companyCount }] }
 */
export function getSourcesOverview(companyStats) {
  const sourceJobCounts = {};
  const sourceCompanyCounts = {};

  companyStats.forEach(company => {
    Object.entries(company.sourceCounts || {}).forEach(([source, count]) => {
      sourceJobCounts[source] = (sourceJobCounts[source] || 0) + count;
      sourceCompanyCounts[source] = (sourceCompanyCounts[source] || 0) + 1;
    });
  });

  const sourceTotals = Object.keys(sourceJobCounts)
    .map(source => ({
      source,
      jobCount: sourceJobCounts[source],
      companyCount: sourceCompanyCounts[source],
    }))
    .sort((a, b) => b.jobCount - a.jobCount);

  return {
    totalSources: sourceTotals.length,
    sourceTotals,
  };
}

export function getATSBreakdown(companyStats, intelligence) {
  const platforms = {};

  companyStats.forEach(company => {
    const intel = intelligence[company.slug];
    if (intel && intel.ats) {
      intel.ats.forEach(ats => {
        const platform = ats.platform;
        platforms[platform] = (platforms[platform] || 0) + 1;
      });
    }
  });

  return Object.entries(platforms)
    .sort((a, b) => b[1] - a[1])
    .map(([platform, count]) => ({ platform, count }));
}
