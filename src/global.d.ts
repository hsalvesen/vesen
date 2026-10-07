/// <reference types="svelte" />
/// <reference types="vite/client" />

declare global {
  /** The package.json version, injected by Vite's `define` at build time. */
  const __APP_VERSION__: string;

  interface ImportMetaEnv {
    /**
     * The stock Worker's base URL (worker/stock), such as https://vesen-stock.example.workers.dev.
     * Unset or empty, `stock` uses the interim public proxy (src/services/market/interim.ts).
     */
    readonly VITE_STOCK_API?: string;
  }
}

export {};
