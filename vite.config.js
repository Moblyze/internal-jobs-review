import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import geocodeApiPlugin from './vite-plugin-geocode-api.js'

export default defineConfig({
  plugins: [react(), geocodeApiPlugin()],
  // Cloudflare Pages serves from the root (VITE_BASE=/); the legacy GitHub Pages
  // path stays the default until switch-over.
  base: process.env.VITE_BASE || '/internal-jobs-review/',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom', 'scheduler'],
          'date-utils': ['date-fns'],
          'ui': ['react-select', 'react-infinite-scroll-component']
        }
      }
    }
  }
})
