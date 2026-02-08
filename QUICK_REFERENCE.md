# Job Description Formatter - Quick Reference

## Import

```javascript
import { formatJobDescription } from '../utils/contentFormatter'
import { formatLocation } from '../utils/locationParser'
```

## Basic Usage

```javascript
// Format job description
const blocks = formatJobDescription(job.description)

// Format location
const location = formatLocation(job.location)
```

## Render Formatted Description

```jsx
{blocks.map((block, index) => {
  switch (block.type) {
    case 'header':
      return (
        <h3 key={index} className="text-lg font-semibold text-gray-900 mt-6 mb-3">
          {block.content}
        </h3>
      )
    case 'list':
      return (
        <ul key={index} className="list-disc list-inside space-y-2 my-4">
          {block.items.map((item, i) => (
            <li key={i} className="text-gray-700">
              {item}
            </li>
          ))}
        </ul>
      )
    case 'paragraph':
      return (
        <p key={index} className="text-gray-700 my-3">
          {block.content}
        </p>
      )
  }
})}
```

## Block Structure

```typescript
// Header
{
  type: 'header',
  content: string
}

// List
{
  type: 'list',
  items: string[]
}

// Paragraph
{
  type: 'paragraph',
  content: string
}
```

## Location Formatting Examples

```javascript
formatLocation('locations\nUS-TX-HOUSTON')
// => "Houston, TX"

formatLocation('locations\nBR-RJ-RIO DE JANEIRO')
// => "Rio De Janeiro, Rio de Janeiro, Brazil"

formatLocation('Houston')
// => "Houston"
```

## Supported Bullet Formats

- `•` Unicode bullet
- `-` Hyphen
- `*` Asterisk
- `1.`, `2.` Numbered lists
- `o` Circle
- `▪` Square

## Detected Section Headers

- RESPONSIBILITIES
- QUALIFICATIONS
- REQUIREMENTS
- ESSENTIAL RESPONSIBILITIES
- DESIRED CHARACTERISTICS
- REQUIRED SKILLS
- PREFERRED SKILLS
- BENEFITS
- WORKING WITH US
- WORKING FOR YOU
- Plus many more...

## Testing

```bash
# Run unit tests
npm test contentFormatter.test.js

# Run demo script
node test-formatter.js
```

## Files

| File | Purpose |
|------|---------|
| `src/utils/contentFormatter.js` | Main formatter logic |
| `src/utils/locationParser.js` | Location formatting |
| `src/pages/JobDetailPage.jsx` | Usage example |
| `src/utils/__tests__/contentFormatter.test.js` | Tests |

## Styling Classes (Tailwind)

```javascript
// Headers
"text-lg font-semibold text-gray-900 mt-6 mb-3 first:mt-0"

// Lists
"list-disc list-inside space-y-2 my-4 ml-2"

// List Items
"text-gray-700 leading-relaxed"

// Paragraphs
"text-gray-700 leading-relaxed my-3"
```

## Edge Cases

```javascript
// Empty input
formatJobDescription('') // => []
formatJobDescription(null) // => []

// Already well-formatted
formatJobDescription('Nice clean text')
// => [{ type: 'paragraph', content: 'Nice clean text' }]
```

## Performance

- Parsing: < 1ms per description
- No external dependencies
- Client-side only
- React-friendly

## Browser Support

✅ Chrome/Edge
✅ Firefox
✅ Safari
✅ Mobile browsers

## Common Patterns

### Full implementation
```jsx
function JobDetailPage() {
  const job = getJobById(jobs, jobId)
  const formattedDesc = formatJobDescription(job.description)
  const formattedLoc = formatLocation(job.location)

  return (
    <div>
      {/* Location */}
      {formattedLoc && <p>{formattedLoc}</p>}

      {/* Description */}
      <div className="prose">
        {formattedDesc.map((block, index) => (
          /* render blocks */
        ))}
      </div>
    </div>
  )
}
```

### With fallback
```jsx
{formattedDesc.length > 0 ? (
  formattedDesc.map((block, index) => /* render */)
) : (
  <p className="whitespace-pre-wrap">{job.description}</p>
)}
```

### With memo (optimization)
```jsx
const formattedDesc = useMemo(
  () => formatJobDescription(job.description),
  [job.description]
)
```

## Troubleshooting

**Q: Description not formatting?**
A: Check that description is a string and not empty

**Q: Location showing raw codes?**
A: Some international formats may not parse perfectly - fallback shows original

**Q: Headers not detected?**
A: Add pattern to `SECTION_HEADERS` array in `contentFormatter.js`

**Q: Bullet points not converting?**
A: Check `isBulletPoint()` function supports your format

## Quick Fixes

```javascript
// Add new section header
SECTION_HEADERS.push('new header pattern')

// Add new bullet format
function isBulletPoint(line) {
  return line.trim().startsWith('»') // Add custom bullet
}
```

## Documentation

- `JOB_DESCRIPTION_FORMATTING.md` - Full guide
- `IMPLEMENTATION_SUMMARY.md` - Overview
- `BEFORE_AFTER_EXAMPLES.md` - Visual examples
- `QUICK_REFERENCE.md` - This file

## Support

For issues or questions:
1. Check test file for examples
2. Run `node test-formatter.js` to debug
3. Review implementation in `JobDetailPage.jsx`
