/**
 * Test suite for energyJobMatcher.js
 * Validates matching against actual job titles from the dataset
 */

import { matchEnergyRole, getMatchStatistics, getEnergyRoles } from '../energyJobMatcher.js';

// Sample of actual job titles from jobs.json (Baker Hughes, Halliburton, Schlumberger)
const testJobs = [
  // MWD/LWD
  { title: "Field Professional - MWD, II", expected: 'mwd-lwd' },
  { title: "Field Specialist IV - LWD/DD", expected: 'mwd-lwd' },
  { title: "Cunduacán, Tabasco - Field Engineer MLWD, II", expected: 'mwd-lwd' },

  // Wireline
  { title: "Wireline Field Operator", expected: 'wireline-operator' },
  { title: "Argentina - Neuquen: Operadore/as / Ingeniero/as de Wireline & Perforating", expected: 'wireline-operator' },
  { title: "General Field Professional - Logging & Perforating", expected: 'wireline-operator' },
  { title: "Perforating Specialist - Senior Field Professional - Wireline - 204088", expected: 'wireline-operator' },

  // Cementing
  { title: "Aberdeen - Svc Operator I-Cementing", expected: 'cementing-services' },
  { title: "Associate Technical Professional - Cementing", expected: 'cementing-services' },
  { title: "Bulk Material Operator (I-III) Cementing", expected: 'cementing-services' },
  { title: "Heavy Truck Driver - Cementing", expected: 'cementing-services' },

  // Fracturing
  { title: "Argentina - Neuquén: Operadores/as / Supervisores/as / Ingenieros/as en Fractura", expected: 'fracturing-stimulation' },
  { title: "Ecuador - Francisco De Orellana - Supervisor de Fracturas y Estimulaciones - Production Enhancement", expected: 'fracturing-stimulation' },
  { title: "Ecuador, Coca-Ingeniero de Fracturamiento-Production Enhancement", expected: 'fracturing-stimulation' },
  { title: "Ingeniero de Fracturamiento / Fracturing Engineer", expected: 'fracturing-stimulation' },

  // Well Testing
  { title: "Brasil - RJ - Macaé - Especialista em Serviços Surface Well Testing - Testing and Subsea", expected: 'subsea-engineer' },
  { title: "Reforma, Chiapas - Especialista de Surface Well Testing.", expected: 'well-testing' },
  { title: "Service Supervisor-Surface Well Testg, II", expected: 'well-testing' },

  // Completions
  { title: "Associate Technical Professional , Completions", expected: 'completions' },
  { title: "Completions Service  Specialist III", expected: 'completions' },
  { title: "Service Specialist (I - III) - Completion Tools", expected: 'completions' },
  { title: "Senior Completion Engineer (2-year contract)", expected: 'completions' },

  // Coiled Tubing
  { title: "Coca, Ecuador - Asistente de Operador, Coiled Tubing", expected: 'coiled-tubing' },

  // Artificial Lift
  { title: "Ciudad del Carmen, México - Field Engineer Artificial Lift", expected: 'artificial-lift' },
  { title: "Artificial Lift Test Technician II - Netherlands, Emmen", expected: 'artificial-lift' },

  // Directional Drilling
  { title: "Ecuador- Francisco de Orellana- Ingeniero de Perforación Direccional-Sperry Drilling Svcs-", expected: 'directional-drilling' },
  { title: "Field Professional - Geosteering, II", expected: 'directional-drilling' },
  { title: "Geosteering Geologist", expected: 'directional-drilling' },

  // Drilling
  { title: "Brazil - RJ - Macaé: Well Design Consultant - Sperry Drilling Svcs", expected: 'petroleum-engineer' },
  { title: "Commuter - Managed Pressure Drilling", expected: 'drilling-engineer' },
  { title: "Drill Bits Application Engineer", expected: 'drilling-engineer' },

  // Well Engineering
  { title: "Brazil - Macaé - Well Engineer", expected: 'petroleum-engineer' },
  { title: "Well Site Supv, I", expected: 'driller-rig-crew' },

  // Geologists
  { title: "Logging Geologist II - SDL", expected: 'geologist' },
  { title: "Paramaribo - Suriname: Logging Geologist", expected: 'geologist' },
  { title: "Geoscientist (Advisor) Wireline and Perforating", expected: 'wireline-operator' },

  // Production
  { title: "Production Advisor", expected: 'production-engineer' },
  { title: "Pump Design Engineer (Senior - Principal - Advisor) Production Enhancement", expected: 'fracturing-stimulation' },

  // Offshore
  { title: "Coordenadora(or) de Operações Offshore", expected: 'offshore-operations' },
  { title: "Human & Organizational Performance Coach (Offshore Position)", expected: 'offshore-operations' },

  // Mechanics & Technicians
  { title: "Diesel Mechanic Technician (I - III)", expected: 'rig-mechanic' },
  { title: "Electrical Technician I", expected: 'electrician-oilfield' },
  { title: "Electronic Technician (I - III)", expected: 'instrumentation-tech' },
  { title: "Electro/Mechanical Technician - Senior Electro/Mechanical Technician", expected: 'instrumentation-tech' },
  { title: "Mechanic Technician (I - III) - Maintenance", expected: 'mechanic-technician' },

  // Engineering (General)
  { title: "Electrical Engineer - Surface Equipment (Senior - Principal - Advisor) - Production Enhancement", expected: 'fracturing-stimulation' },

  // Materials/Lab
  { title: "Materials Scientist - Metallics & Welding (Engineer - Senior - Principal) Drill Bits and Services", expected: 'materials-specialist' },
  { title: "Laboratory Technician-Chemistry (Associate- Senior)", expected: 'lab-technician' },

  // HSE
  { title: "Technical Instructor (Senior - Principal) Boots & Coots Well Control", expected: 'hse-specialist' },

  // Non-energy roles (should NOT match)
  { title: "Administrative Specialist", expected: null },
  { title: "Account Manager I-III - Landmark", expected: null },
  { title: "Supply Chain Localization Leader", expected: null },
  { title: "Angular & Node.js Developer", expected: null },
  { title: "Applications Engineer I - Service Delivery Applications", expected: null },
  { title: "Chemical Engineer I", expected: null },
];

