/**
 * Professional Energy Industry Certification Extractor
 *
 * Extracts ONLY real, verifiable certifications from job postings.
 * Filters out sentences, job requirements, and generic mentions.
 *
 * Focus: Oil & Gas, Energy, Safety, Maritime, and Skilled Trades
 */

// Official certification mappings with variations
const CERTIFICATION_DATABASE = {
  // ==================== API CERTIFICATIONS ====================
  'API 510': {
    patterns: [/\bAPI[\s-]*510\b/gi],
    category: 'api'
  },
  'API 570': {
    patterns: [/\bAPI[\s-]*570\b/gi],
    category: 'api'
  },
  'API 653': {
    patterns: [/\bAPI[\s-]*653\b/gi],
    category: 'api'
  },
  'API 571': {
    patterns: [/\bAPI[\s-]*571\b/gi],
    category: 'api'
  },
  'API 580': {
    patterns: [/\bAPI[\s-]*580\b/gi],
    category: 'api'
  },
  'API 1169': {
    patterns: [/\bAPI[\s-]*1169\b/gi],
    category: 'api'
  },

  // ==================== WELL CONTROL ====================
  'IADC WellSharp': {
    patterns: [
      /\bIADC[\s-]*WellSharp\b/gi,
      /\bWellSharp\b/gi,
      /\bWell[\s-]*Control[\s-]*Certif/gi
    ],
    category: 'well_control'
  },
  'IWCF': {
    patterns: [/\bIWCF\b/gi],
    category: 'well_control'
  },

  // ==================== OFFSHORE SURVIVAL ====================
  'BOSIET': {
    patterns: [/\bBOSIET\b/gi, /\bT-BOSIET\b/gi],
    category: 'offshore_survival'
  },
  'HUET': {
    patterns: [/\bHUET\b/gi],
    category: 'offshore_survival'
  },
  'FOET': {
    patterns: [/\bFOET\b/gi],
    category: 'offshore_survival'
  },

  // ==================== CORROSION ====================
  'NACE CIP': {
    patterns: [/\bNACE[\s-]*CIP[\s-]*[1-4]?\b/gi],
    category: 'corrosion'
  },
  'NACE CP': {
    patterns: [/\bNACE[\s-]*CP[\s-]*[1-4]?\b/gi],
    category: 'corrosion'
  },

  // ==================== RIGGING & LIFTING ====================
  'Rigger Certification': {
    patterns: [
      /\bRigger[\s-]*Level[\s-]*[1-3]\b/gi,
      /\bCertified[\s-]*Rigger\b/gi
    ],
    category: 'rigging'
  },
  'Signal Person': {
    patterns: [/\bSignal[\s-]*Person\b/gi],
    category: 'rigging'
  },

  // ==================== CRANE ====================
  'NCCCO Crane Operator': {
    patterns: [
      /\bNCCCO\b/gi,
      /\bCrane[\s-]*Operator[\s-]*Certif/gi,
      /\bCCO\b/gi
    ],
    category: 'crane'
  },

  // ==================== WELDING ====================
  'CWI': {
    patterns: [
      /\bCWI\b/gi,
      /\bCertified[\s-]*Welding[\s-]*Inspector\b/gi
    ],
    category: 'welding'
  },
  'CWB': {
    patterns: [/\bCWB\b/gi],
    category: 'welding'
  },
  'AWS Certification': {
    patterns: [/\bAWS[\s-]*Certif/gi],
    category: 'welding'
  },

  // ==================== SAFETY ====================
  'OSHA 10': {
    patterns: [/\bOSHA[\s-]*10[\s-]*hour\b/gi, /\bOSHA[\s-]*10\b/gi],
    category: 'safety'
  },
  'OSHA 30': {
    patterns: [/\bOSHA[\s-]*30[\s-]*hour\b/gi, /\bOSHA[\s-]*30\b/gi],
    category: 'safety'
  },
  'OSHA 40': {
    patterns: [/\bOSHA[\s-]*40[\s-]*hour\b/gi, /\bOSHA[\s-]*40\b/gi],
    category: 'safety'
  },
  'HAZMAT': {
    patterns: [/\bHAZMAT\b/gi, /\bHazardous[\s-]*Materials[\s-]*Certif/gi],
    category: 'safety'
  },
  'HAZWOPER': {
    patterns: [
      /\bHAZWOPER\b/gi,
      /\bHAZWOPER[\s-]*24\b/gi,
      /\bHAZWOPER[\s-]*40\b/gi
    ],
    category: 'safety'
  },
  'H2S': {
    patterns: [
      /\bH2S[\s-]*Alive\b/gi,
      /\bH2S[\s-]*Clear\b/gi,
      /\bH2S[\s-]*Safety\b/gi
    ],
    category: 'safety'
  },

  // ==================== FIRST AID ====================
  'CPR/First Aid': {
    patterns: [
      /\bCPR[\s\/]*First[\s-]*Aid\b/gi,
      /\bCPR\b/gi,
      /\bFirst[\s-]*Aid[\s-]*Certif/gi,
      /\bBLS\b/gi
    ],
    category: 'first_aid'
  },
  'AED': {
    patterns: [/\bAED[\s-]*Certif/gi],
    category: 'first_aid'
  },

  // ==================== MARITIME ====================
  'USCG License': {
    patterns: [
      /\bUSCG[\s-]*[\w\s]*License\b/gi,
      /\bUSCG[\s-]*Master\b/gi,
      /\bUSCG[\s-]*Chief[\s-]*Engineer\b/gi
    ],
    category: 'maritime'
  },
  'DPO': {
    patterns: [
      /\bDPO\b/gi,
      /\bDynamic[\s-]*Positioning[\s-]*Operator\b/gi
    ],
    category: 'maritime'
  },
  'STCW': {
    patterns: [/\bSTCW\b/gi],
    category: 'maritime'
  },

  // ==================== PROFESSIONAL ====================
  'PE License': {
    patterns: [
      /\bPE[\s-]*License\b/gi,
      /\bP\.E\.[\s-]*License\b/gi,
      /\bProfessional[\s-]*Engineer[\s-]*License\b/gi
    ],
    category: 'professional'
  },
  'PMP': {
    patterns: [
      /\bPMP\b/gi,
      /\bProject[\s-]*Management[\s-]*Professional\b/gi
    ],
    category: 'professional'
  },
  'Six Sigma': {
    patterns: [
      /\bSix[\s-]*Sigma[\s-]*Green[\s-]*Belt\b/gi,
      /\bSix[\s-]*Sigma[\s-]*Black[\s-]*Belt\b/gi,
      /\bLean[\s-]*Six[\s-]*Sigma\b/gi
    ],
    category: 'professional'
  },
  'CDL': {
    patterns: [
      /\bCDL\b/gi,
      /\bClass[\s-]*[ABC][\s-]*CDL\b/gi,
      /\bCommercial[\s-]*Driver'?s?[\s-]*License\b/gi
    ],
    category: 'professional'
  },

  // ==================== TRADES ====================
  'Master Electrician': {
    patterns: [/\bMaster[\s-]*Electrician\b/gi],
    category: 'trades'
  },
  'Journeyman Electrician': {
    patterns: [/\bJourneyman[\s-]*Electrician\b/gi],
    category: 'trades'
  },
  'EPA 608': {
    patterns: [/\bEPA[\s-]*608\b/gi],
    category: 'trades'
  },
  'Forklift Operator': {
    patterns: [
      /\bForklift[\s-]*Operator\b/gi,
      /\bForklift[\s-]*Certif/gi,
      /\bForklift[\s-]*License\b/gi
    ],
    category: 'trades'
  },

  // ==================== INDUSTRY BODIES ====================
  'IADC': {
    patterns: [/\bIADC[\s-]*Certif/gi],
    category: 'industry'
  },
  'IMCA': {
    patterns: [/\bIMCA[\s-]*Certif/gi],
    category: 'industry'
  },
  'NICET': {
    patterns: [/\bNICET\b/gi],
    category: 'industry'
  }
}

