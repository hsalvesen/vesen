/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module '*.svelte' {
  import type { ComponentType } from 'svelte'
  const component: ComponentType
  export default component
}

interface ImportMetaEnv {
  readonly VITE_TRACKING_ENABLED?: string
  readonly VITE_TRACKING_SITE_ID?: string
  readonly VITE_TRACKING_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

export {};