/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { svelteTesting } from '@testing-library/svelte/vite';

// Read the version at build time so package.json itself never ships in the bundle.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

// Tests that need a DOM: anything under the UI folders, Svelte component tests, and the
// golden snapshots of the legacy terminal.
const domTests = [
  'src/ui/**/*.test.ts',
  'src/components/**/*.test.ts',
  'src/**/*.svelte.test.ts',
  'tests/golden/**/*.test.ts',
];

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 3000,
  },
  build: {
    // Instagram's in-app browser on older iPhones runs an iOS 15 WebKit.
    target: ['es2020', 'safari15'],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...domTests],
        },
      },
      {
        extends: true,
        plugins: [svelteTesting()],
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: domTests,
          setupFiles: ['src/testing/setup-dom.ts'],
        },
      },
    ],
  },
});
