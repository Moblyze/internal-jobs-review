# Enhance with AI - Setup & Testing Guide

## Quick Start

### 1. Environment Setup

Add the API key to your `.env` file:

```bash
# Add to .env
VITE_ANTHROPIC_API_KEY=sk-ant-api03-...
```

**Note**: Use the same value as `ANTHROPIC_API_KEY` (already in .env)

### 2. Start Development Server

```bash
npm run dev
```

### 3. Test the Feature

1. Open http://localhost:5173
2. Navigate to any job detail page without AI enhancement
3. Look for the "Enhance with AI" button in the top-right
4. Click it and watch it process
5. Verify the toggle button appears after enhancement

## Finding Test Jobs

### Check Enhancement Status

```bash
node scripts/find-unenhanced-jobs.js
```

Output shows:
- Total jobs count
- How many are enhanced vs unenhanced
- List of first 5 unenhanced jobs

### Current Status (as of implementation)
- **Total jobs**: 2,368
- **Enhanced**: 2,310 (97.5%)
- **Unenhanced**: 58 (2.5%)

### Example Unenhanced Jobs
1. Field Specialist IV - Baker Hughes
2. Digital Technology Specialist - Baker Hughes
3. Control Field Service Engineer - Baker Hughes
4. Pasantías Universitarias - Baker Hughes
5. Projektový manažer technologických investic - Baker Hughes

## Testing Checklist

### Visual Tests

- [ ] **Button Visibility**
  - Navigate to unenhanced job
  - Button appears in top-right corner
  - Button has AI icon and "Enhance with AI" text
  - Button styling matches existing toggle button

- [ ] **Loading State**
  - Click enhance button
  - Button shows spinner
  - Text changes to "Enhancing..."
  - Button is disabled during processing

- [ ] **Success State**
  - Green "Enhanced!" badge appears
  - Badge auto-dismisses after 3 seconds
  - View switches to AI-structured automatically
  - Toggle button replaces enhance button

- [ ] **Toggle Functionality**
  - Click "View Original" - shows original description
  - Click "View AI-Structured" - shows enhanced version
  - Badge updates ("AI Enhanced" vs "Original")
  - Switching is instant (no loading)

- [ ] **Persistence**
  - Refresh page
  - Enhancement persists (loaded from localStorage)
  - Toggle still works
  - No re-enhancement needed

- [ ] **Error Handling**
  - Simulate error (invalid API key in .env)
  - Red error message appears
  - Error auto-dismisses after 5 seconds
  - Button remains clickable for retry

### Functional Tests

- [ ] **localStorage Integration**
  - Open DevTools > Application > Local Storage
  - Look for key: `moblyze_job_enhancements`
  - Verify JSON structure after enhancement
  - Clear localStorage and verify enhancement disappears

- [ ] **Multiple Jobs**
  - Enhance multiple different jobs
  - Verify all persist in localStorage
  - Check count: `localStorage.getItem('moblyze_job_enhancements')`

- [ ] **Console Logs**
  - No errors in console
  - Enhancement logs show: `[useJobEnhancement] Enhancing job: ...`
  - Success log: `[useJobEnhancement] Successfully enhanced job: ...`

## Manual Testing Script

```javascript
// Open browser console on any job detail page

// 1. Check localStorage state
const enhancements = JSON.parse(localStorage.getItem('moblyze_job_enhancements') || '{}');
console.log('Current enhancements:', Object.keys(enhancements).length);

// 2. View an enhancement
console.log('Enhancement data:', Object.values(enhancements)[0]);

// 3. Clear all enhancements (for testing)
localStorage.removeItem('moblyze_job_enhancements');
console.log('Cleared - refresh page to see enhance button again');

// 4. Check if API key is configured
console.log('API Key configured:', !!import.meta.env.VITE_ANTHROPIC_API_KEY);
```

## Backend API Test

Test the AI parser directly (simulates what happens in browser):

```bash
npm run test-single-enhancement
```

This script:
1. Loads jobs from `public/data/jobs.json`
2. Finds first unenhanced job
3. Calls `restructureJobDescription()` (same as browser)
4. Validates response structure
5. Shows timing and section breakdown
6. Simulates localStorage save

**Expected output**:
```
🧪 Testing Single Job Enhancement Feature

📂 Loading jobs...
   Found 2368 jobs

📝 Testing with job:
   ID: baker-hughes-...
   Title: Field Specialist IV
   Company: Baker Hughes
   Description length: 1834 chars

🤖 Enhancing job description...
   ✓ Enhancement completed in 3.24s

📊 Result:
   Sections: 5
   1. About the Role (paragraph): As a Field Specialist IV...
   2. Key Responsibilities (list): 8 items
   3. Required Qualifications (list): 6 items
   4. Preferred Qualifications (list): 2 items
   5. What We Offer (list): 5 items

💾 Simulating localStorage save...
   ✓ Would save 1247 bytes to localStorage

🔄 On page reload:
   1. Jobs loaded from jobs.json
   2. Enhancement merged from localStorage
   3. Job shows toggle instead of enhance button
   4. User can switch between original and AI views

✅ Test PASSED - Feature working correctly!
```

