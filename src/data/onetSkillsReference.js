/**
 * O*NET Skills Reference - Static allowlist for skill validation
 *
 * Contains the complete O*NET taxonomy (skills, knowledge, abilities)
 * plus common energy/engineering industry terms.
 *
 * Used at runtime to filter raw job skills to only valid, clean terms.
 * This file is static - no API calls or rebuilds needed for new jobs.
 */

// Complete O*NET Skills taxonomy (35 items)
const ONET_SKILLS = [
  'Active Learning', 'Active Listening', 'Complex Problem Solving',
  'Coordination', 'Critical Thinking', 'Equipment Maintenance',
  'Equipment Selection', 'Installation', 'Instructing',
  'Judgment and Decision Making', 'Learning Strategies',
  'Management of Financial Resources', 'Management of Material Resources',
  'Management of Personnel Resources', 'Mathematics', 'Monitoring',
  'Negotiation', 'Operation Monitoring', 'Operation and Control',
  'Operations Analysis', 'Persuasion', 'Programming',
  'Quality Control Analysis', 'Reading Comprehension', 'Repairing',
  'Science', 'Service Orientation', 'Social Perceptiveness', 'Speaking',
  'Systems Analysis', 'Systems Evaluation', 'Technology Design',
  'Time Management', 'Troubleshooting', 'Writing',
];

// Complete O*NET Knowledge taxonomy (33 items)
const ONET_KNOWLEDGE = [
  'Administration and Management', 'Biology', 'Building and Construction',
  'Chemistry', 'Clerical', 'Communications and Media',
  'Computers and Electronics', 'Customer and Personal Service', 'Design',
  'Economics and Accounting', 'Education and Training',
  'Engineering and Technology', 'English Language', 'Fine Arts',
  'Food Production', 'Foreign Language', 'Geography',
  'History and Archeology', 'Law and Government', 'Mathematics',
  'Mechanical', 'Medicine and Dentistry', 'Personnel and Human Resources',
  'Philosophy and Theology', 'Physics', 'Production and Processing',
  'Psychology', 'Public Safety and Security', 'Sales and Marketing',
  'Sociology and Anthropology', 'Telecommunications',
  'Therapy and Counseling', 'Transportation',
];

// Complete O*NET Abilities taxonomy (52 items)
const ONET_ABILITIES = [
  'Arm-Hand Steadiness', 'Auditory Attention', 'Category Flexibility',
  'Control Precision', 'Deductive Reasoning', 'Depth Perception',
  'Dynamic Flexibility', 'Dynamic Strength', 'Explosive Strength',
  'Extent Flexibility', 'Far Vision', 'Finger Dexterity',
  'Flexibility of Closure', 'Fluency of Ideas', 'Glare Sensitivity',
  'Gross Body Coordination', 'Gross Body Equilibrium', 'Hearing Sensitivity',
  'Inductive Reasoning', 'Information Ordering', 'Manual Dexterity',
  'Mathematical Reasoning', 'Memorization', 'Multilimb Coordination',
  'Near Vision', 'Night Vision', 'Number Facility', 'Oral Comprehension',
  'Oral Expression', 'Originality', 'Perceptual Speed', 'Peripheral Vision',
  'Problem Sensitivity', 'Rate Control', 'Reaction Time',
  'Response Orientation', 'Selective Attention', 'Sound Localization',
  'Spatial Orientation', 'Speech Clarity', 'Speech Recognition',
  'Speed of Closure', 'Speed of Limb Movement', 'Stamina',
  'Static Strength', 'Time Sharing', 'Trunk Strength',
  'Visual Color Discrimination', 'Visualization', 'Wrist-Finger Speed',
  'Written Comprehension', 'Written Expression',
];

