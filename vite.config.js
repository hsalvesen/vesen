import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  base: '/', // <<< THIS MUST BE PRESENT AND SET TO '/'
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})