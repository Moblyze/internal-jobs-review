/**
 * Vite Plugin: Geocode API
 *
 * Adds a simple API endpoint to save geocoded location data during development.
 * This allows the browser-based geocoder to persist data back to the file system.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function geocodeApiPlugin() {
  const GEOCODED_FILE = path.join(__dirname, 'public/data/locations-geocoded.json');

  return {
    name: 'geocode-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Handle POST /api/geocode/save
        if (req.method === 'POST' && req.url === '/api/geocode/save') {
          let body = '';

          req.on('data', chunk => {
            body += chunk.toString();
          });

          req.on('end', () => {
            try {
              const data = JSON.parse(body);

              // Validate data structure
              if (typeof data !== 'object' || data === null) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid data format' }));
                return;
              }

              // Save to file with pretty formatting
              fs.writeFileSync(GEOCODED_FILE, JSON.stringify(data, null, 2), 'utf-8');

              console.log(`✅ Saved ${Object.keys(data).length} geocoded locations to ${GEOCODED_FILE}`);

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                count: Object.keys(data).length,
                file: GEOCODED_FILE
              }));
            } catch (error) {
              console.error('Error saving geocoded data:', error);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: error.message }));
            }
          });

          return;
        }

        // Handle GET /api/geocode/status (optional - for checking if API is available)
        if (req.method === 'GET' && req.url === '/api/geocode/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            available: true,
            file: GEOCODED_FILE,
            exists: fs.existsSync(GEOCODED_FILE)
          }));
          return;
        }

        next();
      });
    }
  };
}
