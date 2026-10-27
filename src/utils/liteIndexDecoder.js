/**
 * Lite Index Decoder
 *
 * Decodes the dictionary-encoded jobs-index-lite.json back into
 * full job objects compatible with the existing codebase.
 *
 * The lite format uses numeric indices for companies, skills, and locations
 * to reduce the JSON payload from ~45MB to ~17MB.
 *
 * Format:
 *   { skills: [...], companies: [...], locations: [...], ids: [...], jobs: [...] }
 *
 * Job entry short keys:
 *   t=title, c=companyIdx, l=locationIdx, s=status (omitted if 'active'),
 *   k=skillIndices[], e=employmentType, sr=source, p=profile, a=appReady,
 *   cr=certifications[], d=descriptionPreview, sa=salary, pd=postedDate
 *
 * Build-time facets (v2, scripts/build-site-facets.mjs):
 *   lo=parsed location indices (into `locs`), kv=validated skill indices (into
 *   `validSkills`), ro=role index (into `roles`), ag=agency flag, mk=content markets[]
 */

/**
 * Decode a lite index payload into an array of job objects.
 *
 * @param {Object} liteData - The parsed jobs-index-lite.json
 * @returns {Array} Array of job objects with full string values
 */
export function decodeLiteIndex(liteData) {
  const { skills, companies, locations, ids, jobs } = liteData;
  const locs = liteData.locs || [];
  const validSkills = liteData.validSkills || [];
  const roles = liteData.roles || [];

  return jobs.map((entry, idx) => {
    const job = {
      id: ids[idx],
      title: entry.t,
      company: entry.c >= 0 ? companies[entry.c] : '',
      location: entry.l >= 0 ? locations[entry.l] : '',
      status: entry.s || 'active',
    };

    // Decode dictionary-encoded skills back to strings
    if (entry.k) {
      job.skills = entry.k.map(i => skills[i]);
    } else {
      job.skills = [];
    }

    // Categorical fields
    if (entry.e) job.employmentType = entry.e;
    if (entry.sr) job.source = entry.sr;
    if (entry.st) job.sourceTab = entry.st;
    if (entry.p) job.profile = entry.p;
    if (entry.a) job.appReady = true;

    // Certifications
    if (entry.cr) job.extractedCertifications = entry.cr;

    // Display fields for JobCard
    if (entry.d) job.descriptionPreview = entry.d;
    if (entry.sa) job.salary = entry.sa;
    if (entry.pd) job.postedDate = entry.pd;

    // Precomputed facets
    job.locs = entry.lo ? entry.lo.map(i => locs[i]) : [];
    job.validSkills = entry.kv ? entry.kv.map(i => validSkills[i]) : [];
    if (entry.ro !== undefined) job.roleId = roles[entry.ro];
    if (entry.ag) job.isAgency = true;
    if (entry.mk) job.markets = entry.mk;

    return job;
  });
}

/**
 * Extract the skill dictionary from the lite index data.
 * Useful for building filter options without decoding all jobs.
 *
 * @param {Object} liteData - The parsed jobs-index-lite.json
 * @returns {string[]} Array of all unique skill strings
 */
export function getSkillDictionary(liteData) {
  return liteData.skills || [];
}

/**
 * Extract the company dictionary from the lite index data.
 *
 * @param {Object} liteData - The parsed jobs-index-lite.json
 * @returns {string[]} Array of all unique company names
 */
export function getCompanyDictionary(liteData) {
  return liteData.companies || [];
}