// Energy sector and engineering industry skills
const INDUSTRY_SKILLS = [
  // Engineering disciplines
  'Aerospace Engineering', 'Chemical Engineering', 'Civil Engineering',
  'Electrical Engineering', 'Environmental Engineering',
  'Mechanical Engineering', 'Petroleum Engineering', 'Process Engineering',
  'Structural Engineering', 'Systems Engineering', 'Software Engineering',
  'Industrial Engineering', 'Nuclear Engineering', 'Marine Engineering',
  'Subsea Engineering', 'Pipeline Engineering', 'Reservoir Engineering',
  'Drilling Engineering', 'Completions Engineering', 'Production Engineering',
  'Facilities Engineering', 'Controls Engineering', 'Automation Engineering',

  // Technical skills
  'Welding', 'Fabrication', 'Machining', 'Soldering', 'Brazing',
  'Pipefitting', 'Rigging', 'Scaffolding', 'Electrical Wiring',
  'Instrumentation', 'Calibration', 'Inspection', 'NDT',
  'Non-Destructive Testing', 'Pressure Testing', 'Commissioning',
  'Decommissioning', 'Hot Work', 'Confined Space Entry',

  // Project and operations management
  'Project Management', 'Program Management', 'Contract Management',
  'Supply Chain Management', 'Vendor Management', 'Stakeholder Management',
  'Risk Management', 'Change Management', 'Asset Management',
  'Performance Management', 'Quality Management', 'Cost Management',
  'Schedule Management', 'Scope Management', 'Resource Management',
  'Construction Management', 'Maintenance Management',
  'Operations Management', 'Workforce Planning', 'Succession Planning',
  'Project Planning', 'Project Scheduling', 'Project Controls',
  'Cost Estimation', 'Budget Management',

  // HSE and safety
  'HSE', 'Safety Management', 'Environmental Management',
  'Process Safety', 'Occupational Safety', 'Incident Investigation',
  'Risk Assessment', 'Hazard Analysis', 'Permit to Work',
  'Lockout Tagout', 'Emergency Response', 'Fire Safety',

  // Software and technical tools
  'AutoCAD', 'Revit', 'SolidWorks', 'CATIA', 'NX', 'Inventor',
  'MicroStation', 'PDMS', 'E3D', 'SP3D', 'SmartPlant',
  'Primavera', 'SAP', 'Oracle', 'Maximo',
  'MATLAB', 'Python', 'SQL', 'Power BI', 'Tableau',
  'Excel', 'Microsoft Office', 'SCADA', 'PLC', 'DCS',
  'CAESAR II', 'STAAD Pro', 'ETABS', 'ANSYS', 'Aspen HYSYS',
  'R', 'Java', 'JavaScript', 'C++', 'C#', 'Linux',
  'AWS', 'Azure', 'GIS', 'ArcGIS',

  // Data and IT
  'Data Analysis', 'Data Science', 'Machine Learning',
  'Artificial Intelligence', 'Cloud Computing', 'Cybersecurity',
  'Database Management', 'Network Administration', 'DevOps',
  'Agile', 'Scrum', 'Software Development', 'Web Development',
  'API Development', 'System Administration', 'IT Infrastructure',

  // Business and professional skills
  'Strategic Planning', 'Business Development', 'Financial Analysis',
  'Budgeting', 'Forecasting', 'Procurement', 'Logistics',
  'Report Writing', 'Technical Writing', 'Presentation',
  'Communication', 'Oral Communication', 'Written Communication',
  'Leadership', 'Team Leadership', 'Team Building', 'Teamwork',
  'Mentoring', 'Coaching', 'Conflict Resolution',
  'Problem Solving', 'Decision Making', 'Analytical Thinking',
  'Continuous Improvement', 'Lean', 'Six Sigma',
  'Root Cause Analysis', 'Statistical Analysis',
  'Customer Service', 'Stakeholder Engagement',
  'Regulatory Compliance', 'Audit', 'Documentation',
  'Interpersonal Communication', 'Planning', 'Scheduling',
  'Organizational Skills', 'Attention to Detail',

  // Energy sector specific
  'Drilling', 'Completions', 'Production Operations', 'Well Testing',
  'Well Intervention', 'Workover', 'Artificial Lift',
  'Subsea Operations', 'Pipeline Operations', 'Offshore Operations',
  'Onshore Operations', 'Upstream Operations', 'Midstream Operations',
  'Downstream Operations', 'Refinery Operations', 'LNG',
  'Geoscience', 'Geology', 'Geophysics', 'Petrophysics',
  'Seismic Interpretation', 'Reservoir Simulation',
  'Power Generation', 'Renewable Energy', 'Solar Energy', 'Wind Energy',
  'Grid Operations', 'Transmission', 'Distribution',
  'FEED', 'EPC', 'Turnaround',

  // Construction and trades
  'Crane Operations', 'Heavy Equipment Operation', 'Carpentry',
  'Plumbing', 'HVAC', 'Refrigeration', 'Boiler Operations',
  'Hydraulics', 'Pneumatics', 'Mechanical Maintenance',
  'Electrical Maintenance', 'Preventive Maintenance',
  'Predictive Maintenance', 'Reliability Engineering',

  // Standards awareness
  'API Standards', 'ASME Standards', 'ISO Standards', 'NFPA',
];

