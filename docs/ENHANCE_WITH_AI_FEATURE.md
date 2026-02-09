# Enhance with AI Feature

## Overview

The "Enhance with AI" feature allows users to enhance individual job descriptions with AI-powered restructuring on-demand. This complements the existing batch processing script by enabling real-time enhancement for jobs that haven't been processed yet.

## How It Works

### Architecture

Since this is a static site hosted on GitHub Pages, the feature uses a client-side approach:

1. **Detection**: Job detail pages detect if a job has `structuredDescription` or not
2. **UI**:
   - Jobs WITH structured descriptions → Show "View Original/View AI-Structured" toggle
   - Jobs WITHOUT structured descriptions → Show "Enhance with AI" button
3. **Processing**: When clicked, the job is processed using the Claude API (same logic as batch processing)
4. **Storage**: Enhanced descriptions are stored in browser localStorage
5. **Persistence**: Enhancements persist across page reloads within the same browser
6. **Merging**: On app load, localStorage enhancements are merged with jobs.json data

### Data Flow

```
┌─────────────────┐
│  Job Detail Page │
└────────┬────────┘
         │
         ├─ Has structuredDescription?
         │
    NO   │   YES
    ↓    │    ↓
┌───────────┐ ┌──────────────────┐
│  Enhance  │ │ View Toggle      │
│  Button   │ │ Original/AI View │
└─────┬─────┘ └──────────────────┘
      │
      ↓ (Click)
┌─────────────────┐
│ Call Claude API │
│ (client-side)   │
└────────┬────────┘
         │
         ↓
┌──────────────────┐
│ Save to          │
│ localStorage     │
└────────┬─────────┘
         │
         ↓
┌──────────────────┐
│ Update UI        │
│ Switch to AI view│
└──────────────────┘
```

### Storage Strategy

**localStorage key**: `moblyze_job_enhancements`

**Format**:
```json
{
  "job-id-1": {
    "sections": [...structured description data...]
  },
  "job-id-2": {
    "sections": [...structured description data...]
  }
}
```

**Limitations**:
- Per-browser only (not synced across devices)
- Subject to localStorage size limits (~5-10MB depending on browser)
- Cleared if user clears browser data
- Not persisted to jobs.json (requires manual batch processing for that)

## Files Changed

### New Files

1. **`src/utils/jobEnhancementStorage.js`**
   - Manages localStorage persistence of AI-enhanced descriptions
   - Functions: `saveEnhancement()`, `getEnhancement()`, `mergeEnhancements()`

2. **`src/hooks/useJobEnhancement.js`**
   - React hook for enhancing individual jobs
   - Manages state: `enhancing`, `error`, `success`
   - Wraps AI parser with localStorage integration

3. **`src/components/EnhanceWithAIButton.jsx`**
   - UI component for the enhancement button
   - Shows loading state, success feedback, error messages
   - Calls `onEnhanced` callback when complete

4. **`docs/ENHANCE_WITH_AI_FEATURE.md`** (this file)
   - Documentation

### Modified Files

1. **`src/pages/JobDetailPage.jsx`**
   - Added `EnhanceWithAIButton` component
   - Conditional rendering: Button if no structured description, toggle if has one
   - Manages `clientEnhancement` state for newly enhanced jobs

2. **`src/hooks/useJobs.js`**
   - Imports `mergeEnhancements()` from storage utility
   - Merges localStorage enhancements with jobs.json on load

3. **`src/utils/aiDescriptionParser.js`**
   - Changed `dangerouslyAllowBrowser: false` → `true` to enable client-side usage
   - Updated `getApiKey()` to support `VITE_ANTHROPIC_API_KEY` for browser access

4. **`.env`**
   - Added `VITE_ANTHROPIC_API_KEY` (same value as `ANTHROPIC_API_KEY`)
   - This exposes the key to browser - see Security Considerations below

5. **`.env.example`**
   - Updated with documentation for both API key variants

## Usage

### For Users

1. Navigate to any job detail page
2. If the job hasn't been AI-enhanced:
   - You'll see a blue "Enhance with AI" button in the top-right
3. Click the button
   - Button shows "Enhancing..." with spinner
   - Typically takes 2-5 seconds
4. On success:
   - Green "Enhanced!" badge appears
   - Page automatically switches to AI-structured view
   - Enhancement saved to browser for future visits
5. You can now toggle between "Original" and "AI-Structured" views

### For Developers

**Testing locally**:
```bash
npm run dev
```

**Required**: Set `VITE_ANTHROPIC_API_KEY` in `.env` file

**Debugging**:
- Check browser console for logs: `[useJobEnhancement]`
- Inspect localStorage: `localStorage.getItem('moblyze_job_enhancements')`
- Clear enhancements: `localStorage.removeItem('moblyze_job_enhancements')`

**Utility functions**:
```javascript
import {
  getAllEnhancements,
  getEnhancementCount,
  clearAllEnhancements
} from '../utils/jobEnhancementStorage';

// View all enhancements
console.log(getAllEnhancements());

// Count enhancements
console.log(getEnhancementCount());

// Clear all (for testing)
clearAllEnhancements();
```

## Security Considerations

### API Key Exposure

**Current Implementation**:
- The Anthropic API key is exposed in the browser via `VITE_ANTHROPIC_API_KEY`
- This is acceptable for development but **NOT recommended for production**

