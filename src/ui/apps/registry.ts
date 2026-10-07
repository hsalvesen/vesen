// The full-screen apps a command can show (ctx.tty.fullscreen), each in its own chunk, loaded the
// first time it is shown. The pager, the editor and the QR presenter register here as they land.

import type { Component } from 'svelte';
import type { FullscreenView } from '../../shell/types';

/** What AppHost passes to an app. */
export interface AppProps {
  /** The view model the command built, such as a ShutdownView. */
  props: unknown;
  /** Ends the app and hands the command its result. */
  close: (result?: unknown) => void;
}

type Loader = () => Promise<{ default: Component<AppProps> }>;

const APPS: Partial<Record<FullscreenView, Loader>> = {
  shutdown: () => import('./Shutdown.svelte'),
  'qr-present': () => import('./QrPresenter.svelte'),
  sl: () => import('./Train.svelte'),
  matrix: () => import('./Matrix.svelte'),
};

/** The loader for a view, or undefined when no app of that name exists yet. */
export function appLoader(view: string): Loader | undefined {
  return Object.prototype.hasOwnProperty.call(APPS, view) ? APPS[view as FullscreenView] : undefined;
}
