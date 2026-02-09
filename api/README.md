# AI Enhancement Proxy Server

Secure backend proxy for the "Enhance with AI" feature. Keeps the Anthropic API key secure on the server instead of exposing it in the browser.

## Features

- ✅ Secure API key management
- ✅ CORS protection
- ✅ Rate limiting aware
- ✅ Health check endpoint
- ✅ Simple Express server

## Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create `.env` file:**
   ```bash
   cp .env.example .env
   # Edit .env and add your ANTHROPIC_API_KEY
   ```

3. **Start server:**
   ```bash
   npm run dev
   ```

4. **Test health check:**
   ```bash
   curl http://localhost:3000/health
   ```

## Deployment

### Option 1: Railway (Recommended)

1. **Install Railway CLI:**
   ```bash
   npm i -g @railway/cli
   ```

2. **Login and init:**
   ```bash
   railway login
   cd api
   railway init
   ```

3. **Set environment variables:**
   ```bash
   railway variables set ANTHROPIC_API_KEY=your_key_here
   railway variables set ALLOWED_ORIGINS=https://moblyze.github.io
   ```

4. **Deploy:**
   ```bash
   railway up
   ```

5. **Get your URL:**
   ```bash
   railway domain
   ```

### Option 2: Render

1. **Create new Web Service** at https://render.com

2. **Connect your GitHub repo**

3. **Configure:**
   - Build Command: `cd api && npm install`
   - Start Command: `cd api && npm start`
   - Environment Variables:
     - `ANTHROPIC_API_KEY`: your_key_here
     - `ALLOWED_ORIGINS`: https://moblyze.github.io

4. **Deploy** - Render will auto-deploy on push to main

### Option 3: Fly.io

1. **Install Fly CLI:**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login and init:**
   ```bash
   fly auth login
   cd api
   fly launch
   ```

3. **Set secrets:**
   ```bash
   fly secrets set ANTHROPIC_API_KEY=your_key_here
   fly secrets set ALLOWED_ORIGINS=https://moblyze.github.io
   ```

4. **Deploy:**
   ```bash
   fly deploy
   ```

## API Endpoints

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "service": "ai-enhancement-proxy"
}
```

### `POST /api/enhance-description`
Enhance a job description with AI.

**Request:**
```json
{
  "description": "Job description text...",
  "systemPrompt": "System prompt for AI...",
  "model": "claude-sonnet-4-5-20250929",
  "maxTokens": 2048
}
```

**Response:**
```json
{
  "content": "AI-generated response...",
  "usage": {
    "input_tokens": 123,
    "output_tokens": 456
  }
}
```

### `POST /api/classify-role`
Classify a job into a role category.

**Request:**
```json
{
  "jobTitle": "ROV Pilot",
  "jobDescription": "Description...",
  "availableRoles": [...],
  "systemPrompt": "Classification prompt...",
  "model": "claude-sonnet-4-5-20250929"
}
```

**Response:**
```json
{
  "content": "AI-generated classification...",
  "usage": {
    "input_tokens": 123,
    "output_tokens": 456
  }
}
```

## Cost Estimation

- **Railway Free Tier:** 500 hours/month + $5 credit
- **Render Free Tier:** Always-on free tier (750 hrs/month)
- **Fly.io Free Tier:** 3 shared VMs + 160GB bandwidth

All should be sufficient for this use case. Railway is recommended for simplicity.

## Security Notes

- API key never exposed to browser
- CORS configured to only allow your domains
- Request size limited to 1MB
- No data persistence (stateless)

## Monitoring

Check your deployment dashboard for:
- Response times
- Error rates
- Request volume
- API usage/costs

## Troubleshooting

**CORS errors in browser:**
- Ensure `ALLOWED_ORIGINS` includes your GitHub Pages URL
- Check browser console for exact origin

**500 errors:**
- Verify `ANTHROPIC_API_KEY` is set correctly
- Check server logs for details

**Timeout errors:**
- Default timeout is 30s (client-side)
- Long descriptions may take 10-15s
- This is normal for AI processing
