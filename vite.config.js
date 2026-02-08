import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import geocodeApiPlugin from './vite-plugin-geocode-api.js'

export default defineConfig({
  plugins: [react(), geocodeApiPlugin()],
  base: './',
})
