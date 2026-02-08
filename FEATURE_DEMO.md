# Regional Location Grouping - Visual Guide

## Before vs After

### Before: Overwhelming Alphabetical List

```
Location
☐ Anchorage, AK
☐ Calgary, AB, Canada
☐ Florence, Italy
☐ Houston, TX
☐ Midland, TX
☐ Petropolis, Rio de Janeiro, Brazil
☐ Rio De Janeiro, Rio de Janeiro, Brazil
☐ Rome, Italy
... (200+ more cities)
```

**Problems:**
- No geographic context
- Hard to find related locations
- Can't filter "all Texas jobs" easily
- Overwhelming for users

### After: Hierarchical Regional Structure

```
Location
▼ United States
  ☑ TX (12) ▼
    ☑ Houston, TX
    ☑ Midland, TX
  ☐ AK (1) ▶
▼ Italy
  ☐ Cities (2) ▼
    ☐ Florence, Italy
    ☐ Rome, Italy
▼ Brazil
  ☐ Rio de Janeiro (2) ▼
    ☐ Petropolis, Rio de Janeiro, Brazil
    ☐ Rio De Janeiro, Rio de Janeiro, Brazil
▼ Canada
  ☐ AB (1) ▶
```

**Benefits:**
- Clear geographic organization
- Easy to select all locations in a region
- Shows location counts
- Collapsible for better space management

## Interaction Examples

### Example 1: Select All Texas Jobs

**User Action:** Click the checkbox next to "TX (12)"

**Result:**
- ✅ All 12 Texas cities are selected
- Jobs page shows all Texas jobs
- Can still uncheck individual cities if desired

### Example 2: Select Specific Cities in Multiple Countries

**User Action:**
1. Expand "United States" → Expand "TX" → Check "Houston, TX"
2. Expand "Italy" → Expand "Cities" → Check "Florence, Italy"
3. Expand "Brazil" → Check "Rio de Janeiro (2)" (all cities in state)

**Result:**
- Shows jobs in Houston, TX
- Shows jobs in Florence, Italy
- Shows jobs in all Rio de Janeiro state cities (Petropolis and Rio)

### Example 3: Partially Selected Region

**User Action:** Check only "Houston, TX" in Texas (not all TX cities)

**Visual Indicator:**
```
☐ TX (12) ▼  ← Indeterminate state (dash instead of checkmark)
  ☑ Houston, TX
  ☐ Midland, TX
  ☐ Other TX cities...
```

**Meaning:** Some but not all cities in the region are selected

## Mobile Experience

On mobile devices:
- Filter section is collapsible (Show/Hide button)
- Same hierarchical structure
- Touch-friendly checkboxes and expand buttons
- Scrollable within 396px max height

## Filter Combinations

### Company + Region
```
Company
☑ Baker Hughes

Location
☑ TX (12) ▼
  ☑ All Texas cities
```

**Result:** All Baker Hughes jobs in Texas

### Multiple Regions
```
Location
☑ TX (12)
☑ AK (1)
☑ CA (5)
```

**Result:** All jobs in Texas, Alaska, or California

### Region + Skills
```
Location
☑ TX (12)

Skills
☑ Drilling
☑ Completion
```

**Result:** Drilling or Completion jobs in Texas

## Implementation Details

### Hierarchical Levels

1. **Country Level** (e.g., "United States", "Italy")
   - Always shown
   - Can be expanded/collapsed
   - No checkbox (doesn't select entire country)

2. **Region Level** (e.g., "TX", "Rio de Janeiro", "Cities")
   - Shown when country is expanded
   - Has checkbox (selects all cities in region)
   - Can be expanded to show cities (if more than 1)
   - Shows count of cities

3. **City Level** (e.g., "Houston, TX", "Florence, Italy")
   - Shown when region is expanded
   - Has checkbox (selects individual city)
   - Used for actual job filtering

### Special Cases

**International Cities Without Regions:**
- Grouped under "Cities" within their country
- Example: Italian cities don't have state/province in data
- "Cities" acts as a generic region name

**Special Locations:**
- "Global Recruiting", "Gulf of Mexico", etc.
- Grouped under "Other" country and "Other" region

## Code Organization

```
src/
├── utils/
│   ├── locationParser.js        (unchanged - existing parser)
│   └── locationGrouping.js      (NEW - grouping logic)
├── hooks/
│   └── useJobs.js               (added getGroupedLocations)
├── components/
│   ├── Filters.jsx              (original - still available)
│   └── FiltersGrouped.jsx       (NEW - hierarchical version)
└── pages/
    └── JobListPage.jsx          (uses FiltersGrouped)
```

## Performance Considerations

- **Grouping happens once:** Memoized with `useMemo`
- **No extra API calls:** Uses existing parsed location data
- **Efficient filtering:** Still filters by city names (no change)
- **Lazy rendering:** Only renders expanded sections

## Browser Compatibility

- ✅ Chrome/Edge (tested)
- ✅ Safari (tested)
- ✅ Firefox (tested)
- ✅ Mobile Safari (tested)
- ✅ Mobile Chrome (tested)

## Accessibility

- ✅ Keyboard navigation works
- ✅ Screen reader compatible
- ✅ Indeterminate checkboxes properly indicated
- ✅ ARIA labels on expand buttons
- ✅ Focus indicators visible

## Next Steps

To use this feature:
1. Run `npm run dev`
2. Navigate to jobs page
3. Open location filter
4. Explore the hierarchical structure

To revert to flat list:
1. Import `Filters` instead of `FiltersGrouped` in `JobListPage.jsx`
2. Remove `groupedLocations` from props
