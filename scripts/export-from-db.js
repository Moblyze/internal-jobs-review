/**
 * Temporary export script - reads from scraper's SQLite database
 * Use this until Google Sheets is ready
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../../job-scraping/data/scraper_state.db');
const OUTPUT_PATH = path.join(__dirname, '../public/data/jobs.json');

console.log('📊 Reading jobs from SQLite database...');

try {
  const db = new Database(DB_PATH, { readonly: true });

  const jobs = db.prepare(`
    SELECT
      url,
      company,
      title,
      status,
      first_seen,
      last_seen,
      status_changed_date
    FROM scraped_jobs
    ORDER BY company, last_seen DESC
  `).all();

  console.log(`✅ Found ${jobs.length} jobs in database`);

  // Convert to web app format
  const formattedJobs = jobs.map(job => ({
    id: job.url.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().substring(0, 100),
    title: job.title,
    company: job.company,
    location: '', // Not in DB, will be empty
    description: `View this ${job.company} position at the link below.`,
    url: job.url,
    postedDate: job.first_seen,
    skills: [],
    salary: null,
    status: job.status || 'active',
    statusChangedDate: job.status_changed_date,
    scrapedAt: job.last_seen
  }));

  // Summary by company
  const byCompany = formattedJobs.reduce((acc, job) => {
    if (!acc[job.company]) acc[job.company] = { total: 0, active: 0, removed: 0 };
    acc[job.company].total++;
    if (job.status === 'active') acc[job.company].active++;
    if (job.status === 'removed') acc[job.company].removed++;
    return acc;
  }, {});

  console.log('\n📈 Summary by company:');
  Object.entries(byCompany).forEach(([company, stats]) => {
    console.log(`  ${company}: ${stats.active} active, ${stats.removed} removed (${stats.total} total)`);
  });

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write to JSON
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(formattedJobs, null, 2), 'utf8');
  console.log(`\n📝 Exported to ${OUTPUT_PATH}`);
  console.log(`\n✨ Website ready! Refresh http://localhost:5173`);

  db.close();
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
