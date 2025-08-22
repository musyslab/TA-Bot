// ui/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: '.',                // your project root
  publicDir: 'public',      // same as CRA’s public
  plugins: [react()],
  server: {
    port: 3000,             // match your old dev port if desired
    open: true
  },
  build: {
    outDir: 'dist',         // Vite’s default
    emptyOutDir: true
  }
})
