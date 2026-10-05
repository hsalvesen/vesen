/// <reference types="svelte" />
/// <reference types="vite/client" />

declare global {
  /** The package.json version, injected by Vite's `define` at build time. */
  const __APP_VERSION__: string;

  interface ImportMetaEnv {
    readonly VITE_TRACKING_ENABLED?: string;
    readonly VITE_TRACKING_SITE_ID?: string;
    readonly VITE_TRACKING_URL?: string;
  }
}

export {};
