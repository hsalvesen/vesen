// The trusted Svelte components a `component` block may name. Weather, stock and QR register
// their cards here as they land, each as a loader (`'weather-card': () =>
// import('./WeatherCard.svelte')`), so a card's code is fetched the first time a block names it:
// it is never in the first paint's chunk, nor in RichBlock's. Until it arrives, and when it
// cannot, a block shows its plain text, as does a name with no card.

import type { Component } from 'svelte';
import type { Action, ComponentName } from '../../output/model';

/** What OutputView passes to a registered component. */
export interface ComponentBlockProps {
  /** The block's view model (WeatherView, QuoteEnvelope, QrView); each card narrows it. */
  view: unknown;
  /** The screen-reader summary of the card. */
  alt: string;
  /** Runs a trusted action from the card, when the host can act on one. */
  onaction?: (action: Action) => void;
}

export type BlockComponent = Component<ComponentBlockProps>;

/** Loads a card's chunk. */
export type ComponentLoader = () => Promise<{ readonly default: BlockComponent }>;

/** The cards, by name, each loading its own chunk. Each card adds itself here as it lands. */
const CARDS: Partial<Record<ComponentName, ComponentLoader>> = {
  'quote-card': () => import('./QuoteCard.svelte'),
  'quote-table': () => import('./QuoteTable.svelte'),
};

const loaders = new Map<ComponentName, ComponentLoader>(Object.entries(CARDS) as [ComponentName, ComponentLoader][]);

/** Cards whose chunk has arrived, so a card drawn again draws at once. */
const loaded = new Map<ComponentName, BlockComponent>();

/** Cards whose chunk is on its way, so two blocks naming one card fetch it once. */
const loading = new Map<ComponentName, Promise<BlockComponent>>();

/**
 * Registers the card for `name`, replacing any before it, beside those in CARDS: for tests. Its
 * chunk is not fetched until a block names it.
 */
export function registerComponent(name: ComponentName, load: ComponentLoader): void {
  loaders.set(name, load);
  loaded.delete(name);
  loading.delete(name);
}

/**
 * The component for `name` when its chunk has already arrived, or undefined. Inherited keys such
 * as `constructor` never match.
 */
export function lookupComponent(name: string): BlockComponent | undefined {
  return loaded.get(name as ComponentName);
}

/**
 * Fetches the component for `name`, once; undefined when no card is registered for it. A load
 * that fails is tried again the next time a block names the card.
 */
export function loadComponent(name: string): Promise<BlockComponent> | undefined {
  const key = name as ComponentName;
  const load = loaders.get(key);
  if (load === undefined) return undefined;
  const pending = loading.get(key);
  if (pending !== undefined) return pending;
  const next = load().then((module) => {
    if (loading.get(key) === next) loaded.set(key, module.default);
    return module.default;
  });
  next.catch(() => {
    if (loading.get(key) === next) loading.delete(key);
  });
  loading.set(key, next);
  return next;
}
