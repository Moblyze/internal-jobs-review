/**
 * AI Enhancement Proxy Server
 *
 * Simple Express server that proxies AI enhancement requests
 * to Anthropic API, keeping the API key secure on the server.
 *
 * Deploy to Railway, Render, or similar platform.
 */

import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// CORS configuration - adjust allowed origins for production
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:5173', 'https://moblyze.github.io'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ai-enhancement-proxy' });
});

// AI Enhancement endpoint
app.post('/api/enhance-description', async (req, res) => {
  try {
    const { description, systemPrompt, model = 'claude-sonnet-4-5-20250929', maxTokens = 2048 } = req.body;

    // Validate input
    if (!description || typeof description !== 'string') {
      return res.status(400).json({
        error: 'Invalid input: description is required and must be a string',
      });
    }

    if (!systemPrompt || typeof systemPrompt !== 'string') {
      return res.status(400).json({
        error: 'Invalid input: systemPrompt is required and must be a string',
      });
    }

    // Check API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY not configured');
      return res.status(500).json({
        error: 'API key not configured on server',
      });
    }

    console.log(`[AI Enhancement] Request for ${description.length} chars`);

    // Make request to Anthropic API
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: `${systemPrompt}\n\n**Job Description to Format:**\n\n${description}`,
        },
      ],
    });

    // Extract text content
    const textContent = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (!textContent) {
      throw new Error('No text content in API response');
    }

    console.log(`[AI Enhancement] Success - ${textContent.length} chars returned`);

    // Return the response
    res.json({
      content: textContent,
      usage: response.usage,
    });
  } catch (error) {
    console.error('[AI Enhancement] Error:', error);

    // Handle specific error types
    if (error.status === 401) {
      return res.status(500).json({
        error: 'API authentication failed',
      });
    }

    if (error.status === 429) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Please try again later.',
      });
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(503).json({
        error: 'Service temporarily unavailable',
      });
    }

    // Generic error response
    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

// AI Role Classification endpoint (for future use)
app.post('/api/classify-role', async (req, res) => {
  try {
    const { jobTitle, jobDescription, availableRoles, systemPrompt, model = 'claude-sonnet-4-5-20250929' } = req.body;

    // Validate input
    if (!jobTitle || typeof jobTitle !== 'string') {
      return res.status(400).json({
        error: 'Invalid input: jobTitle is required and must be a string',
      });
    }

    if (!systemPrompt || typeof systemPrompt !== 'string') {
      return res.status(400).json({
        error: 'Invalid input: systemPrompt is required and must be a string',
      });
    }

    console.log(`[Role Classification] Request for: ${jobTitle}`);

    // Format role list for prompt
    const rolesList = availableRoles
      .map((role) => `- ${role.id}: ${role.label} (${role.category})`)
      .join('\n');

    // Build user message
    const userMessage = `**Available Roles:**
${rolesList}

**Job to Classify:**

Title: ${jobTitle}

${jobDescription ? `Description: ${jobDescription.substring(0, 1000)}` : 'Description: (not provided)'}

Please classify this job into the most appropriate role from the list above.`;

    // Make request to Anthropic API
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${systemPrompt}\n\n${userMessage}`,
        },
      ],
    });

    // Extract text content
    const textContent = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (!textContent) {
      throw new Error('No text content in API response');
    }

    console.log(`[Role Classification] Success`);

    // Return the response
    res.json({
      content: textContent,
      usage: response.usage,
    });
  } catch (error) {
    console.error('[Role Classification] Error:', error);

    // Handle errors similar to enhance-description
    if (error.status === 401) {
      return res.status(500).json({ error: 'API authentication failed' });
    }
    if (error.status === 429) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AI Enhancement Proxy listening on port ${PORT}`);
  console.log(`📍 Allowed origins: ${corsOptions.origin.join(', ')}`);
  console.log(`🔑 API key configured: ${process.env.ANTHROPIC_API_KEY ? 'Yes' : 'No'}`);
});
