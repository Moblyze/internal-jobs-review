/**
 * Energy Sector Role Definitions for AI Classification
 *
 * Provides formatted role definitions optimized for Claude AI job classification.
 * Ordered by specificity to help the AI match most specific roles first.
 *
 * Usage:
 * ```javascript
 * import { getFormattedRolesForAI } from './roleDefinitionsForAI.js';
 *
 * const roles = getFormattedRolesForAI();
 * // Returns array of 67 energy sector roles with descriptions
 * ```
 */

/**
 * All 67 energy sector roles with AI-optimized descriptions
 * Ordered by specificity (most specific first, general roles last)
 *
 * Each role includes:
 * - id: Unique role identifier (matches energyRoles.js and energyJobMatcher.js)
 * - label: Human-readable role name
 * - description: Clear description for AI classification
 * - category: Role category (offshore, drilling, production, etc.)
 */
export const ENERGY_ROLES_FOR_AI = [
  // ============================================================================
  // OFFSHORE & SUBSEA (High specificity)
  // ============================================================================
  {
    id: 'rov-supervisor',
    label: 'ROV Supervisor',
    description: 'Oversees remotely operated vehicle (ROV) operations in offshore/subsea environments. Manages ROV pilots and coordinates underwater equipment deployment.',
    category: 'offshore'
  },
  {
    id: 'rov-pilot-technician',
    label: 'ROV Pilot/Technician',
    description: 'Operates remotely operated vehicles for subsea inspection, maintenance, and drilling support. Performs equipment troubleshooting and repairs.',
    category: 'offshore'
  },
  {
    id: 'saturation-diver',
    label: 'Saturation Diver',
    description: 'Commercial diver who works at extreme depths using saturation diving techniques. Performs subsea construction, inspection, and maintenance.',
    category: 'offshore'
  },
  {
    id: 'dp-operator',
    label: 'DP Operator',
    description: 'Operates dynamic positioning systems on offshore vessels and rigs to maintain precise location during operations.',
    category: 'offshore'
  },
  {
    id: 'chief-engineer-marine',
    label: 'Chief Engineer (Marine)',
    description: 'Senior engineering role on marine vessels/offshore platforms responsible for power generation, propulsion, and mechanical systems.',
    category: 'offshore'
  },
  {
    id: 'subsea-engineer',
    label: 'Subsea Engineer',
    description: 'Designs, installs, and maintains underwater production systems, pipelines, and control equipment for offshore oil and gas.',
    category: 'offshore'
  },
  {
    id: 'ei-technician',
    label: 'E&I Technician',
    description: 'Electrical and Instrumentation technician who maintains control systems, electrical power, and instrumentation on offshore platforms.',
    category: 'offshore'
  },
  {
    id: 'offshore-operations',
    label: 'Offshore Operations',
    description: 'General offshore operations roles including platform supervisors, offshore coordinators, and operations crew.',
    category: 'offshore'
  },
  {
    id: 'diving-marine',
    label: 'Diving & Marine',
    description: 'Commercial diving and marine operations including surface diving, inspection, and marine support services.',
    category: 'offshore'
  },

  // ============================================================================
  // DRILLING OPERATIONS (Highly specific drilling services)
  // ============================================================================
  {
    id: 'directional-drilling',
    label: 'Directional Drilling',
    description: 'Specialists who steer drilling trajectory using directional tools and geosteering techniques. Includes DD engineers and field professionals.',
    category: 'drilling'
  },
  {
    id: 'mwd-lwd',
    label: 'MWD/LWD Specialist',
    description: 'Operates measurement-while-drilling and logging-while-drilling systems to collect real-time formation and drilling data.',
    category: 'drilling'
  },
  {
    id: 'drilling-engineer',
    label: 'Drilling Engineer',
    description: 'Plans and optimizes drilling programs, including well design, drill bit selection, and managed pressure drilling (MPD) operations.',
    category: 'drilling'
  },
  {
    id: 'assistant-driller',
    label: 'Assistant Driller',
    description: 'Second-in-command on drilling rig floor, assists driller with rig operations and prepares to become a driller.',
    category: 'drilling'
  },
  {
    id: 'driller-rig-crew',
    label: 'Driller & Rig Crew',
    description: 'Operates drilling rig and supervises floor crew. Includes toolpushers, drillers, derrick hands, and roughnecks.',
    category: 'drilling'
  },
  {
    id: 'mud-engineer',
    label: 'Mud Engineer/Specialist',
    description: 'Manages drilling fluid properties and performance. Designs mud programs and monitors fluid systems during drilling.',
    category: 'drilling'
  },
  {
    id: 'drilling-operations',
    label: 'Drilling Operations',
    description: 'General drilling operations roles including rig supervisors, drilling foremen, and tour pushers.',
    category: 'drilling'
  },

  // ============================================================================
  // WELL SERVICES (Specific service types)
  // ============================================================================
  {
    id: 'wireline-operator',
    label: 'Wireline Operator/Engineer',
    description: 'Runs wireline tools for well logging, perforating, and interventions. Includes logging & perforating specialists.',
    category: 'well-services'
  },
  {
    id: 'coiled-tubing',
    label: 'Coiled Tubing Operator',
    description: 'Operates coiled tubing units for well cleanouts, stimulation, drilling, and intervention operations.',
    category: 'well-services'
  },
  {
    id: 'cementing-services',
    label: 'Cementing Services',
    description: 'Performs primary cementing, squeeze cementing, and plug operations. Includes cement operators and field engineers.',
    category: 'well-services'
  },
  {
    id: 'fracturing-stimulation',
    label: 'Fracturing & Stimulation',
    description: 'Hydraulic fracturing and well stimulation specialists. Includes frac engineers, stimulation supervisors, and production enhancement.',
    category: 'well-services'
  },
  {
    id: 'well-testing',
    label: 'Well Testing',
    description: 'Surface well testing and downhole testing operations to evaluate reservoir productivity and fluid properties.',
    category: 'well-services'
  },
  {
    id: 'completions',
    label: 'Completions Specialist',
    description: 'Installs and maintains completion equipment including packers, tubing, and downhole tools to prepare wells for production.',
    category: 'well-services'
  },
  {
    id: 'workover-intervention',
    label: 'Workover & Well Intervention',
    description: 'Performs well workovers, recompletions, and interventions to restore or enhance production.',
    category: 'well-services'
  },
  {
    id: 'slickline',
    label: 'Slickline Operator',
    description: 'Runs slickline tools for well interventions, gauge installations, and mechanical operations.',
    category: 'well-services'
  },
  {
    id: 'artificial-lift',
    label: 'Artificial Lift Specialist',
    description: 'Designs and operates artificial lift systems including ESP, rod pumps, and PCP to enhance well production.',
    category: 'well-services'
  },

  // ============================================================================
  // PRODUCTION OPERATIONS
  // ============================================================================
  {
    id: 'production-operator',
    label: 'Production Operator',
    description: 'Operates and monitors oil and gas production facilities. Includes well operators, lease operators, gaugers, and pumpers.',
    category: 'production'
  },
  {
    id: 'process-operator',
    label: 'Process Operator',
    description: 'Operates and maintains oil and gas processing equipment including separators, treaters, and dehydration units.',
    category: 'production'
  },
  {
    id: 'plant-operator',
    label: 'Plant Operator',
    description: 'Operates gas plants, refineries, or power generation facilities. Monitors process parameters and equipment.',
    category: 'production'
  },
  {
    id: 'control-room-operator',
    label: 'Control Room Operator',
    description: 'Monitors and controls production operations from centralized control rooms using SCADA and DCS systems.',
    category: 'production'
  },
  {
    id: 'reactor-operator',
    label: 'Reactor Operator',
    description: 'Operates nuclear reactors in power generation facilities. Monitors reactor controls and safety systems.',
    category: 'production'
  },
  {
    id: 'crane-operator',
    label: 'Crane Operator',
    description: 'Operates cranes for lifting and moving equipment on offshore platforms, construction sites, or industrial facilities.',
    category: 'production'
  },
  {
    id: 'production-engineer',
    label: 'Production Engineer',
    description: 'Optimizes oil and gas production through well performance analysis, production forecasting, and facility design.',
    category: 'production'
  },
  {
    id: 'field-engineer',
    label: 'Field Engineer',
    description: 'General field engineering role providing technical support for various oilfield services and operations.',
    category: 'production'
  },
  {
    id: 'field-specialist',
    label: 'Field Specialist/Technician',
    description: 'Field-based technical specialists and service representatives for oilfield equipment and services.',
    category: 'production'
  },
  {
    id: 'service-operator',
    label: 'Service Operator',
    description: 'Operates service equipment for various well services and field operations.',
    category: 'production'
  },

  // ============================================================================
  // RESERVOIR & GEOSCIENCE
  // ============================================================================
  {
    id: 'reservoir-engineer',
    label: 'Reservoir Engineer',
    description: 'Analyzes reservoir performance, estimates reserves, and develops production strategies through reservoir modeling.',
    category: 'geoscience'
  },
  {
    id: 'petrophysicist',
    label: 'Petrophysicist',
    description: 'Analyzes rock and fluid properties from well logs and core data to characterize hydrocarbon reservoirs.',
    category: 'geoscience'
  },
  {
    id: 'geologist',
    label: 'Geologist',
    description: 'Studies rock formations and structures to locate hydrocarbon deposits. Includes wellsite, logging, and geosteering geologists.',
    category: 'geoscience'
  },
  {
    id: 'geophysicist',
    label: 'Geophysicist',
    description: 'Interprets seismic data and develops subsurface models to identify drilling prospects and reservoir characteristics.',
    category: 'geoscience'
  },
  {
    id: 'geoscientist',
    label: 'Geoscientist',
    description: 'Broad earth science role combining geology, geophysics, and earth sciences for exploration and development.',
    category: 'geoscience'
  },
  {
    id: 'petroleum-engineer',
    label: 'Petroleum Engineer',
    description: 'General petroleum engineering role covering drilling, completions, production, or reservoir engineering.',
    category: 'geoscience'
  },

  // ============================================================================
  // TECHNICAL TRADES
  // ============================================================================
  {
    id: 'welder',
    label: 'Welder',
    description: 'Performs welding on pipelines, structures, and equipment using TIG, MIG, stick, or specialized welding processes.',
    category: 'trades'
  },
  {
    id: 'pipefitter',
    label: 'Pipefitter',
    description: 'Installs, maintains, and repairs piping systems for oil, gas, and process fluids.',
    category: 'trades'
  },
  {
    id: 'scaffolder',
    label: 'Scaffolder',
    description: 'Erects and dismantles scaffolding for maintenance access on platforms, plants, and refineries.',
    category: 'trades'
  },
  {
    id: 'rigger',
    label: 'Rigger',
    description: 'Plans and executes rigging operations for heavy lifts and equipment moves using slings, chains, and cranes.',
    category: 'trades'
  },
  {
    id: 'rig-mechanic',
    label: 'Rig Mechanic',
    description: 'Maintains and repairs drilling rig equipment including diesel engines, pumps, and mechanical systems.',
    category: 'trades'
  },
  {
    id: 'millwright',
    label: 'Millwright/Industrial Mechanic',
    description: 'Installs, maintains, and repairs industrial machinery and mechanical equipment.',
    category: 'trades'
  },
  {
    id: 'electrician-oilfield',
    label: 'Electrician (Oilfield)',
    description: 'Maintains electrical systems, motors, and power distribution on rigs, platforms, and industrial facilities.',
    category: 'trades'
  },
  {
    id: 'instrumentation-tech',
    label: 'Instrumentation Technician',
    description: 'Calibrates and maintains instrumentation and control systems including pressure, temperature, and flow measurement.',
    category: 'trades'
  },
  {
    id: 'hydraulic-specialist',
    label: 'Hydraulic Specialist',
    description: 'Maintains and repairs hydraulic systems on drilling equipment and heavy machinery.',
    category: 'trades'
  },
  {
    id: 'mechanic-technician',
    label: 'Mechanic/Technician (General)',
    description: 'General mechanical and maintenance technician roles supporting oilfield operations.',
    category: 'trades'
  },

  // ============================================================================
  // INSPECTION & INTEGRITY
  // ============================================================================
  {
    id: 'ndt-inspector',
    label: 'NDT Inspector',
    description: 'Performs non-destructive testing using ultrasonic, radiographic, magnetic particle, or other inspection methods.',
    category: 'inspection'
  },
  {
    id: 'pipeline-inspector',
    label: 'Pipeline Inspector',
    description: 'Inspects pipeline construction, installation, and integrity for compliance and safety.',
    category: 'inspection'
  },
  {
    id: 'coating-inspector',
    label: 'Coating Inspector',
    description: 'Inspects protective coatings and corrosion prevention systems on pipelines and structures.',
    category: 'inspection'
  },
  {
    id: 'structural-inspector',
    label: 'Structural Inspector',
    description: 'Inspects structural integrity of platforms, facilities, and industrial structures.',
    category: 'inspection'
  },

  // ============================================================================
  // DIGITAL & AUTOMATION
  // ============================================================================
  {
    id: 'scada-engineer',
    label: 'SCADA Engineer',
    description: 'Designs and maintains supervisory control and data acquisition systems for remote operations monitoring.',
    category: 'digital'
  },
  {
    id: 'automation-engineer',
    label: 'Automation Engineer',
    description: 'Designs and implements control systems and automation solutions for production and processing operations.',
    category: 'digital'
  },
  {
    id: 'plc-technician',
    label: 'PLC Technician',
    description: 'Programs and troubleshoots programmable logic controllers for industrial automation.',
    category: 'digital'
  },
  {
    id: 'data-analyst-energy',
    label: 'Data Analyst (Energy)',
    description: 'Analyzes production, drilling, or operational data to optimize performance in energy sector.',
    category: 'digital'
  },

  // ============================================================================
  // WIND & RENEWABLE ENERGY
  // ============================================================================
  {
    id: 'wind-turbine-technician',
    label: 'Wind Turbine Technician',
    description: 'Maintains and repairs wind turbines including mechanical, electrical, and hydraulic systems.',
    category: 'renewable'
  },
  {
    id: 'blade-technician',
    label: 'Blade Technician',
    description: 'Inspects and repairs wind turbine blades using composite repair and rope access techniques.',
    category: 'renewable'
  },

  // ============================================================================
  // ENERGY TRANSITION & DECARBONIZATION
  // ============================================================================
  {
    id: 'ccs-engineer',
    label: 'CCS Engineer',
    description: 'Works on carbon capture and storage projects to reduce greenhouse gas emissions from industrial operations.',
    category: 'energy-transition'
  },
  {
    id: 'hydrogen-engineer',
    label: 'Hydrogen Engineer',
    description: 'Designs hydrogen production, storage, or distribution systems for clean energy applications.',
    category: 'energy-transition'
  },
  {
    id: 'hydrogen-technician',
    label: 'Hydrogen Technician',
    description: 'Operates and maintains hydrogen production or fuel cell equipment.',
    category: 'energy-transition'
  },

  // ============================================================================
  // SPECIALIZED ROLES
  // ============================================================================
  {
    id: 'rope-access-technician',
    label: 'Rope Access Technician',
    description: 'Performs maintenance and inspection at heights using rope access techniques. IRATA certified professionals.',
    category: 'specialized'
  },
  {
    id: 'lab-technician',
    label: 'Laboratory Technician',
    description: 'Performs laboratory testing of oil, gas, water, and drilling fluids to ensure quality and compliance.',
    category: 'specialized'
  },
  {
    id: 'materials-specialist',
    label: 'Materials Specialist',
    description: 'Analyzes materials performance including metallurgy, corrosion, and welding engineering.',
    category: 'specialized'
  },
  {
    id: 'hse-specialist',
    label: 'HSE Specialist',
    description: 'Health, Safety, and Environment professionals ensuring compliance and safety in energy operations. Includes well control instructors.',
    category: 'specialized'
  },
];

