import { defineConfig } from 'vite';

// Relative base so the build can be dropped into any sub-path on the hosting site.
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1000 },
});