/**
 * Get the sentence/line containing a match
 * Looks for sentence boundaries (periods, newlines, line breaks)
 */
function extractSentence(text, matchIndex, matchLength) {
  // Find the start of the sentence (period or newline before)
  let start = matchIndex
  while (start > 0) {
    const char = text[start - 1]
    if (char === '.' || char === '\n' || char === '\r') {
      break
    }
    start--
    // Don't go back more than 200 chars (definitely not the same sentence)
    if (matchIndex - start > 200) break
  }

  // Find the end of the sentence (period or newline after)
  let end = matchIndex + matchLength
  while (end < text.length) {
    const char = text[end]
    if (char === '.' || char === '\n' || char === '\r') {
      end++  // Include the period
      break
    }
    end++
    // Don't go forward more than 200 chars
    if (end - (matchIndex + matchLength) > 200) break
  }

  return text.substring(start, end).trim()
}

/**
 * Check if a sentence is describing job duties (not a certification requirement)
 * Examples:
 *   "You will manage the project" - YES (duty)
 *   "PE License required" - NO (cert requirement)
 *   "Oversee the data infrastructure" - YES (duty)
 */
function isJobDutyDescription(sentence) {
  // Duty verbs that indicate this is describing what the person DOES
  const dutyVerbs = /\b(oversee|overseeing|manage|managing|ensure|ensuring|develop|developing|coordinate|coordinating|implement|implementing|maintain|maintaining|support|supporting|provide|providing|lead|leading|drive|driving|perform|performing|execute|executing|deliver|delivering|create|creating|build|building)\b/i

  // Subject patterns that indicate job duties
  const dutySubjects = /\b(you\s+will|your\s+responsibilities|responsibilities\s+include|duties\s+include|tasks\s+include)\b/i

  return dutyVerbs.test(sentence) || dutySubjects.test(sentence)
}

