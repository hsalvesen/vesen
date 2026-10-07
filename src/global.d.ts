/// <reference types="svelte" />
/// <reference types="vite/client" />

declare global {
  /** The package.json version, injected by Vite's `define` at build time. */
  const __APP_VERSION__: string;

  interface ImportMetaEnv {
    /** vesen's own fetch proxy for `curl --via-proxy`, such as https://proxy.example/fetch; unset means none. */
    readonly VITE_FETCH_PROXY?: string;
  }
}

export {};
