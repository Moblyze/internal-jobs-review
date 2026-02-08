# Scripts Directory

Data processing and ingestion scripts for the Moblyze Jobs Web project.

## Available Scripts

### Data Export

#### `export-jobs.js`
Exports jobs from the main data source.

```bash
npm run export-jobs
```

**Output:** `public/data/jobs.json`

---

#### `export-from-db.js`
Exports jobs directly from the database.

```bash
npm run export-from-db
```

**Requirements:** Database connection configured
**Output:** `public/data/jobs.json`

---

### Data Enhancement

#### `process-descriptions.js`
Batch processes job descriptions using AI to create structured descriptions.

```bash
# Process all jobs
npm run process-descriptions

# Dry run (test without saving)
npm run process-descriptions -- --dry-run

# Process first 10 jobs
npm run process-descriptions -- --limit=10

# Skip already-processed jobs
npm run process-descriptions -- --skip-processed
```

**Requirements:**
- `src/utils/aiDescriptionParser.js` must exist
- API keys configured in `.env`

**Output:** Adds `structuredDescription` field to each job in `jobs.json`

**Documentation:** See `/docs/BATCH_PROCESSING_GUIDE.md`

---

#### `geocode-locations.js`
Geocodes job locations using Mapbox API.

```bash
npm run geocode-locations
```

**Requirements:**
- `VITE_MAPBOX_TOKEN` in `.env`
- `public/data/jobs.json` exists

**Output:** `public/data/locations-geocoded.json`

**Features:**
- Resume capability (skips already-geocoded locations)
- Rate limiting (respects Mapbox API limits)
- Progress tracking

---

#### `build-skills-cache.js`
Builds O*NET skills cache for job matching.

```bash
node scripts/build-skills-cache.js
```

**Requirements:**
- O*NET API credentials in `.env`

**Output:** Skills cache file

---

### Verification & Testing

#### `verify-setup.js`
Verifies geocoding setup and configuration.

```bash
npm run verify-geocoding
```

**Checks:**
- Mapbox token validity
- File permissions
- Data structure

---

#### `test-geocode-integration.js`
Tests geocoding integration.

```bash
npm run test-geocode
```

---

#### `test-*.js` (Various)
Unit and integration tests for specific features:

- `test-energy-regions.js` - Energy region mapping
- `test-integration.js` - General integration tests
- `test-onet-*.js` - O*NET API integration tests
- `test-skill-standardization.js` - Skills processing

Run directly with Node:
```bash
node scripts/test-<name>.js
```

---

## Data Pipeline

Standard data ingestion workflow:

```bash
# 1. Export jobs
npm run export-from-db

# 2. Process descriptions with AI
npm run process-descriptions

# 3. Geocode locations
npm run geocode-locations

# 4. Verify data
npm run verify-geocoding

# 5. Build & deploy
npm run build
```

## Script Patterns

### Common Options

Most scripts support these patterns:

```bash
# Dry run (no changes)
script-name -- --dry-run

# Limit processing
script-name -- --limit=N

# Skip already processed
script-name -- --skip-processed

# Custom rate limiting
script-name -- --rate-limit=MS
```

### Progress Tracking

Scripts show progress bars:

```
[████████████████░░░░░░░░] 65.0% (130/200) ✓ Processing item...
```

### Error Handling

- Errors logged to `logs/` directory
- Automatic retries for transient failures
- Backup files created before modifications

### Rate Limiting

All API-dependent scripts include rate limiting:

- Default delays configured per API limits
- Customizable via `--rate-limit` flag
- Automatic backoff on errors

## Environment Variables

Required in `.env`:

```bash
# Mapbox (for geocoding)
VITE_MAPBOX_TOKEN=pk.xxx

# AI Services (for description processing)
VITE_ANTHROPIC_API_KEY=sk-xxx
# OR
VITE_OPENAI_API_KEY=sk-xxx

# O*NET (for skills processing)
ONET_USERNAME=xxx
ONET_PASSWORD=xxx

# Database (for data export)
DATABASE_URL=xxx
```

## Output Files

