# AI Enhancement Proxy - Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User's Browser                              │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  React App (GitHub Pages)                                     │ │
│  │  https://moblyze.github.io                                    │ │
│  │                                                                │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │  JobDetailPage.jsx                                       │ │ │
│  │  │                                                           │ │ │
│  │  │  [Enhance with AI] ← User clicks                        │ │ │
│  │  │         ↓                                                 │ │ │
│  │  │  EnhanceWithAIButton.jsx                                 │ │ │
│  │  │         ↓                                                 │ │ │
│  │  │  useJobEnhancement hook                                  │ │ │
│  │  │         ↓                                                 │ │ │
│  │  │  aiDescriptionParser.js                                  │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  │                                                                │ │
│  │  Environment Variables:                                        │ │
│  │  ✅ VITE_AI_PROXY_URL=https://proxy.railway.app              │ │
│  │  ❌ NO API KEY IN BROWSER                                      │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│                              │ HTTPS Request                        │
│                              │ POST /api/enhance-description        │
│                              │ { description, systemPrompt, ... }   │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                               ↓
┌──────────────────────────────────────────────────────────────────────┐
│                    AI Enhancement Proxy                              │
│                    (Railway/Render/Fly.io)                           │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Express.js Server                                             │ │
│  │                                                                 │ │
│  │  Routes:                                                        │ │
│  │  • GET  /health                                                │ │
│  │  • POST /api/enhance-description                               │ │
│  │  • POST /api/classify-role                                     │ │
│  │                                                                 │ │
│  │  CORS Protection:                                               │ │
│  │  ✅ https://moblyze.github.io                                  │ │
│  │  ❌ Other origins blocked                                       │ │
│  │                                                                 │ │
│  │  Request Validation:                                            │ │
│  │  • Validates input schema                                       │ │
│  │  • Sanitizes data                                               │ │
│  │  • Rate limiting (optional)                                     │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  Environment Variables:                                              │
│  🔐 ANTHROPIC_API_KEY=sk-ant-api03-... (SECURE)                    │
│  🌐 ALLOWED_ORIGINS=https://moblyze.github.io                      │
│  🔢 PORT=3000                                                       │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               │ HTTPS Request
                               │ POST /v1/messages
                               │ Authorization: Bearer sk-ant-api03-...
                               ↓
┌──────────────────────────────────────────────────────────────────────┐
│                      Anthropic API                                   │
│                      https://api.anthropic.com                       │
│                                                                      │
│  Claude Model Processing:                                            │
│  • Receives job description + system prompt                         │
│  • Processes with Claude Sonnet 4.5                                 │
│  • Returns structured JSON response                                 │
│                                                                      │
│  Billing:                                                            │
│  • Charges based on tokens used                                     │
│  • ~$0.003 per enhancement                                          │
└──────────────────────────────────────────────────────────────────────┘
```

## Request Flow

### Step 1: User Interaction

```javascript
// User clicks "Enhance with AI" button
<EnhanceWithAIButton job={job} onEnhanced={handleEnhanced} />
```

### Step 2: Frontend Hook

```javascript
// useJobEnhancement.js
const { enhanceJob } = useJobEnhancement();
await enhanceJob(job);  // Calls aiDescriptionParser
```

### Step 3: API Client (Browser)

```javascript
// aiDescriptionParser.js - Browser path
const response = await fetch(`${AI_PROXY_URL}/api/enhance-description`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    description: job.description,
    systemPrompt: RESTRUCTURE_PROMPT,
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 2048
  })
});
```

### Step 4: Proxy Server

```javascript
// server.js
app.post('/api/enhance-description', async (req, res) => {
  // 1. Validate request
  const { description, systemPrompt, model, maxTokens } = req.body;

  // 2. Call Anthropic API with secure key
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: `${systemPrompt}\n\n${description}` }]
  });

  // 3. Return response to browser
  res.json({ content: textContent, usage: response.usage });
});
```

### Step 5: Response Processing

```javascript
// aiDescriptionParser.js - Parse response
const parsed = JSON.parse(textContent);
// Returns: { sections: [...] }
```

### Step 6: UI Update

```javascript
// JobDetailPage.jsx - Display enhanced description
<StructuredJobDescription description={structuredDescription} />
```

## Security Layers

### Layer 1: CORS Protection

```javascript
// server.js
const corsOptions = {
  origin: ['https://moblyze.github.io'],  // Only allow your domain
  optionsSuccessStatus: 200
};
```

**Prevents:** Random websites from using your proxy

### Layer 2: Environment Variables

```bash
# Railway/Render/Fly.io - Server only
ANTHROPIC_API_KEY=sk-ant-api03-...  # Never in browser
```

**Prevents:** API key exposure in client-side code

### Layer 3: Request Validation

```javascript
// server.js
if (!description || typeof description !== 'string') {
  return res.status(400).json({ error: 'Invalid input' });
}
```

**Prevents:** Malformed requests and injection attacks

### Layer 4: Rate Limiting (Optional)

```javascript
// Can add with express-rate-limit
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100  // Limit each IP to 100 requests per windowMs
});
```

**Prevents:** API abuse and unexpected costs

## Data Flow

### Enhancement Request

```
Browser → Proxy → Anthropic
{                 {                    {
  description,      description,         model,
  systemPrompt,     systemPrompt,        max_tokens,
  model,           model,               messages: [...]
  maxTokens        maxTokens            }
}                 }                    ↓
                  + API Key            Process
                                       ↓
                                       {
                                         content: [{
                                           type: 'text',
                                           text: '{"sections":[...]}'
                                         }],
                                         usage: {...}
                                       }