// Build the lookup structures
const allReferenceTerms = [
  ...ONET_SKILLS, ...ONET_KNOWLEDGE, ...ONET_ABILITIES, ...INDUSTRY_SKILLS,
];

// Exact match lookup: lowercase -> canonical name
const exactLookup = new Map();
allReferenceTerms.forEach(term => {
  exactLookup.set(term.toLowerCase(), term);
});

// Word index: word -> Set of canonical terms containing that word
const wordIndex = new Map();
allReferenceTerms.forEach(term => {
  const words = term.toLowerCase().split(/[\s\-\/]+/).filter(w => w.length >= 3);
  words.forEach(word => {
    if (!wordIndex.has(word)) wordIndex.set(word, new Set());
    wordIndex.get(word).add(term);
  });
});

// Stop words to ignore during matching
const STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'into', 'that', 'this', 'have',
  'has', 'been', 'are', 'was', 'were', 'will', 'can', 'may',
]);

/**
 * Match a normalized skill against the O*NET reference.
 * Returns the canonical reference name if matched, null otherwise.
 */
export function matchSkillToReference(normalizedSkill) {
  if (!normalizedSkill || typeof normalizedSkill !== 'string') return null;

  const lower = normalizedSkill.toLowerCase().trim();
  if (lower.length < 2) return null;

  // 1. Exact match
  if (exactLookup.has(lower)) {
    return exactLookup.get(lower);
  }

  // 2. Normalized match (collapse hyphens/slashes to spaces)
  const collapsed = lower.replace(/[\-\/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (exactLookup.has(collapsed)) {
    return exactLookup.get(collapsed);
  }

  // 3. Word-based matching
  const skillWords = collapsed.split(/\s+/).filter(w => w.length >= 2 && !STOP_WORDS.has(w));
  if (skillWords.length === 0) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const [refLower, canonical] of exactLookup) {
    const refWords = refLower.split(/[\s\-\/]+/).filter(w => w.length >= 2 && !STOP_WORDS.has(w));
    if (refWords.length === 0) continue;

    // Count overlapping words
    const refWordSet = new Set(refWords);
    const overlap = skillWords.filter(w => refWordSet.has(w)).length;
    if (overlap === 0) continue;

    // Score: average of coverage in both directions
    const skillCoverage = overlap / skillWords.length;
    const refCoverage = overlap / refWords.length;
    const score = (skillCoverage + refCoverage) / 2;

    // Require at least 60% average coverage
    if (score > bestScore && score >= 0.6) {
      bestScore = score;
      bestMatch = canonical;
    }
  }

  return bestMatch;
}

/**
 * Get the full list of reference skill names
 */
export function getAllReferenceSkills() {
  return [...allReferenceTerms].sort();
}

export { ONET_SKILLS, ONET_KNOWLEDGE, ONET_ABILITIES, INDUSTRY_SKILLS };
