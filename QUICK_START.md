# URL Filters - Quick Start Guide

## What's New?

Added URL parameter support for job filters. Users can now bookmark, share, and navigate filtered job searches.

**Before**: Filters only in UI, lost on refresh
**After**: Filters in URL, shareable and persistent

## Try It Now

```bash
cd /Users/jesse/Dropbox/development/moblyze/moblyze-jobs-web
npm run dev
```

### Test the Feature

1. Open http://localhost:5173/internal-jobs-review/
2. Select a filter (e.g., Location: Texas)
3. Watch URL update to `/?locations=Texas`
4. Refresh page - filter persists
5. Click "Share" button - URL copied to clipboard
6. Open in new tab - same filtered results

## Key Features

- **Shareable URLs** - Copy and share filtered searches
- **Persistent Filters** - Survive page refresh
- **Browser Navigation** - Back/forward buttons work
- **SEO-Friendly** - Clean URLs for search engines
- **No Dependencies** - Uses React Router built-in

## Quick Usage

### For Developers

```javascript
import { useFilterParams } from '../hooks/useFilterParams'

function MyPage() {
  const { filters, setFilters } = useFilterParams()

  return (
    <FiltersSearchable
      filters={filters}
      onFilterChange={setFilters}
    />
  )
}
```

### For Testing

```bash
# Single filter
http://localhost:5173/internal-jobs-review/?locations=Texas

# Multiple filters
http://localhost:5173/internal-jobs-review/?locations=Texas,California&skills=Welding

# Company page with filters
http://localhost:5173/internal-jobs-review/companies/tesla?locations=Texas
```

## Files Changed

### Created
- `src/hooks/useFilterParams.js` - Custom hook for URL sync
- `src/components/SEO.jsx` - Dynamic meta tags
- `src/components/ShareFilterButton.jsx` - URL copy button

### Modified
- `src/pages/JobListPage.jsx` - Uses URL params instead of useState
- `src/pages/CompanyPage.jsx` - Added filter support

### Documentation
- `URL_FILTERS_SUMMARY.md` - Quick overview
- `URL_FILTERS_IMPLEMENTATION.md` - Complete details
- `URL_FILTER_ARCHITECTURE.md` - Technical architecture
- `TEST_URLS.md` - Test case URLs
- `QUICK_START.md` - This file

## Testing Checklist

```bash
# Build verification
npm run build  # Should succeed with no errors

# Manual testing
- [ ] Apply filter → URL updates
- [ ] Refresh page → Filter persists
- [ ] Click Share → URL copies
- [ ] Browser back → Returns to previous page
- [ ] New tab with URL → Filters restore
```

## Example URLs

```
# Filter by location
/?locations=Texas

# Multiple locations
/?locations=Texas,California,Oklahoma

# Combined filters
/?companies=Tesla&locations=Texas&roles=Solar%20Technician

# Company page
/companies/tesla?locations=Texas&skills=Welding
```

## Documentation

| File | Purpose |
|------|---------|
| QUICK_START.md | This quick guide |
| URL_FILTERS_SUMMARY.md | Implementation overview |
| URL_FILTERS_IMPLEMENTATION.md | Full technical details |
| URL_FILTER_ARCHITECTURE.md | Architecture diagrams |
| TEST_URLS.md | Comprehensive test cases |

## Need Help?

1. Check `URL_FILTERS_SUMMARY.md` for overview
2. See `TEST_URLS.md` for test URLs
3. Review `URL_FILTER_ARCHITECTURE.md` for technical details

## Status

✅ Implementation complete
✅ Build succeeds (verified)
✅ Zero new dependencies
✅ Fully backward compatible
✅ Ready for testing
