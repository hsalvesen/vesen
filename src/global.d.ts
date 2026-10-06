/// <reference types="svelte" />
/// <reference types="vite/client" />

declare global {
  /** The package.json version, injected by Vite's `define` at build time. */
  const __APP_VERSION__: string;
}

export {};