## Troubleshooting

### Button doesn't appear

**Possible causes**:
1. Job already has `structuredDescription` (shows toggle instead)
2. Job not loaded yet (still in loading state)
3. React component not rendering

**Debug**:
```javascript
// In browser console
const jobSlug = window.location.pathname.split('/').pop();
const response = await fetch('/data/jobs.json');
const jobs = await response.json();
const job = jobs.find(j => j.id.includes(jobSlug));
console.log('Has structured description:', !!job.structuredDescription);
```

### "AI parsing is not available" error

**Cause**: `VITE_ANTHROPIC_API_KEY` not set

**Fix**:
1. Check `.env` file has `VITE_ANTHROPIC_API_KEY=...`
2. Restart dev server: `npm run dev`
3. Hard refresh browser: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

### Enhancement fails with 401 error

**Cause**: Invalid API key

**Fix**:
1. Verify key in Anthropic console: https://console.anthropic.com/
2. Copy fresh key to `.env`
3. Restart server

### Enhancement takes too long

**Normal timing**: 2-5 seconds for average job description

**If longer**:
- Check network connection
- Large job descriptions (>5000 chars) take longer
- API rate limits may slow requests

### localStorage quota exceeded

**Symptoms**: Enhancement succeeds but save fails

**Fix**:
```javascript
// Clear old enhancements
localStorage.removeItem('moblyze_job_enhancements');

// Or clear all localStorage
localStorage.clear();
```

**Prevention**: Use batch processing for production instead of client-side storage

## Performance Considerations

### API Costs

Each enhancement costs ~$0.01-0.03 depending on description length.

**Development**:
- 58 unenhanced jobs × $0.02 = ~$1.16
- Cost-effective for testing

**Production**:
- Use batch processing script instead
- Process all jobs once before deployment
- No per-user API calls
- No exposed API key

### Timing

**Average enhancement time**: 3-4 seconds
- Network latency: ~200ms
- API processing: 2-3s
- Result parsing: ~100ms

**User experience**:
- Acceptable for on-demand feature
- Would be too slow if all jobs required it
- Batch processing is much faster (parallel + no network overhead)

### Storage

**localStorage usage per job**: ~1-2 KB
- 100 enhanced jobs ≈ 150 KB
- Well within 5-10 MB localStorage limit

**Browser limits**:
- Chrome/Edge: 10 MB
- Firefox: 10 MB
- Safari: 5 MB

## Next Steps

### After Testing

1. **Verify all tests pass**
2. **Test on mobile viewport**
3. **Check browser compatibility** (Chrome, Firefox, Safari)
4. **Review console for any warnings**

### Before Production

1. **Security**: Implement backend proxy for API calls
2. **Batch Processing**: Pre-enhance all jobs offline
3. **Analytics**: Track enhancement usage
4. **Monitoring**: Set up error logging

### Recommended Production Flow

```bash
# 1. Enhance all jobs offline
npm run process-descriptions -- --skip-processed

# 2. Verify enhancements
npm run test-batch-processing

# 3. Build for production
npm run build

# 4. Deploy
# (jobs.json includes all enhancements)
```

## Development Tips

### Quick Test Cycle

```bash
# Terminal 1: Run dev server
npm run dev

# Terminal 2: Watch for unenhanced jobs
watch -n 5 'node scripts/find-unenhanced-jobs.js'

# Browser: Test enhancements
# Console: Monitor localStorage
```

### Reset Testing State

```bash
# Browser console
localStorage.removeItem('moblyze_job_enhancements');
location.reload();
```

### Debug Mode

Add to `src/hooks/useJobEnhancement.js`:

```javascript
// After line 31
console.log('[DEBUG] Enhancing job:', job.id);
console.log('[DEBUG] Description length:', job.description.length);

// After line 42
console.log('[DEBUG] API response:', structuredDescription);
```

## Support

### Documentation
- Full feature docs: `docs/ENHANCE_WITH_AI_FEATURE.md`
- API parser docs: `src/utils/aiDescriptionParser.js` (see header comments)
- Batch processing: `scripts/README.md`

### Common Issues
- API key: Check `.env` file has `VITE_ANTHROPIC_API_KEY`
- CORS errors: Restart dev server
- Build errors: Clear `dist/` and rebuild

### Testing Resources
- Test script: `npm run test-single-enhancement`
- Find jobs: `node scripts/find-unenhanced-jobs.js`
- Manual test: Open DevTools > Console