// Run tests
console.log("=".repeat(80));
console.log("ENERGY JOB MATCHER TEST RESULTS");
console.log("=".repeat(80));
console.log();

let passed = 0;
let failed = 0;
const failures = [];

testJobs.forEach(job => {
  const match = matchEnergyRole(job.title);
  const actualRoleId = match ? match.roleId : null;

  if (actualRoleId === job.expected) {
    passed++;
    console.log(`✓ ${job.title}`);
    if (match) {
      console.log(`  → ${match.roleName} [${match.confidence}]`);
    }
  } else {
    failed++;
    failures.push({
      title: job.title,
      expected: job.expected,
      actual: actualRoleId,
      match: match
    });
    console.log(`✗ ${job.title}`);
    console.log(`  Expected: ${job.expected || 'null'}`);
    console.log(`  Got: ${actualRoleId || 'null'}`);
    if (match) {
      console.log(`  → ${match.roleName} [${match.confidence}]`);
    }
  }
  console.log();
});

console.log("=".repeat(80));
console.log("TEST SUMMARY:");
console.log("-".repeat(80));
console.log(`Total: ${testJobs.length}`);
console.log(`Passed: ${passed} (${(passed/testJobs.length*100).toFixed(1)}%)`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log();
  console.log("FAILURES:");
  failures.forEach(f => {
    console.log(`  - ${f.title}`);
    console.log(`    Expected: ${f.expected}, Got: ${f.actual}`);
  });
}

// Statistics
console.log();
console.log("=".repeat(80));
console.log("MATCH STATISTICS:");
console.log("-".repeat(80));

const stats = getMatchStatistics(testJobs);
console.log(`Total jobs: ${stats.total}`);
console.log(`Matched: ${stats.matched}`);
console.log(`Unmatched: ${stats.unmatched}`);
console.log(`Match rate: ${stats.matchRate}`);
console.log();

console.log("Matches by role:");
Object.entries(stats.byRole)
  .sort((a, b) => b[1] - a[1])
  .forEach(([role, count]) => {
    console.log(`  ${role}: ${count}`);
  });
console.log();

console.log("Matches by confidence:");
Object.entries(stats.byConfidence).forEach(([conf, count]) => {
  console.log(`  ${conf}: ${count}`);
});

console.log();
console.log("=".repeat(80));

// Exit with error code if tests failed
if (failed > 0) {
  process.exit(1);
}
