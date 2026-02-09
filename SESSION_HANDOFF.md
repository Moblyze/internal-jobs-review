# Session Handoff - AI Job Processing

## Current Status
- ✅ Workflow running: 70/200 jobs processed
- ✅ 2,273 jobs have AI descriptions (committed)
- ⚠️ JSON parsing errors (continuing past them)
- ⚠️ Workflow sees all 2,368 jobs as "new" (ID mismatch)

## Key Issue
Job IDs don't match between committed file and Sheets export.
Need to fix ID generation consistency.

## Next Steps
1. Let current run complete
2. Fix JSON parser (strip markdown wrappers)
3. Fix ID matching in export/sync scripts
4. Test merge works locally

## Files
- jobs.json: 2,273/2,330 with AI (97.6%)
- Workflow: --limit=200, 60min timeout
- Cost: ~$2 per 200 jobs

## Links
- Actions: https://github.com/Moblyze/internal-jobs-review/actions
- Site: https://moblyze.github.io/internal-jobs-review/
