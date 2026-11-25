import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // relative asset paths: dist/ works from a domain root or any sub-folder
  base: './',
  plugins: [react()],
})
