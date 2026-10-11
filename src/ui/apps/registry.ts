// The full-screen apps a command can show (ctx.tty.fullscreen), each in its own chunk, loaded the
// first time it is shown. Each app registers here as it lands.

import type { Component } from 'svelte';
import type { FullscreenView } from '../../shell/types';

/** What AppHost passes to an app. */
export interface AppProps {
  /** The view model the command built, such as a ShutdownView. */
  props: unknown;
  /** Ends the app and hands the command its result. */
  close: (result?: unknown) => void;
}

/** What an app exports for AppHost. */
export interface AppExports {
  /**
   * Back (Android's button, iOS's edge swipe) left the app's history entry: close the way the app
   * closes itself, so the command gets its usual result, or dismiss what is on top first (a
   * prompt, the help). An app that stays open gets its entry back. Without it, Back closes the
   * app with no result.
   */
  back?: () => void;
}

type Loader = () => Promise<{ default: Component<AppProps, AppExports> }>;

const APPS: Partial<Record<FullscreenView, Loader>> = {
  shutdown: () => import('./Shutdown.svelte'),
  'qr-present': () => import('./QrPresenter.svelte'),
  sl: () => import('./Train.svelte'),
  matrix: () => import('./Matrix.svelte'),
  rick: () => import('./Rick.svelte'),
  pager: () => import('./Pager.svelte'),
  editor: () => import('./Editor.svelte'),
};

/** The loader for a view, or undefined when no app of that name exists yet. */
export function appLoader(view: string): Loader | undefined {
  return Object.prototype.hasOwnProperty.call(APPS, view) ? APPS[view as FullscreenView] : undefined;
}
