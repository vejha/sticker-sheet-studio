import { defineConfig } from 'vite';

export default defineConfig({
  // Set VITE_BASE_PATH=/repository-name/ for GitHub Pages project sites.
  base: process.env.VITE_BASE_PATH || './',
});
