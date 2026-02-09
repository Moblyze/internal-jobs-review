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
  const companySlug = company.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  const titleSlug = title.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .substring(0, 100); // Limit title length in URL

  return `${companySlug}-${titleSlug}`;
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
  // Find all jobs that match the slug
  const matches = jobs.filter(job => {
    const expectedSlug = jobToSlug(job.company, job.title);
    return expectedSlug === slug;
  });

  // Return first match (or null if no matches)
  // If multiple jobs have identical company+title, return the first one
  return matches.length > 0 ? matches[0] : null;
}