```

### Enhancement Response

```
Anthropic → Proxy → Browser
{             {           {
  content,      content,    sections: [
  usage         usage         {title, type, content},
}             }             {...}
                          ]
                        }
```

## Node.js Scripts (Server-side)

For batch processing scripts, no proxy needed:

```javascript
// aiDescriptionParser.js - Node.js path
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY  // From .env
});

const response = await client.messages.create({...});
```

**Scripts:**
- `npm run process-descriptions` - Batch AI processing
- `npm run sync-process` - Sync from Sheets + AI process
- `npm run test-ai-parser` - Test AI functionality

These run locally/in CI and have direct API access.

## Deployment Architecture

### Production Setup

```
GitHub Pages (Frontend)
  ├── Static files (HTML, CSS, JS)
  ├── No API keys
  └── Calls proxy at VITE_AI_PROXY_URL

Railway/Render/Fly.io (Proxy)
  ├── Express server
  ├── Environment: ANTHROPIC_API_KEY (secure)
  ├── Health monitoring
  └── Auto-scaling (if needed)

Anthropic API
  └── Claude processing
```

### Development Setup

```
localhost:5173 (Frontend)
  └── VITE_AI_PROXY_URL=http://localhost:3000

localhost:3000 (Proxy)
  └── ANTHROPIC_API_KEY from .env
```

## Error Handling

### Frontend

```javascript
try {
  const result = await enhanceJob(job);
  // Show success
} catch (error) {
  // Show error message to user
  setError(error.message);
}
```

### Proxy

```javascript
try {
  const response = await anthropic.messages.create({...});
  res.json({ content: ... });
} catch (error) {
  if (error.status === 429) {
    res.status(429).json({ error: 'Rate limit exceeded' });
  } else {
    res.status(500).json({ error: error.message });
  }
}
```

### User Experience

- Loading spinner during processing (2-15s)
- Success message on completion
- Error message with retry option
- Fallback to original description if enhancement fails

## Monitoring & Logging

### Proxy Logs

```javascript
// server.js
console.log(`[AI Enhancement] Request for ${description.length} chars`);
console.log(`[AI Enhancement] Success - ${textContent.length} chars returned`);
console.error('[AI Enhancement] Error:', error);
```

### Platform Monitoring

**Railway:**
```bash
railway logs --tail
railway metrics
```

**Render:**
- Dashboard graphs (CPU, memory, requests)
- Email alerts on failures

**Fly.io:**
```bash
fly logs
fly status
```

## Performance

### Expected Response Times

- Short description (500 chars): 2-3s
- Medium description (2000 chars): 5-8s
- Long description (5000 chars): 10-15s
- Timeout: 30s (configurable)

### Optimization Opportunities

1. **Caching:** Cache enhanced descriptions by job ID
2. **Batch Processing:** Process multiple jobs in one request
3. **Streaming:** Stream response to user (partial updates)
4. **CDN:** Use CDN for faster proxy access (Cloudflare)

## Cost Optimization

### Current Setup (No Optimization)

- Every "Enhance with AI" click = 1 API request
- Cost: ~$0.003 per enhancement

### With Caching

```javascript
// Pseudo-code
const cache = new Map();
if (cache.has(jobId)) {
  return cache.get(jobId);
}
const result = await anthropic.messages.create({...});
cache.set(jobId, result);
```

- Saves API costs for repeat enhancements
- Can use Redis/Memcached for persistence

### With Batch Processing

Already implemented in scripts:
- `npm run process-descriptions` - Process all jobs at once
- Results stored in `jobs.json`
- Browser just displays pre-processed results (no API calls)

## Scaling Considerations

### Current Scale

- Expected: <100 enhancements/month
- Free tier sufficient

### If Usage Grows

**Proxy:**
- Railway: Scales automatically
- Render: Upgrade to paid tier for more resources
- Fly.io: Add more VMs in different regions

**API Costs:**
- Monitor in Anthropic Console
- Set up budget alerts
- Consider caching strategy

**Database (Future):**
- Store enhancements in DB instead of localStorage
- Reduces repeat API calls
- Enables analytics

## Testing

### Unit Tests

```bash
cd api
npm test  # (if we add tests)
```

### Integration Tests

```bash
./test-proxy.sh http://localhost:3000
```

### End-to-End Tests

```bash
# Start both servers
cd api && npm run dev &
npm run dev &

# Test in browser
open http://localhost:5173
```

## Maintenance

### Regular Tasks

- ✅ Monitor proxy logs weekly
- ✅ Check API usage/costs monthly
- ✅ Review error rates
- ✅ Update dependencies quarterly

### Platform Updates

**Railway:**
```bash
railway up  # Deploy updates
```

**Render:**
- Auto-deploys on git push to main

**Fly.io:**
```bash
fly deploy
```

## Future Enhancements

### Possible Improvements

1. **Rate Limiting:** Add per-user/IP limits
2. **Analytics:** Track enhancement success rates
3. **A/B Testing:** Compare AI vs non-AI descriptions
4. **Feedback:** Collect user ratings on enhancements
5. **Multiple Models:** Allow users to choose model
6. **Streaming:** Stream response for faster perceived performance
7. **Webhooks:** Notify when batch processing completes

### Migration Path

If moving from GitHub Pages to full backend:

1. Keep proxy as-is
2. Add database (PostgreSQL)
3. Store jobs in DB instead of JSON
4. Store enhancements in DB
5. Add user authentication
6. Add analytics dashboard

Proxy architecture remains the same!
