import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Served at root on Firebase Hosting (wardround.app).
  // If reverting to GitHub Pages, change to '/catalist/'.
  base: '/',
  build: {
    // Source maps so production stack traces map back to readable code.
    // ~3MB extra in dist/ is fine for an internal app at this stage.
    sourcemap: true,
  },
});
