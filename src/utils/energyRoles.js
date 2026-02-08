/**
 * Energy Sector Role Taxonomy
 *
 * Maps O*NET occupation codes to user-friendly role categories
 * for filtering jobs by energy sector occupations.
 *
 * Based on Moblyze energy sector roles:
 * https://www.notion.so/dc37de1493f743909fc2a3f1129a42f8
 */

/**
 * Energy sector role categories with O*NET mappings
 * Based on actual job dataset analysis (523 jobs, 178 unique O*NET codes)
 */
export const ENERGY_ROLES = {
  // === UPSTREAM - DRILLING & WELL OPERATIONS ===

  // ROV & Subsea Operations (Keyword-matched roles)
  'rov-supervisor': {
    label: 'ROV Supervisor',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },
  'rov-pilot-technician': {
    label: 'ROV Pilot/Technician',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },
  'subsea-engineer': {
    label: 'Subsea Engineer',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // Offshore & Marine Operations
  'saturation-diver': {
    label: 'Saturation Diver',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },
  'diving-marine': {
    label: 'Diving & Marine',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },
  'dp-operator': {
    label: 'DP Operator',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },
  'chief-engineer-marine': {
    label: 'Chief Engineer (Marine)',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },
  'offshore-operations': {
    label: 'Offshore Operations',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // E&I and Instrumentation
  'ei-technician': {
    label: 'E&I Technician',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // Drilling Operations
  'drilling-operations': {
    label: 'Drilling Operations',
    onet_codes: [
      '47-5071.00', // Roustabouts, Oil and Gas (12 jobs)
      '47-5013.00', // Service Unit Operators, Oil and Gas (9 jobs)
      '47-5012.00', // Rotary Drill Operators, Oil and Gas (2 jobs)
      '47-5023.00', // Earth Drillers, Except Oil and Gas (2 jobs)
    ],
    keywords: ['driller', 'toolpusher', 'derrick hand', 'roughneck', 'floorhand', 'rig crew', 'drilling foreman', 'tour pusher'],
    icon: '',
    category: 'drilling'
  },
  'driller-rig-crew': {
    label: 'Driller & Rig Crew',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },
  'assistant-driller': {
    label: 'Assistant Driller',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // Directional Drilling
  'directional-drilling': {
    label: 'Directional Drilling',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },
  'drilling-engineer': {
    label: 'Drilling Engineer',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // Mud Engineering
  'mud-engineer': {
    label: 'Mud Engineer/Specialist',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // MWD/LWD Services
  'mwd-lwd': {
    label: 'MWD/LWD Specialist',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // Wireline Services
  'wireline-operator': {
    label: 'Wireline Operator/Engineer',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },
  'slickline': {
    label: 'Slickline Operator',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // Coiled Tubing
  'coiled-tubing': {
    label: 'Coiled Tubing Operator',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // Cementing Services
  'cementing-services': {
    label: 'Cementing Services',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // Well Testing
  'well-testing': {
    label: 'Well Testing',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // Stimulation & Fracturing
  'fracturing-stimulation': {
    label: 'Fracturing & Stimulation',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // Completions
  'completions': {
    label: 'Completions Specialist',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // Workover & Intervention
  'workover-intervention': {
    label: 'Workover & Well Intervention',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // Artificial Lift
  'artificial-lift': {
    label: 'Artificial Lift Specialist',
    onet_codes: [],
    icon: '',
    category: 'drilling'
  },

  // === UPSTREAM - PRODUCTION OPERATIONS ===

  // Production Operations
  'production-operator': {
    label: 'Production Operator',
    onet_codes: [],
    icon: '',
    category: 'production'
  },
  'production-engineer': {
    label: 'Production Engineer',
    onet_codes: [],
    icon: '',
    category: 'production'
  },

  // Process & Plant Operations
  'process-operator': {
    label: 'Process Operator',
    onet_codes: [],
    icon: '',
    category: 'production'
  },
  'plant-operator': {
    label: 'Plant Operator',
    onet_codes: [],
    icon: '',
    category: 'production'
  },
  'control-room-operator': {
    label: 'Control Room Operator',
    onet_codes: [],
    icon: '',
    category: 'production'
  },
  'reactor-operator': {
    label: 'Reactor Operator',
    onet_codes: [],
    icon: '',
    category: 'production'
  },

  // Field Services
  'field-engineer': {
    label: 'Field Engineer',
    onet_codes: [],
    icon: '',
    category: 'production'
  },
  'field-specialist': {
    label: 'Field Specialist/Technician',
    onet_codes: [],
    icon: '',
    category: 'production'
  },
  'service-operator': {
    label: 'Service Operator',
    onet_codes: [],
    icon: '',
    category: 'production'
  },

  // Equipment Operations
  'crane-operator': {
    label: 'Crane Operator',
    onet_codes: [],
    icon: '',
    category: 'production'
  },

  // === UPSTREAM - RESERVOIR & GEOSCIENCE ===

  // Reservoir Engineering
  'reservoir-engineer': {
    label: 'Reservoir Engineer',
    onet_codes: [],
    icon: '',
    category: 'geoscience'
  },

  // Petroleum Engineering
  'petroleum-engineer': {
    label: 'Petroleum Engineer',
    onet_codes: [
      '17-2171.00', // Petroleum Engineers (6 jobs)
    ],
    icon: '',
    category: 'geoscience'
  },

  // Petrophysics
  'petrophysicist': {
    label: 'Petrophysicist',
    onet_codes: [],
    icon: '',
    category: 'geoscience'
  },

  // Geology & Geophysics
  'geologist': {
    label: 'Geologist',
    onet_codes: [],
    icon: '',
    category: 'geoscience'
  },
  'geophysicist': {
    label: 'Geophysicist',
    onet_codes: [],
    icon: '',
    category: 'geoscience'
  },
  'geoscientist': {
    label: 'Geoscientist',
    onet_codes: [],
    icon: '',
    category: 'geoscience'
  },

  // Geoscientists
  'geoscientists': {
    label: 'Geoscientists & Earth Scientists',
    onet_codes: [
      '19-2042.00', // Geoscientists, Except Hydrologists and Geographers (7 jobs)
      '19-4043.00', // Geological Technicians, Except Hydrologic Technicians (3 jobs)
      '19-2099.01', // Remote Sensing Scientists and Technologists (6 jobs)
      '19-4099.03', // Remote Sensing Technicians (1 job)
      '19-2012.00', // Physicists (1 job)
    ],
    icon: '',
    category: 'geoscience'
  },

  // Engineering (17-2xxx)
  'engineering-electrical': {
    label: 'Electrical & Electronics Engineers',
    onet_codes: [
      '17-2071.00', // Electrical Engineers (2 jobs)
      '17-2072.00', // Electronics Engineers, Except Computer (1 job)
    ],
    icon: '',
    category: 'engineering'
  },
  'engineering-mechanical': {
    label: 'Mechanical Engineers',
    onet_codes: [
      '17-2141.00', // Mechanical Engineers (2 jobs)
    ],
    icon: '',
    category: 'engineering'
  },
  'engineering-specialized': {
    label: 'Specialized Engineers',
    onet_codes: [
      '17-2199.11', // Solar Energy Systems Engineers (2 jobs)
      '17-2111.00', // Health and Safety Engineers (3 jobs)
      '17-2161.00', // Nuclear Engineers (3 jobs)
      '17-2199.09', // Nanosystems Engineers (3 jobs)
      '17-2041.00', // Chemical Engineers (1 job)
      '17-2011.00', // Aerospace Engineers (1 job)
      '17-2031.00', // Bioengineers and Biomedical Engineers (1 job)
      '17-2121.00', // Marine Engineers and Naval Architects (1 job)
      '17-2131.00', // Materials Engineers (1 job)
      '17-2151.00', // Mining and Geological Engineers (1 job)
      '17-2112.01', // Human Factors Engineers and Ergonomists (1 job)
    ],
    icon: '',
    category: 'engineering'
  },

  // Technical Trades (49-xxxx, 47-2xxx)

  // Welding & Fabrication
  'welder': {
    label: 'Welder',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },
  'pipefitter': {
    label: 'Pipefitter',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },
  'rigger': {
    label: 'Rigger',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },
  'scaffolder': {
    label: 'Scaffolder',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },

  // Mechanical & Equipment
  'rig-mechanic': {
    label: 'Rig Mechanic',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },
  'millwright': {
    label: 'Millwright/Industrial Mechanic',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },
  'mechanic-technician': {
    label: 'Mechanic/Technician (General)',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },

  // Electrical & Instrumentation
  'electrical-trades': {
    label: 'Electricians & Electrical Repairers',
    onet_codes: [
      '49-2095.00', // Electrical/Electronics Repairers, Powerhouse (3 jobs)
      '47-2111.00', // Electricians (2 jobs)
      '49-9051.00', // Electrical Power-Line Installers (1 job)
      '49-2094.00', // Electrical/Electronics Repairers, Commercial (1 job)
    ],
    icon: '',
    category: 'trades'
  },
  'electrician-oilfield': {
    label: 'Electrician (Oilfield)',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },
  'instrumentation-tech': {
    label: 'Instrumentation Technician',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },

  // Hydraulics & Specialized
  'hydraulic-specialist': {
    label: 'Hydraulic Specialist',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },
  'rope-access-technician': {
    label: 'Rope Access Technician',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },
  'maintenance-mechanics': {
    label: 'Maintenance & Mechanics',
    onet_codes: [
      '49-9071.00', // Maintenance and Repair Workers, General (6 jobs)
      '49-9012.00', // Control and Valve Installers and Repairers (6 jobs)
      '49-9041.00', // Industrial Machinery Mechanics (2 jobs)
      '49-3023.00', // Automotive Service Technicians (3 jobs)
      '49-2022.00', // Telecommunications Equipment Installers (1 job)
      '49-9097.00', // Signal and Track Switch Repairers (1 job)
    ],
    icon: '',
    category: 'trades'
  },
  'construction-trades': {
    label: 'Construction Trades',
    onet_codes: [
      '47-2061.00', // Construction Laborers (3 jobs)
      '47-2051.00', // Cement Masons and Concrete Finishers (2 jobs)
      '47-4041.00', // Hazardous Materials Removal Workers (2 jobs)
      '47-1011.00', // First-Line Supervisors of Construction (1 job)
      '47-1011.03', // Solar Energy Installation Managers (1 job)
    ],
    icon: '',
    category: 'trades'
  },
  'equipment-operators': {
    label: 'Equipment Operators',
    onet_codes: [
      '47-2073.00', // Operating Engineers and Construction Equipment (1 job)
    ],
    icon: '',
    category: 'trades'
  },

  // Inspection & Integrity
  'ndt-inspector': {
    label: 'NDT Inspector',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },
  'pipeline-inspector': {
    label: 'Pipeline Inspector',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },
  'coating-inspector': {
    label: 'Coating Inspector',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },
  'structural-inspector': {
    label: 'Structural Inspector',
    onet_codes: [],
    icon: '',
    category: 'trades'
  },

  // Engineering Technicians (17-3xxx)
  'engineering-technicians': {
    label: 'Engineering Technicians',
    onet_codes: [
      '17-3023.00', // Electrical/Electronic Engineering Technicians (8 jobs)
      '17-3027.00', // Mechanical Engineering Technicians (6 jobs)
      '17-3024.00', // Electro-Mechanical/Mechatronics Technicians (6 jobs)
      '17-3026.00', // Industrial Engineering Technicians (2 jobs)
      '17-3028.00', // Calibration Technologists and Technicians (1 job)
      '17-3029.08', // Photonics Technicians (1 job)
      '17-3012.00', // Electrical and Electronics Drafters (1 job)
    ],
    icon: '',
    category: 'technicians'
  },

  // Operations (51-8xxx, 51-9xxx)
  'plant-operators': {
    label: 'Plant & Process Operators',
    onet_codes: [
      '51-8013.00', // Power Plant Operators (2 jobs)
      '51-8021.00', // Stationary Engineers and Boiler Operators (1 job)
      '51-8091.00', // Chemical Plant and System Operators (1 job)
      '51-8093.00', // Petroleum Pump System Operators (1 job)
      '51-8013.04', // Hydroelectric Plant Technicians (1 job)
      '53-7071.00', // Gas Compressor and Pumping Station Operators (1 job)
    ],
    icon: '',
    category: 'operations'
  },
  'production-workers': {
    label: 'Production & Process Workers',
    onet_codes: [
      '51-9199.00', // Production Workers, All Other (29 jobs)
      '51-9191.00', // Adhesive Bonding Machine Operators (13 jobs)
      '51-9011.00', // Chemical Equipment Operators and Tenders (5 jobs)
      '51-9061.00', // Inspectors, Testers, Sorters (5 jobs)
      '51-4111.00', // Tool and Die Makers (4 jobs)
      '51-9194.00', // Etchers and Engravers (4 jobs)
      '51-9021.00', // Crushing, Grinding, Polishing Machine Operators (3 jobs)
      '51-4081.00', // Multiple Machine Tool Setters (2 jobs)
      '51-1011.00', // First-Line Supervisors of Production (1 job)
      '51-9023.00', // Mixing and Blending Machine Operators (1 job)
      '51-9198.00', // Helpers--Production Workers (1 job)
      '51-4032.00', // Drilling and Boring Machine Tool Setters (1 job)
      '51-4199.00', // Metal Workers and Plastic Workers, All Other (1 job)
    ],
    icon: '',
    category: 'operations'
  },

  // Management (11-xxxx)
  'engineering-management': {
    label: 'Engineering & Technical Management',
    onet_codes: [
      '11-9041.00', // Architectural and Engineering Managers (6 jobs)
      '11-9041.01', // Biofuels/Biodiesel Development Managers (51 jobs)
      '11-9199.10', // Wind Energy Development Managers (1 job)
      '11-9021.00', // Construction Managers (1 job)
    ],
    icon: '',
    category: 'management'
  },
  'operations-management': {
    label: 'Operations & General Management',
    onet_codes: [
      '11-1011.03', // Chief Sustainability Officers (21 jobs)
      '11-1021.00', // General and Operations Managers (1 job)
      '11-3051.06', // Hydroelectric Production Managers (1 job)
    ],
    icon: '',
    category: 'management'
  },
  'supply-chain-management': {
    label: 'Supply Chain & Logistics Management',
    onet_codes: [
      '11-3071.04', // Supply Chain Managers (4 jobs)
      '11-3071.00', // Transportation, Storage, Distribution Managers (2 jobs)
      '11-3061.00', // Purchasing Managers (2 jobs)
      '11-3013.00', // Facilities Managers (2 jobs)
    ],
    icon: '',
    category: 'management'
  },

  // Support Functions (13-xxxx, 43-xxxx)
  'business-analysts': {
    label: 'Business & Financial Analysts',
    onet_codes: [
      '13-2011.00', // Accountants and Auditors (5 jobs)
      '13-2051.00', // Financial and Investment Analysts (2 jobs)
      '13-1111.00', // Management Analysts (1 job)
      '13-2052.00', // Personal Financial Advisors (1 job)
      '13-2053.00', // Insurance Underwriters (1 job)
      '13-2081.00', // Tax Examiners and Revenue Agents (1 job)
      '13-2082.00', // Tax Preparers (1 job)
      '15-2051.00', // Data Scientists (1 job)
      '15-2051.01', // Business Intelligence Analysts (1 job)
    ],
    icon: '',
    category: 'support'
  },
  'supply-chain-specialists': {
    label: 'Supply Chain & Logistics Specialists',
    onet_codes: [
      '13-1081.02', // Logistics Analysts (1 job)
      '13-1022.00', // Wholesale and Retail Buyers (1 job)
      '13-1023.00', // Purchasing Agents (1 job)
      '43-3061.00', // Procurement Clerks (1 job)
      '43-5061.00', // Production, Planning, Expediting Clerks (2 jobs)
    ],
    icon: '',
    category: 'support'
  },
  'hr-admin': {
    label: 'HR & Administrative',
    onet_codes: [
      '43-3051.00', // Payroll and Timekeeping Clerks (6 jobs)
      '13-1141.00', // Compensation, Benefits, Job Analysis (2 jobs)
      '11-3121.00', // Human Resources Managers (1 job)
      '13-1151.00', // Training and Development Specialists (1 job)
      '43-1011.00', // First-Line Supervisors of Office (1 job)
      '43-3031.00', // Bookkeeping, Accounting Clerks (1 job)
      '43-6011.00', // Executive Secretaries (1 job)
      '43-4051.00', // Customer Service Representatives (3 jobs)
      '43-9021.00', // Data Entry Keyers (1 job)
    ],
    icon: '',
    category: 'support'
  },
  'compliance-safety': {
    label: 'Compliance, Safety & Quality',
    onet_codes: [
      '11-9199.02', // Compliance Managers (2 jobs)
      '13-1041.07', // Regulatory Affairs Specialists (1 job)
      '13-1199.07', // Security Management Specialists (2 jobs)
      '13-1199.04', // Business Continuity Planners (1 job)
      '11-9121.02', // Water Resource Specialists (2 jobs)
      '19-4031.00', // Chemical Technicians (2 jobs)
    ],
    icon: '',
    category: 'support'
  },

  // Digital & IT (15-xxxx)

  // Automation & Control Systems
  'scada-engineer': {
    label: 'SCADA Engineer',
    onet_codes: [],
    icon: '',
    category: 'digital'
  },
  'automation-engineer': {
    label: 'Automation Engineer',
    onet_codes: [],
    icon: '',
    category: 'digital'
  },
  'plc-technician': {
    label: 'PLC Technician',
    onet_codes: [],
    icon: '',
    category: 'digital'
  },

  // Data & Analytics
  'data-analyst-energy': {
    label: 'Data Analyst (Energy)',
    onet_codes: [],
    icon: '',
    category: 'digital'
  },

  'software-developers': {
    label: 'Software Development',
    onet_codes: [
      '15-1252.00', // Software Developers (7 jobs)
      '15-1251.00', // Computer Programmers (3 jobs)
      '15-1253.00', // Software QA Analysts and Testers (1 job)
      '15-1254.00', // Web Developers (1 job)
    ],
    icon: '',
    category: 'digital'
  },
  'it-infrastructure': {
    label: 'IT Infrastructure & Support',
    onet_codes: [
      '15-1299.09', // Information Technology Project Managers (5 jobs)
      '15-1231.00', // Computer Network Support Specialists (2 jobs)
      '15-1232.00', // Computer User Support Specialists (2 jobs)
      '15-1211.00', // Computer Systems Analysts (1 job)
      '15-1241.00', // Computer Network Architects (1 job)
      '15-1244.00', // Network and Computer Systems Administrators (1 job)
    ],
    icon: '',
    category: 'digital'
  },
  'data-specialists': {
    label: 'Data & Analytics',
    onet_codes: [
      '15-1243.01', // Data Warehousing Specialists (2 jobs)
      '15-1299.06', // Digital Forensics Analysts (2 jobs)
    ],
    icon: '',
    category: 'digital'
  },

  // Sales & Marketing
  'sales-engineers': {
    label: 'Technical Sales',
    onet_codes: [
      '41-9031.00', // Sales Engineers (1 job)
      '41-4011.00', // Sales Representatives, Technical Products (1 job)
      '41-1012.00', // First-Line Supervisors of Non-Retail Sales (1 job)
      '11-2022.00', // Sales Managers (1 job)
    ],
    icon: '',
    category: 'sales'
  },
  'marketing-specialists': {
    label: 'Marketing & Communications',
    onet_codes: [
      '27-3042.00', // Technical Writers (6 jobs)
      '13-1161.01', // Search Marketing Strategists (1 job)
      '13-1121.00', // Meeting, Convention, Event Planners (1 job)
      '43-9031.00', // Desktop Publishers (2 jobs)
    ],
    icon: '',
    category: 'sales'
  },

  // Wind Energy
  'wind-turbine-technician': {
    label: 'Wind Turbine Technician',
    onet_codes: [],
    icon: '',
    category: 'renewable'
  },
  'blade-technician': {
    label: 'Blade Technician',
    onet_codes: [],
    icon: '',
    category: 'renewable'
  },

  // Energy Transition & Decarbonization
  'ccs-engineer': {
    label: 'CCS Engineer',
    onet_codes: [],
    icon: '',
    category: 'renewable'
  },
  'hydrogen-engineer': {
    label: 'Hydrogen Engineer',
    onet_codes: [],
    icon: '',
    category: 'renewable'
  },
  'hydrogen-technician': {
    label: 'Hydrogen Technician',
    onet_codes: [],
    icon: '',
    category: 'renewable'
  },

  // Support Roles
  'lab-technician': {
    label: 'Laboratory Technician',
    onet_codes: [],
    icon: '',
    category: 'support'
  },
  'materials-specialist': {
    label: 'Materials Specialist',
    onet_codes: [],
    icon: '',
    category: 'support'
  },
  'hse-specialist': {
    label: 'HSE Specialist',
    onet_codes: [],
    icon: '',
    category: 'support'
  },

  // Transportation & Logistics
  'transportation': {
    label: 'Transportation & Logistics',
    onet_codes: [
      '53-3032.00', // Heavy and Tractor-Trailer Truck Drivers (5 jobs)
      '53-1043.00', // First-Line Supervisors of Material-Moving (2 jobs)
      '53-7062.00', // Laborers and Freight Movers (2 jobs)
      '53-4013.00', // Rail Yard Engineers, Dinkey Operators (1 job)
      '53-4041.00', // Subway and Streetcar Operators (1 job)
      '53-5021.00', // Captains, Mates, Pilots of Water Vessels (1 job)
      '53-2022.00', // Airfield Operations Specialists (1 job)
    ],
    icon: '',
    category: 'logistics'
  },

  // Other/Unmatched (Military, Education, Unrelated)
  'other': {
    label: 'Other Roles',
    onet_codes: [
      // Military codes (92 jobs - these are mismatches from O*NET API)
      '55-3015.00', // Command and Control Center Specialists (38 jobs)
      '33-3012.00', // Correctional Officers and Jailers (14 jobs)
      '55-1019.00', // Military Officer Special Ops (5 jobs)
      '55-1015.00', // Command and Control Center Officers (4 jobs)
      '33-3021.00', // Detectives and Criminal Investigators (3 jobs)
      '55-1014.00', // Artillery and Missile Officers (2 jobs)
      '55-2012.00', // First-Line Supervisors of Weapons (1 job)
      '55-3019.00', // Military Enlisted Tactical Operations (1 job)
      // Education codes (13 jobs - unrelated)
      '11-9032.00', // Education Administrators K-12 (4 jobs)
      '25-2055.00', // Special Education Teachers, Kindergarten (2 jobs)
      '25-2022.00', // Middle School Teachers (2 jobs)
      '25-1051.00', // Earth Sciences Teachers, Postsecondary (2 jobs)
      '25-1122.00', // Communications Teachers, Postsecondary (2 jobs)
      '25-1021.00', // Computer Science Teachers (1 job)
      '25-1113.00', // Social Work Teachers (1 job)
      '25-2012.00', // Kindergarten Teachers (1 job)
      '25-2032.00', // Career/Technical Education Teachers (1 job)
      '25-3011.00', // Adult Basic Education Instructors (1 job)
      '11-9033.00', // Education Administrators, Postsecondary (1 job)
      // Entertainment/Service (14 jobs - unrelated)
      '27-2012.04', // Talent Directors (3 jobs)
      '43-4011.00', // Brokerage Clerks (3 jobs)
      '27-2011.00', // Actors (1 job)
      '27-3092.00', // Court Reporters (1 job)
      '39-1022.00', // First-Line Supervisors Personal Service (1 job)
      '39-2011.00', // Animal Trainers (1 job)
      '39-3091.00', // Amusement and Recreation Attendants (1 job)
      '11-9051.00', // Food Service Managers (1 job)
      '43-4081.00', // Hotel/Motel Desk Clerks (1 job)
      '43-5052.00', // Postal Service Mail Carriers (2 jobs)
      // Healthcare/Social (9 jobs - unrelated)
      '29-2034.00', // Radiologic Technologists (2 jobs)
      '21-1011.00', // Substance Abuse Counselors (1 job)
      '21-1015.00', // Rehabilitation Counselors (1 job)
      '21-1092.00', // Probation Officers (1 job)
      '21-1099.00', // Community and Social Service (1 job)
      '29-1122.00', // Occupational Therapists (1 job)
      '29-2011.00', // Medical Lab Technologists (1 job)
      '29-2042.00', // Emergency Medical Technicians (1 job)
      // Other miscellaneous (20 jobs)
      '27-1025.00', // Interior Designers (2 jobs)
      '51-3023.00', // Slaughterers and Meat Packers (1 job)
      '51-6062.00', // Textile Cutting Machine Operators (1 job)
      '19-1012.00', // Food Scientists and Technologists (1 job)
      '19-4012.01', // Precision Agriculture Technicians (1 job)
      '45-4011.00', // Forest and Conservation Workers (1 job)
      '23-1011.00', // Lawyers (1 job)
      '13-1199.00', // Business Operations Specialists, All Other (1 job)
    ],
    icon: '',
    category: 'other'
  }
}

/**
 * Map O*NET code or job title to energy role category
 *
 * @param {string} onetCode - O*NET-SOC code (e.g., "47-2111.00")
 * @param {string} jobTitle - Job title for keyword matching (optional)
 * @returns {object} Role object with id and metadata
 */
export function getEnergyRole(onetCode, jobTitle = '') {
  if (!onetCode && !jobTitle) {
    return { id: 'other', ...ENERGY_ROLES.other }
  }

  // First, try O*NET code matching
  if (onetCode) {
    for (const [roleId, role] of Object.entries(ENERGY_ROLES)) {
      if (role.onet_codes && role.onet_codes.includes(onetCode)) {
        return { id: roleId, ...role }
      }
    }
  }

  // Second, try keyword matching on job title
  if (jobTitle) {
    const normalizedTitle = jobTitle.toLowerCase()
    for (const [roleId, role] of Object.entries(ENERGY_ROLES)) {
      if (role.keywords) {
        for (const keyword of role.keywords) {
          if (normalizedTitle.includes(keyword.toLowerCase())) {
            return { id: roleId, ...role }
          }
        }
      }
    }
  }

  // Default to "other" if no match
  return { id: 'other', ...ENERGY_ROLES.other }
}

/**
 * Get all role categories (for grouping in UI)
 *
 * @returns {object} Categories with their roles
 */
export function getRolesByCategory() {
  const categories = {}

  Object.entries(ENERGY_ROLES).forEach(([roleId, role]) => {
    const category = role.category
    if (!categories[category]) {
      categories[category] = []
    }
    categories[category].push({ id: roleId, ...role })
  })

  return categories
}

/**
 * Get human-readable category labels
 */
export const CATEGORY_LABELS = {
  drilling: 'Drilling & Well Services',
  production: 'Production & Field Operations',
  geoscience: 'Reservoir & Geoscience',
  engineering: 'Engineering',
  trades: 'Technical Trades',
  technicians: 'Engineering Technicians',
  operations: 'Plant & Process Operations',
  management: 'Management',
  support: 'Support Functions',
  digital: 'Digital & IT',
  renewable: 'Renewable & Energy Transition',
  sales: 'Sales & Marketing',
  logistics: 'Transportation & Logistics',
  other: 'Other Roles'
}

/**
 * Category display order
 */
export const CATEGORY_ORDER = [
  'drilling',
  'production',
  'geoscience',
  'engineering',
  'trades',
  'technicians',
  'operations',
  'management',
  'support',
  'digital',
  'renewable',
  'sales',
  'logistics',
  'other'
]