/**
 * Get formatted role definitions for AI classification prompts
 *
 * @param {Object} options - Formatting options
 * @param {boolean} options.includeCategory - Include category in output (default: true)
 * @param {boolean} options.concise - Use shorter format (default: false)
 * @returns {Array} Array of role objects formatted for AI
 */
export function getFormattedRolesForAI(options = {}) {
  const { includeCategory = true, concise = false } = options;

  if (concise) {
    // Shorter format for token efficiency
    return ENERGY_ROLES_FOR_AI.map(role => ({
      id: role.id,
      label: role.label,
      keywords: role.description.split('.')[0] // First sentence only
    }));
  }

  if (!includeCategory) {
    return ENERGY_ROLES_FOR_AI.map(({ id, label, description }) => ({
      id,
      label,
      description
    }));
  }

  return ENERGY_ROLES_FOR_AI;
}

/**
 * Get roles organized by category for AI context
 *
 * @returns {Object} Roles grouped by category
 */
export function getRolesByCategory() {
  const categories = {};

  ENERGY_ROLES_FOR_AI.forEach(role => {
    const category = role.category;
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(role);
  });

  return categories;
}

/**
 * Get a formatted string for Claude AI prompt
 * Optimized to stay under token limits while providing context
 *
 * @param {Object} options - Formatting options
 * @param {number} options.maxRoles - Maximum roles to include (default: all)
 * @returns {string} Formatted role definitions as a string
 */
