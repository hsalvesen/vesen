import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 3000,
  },
  // === IMPORTANT ADDITIONS FOR PRODUCTION DEPLOYMENT ===
  base: '/', // Tells Vite to generate asset paths relative to the root of the domain
  build: {
    outDir: 'dist', // Ensures the build output goes into the 'dist' folder
    emptyOutDir: true, // Cleans the 'dist' folder before each new build
  },
  // =====================================================
});