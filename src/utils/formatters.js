export function formatDate(dateString) {
  if (!dateString) return null;

  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return null;
  }
}

export function timeAgo(dateString) {
  if (!dateString) return null;

  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  } catch {
    return null;
  }
}

export function companyToSlug(company) {
  return company.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export function slugToCompany(slug) {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Generate a URL-friendly slug from company and job title
 * Format: company-name-job-title-words
 * @param {string} company - Company name
 * @param {string} title - Job title
 * @returns {string} URL slug
 */
export function jobToSlug(company, title) {
  if (!company || !title) {
    console.warn('[jobToSlug] Missing company or title:', { company, title });
    return '';
  }

  const companySlug = company
    .trim()                          // Remove leading/trailing whitespace
    .toLowerCase()
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/[^a-z0-9-]/g, '')     // Remove special characters
    .replace(/-+/g, '-')            // Replace consecutive hyphens with single hyphen
    .replace(/^-|-$/g, '');         // Remove leading/trailing hyphens

  const titleSlug = title
    .trim()                          // Remove leading/trailing whitespace
    .toLowerCase()
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/[^a-z0-9-]/g, '')     // Remove special characters
    .replace(/-+/g, '-')            // Replace consecutive hyphens with single hyphen
    .replace(/^-|-$/g, '')          // Remove leading/trailing hyphens
    .substring(0, 100);             // Limit title length in URL

  const slug = `${companySlug}-${titleSlug}`;
  return slug;
}

/**
 * Find a job by its slug
 * Since slugs may not be unique (multiple identical job titles at same company),
 * we match by company and title similarity
 * @param {Array} jobs - Array of all jobs
 * @param {string} slug - The URL slug
 * @returns {object|null} Matched job or null
 */
export function findJobBySlug(jobs, slug) {
  if (!jobs || jobs.length === 0) {
    console.warn('[findJobBySlug] No jobs to search');
    return null;
  }

  if (!slug) {
    console.warn('[findJobBySlug] No slug provided');
    return null;
  }

  // Find all jobs that match the slug
  const matches = jobs.filter(job => {
    const expectedSlug = jobToSlug(job.company, job.title);
    const isMatch = expectedSlug === slug;

    // Debug logging (only for first 3 jobs to avoid spam)
    if (jobs.indexOf(job) < 3 || isMatch) {
      console.log('[findJobBySlug]', isMatch ? '✓ MATCH' : '✗',
        `Expected: "${expectedSlug}" vs URL: "${slug}"`,
        isMatch ? job.title : '');
    }

    return isMatch;
  });

  if (matches.length === 0) {
    console.warn('[findJobBySlug] No job found for slug:', slug);
  } else {
    console.log('[findJobBySlug] ✓ Found job:', matches[0].title);
  }

  // Return first match (or null if no matches)
  // If multiple jobs have identical company+title, return the first one
  return matches.length > 0 ? matches[0] : null;
}