**Why this matters**:
- Anyone can view the API key in browser DevTools
- Could lead to unauthorized API usage and costs
- Risk of key abuse/quota exhaustion

### Production Recommendations

For production deployment, choose one of these approaches:

#### Option 1: Backend Proxy (Recommended)
Create a simple serverless function (Vercel, Netlify, Cloudflare Workers) that:
- Accepts job description from client
- Calls Claude API with server-side key
- Returns structured description
- Implements rate limiting per user/IP

Example (Vercel):
```javascript
// api/enhance-job.js
export default async function handler(req, res) {
  // Rate limiting logic
  const description = req.body.description;
  const result = await callClaudeAPI(description);
  res.json(result);
}
```

Then update `src/hooks/useJobEnhancement.js` to call this endpoint instead of direct API.

#### Option 2: Disable Client-Side Enhancement
If backend proxy is not feasible:
- Remove the `VITE_ANTHROPIC_API_KEY` from .env
- Feature will gracefully fail with "AI parsing not available" message
- Users can only view pre-enhanced jobs (from batch processing)

#### Option 3: Rate-Limited Key
Create a separate Anthropic API key with:
- Low rate limits
- Low spending cap
- Monitor usage closely

### Current Status
🟡 **Development mode enabled**: API key exposed for ease of development. Must address before production deployment.

## Batch Processing Integration

This feature complements (but doesn't replace) the batch processing script.

### When to use each:

**Client-side enhancement** (this feature):
- Individual jobs on-demand
- Quick testing/preview
- User-initiated enhancement
- Temporary (localStorage)

**Batch processing** (script):
- Process all jobs at once
- Permanent storage in jobs.json
- Part of data pipeline
- Deployed to production

### Recommended Workflow:

1. **Development**: Use "Enhance with AI" button for testing
2. **Production**: Run batch processing script before deployment
   ```bash
   npm run process-descriptions -- --skip-processed
   ```
3. **Deploy**: Enhanced jobs.json includes all structured descriptions
4. **Users**: See pre-enhanced jobs, no client-side processing needed

### Why batch processing is better for production:
- No API key exposure
- Faster (no client-side API calls)
- Consistent (all jobs enhanced upfront)
- Cheaper (batch once vs. per-user)
- Works offline (jobs.json is static)

## Troubleshooting

### "AI parsing is not available"
**Cause**: `VITE_ANTHROPIC_API_KEY` not set in `.env`

**Fix**:
```bash
# Add to .env
VITE_ANTHROPIC_API_KEY=sk-ant-api03-...
```

Restart dev server:
```bash
npm run dev
```

### Enhancement fails with error
**Check**:
1. API key is valid (test in Claude console)
2. Network connection is stable
3. Job has a description (not empty)
4. Browser console for detailed error

**Common errors**:
- `401 Unauthorized`: Invalid API key
- `429 Too Many Requests`: Rate limit exceeded
- `Request timeout`: Slow connection or large description

### Enhancement not persisting
**Cause**: localStorage disabled or full

**Fix**:
- Check browser privacy settings
- Clear old localStorage data
- Try different browser

### Button doesn't appear
**Check**:
1. Job already has `structuredDescription` (will show toggle instead)
2. Job loaded successfully (not 404/error state)
3. Check browser console for React errors

## Future Enhancements

Potential improvements to consider:

1. **Backend Service Integration**
   - Implement serverless proxy for API calls
   - Remove API key from client
   - Add rate limiting and authentication

2. **Export Feature**
   - Allow users to export enhanced jobs
   - Generate JSON for batch merge into jobs.json
   - Admin panel for bulk operations

3. **Enhancement Queue**
   - Queue multiple jobs for enhancement
   - Process in background
   - Show progress notification

4. **Collaborative Enhancement**
   - Share enhancements between users
   - Cloud storage (Firebase, Supabase)
   - Sync across devices

5. **Enhancement History**
   - Track enhancement versions
   - Compare different AI results
   - Rollback capability

6. **Quality Feedback**
   - Thumbs up/down on AI quality
   - Report issues
   - Improve prompts based on feedback

## Testing

### Manual Testing Checklist

- [ ] Button appears on jobs without structuredDescription
- [ ] Button doesn't appear on jobs with structuredDescription
- [ ] Click button triggers enhancement
- [ ] Loading spinner shows during processing
- [ ] Success message appears on completion
- [ ] View switches to AI-structured automatically
- [ ] Enhancement persists on page reload
- [ ] Toggle works after enhancement
- [ ] Error messages show for failures
- [ ] Error messages auto-dismiss after 5 seconds
- [ ] Works on mobile viewport
- [ ] No console errors

### Test Jobs

Find jobs without structured descriptions:
```javascript
// In browser console
const jobs = await fetch('/data/jobs.json').then(r => r.json());
const unenhanced = jobs.filter(j => !j.structuredDescription);
console.log(`${unenhanced.length} jobs need enhancement`);
console.log('First unenhanced job:', unenhanced[0]);
```

## Summary

The "Enhance with AI" feature provides a seamless way for users to enhance job descriptions on-demand. While it's great for development and testing, production deployments should rely primarily on batch processing to avoid API key exposure and reduce costs. The localStorage approach ensures a smooth UX while maintaining the static site architecture.