/**
 * Check if a sentence is about degree requirements (not certifications)
 */
function isDegreeRequirement(sentence) {
  return /\b(bachelor|master|engineering|science|business)\s+(degree|diploma)\b/i.test(sentence)
}

/**
 * Check if a sentence is too long/complex (likely not a simple cert requirement)
 */
function isLongSentence(sentence) {
  // If sentence is > 150 chars and has multiple clauses, it's probably noise
  if (sentence.length > 150 && (sentence.match(/,/g) || []).length > 2) {
    return true
  }
  return false
}

/**
 * Extract certifications from text using strict filtering
 */
function extractCertifications(text) {
  if (!text || typeof text !== 'string') return []

  const certifications = new Set()

  // Try each certification pattern
  for (const [certName, config] of Object.entries(CERTIFICATION_DATABASE)) {
    for (const pattern of config.patterns) {
      // Find all matches with their positions
      let match
      const regex = new RegExp(pattern.source, pattern.flags)

      while ((match = regex.exec(text)) !== null) {
        const matchText = match[0]
        const matchIndex = match.index

        // Extract the sentence containing this match
        const sentence = extractSentence(text, matchIndex, matchText.length)

        // Apply filters based on the SENTENCE, not nearby context
        // 1. Skip if it's describing job duties
        if (isJobDutyDescription(sentence)) continue

        // 2. Skip if it's about degree requirements
        if (isDegreeRequirement(sentence)) continue

        // 3. Skip if it's too long/complex
        if (isLongSentence(sentence)) continue

        // Passed all filters - this is a real certification
        certifications.add(certName)

        // Move past this match to avoid infinite loop
        if (!pattern.global) break
      }
    }
  }

  return Array.from(certifications)
}

/**
 * Extract certifications from a job object
 * @param {Object} job - Job object with description and skills
 * @returns {string[]} - Array of unique certification names
 */
export function extractJobCertifications(job) {
  if (!job) return []

  const certifications = new Set()

  // Extract from description
  if (job.description) {
    const descCerts = extractCertifications(job.description)
    descCerts.forEach(cert => certifications.add(cert))
  }

  // Extract from skills array
  // NOTE: Skills are often already noise (sentences, duties, etc.)
  // The extractCertifications function will handle filtering
  if (Array.isArray(job.skills)) {
    job.skills.forEach(skill => {
      const skillCerts = extractCertifications(skill)
      skillCerts.forEach(cert => certifications.add(cert))
    })
  }

  return Array.from(certifications).sort()
}

/**
 * Get all unique certifications from an array of jobs
 * @param {Array} jobs - Array of job objects
 * @returns {string[]} - Sorted array of unique certification names
 */
export function getAllCertifications(jobs) {
  if (!Array.isArray(jobs)) return []

  const allCertifications = new Set()

  jobs.forEach(job => {
    const jobCerts = extractJobCertifications(job)
    jobCerts.forEach(cert => allCertifications.add(cert))
  })

  return Array.from(allCertifications).sort()
}

/**
 * Get certifications by category
 * @param {string[]} certifications - Array of certification names
 * @returns {Object} - Object with certifications grouped by category
 */
export function groupCertificationsByCategory(certifications) {
  const grouped = {}

  certifications.forEach(certName => {
    const config = CERTIFICATION_DATABASE[certName]
    if (config) {
      const category = config.category
      if (!grouped[category]) {
        grouped[category] = []
      }
      grouped[category].push(certName)
    }
  })

  return grouped
}

/**
 * Get all official certifications from the database
 * @returns {string[]} - Sorted array of all certification names
 */
export function getAllOfficialCertifications() {
  return Object.keys(CERTIFICATION_DATABASE).sort()
}

/**
 * Get all certifications with job counts (including zero-count certifications)
 * @param {Array} jobs - Array of job objects
 * @returns {Array} - Array of {name, count} objects sorted by count (desc) then name (asc)
 */
export function getAllCertificationsWithCounts(jobs) {
  if (!Array.isArray(jobs)) return []

  // Count certifications found in jobs
  const certCounts = new Map()

  jobs.forEach(job => {
    const jobCerts = extractJobCertifications(job)
    jobCerts.forEach(cert => {
      certCounts.set(cert, (certCounts.get(cert) || 0) + 1)
    })
  })

  // Get all official certifications and include counts
  const allCerts = getAllOfficialCertifications()
  const certsWithCounts = allCerts.map(certName => ({
    name: certName,
    count: certCounts.get(certName) || 0
  }))

  // Sort: by count descending, then alphabetically
  return certsWithCounts.sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count
    }
    return a.name.localeCompare(b.name)
  })
}