export function getRoleDefinitionsPrompt(options = {}) {
  const { maxRoles = ENERGY_ROLES_FOR_AI.length } = options;

  const roles = ENERGY_ROLES_FOR_AI.slice(0, maxRoles);

  let prompt = '# Energy Sector Role Definitions\n\n';
  prompt += `Available roles for classification (${roles.length} total):\n\n`;

  roles.forEach((role, index) => {
    prompt += `${index + 1}. **${role.label}** (id: "${role.id}")\n`;
    prompt += `   ${role.description}\n\n`;
  });

  return prompt;
}

/**
 * Get total count of roles
 */
export const TOTAL_ROLES = ENERGY_ROLES_FOR_AI.length;

/**
 * Category labels for human-readable display
 */
export const CATEGORY_LABELS = {
  'offshore': 'Offshore & Subsea',
  'drilling': 'Drilling Operations',
  'well-services': 'Well Services',
  'production': 'Production Operations',
  'geoscience': 'Reservoir & Geoscience',
  'trades': 'Technical Trades',
  'inspection': 'Inspection & Integrity',
  'digital': 'Digital & Automation',
  'renewable': 'Wind & Renewable Energy',
  'energy-transition': 'Energy Transition & Decarbonization',
  'specialized': 'Specialized Roles'
};

export default {
  getFormattedRolesForAI,
  getRolesByCategory,
  getRoleDefinitionsPrompt,
  ENERGY_ROLES_FOR_AI,
  TOTAL_ROLES,
  CATEGORY_LABELS
};