Scripts write to these locations:

```
public/data/
├── jobs.json                  # Main jobs data (enhanced)
├── jobs.backup.json          # Auto-backup (gitignored)
└── locations-geocoded.json   # Geocoding cache

logs/
├── description-processing-errors.log
├── geocoding-errors.log
└── [other error logs]
```

## Adding New Scripts

When creating a new data processing script:

### 1. File Location
Place in `scripts/` directory with descriptive name:
```
scripts/
└── process-<feature>.js
```

### 2. Script Template

```javascript
#!/usr/bin/env node

/**
 * Script Purpose
 *
 * Brief description
 *
 * Usage:
 *   npm run script-name [--options]
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Configuration
const INPUT_FILE = path.join(__dirname, '../public/data/input.json')
const OUTPUT_FILE = path.join(__dirname, '../public/data/output.json')

// Parse arguments
function parseArgs() {
  // ... argument parsing
}

// Main function
async function main() {
  console.log('\n🚀 Script Name\n')

  // 1. Validate prerequisites
  // 2. Load data
  // 3. Process with progress tracking
  // 4. Save results
  // 5. Print summary

  console.log('\n✅ Complete!\n')
}

// Run
main().catch(error => {
  console.error('\n❌ Fatal error:', error)
  process.exit(1)
})
```

### 3. Add to package.json

```json
{
  "scripts": {
    "script-name": "node scripts/script-name.js"
  }
}
```

### 4. Document

Add entry to this README and create guide in `/docs/` if complex.

### 5. Include Features

Standard features to include:

- ✅ Progress tracking (visual bar)
- ✅ Error logging (to logs/ directory)
- ✅ Backup creation (before modifying data)
- ✅ Resume capability (skip processed items)
- ✅ Dry-run mode (test without saving)
- ✅ Rate limiting (if API-dependent)
- ✅ Clear success/error messages
- ✅ Usage documentation in header

## Best Practices

### Error Handling

```javascript
try {
  // Process
} catch (error) {
  logError(item.id, error)
  stats.failed++
  // Continue or abort based on criticality
}
```

### Progress Tracking

```javascript
function drawProgressBar(current, total, label) {
  const percentage = ((current / total) * 100).toFixed(1)
  const barLength = 40
  const filled = Math.round((current / total) * barLength)
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled)
  process.stdout.write(`\r[${bar}] ${percentage}% (${current}/${total}) ${label}`)
}
```

### Rate Limiting

```javascript
const RATE_LIMIT = 500 // ms

for (let i = 0; i < items.length; i++) {
  await processItem(items[i])

  if (i < items.length - 1) {
    await sleep(RATE_LIMIT)
  }
}
```

### Backups

```javascript
function createBackup(data) {
  const backupPath = DATA_FILE.replace('.json', '.backup.json')
  fs.writeFileSync(backupPath, JSON.stringify(data, null, 2))
  return backupPath
}
```

## Troubleshooting

### Common Issues

**Problem:** Script hangs indefinitely

**Solution:** Check for:
- Network connectivity
- API rate limits exceeded
- Infinite loops in processing logic

---

**Problem:** "Cannot find module" error

**Solution:**
- Ensure `type: "module"` in package.json
- Use `.js` extension in imports
- Check file paths are correct

---

**Problem:** Permission denied

**Solution:**
- Make script executable: `chmod +x scripts/script-name.js`
- Check file system permissions on output directories

---

**Problem:** Out of memory

**Solution:**
- Process in smaller batches (use `--limit`)
- Stream large files instead of loading entirely
- Increase Node memory: `NODE_OPTIONS=--max-old-space-size=4096`

---

## Contributing

When modifying scripts:

1. Test with `--dry-run` first
2. Test with `--limit=5` before full run
3. Update documentation (this file + any guides)
4. Commit both script and output data
5. Don't commit backup files or logs

## Support

For script issues:

1. Check error logs in `logs/`
2. Try `--dry-run` mode
3. Review script header documentation
4. Check relevant guide in `/docs/`

---

**Last Updated:** 2026-02-08
