/**
 * Energy Sector Job Title Matcher
 *
 * Keyword-based matching system for categorizing energy sector job titles
 * from Baker Hughes, Halliburton, Schlumberger, and other oilfield service companies.
 *
 * Designed to match actual job titles found in the dataset:
 * - Field Professional - MWD, II
 * - Cementing Service Operator
 * - Wireline Field Operator
 * - Surface Well Testing Specialist
 * - Completion Tools Technician
 * - etc.
 */

/**
 * Role definitions with keyword patterns
 * Ordered by specificity (most specific first to avoid false matches)
 */
const ENERGY_ROLE_PATTERNS = [
  // ============================================================================
  // OFFSHORE & SUBSEA (High specificity - match these first)
  // ============================================================================
  // NOTE: Most specific patterns FIRST (e.g., "ROV Supervisor" before "ROV")
  {
    roleId: 'rov-supervisor',
    roleName: 'ROV Supervisor',
    keywords: [
      /\bROV\b.*\bsupervisor\b/i,
      /\bROV\b.*\bsuper(?:intendent|visor)\b/i,
    ],
    confidence: 'high',
    description: 'Catches: ROV Supervisor, ROV Superintendent'
  },
  {
    roleId: 'rov-pilot-technician',
    roleName: 'ROV Pilot/Technician',
    keywords: [
      /\bROV\b/i,
      /remotely operated vehicle/i,
    ],
    confidence: 'high',
    description: 'Catches: ROV Pilot, ROV Technician'
  },
  {
    roleId: 'saturation-diver',
    roleName: 'Saturation Diver',
    keywords: [
      /\bsaturation\b.*\bdiv(?:er|ing)\b/i,
      /\bsat\b.*\bdiver\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Saturation Diver, Sat Diver'
  },
  {
    roleId: 'dp-operator',
    roleName: 'DP Operator',
    keywords: [
      /\bDP\b.*\boperator\b/i,
      /\bdynamic\b.*\bposition(?:ing)?\b.*\boperator\b/i,
    ],
    confidence: 'high',
    description: 'Catches: DP Operator, Dynamic Positioning Operator'
  },
  {
    roleId: 'chief-engineer-marine',
    roleName: 'Chief Engineer (Marine)',
    keywords: [
      /\bchief\b.*\bengineer\b.*\bmarine\b/i,
      /\bmarine\b.*\bchief\b.*\bengineer\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Chief Engineer (Marine), Marine Chief Engineer'
  },
  {
    roleId: 'subsea-engineer',
    roleName: 'Subsea Engineer',
    keywords: [
      /\bsubsea\b/i,
      /underwater/i,
    ],
    confidence: 'high',
    description: 'Catches: Subsea Engineer, Surface Well Testing - Testing and Subsea'
  },
  {
    roleId: 'ei-technician',
    roleName: 'E&I Technician',
    keywords: [
      /\bE&I\b/i,
      /\belectrical\b.*\binstrument(?:ation)?\b/i,
    ],
    confidence: 'high',
    description: 'Catches: E&I Technician, Electrical & Instrumentation Technician'
  },
  {
    roleId: 'offshore-operations',
    roleName: 'Offshore Operations',
    keywords: [
      /\boffshore\b/i,
      /offshore position/i,
    ],
    confidence: 'medium',  // Lowered to medium since it's very broad
    description: 'Catches: Offshore Supervisor, Coordenadora de Operações Offshore'
  },
  {
    roleId: 'diving-marine',
    roleName: 'Diving & Marine',
    keywords: [
      /\bdiving\b/i,
      /\bdiver\b/i,
      /\bmarine\b/i,
    ],
    confidence: 'medium',
    description: 'Catches: Commercial Diver, Marine Operations roles'
  },

  // ============================================================================
  // DRILLING OPERATIONS (Highly specific drilling terms)
  // ============================================================================
  {
    roleId: 'directional-drilling',
    roleName: 'Directional Drilling',
    keywords: [
      /\bdirectional\b\s+\bdrilling\b/i,
      /\bDD\b.*\bdrill/i,
      /\bgeosteering\b/i,
      /\bField\b\s+\bProf(?:essional)?\b.*\bDD\b/i,
      /\bIngeniero\b\s+\bde\b\s+\bPerforación\b\s+\bDireccional\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Directional Drilling Engineer, Geosteering Geologist, Field Prof-DD'
  },
  {
    roleId: 'mwd-lwd',
    roleName: 'MWD/LWD Specialist',
    keywords: [
      /\bMWD\b/i,
      /\bLWD\b/i,
      /\bMLWD\b/i,
      /measurement while drilling/i,
      /logging while drilling/i,
      /Field Prof.*MWD/i,
      /Field Specialist.*LWD/i,
    ],
    confidence: 'high',
    description: 'Catches: MWD Field Professional, LWD/DD Field Specialist, Field Engineer MLWD'
  },
  {
    roleId: 'drilling-engineer',
    roleName: 'Drilling Engineer',
    keywords: [
      /\bdrilling\b\s+\bengineer\b/i,
      /\bdrill\b\s+\bbits\b.*\bengineer\b/i,
      /\bmanaged\b\s+\bpressure\b\s+\bdrilling\b/i,
      /\bMPD\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Drilling Engineer, Drill Bits Application Engineer, MPD Supervisor'
  },
  {
    roleId: 'assistant-driller',
    roleName: 'Assistant Driller',
    keywords: [
      /\bassistant\b.*\bdriller\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Assistant Driller'
  },
  {
    roleId: 'driller-rig-crew',
    roleName: 'Driller & Rig Crew',
    keywords: [
      /\bdriller\b/i,
      /\brig\b.*\b(?:mechanic|electrician|crew)\b/i,
      /\btoolpusher\b/i,
      /\btool\b\s+\bpusher\b/i,
      /\broughneck\b/i,
      /\broustabout\b/i,
      /\bderrick\b.*\b(?:hand|man)\b/i,
      /\bwell\b\s+\bsite\b.*\bsup(?:ervisor)?\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Driller, Well Site Supervisor, Rig Mechanic'
  },
  {
    roleId: 'mud-engineer',
    roleName: 'Mud Engineer/Specialist',
    keywords: [
      /\bmud\b.*\bengineer\b/i,
      /\bdrilling\b\s+\bfluids\b/i,
      /\bBaroid\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Mud Engineer, Drilling Fluids Specialist, Baroid technicians'
  },

  // ============================================================================
  // WELL SERVICES (Specific service types)
  // ============================================================================
  {
    roleId: 'wireline-operator',
    roleName: 'Wireline Operator/Engineer',
    keywords: [
      /\bwireline\b/i,
      /\bwire\b\s+\bline\b/i,
      /\blogging\b.*\bperf(?:orating)?\b/i,
      /\bL&amp;P\b/i,
      /\bperforating\b\s+\bspecialist\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Wireline Field Operator, Wireline & Perforating Engineer, Logging & Perf'
  },
  {
    roleId: 'coiled-tubing',
    roleName: 'Coiled Tubing Operator',
    keywords: [
      /\bcoiled\b\s+\btubing\b/i,
      /\bCT\b.*\b(?:operator|engineer)\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Coiled Tubing Operator, Asistente de Operador Coiled Tubing'
  },
  {
    roleId: 'cementing-services',
    roleName: 'Cementing Services',
    keywords: [
      /\bcementing\b/i,
      /\bcement\b.*\b(?:operator|technician|specialist)\b/i,
      /\bSvc\b\s+\bOperator\b.*\bCement\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Cementing Service Operator, Technical Professional Cementing'
  },
  {
    roleId: 'fracturing-stimulation',
    roleName: 'Fracturing & Stimulation',
    keywords: [
      /\bfrac(?:turing|k)?\b/i,
      /\bstimulation\b/i,
      /\bacidizing\b/i,
      /\bfracturamiento\b/i,
      /\bIngeniero\b.*\bFrac\b/i,
      /\bProduction\b\s+\bEnhancement\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Fracturing Engineer, Stimulation Supervisor, Production Enhancement roles'
  },
  {
    roleId: 'well-testing',
    roleName: 'Well Testing',
    keywords: [
      /\bwell\b\s+\btesting\b/i,
      /\bsurface\b\s+\bwell\b\s+\btest(?:ing)?\b/i,
      /\bSWT\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Surface Well Testing Specialist, Well Testing Engineer/Supervisor'
  },
  {
    roleId: 'completions',
    roleName: 'Completions Specialist',
    keywords: [
      /\bcompletions?\b/i,
      /\bcompletion\b\s+\btools\b/i,
      /\bcompletion\b\s+\bengineer\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Completions Service Specialist, Completion Tools Technician'
  },
  {
    roleId: 'workover-intervention',
    roleName: 'Workover & Well Intervention',
    keywords: [
      /\bworkover\b/i,
      /\bwork\b\s+\bover\b/i,
      /\bwell\b\s+\bintervention\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Workover Supervisor, Well Intervention Sales'
  },
  {
    roleId: 'slickline',
    roleName: 'Slickline Operator',
    keywords: [
      /\bslickline\b/i,
      /\bslick\b\s+\bline\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Slickline Operator, Slickline Engineer'
  },

  // ============================================================================
  // ARTIFICIAL LIFT
  // ============================================================================
  {
    roleId: 'artificial-lift',
    roleName: 'Artificial Lift Specialist',
    keywords: [
      /\bartificial\b\s+\blift\b/i,
      /\bESP\b.*\b(?:engineer|specialist)\b/i,
      /\belectric\b\s+\bsubmersible\b\s+\bpump\b/i,
      /\brod\b\s+\bpump\b/i,
      /\bPCP\b.*\b(?:engineer|specialist)\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Artificial Lift Field Engineer, ESP Specialist, Artificial Lift Test Tech'
  },

  // ============================================================================
  // PRODUCTION OPERATIONS
  // ============================================================================
  {
    roleId: 'production-operator',
    roleName: 'Production Operator',
    keywords: [
      /\bproduction\b.*\boperator\b/i,
      /\bwell\b\s+\boperator\b/i,
      /\blease\b\s+\boperator\b/i,
      /\bgauger\b/i,
      /\bpumper\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Production Operator, Well Operator, Lease Operator'
  },
  {
    roleId: 'process-operator',
    roleName: 'Process Operator',
    keywords: [
      /\bprocess\b.*\boperator\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Process Operator'
  },
  {
    roleId: 'plant-operator',
    roleName: 'Plant Operator',
    keywords: [
      /\bplant\b.*\boperator\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Plant Operator, Power Plant Operator'
  },
  {
    roleId: 'control-room-operator',
    roleName: 'Control Room Operator',
    keywords: [
      /\bcontrol\b.*\broom\b.*\boperator\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Control Room Operator'
  },
  {
    roleId: 'reactor-operator',
    roleName: 'Reactor Operator',
    keywords: [
      /\breactor\b.*\boperator\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Reactor Operator (Nuclear)'
  },
  {
    roleId: 'crane-operator',
    roleName: 'Crane Operator',
    keywords: [
      /\bcrane\b.*\boperator\b/i,
      /\btower\b.*\bcrane\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Crane Operator, Tower Crane Operator'
  },
  {
    roleId: 'production-engineer',
    roleName: 'Production Engineer',
    keywords: [
      /\bproduction\b.*\bengineer\b/i,
      /\bproduction\b\s+\badvisor\b/i,
    ],
    confidence: 'medium',
    description: 'Catches: Production Engineer, Production Advisor'
  },

  // ============================================================================
  // RESERVOIR & GEOSCIENCE
  // ============================================================================
  {
    roleId: 'reservoir-engineer',
    roleName: 'Reservoir Engineer',
    keywords: [
      /\breservoir\b.*\bengineer\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Reservoir Engineer'
  },
  {
    roleId: 'petrophysicist',
    roleName: 'Petrophysicist',
    keywords: [
      /petrophysicist/i,
      /petrophysics/i,
    ],
    confidence: 'high',
    description: 'Catches: Petrophysicist, Petrophysics Engineer'
  },
  {
    roleId: 'geologist',
    roleName: 'Geologist',
    keywords: [
      /\bgeologist\b/i,
      /geology/i,
      /geosteering geologist/i,
      /logging geologist/i,
    ],
    confidence: 'high',
    description: 'Catches: Geologist, Geosteering Geologist, Logging Geologist'
  },
  {
    roleId: 'geophysicist',
    roleName: 'Geophysicist',
    keywords: [
      /geophysicist/i,
      /geophysics/i,
      /seismic/i,
    ],
    confidence: 'high',
    description: 'Catches: Geophysicist, Geophysical Software Engineer'
  },
  {
    roleId: 'geoscientist',
    roleName: 'Geoscientist',
    keywords: [
      /geoscientist/i,
      /geoscience/i,
    ],
    confidence: 'medium',
    description: 'Catches: Geoscientist (broader than geologist/geophysicist)'
  },

  // ============================================================================
  // PETROLEUM ENGINEERING (General)
  // ============================================================================
  {
    roleId: 'petroleum-engineer',
    roleName: 'Petroleum Engineer',
    keywords: [
      /\bpetroleum\b.*\bengineer\b/i,
      /\bwell\b.*\bengineer\b/i,
      /\bwell\b.*\bdesign\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Petroleum Engineer, Well Engineer, Well Design Consultant'
  },

  // ============================================================================
  // FIELD OPERATIONS (General - lower specificity)
  // ============================================================================
  {
    roleId: 'field-engineer',
    roleName: 'Field Engineer',
    keywords: [
      /\bfield\b.*\bengineer\b/i,
      /\bfield\b\s+\bprof(?:essional)?\b/i,
      /\bfield\b\s+\bprofessional\b/i,
    ],
    confidence: 'medium',
    description: 'Catches: Field Engineer, Field Professional (various services)'
  },
  {
    roleId: 'field-specialist',
    roleName: 'Field Specialist/Technician',
    keywords: [
      /\bfield\b.*\bspecialist\b/i,
      /\bfield\b.*\btechnician\b/i,
      /\bfield\b\s+\bservice\b/i,
    ],
    confidence: 'medium',
    description: 'Catches: Field Specialist, Field Service Representative, Field Service Spec'
  },
  {
    roleId: 'service-operator',
    roleName: 'Service Operator',
    keywords: [
      /\bservice\b.*\boperator\b/i,
      /\bsvc\b.*\boperator\b/i,
    ],
    confidence: 'medium',
    description: 'Catches: Service Operator (various services)'
  },

  // ============================================================================
  // EQUIPMENT & MAINTENANCE
  // ============================================================================
  {
    roleId: 'welder',
    roleName: 'Welder',
    keywords: [
      /\bwelder\b/i,
      /\bwelding\b/i,
      /\bTIG\b.*\bweld/i,
      /\bMIG\b.*\bweld/i,
      /\bstick\b.*\bweld/i,
    ],
    confidence: 'high',
    description: 'Catches: Welder, TIG Welder, Pipeline Welder, Structural Welder'
  },
  {
    roleId: 'pipefitter',
    roleName: 'Pipefitter',
    keywords: [
      /\bpipefitter\b/i,
      /\bpipe\b.*\bfitter\b/i,
      /\bsteamfitter\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Pipefitter, Pipe Fitter, Steamfitter'
  },
  {
    roleId: 'scaffolder',
    roleName: 'Scaffolder',
    keywords: [
      /\bscaffolder\b/i,
      /\bscaffolding\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Scaffolder, Scaffolding Erector'
  },
  {
    roleId: 'rigger',
    roleName: 'Rigger',
    keywords: [
      /\brigger\b/i,
      /rigging/i,
    ],
    confidence: 'high',
    description: 'Catches: Rigger, Rigging Specialist'
  },
  {
    roleId: 'rig-mechanic',
    roleName: 'Rig Mechanic',
    keywords: [
      /\brig\b.*\bmechanic\b/i,
      /\bdiesel\b\s+\bmechanic\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Rig Mechanic, Diesel Mechanic (oil & gas context)'
  },
  {
    roleId: 'millwright',
    roleName: 'Millwright/Industrial Mechanic',
    keywords: [
      /\bmillwright\b/i,
      /\bindustrial\b.*\bmechanic\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Millwright, Industrial Mechanic'
  },
  {
    roleId: 'electrician-oilfield',
    roleName: 'Electrician (Oilfield)',
    keywords: [
      /\belectrical\b.*\btechnician\b/i,
      /\belectrician\b/i,
      /\belectrical\b.*\bpower\b\s+\bsystems\b/i,
    ],
    confidence: 'medium',
    description: 'Catches: Electrical Technician, Electrician, Electrical Power Systems Engineer'
  },
  {
    roleId: 'instrumentation-tech',
    roleName: 'Instrumentation Technician',
    keywords: [
      /\binstrumentation\b/i,
      /\bI&C\b/i,
      /\binstrument\b.*\bcontrol\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Instrumentation Technician, I&C Technician'
  },
  {
    roleId: 'hydraulic-specialist',
    roleName: 'Hydraulic Specialist',
    keywords: [
      /\bhydraulic\b/i,
    ],
    confidence: 'medium',
    description: 'Catches: Hydraulic Specialist, Hydraulic Technician'
  },
  {
    roleId: 'mechanic-technician',
    roleName: 'Mechanic/Technician (General)',
    keywords: [
      /\bmechanic\b.*\btechnician\b/i,
      /\bmaintenance\b.*\btechnician\b/i,
      /\btool\b.*\btechnician\b/i,
    ],
    confidence: 'low',
    description: 'Catches: Mechanic Technician, Maintenance Technician, Tool Technician'
  },

  // ============================================================================
  // INSPECTION & INTEGRITY
  // ============================================================================
  {
    roleId: 'ndt-inspector',
    roleName: 'NDT Inspector',
    keywords: [
      /\bNDT\b/i,
      /\bnon\b.*\bdestructive\b.*\btest(?:ing)?\b/i,
      /\bultrasonic\b.*\binspect(?:ion|or)?\b/i,
      /\bradiographic\b.*\binspect(?:ion|or)?\b/i,
    ],
    confidence: 'high',
    description: 'Catches: NDT Inspector, Non-Destructive Testing Technician'
  },
  {
    roleId: 'pipeline-inspector',
    roleName: 'Pipeline Inspector',
    keywords: [
      /\bpipeline\b.*\binspect(?:ion|or)?\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Pipeline Inspector'
  },
  {
    roleId: 'coating-inspector',
    roleName: 'Coating Inspector',
    keywords: [
      /\bcoating\b.*\binspect(?:ion|or)?\b/i,
      /\bpaint\b.*\binspect(?:ion|or)?\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Coating Inspector, Paint Inspector'
  },
  {
    roleId: 'structural-inspector',
    roleName: 'Structural Inspector',
    keywords: [
      /\bstructural\b.*\binspect(?:ion|or)?\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Structural Inspector'
  },

  // ============================================================================
  // DIGITAL & AUTOMATION
  // ============================================================================
  {
    roleId: 'scada-engineer',
    roleName: 'SCADA Engineer',
    keywords: [
      /\bSCADA\b/i,
      /\bsupervisory\b.*\bcontrol\b/i,
    ],
    confidence: 'high',
    description: 'Catches: SCADA Engineer, SCADA Technician'
  },
  {
    roleId: 'automation-engineer',
    roleName: 'Automation Engineer',
    keywords: [
      /\bautomation\b.*\bengineer\b/i,
      /\bcontrol\b.*\bsystems\b.*\bengineer\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Automation Engineer, Control Systems Engineer'
  },
  {
    roleId: 'plc-technician',
    roleName: 'PLC Technician',
    keywords: [
      /\bPLC\b/i,
      /\bprogrammable\b.*\blogic\b/i,
    ],
    confidence: 'high',
    description: 'Catches: PLC Technician, PLC Programmer'
  },
  {
    roleId: 'data-analyst-energy',
    roleName: 'Data Analyst (Energy)',
    keywords: [
      /\bdata\b.*\banalyst\b.*\benergy\b/i,
      /\benergy\b.*\bdata\b.*\banalyst\b/i,
    ],
    confidence: 'medium',
    description: 'Catches: Data Analyst (Energy sector)'
  },

  // ============================================================================
  // WIND ENERGY
  // ============================================================================
  {
    roleId: 'wind-turbine-technician',
    roleName: 'Wind Turbine Technician',
    keywords: [
      /\bwind\b.*\bturbine\b/i,
      /\bWTT\b/i,
      /\bturbine\b.*\btech(?:nician)?\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Wind Turbine Technician, WTT'
  },
  {
    roleId: 'blade-technician',
    roleName: 'Blade Technician',
    keywords: [
      /\bblade\b.*\btech(?:nician)?\b/i,
      /\bblade\b.*\brepair\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Blade Technician, Blade Repair Technician (wind energy)'
  },

  // ============================================================================
  // ENERGY TRANSITION & DECARBONIZATION
  // ============================================================================
  {
    roleId: 'ccs-engineer',
    roleName: 'CCS Engineer',
    keywords: [
      /\bCCS\b.*\bengineer\b/i,
      /\bcarbon\b.*\bcapture\b.*\bengineer\b/i,
      /\bcarbon\b.*\bstorage\b/i,
    ],
    confidence: 'high',
    description: 'Catches: CCS Engineer, Carbon Capture and Storage Engineer'
  },
  {
    roleId: 'hydrogen-engineer',
    roleName: 'Hydrogen Engineer',
    keywords: [
      /\bhydrogen\b.*\bengineer\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Hydrogen Engineer, Hydrogen Systems Engineer'
  },
  {
    roleId: 'hydrogen-technician',
    roleName: 'Hydrogen Technician',
    keywords: [
      /\bhydrogen\b.*\btech(?:nician)?\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Hydrogen Technician'
  },

  // ============================================================================
  // SPECIALIZED ROLES
  // ============================================================================
  {
    roleId: 'rope-access-technician',
    roleName: 'Rope Access Technician',
    keywords: [
      /\brope\b.*\baccess\b/i,
      /\bIRATA\b/i,
    ],
    confidence: 'high',
    description: 'Catches: Rope Access Technician, IRATA Level 1/2/3'
  },

  // ============================================================================
  // SUPPORT ROLES (Lower confidence - very general terms)
  // ============================================================================
  {
    roleId: 'lab-technician',
    roleName: 'Laboratory Technician',
    keywords: [
      /\blab\b.*\btechnician\b/i,
      /\blaboratory\b/i,
    ],
    confidence: 'medium',
    description: 'Catches: Laboratory Technician, Lab Supervisor'
  },
  {
    roleId: 'materials-specialist',
    roleName: 'Materials Specialist',
    keywords: [
      /\bmaterials\b.*\b(?:scientist|engineer|specialist)\b/i,
      /\bmetallics\b/i,
      /\bwelding\b.*\bengineer\b/i,
    ],
    confidence: 'medium',
    description: 'Catches: Materials Scientist, Metallics & Welding Engineer'
  },
  {
    roleId: 'hse-specialist',
    roleName: 'HSE Specialist',
    keywords: [
      /\bHSE\b/i,
      /\bhealth\b.*\bsafety\b.*\benvironment\b/i,
      /\bwell\b\s+\bcontrol\b/i,
    ],
    confidence: 'medium',
    description: 'Catches: HSE Coordinator, Well Control Instructor'
  },
];

/**
 * Match job title to energy sector role using keywords
 *
 * @param {string} jobTitle - The job title to match
 * @param {string} jobDescription - Optional job description for additional context
 * @returns {Object|null} Match result with { roleId, roleName, confidence, matchedKeyword } or null
 *
 * @example
 * matchEnergyRole("Field Professional - MWD, II")
 * // Returns: { roleId: 'mwd-lwd', roleName: 'MWD/LWD Specialist', confidence: 'high', matchedKeyword: 'MWD' }
 *
 * matchEnergyRole("Wireline Field Operator")
 * // Returns: { roleId: 'wireline-operator', roleName: 'Wireline Operator/Engineer', confidence: 'high', matchedKeyword: 'wireline' }
 */
export function matchEnergyRole(jobTitle, jobDescription = '') {
  if (!jobTitle || typeof jobTitle !== 'string') {
    return null;
  }

  // Combine title and description for matching
  const searchText = `${jobTitle} ${jobDescription}`.trim();

  // Iterate through patterns in order (most specific first)
  for (const pattern of ENERGY_ROLE_PATTERNS) {
    for (const keyword of pattern.keywords) {
      if (keyword.test(searchText)) {
        // Extract the matched keyword for debugging/logging
        const match = searchText.match(keyword);
        const matchedKeyword = match ? match[0] : keyword.source;

        return {
          roleId: pattern.roleId,
          roleName: pattern.roleName,
          confidence: pattern.confidence,
          matchedKeyword,
        };
      }
    }
  }

  return null;
}

/**
 * Get all available role categories
 *
 * @returns {Array} Array of role objects with { roleId, roleName }
 */
export function getEnergyRoles() {
  return ENERGY_ROLE_PATTERNS.map(({ roleId, roleName }) => ({
    roleId,
    roleName,
  }));
}

/**
 * Batch match multiple job titles
 *
 * @param {Array<{title: string, description?: string}>} jobs - Array of job objects
 * @returns {Array<Object>} Array of match results
 */
export function batchMatchEnergyRoles(jobs) {
  return jobs.map(job => ({
    ...job,
    match: matchEnergyRole(job.title, job.description),
  }));
}

/**
 * Get matching statistics for a set of jobs
 *
 * @param {Array<{title: string, description?: string}>} jobs - Array of job objects
 * @returns {Object} Statistics about matches
 */
export function getMatchStatistics(jobs) {
  const matches = batchMatchEnergyRoles(jobs);
  const matched = matches.filter(m => m.match !== null);

  const byRole = matched.reduce((acc, m) => {
    const roleId = m.match.roleId;
    acc[roleId] = (acc[roleId] || 0) + 1;
    return acc;
  }, {});

  const byConfidence = matched.reduce((acc, m) => {
    const conf = m.match.confidence;
    acc[conf] = (acc[conf] || 0) + 1;
    return acc;
  }, {});

  return {
    total: jobs.length,
    matched: matched.length,
    unmatched: jobs.length - matched.length,
    matchRate: (matched.length / jobs.length * 100).toFixed(1) + '%',
    byRole,
    byConfidence,
  };
}

export default {
  matchEnergyRole,
  getEnergyRoles,
  batchMatchEnergyRoles,
  getMatchStatistics,
};
