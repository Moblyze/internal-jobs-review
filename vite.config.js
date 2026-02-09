import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import geocodeApiPlugin from './vite-plugin-geocode-api.js'

export default defineConfig({
  plugins: [react(), geocodeApiPlugin()],
  base: '/internal-jobs-review/',
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
