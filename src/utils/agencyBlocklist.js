/**
 * Agency Blocklist
 *
 * Recruitment agencies whose jobs mask the end employer.
 * Jobs from these agencies are hidden by default but can be
 * toggled on via the "Show Agency Jobs" filter.
 *
 * Maintained by the business development team.
 * Last updated: 2026-04-07
 */

export const AGENCY_BLOCKLIST = [
  'ERSG',
  'Major Energy',
  'PRS Jobs',
  'WTS Energy',
  'Technova Global',
  'AP GlobalEnergy',
  'Adecco',
  'Kinekta',
  'LSP Renewables',
  'Climate17',
  'Orion Group',
  'Scantec',
  'EnergeiaWorks',
  'Pender & Howe',
  'CSI Executive Search',
  'Alpha Apex Group',
  'Mangrum Career Solutions',
  'Lock Search Group',
  'Brunel',
  'NES Fircroft',
  'Spencer Ogden',
  'Airswift',
  'Petroplan',
  'Leap29',
  'Atlas Professionals',
  'Faststream Recruitment',
  'EWI Recruitment',
  'Select Offshore',
  'Worldwide Recruitment Solutions',
  'Taylor Hopkinson',
  'Green Recruitment Company',
  'JD Ross Energy',
  'EarthStream',
  'Pangea Talent Solutions',
  'Cathcart Energy',
  'Viridium Associates',
  'Navitas Resourcing Group',
  'Amoria Bond',
  'iO Associates',
  'Progressive Recruitment',
  'Huxley',
  'Computer Futures',
  'Rullion',
  'Matchtech',
  'Gold Group',
  'System One',
  'Insight Global',
  'Kelly Services',
  'Randstad Engineering',
  'Manpower Engineering',
  'Petro Staff International',
  'Swift Worldwide Resources',
  'TRS Staffing Solutions',
  'Fuschia Careers',
  'First Recruitment Group',
  'Topaz Energy Recruitment',
  'BOSS Energy Consulting',
  'Green Folk',
  'Piper Maddox',
  'Storm4',
  'Hyperion Executive Search',
  'Circular Talent',
  'NextWave Partners',
  'Brightsmith',
  'Net Zero Evolution',
  'Eden Scott',
  'Change Recruitment Group',
  'Connect Appointments',
  'DPS Group',
  'ENG Bauen',
  'Walker Lovell',
  'Samuel Knight International',
  'Consortio Recruitment Group',
  'Redfish Solutions',
  'Core Group Resources',
  'G.A.S. Global',
  'Craft & Technical Solutions',
  'Aerotek',
  'Entech Technical Solutions',
  'PE Global',
  'Quanta Consultancy Services',
  'Clear Edge Consulting',
  'Advance Global Recruitment',
  'Ably Resources',
  'Adept Resourcing',
  'Thor Companies',
  'DSJ Global',
  'Petro-Hunt Talent',
  'Hire Velocity',
  'Talascend',
  'ResourceMFG',
  'NES Advantage Solutions',
  'Nordic Energy Recruitment',
  'Energy People',
  'Power People',
  'Eligo Recruitment',
  'Opus Talent Solutions',
  'Spartan Offshore',
  'Global Resources Network',
  'Offshore Recruitment Services',
  'Energy Search Associates',
  'JAB Recruitment',
  'Mercury Hampton',
  'Artemis Human Capital',
  'Hunter Philips',
  'Mackinnon Bruce International',
  'Parkside Recruitment',
  'Acorn by Synergie',
  'Gap Technical',
  'E3 Recruitment',
  'ATA Recruitment',
  'Energy Talent Company',
  'Quanta Resources',
  'Global Edge Consultants',
  'Petro Staff',
  'Oil Consultants',
  'Taylor Technical Services',
  'BHI Energy',
  'Day & Zimmermann',
  'Quest Energy Group',
  'OneSource Professional Search',
  'Nexus Staffing Solutions',
  'Sirius Technical Services',
  'Longhorn Energy & Transportation Advisors',
  'Workrise',
  'RigUp',
  'X4 Group',
  'Optimus Search',
  'Darwin Recruitment',
]

// ── Pre-built lookup set for fast matching ──────────────────────────────────

/**
 * Normalize an agency name for matching: lowercase, strip common suffixes,
 * replace punctuation with spaces, collapse whitespace.
 */
function normalizeForMatch(name) {
  let n = name.toLowerCase().trim()
  // Strip common corporate suffixes
  const suffixes = [
    ' us, inc.', ', inc.', ' inc.', ', inc', ' inc',
    ', ltd.', ' ltd.', ', ltd', ' ltd',
    ', llc', ' llc', ' limited', ', limited',
    ' plc', ', plc', ' group', ', group',
  ]
  for (const suffix of suffixes) {
    if (n.endsWith(suffix)) {
      n = n.slice(0, -suffix.length).trim()
      break
    }
  }
  // Replace punctuation with spaces (preserve word boundaries)
  n = n.replace(/[^\w\s&]/g, ' ').replace(/\s+/g, ' ').trim()
  return n
}

// Build the lookup set once at module load
const _normalizedSet = new Set(AGENCY_BLOCKLIST.map(normalizeForMatch))

// Also build word-boundary patterns for substring matching (agencies with 4+ char names)
const _patterns = AGENCY_BLOCKLIST
  .map(name => ({ name, norm: normalizeForMatch(name) }))
  .filter(({ norm }) => norm.length >= 4)
  .map(({ name, norm }) => ({
    name,
    regex: new RegExp('\\b' + norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'),
  }))

/**
 * Check if a company name matches any agency on the blocklist.
 *
 * @param {string} companyName - Raw company name from a job posting
 * @returns {{ isAgency: boolean, matchedAgency: string|null }}
 */
export function checkAgency(companyName) {
  if (!companyName) return { isAgency: false, matchedAgency: null }

  const norm = normalizeForMatch(companyName)

  // 1. Exact match after normalization
  if (_normalizedSet.has(norm)) {
    return { isAgency: true, matchedAgency: companyName }
  }

  // 2. Word-boundary substring match
  for (const { name, regex } of _patterns) {
    if (regex.test(norm)) {
      return { isAgency: true, matchedAgency: name }
    }
  }

  return { isAgency: false, matchedAgency: null }
}

/**
 * Check if a job is from a blocked agency.
 * Convenience wrapper for use in filter pipelines.
 *
 * @param {Object} job - Job object with a `company` field
 * @returns {boolean}
 */
export function isAgencyJob(job) {
  return checkAgency(job?.company).isAgency
}
