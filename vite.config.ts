import { defineConfig } from 'vite';

// Vite is only used for the dev server (dev.html). The shippable game is the
// single-file index.html produced by `npm run build`.
export default defineConfig({
  base: './',
});
