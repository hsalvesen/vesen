// The trusted Svelte components a `component` block may name. Weather, stock and QR register
// their cards here as they land; a name with no entry renders the block's plain text.

import type { Component } from 'svelte';
import type { Action, ComponentName } from '../../output/model';

/** What OutputView passes to a registered component. */
export interface ComponentBlockProps {
  /** The block's view model (WeatherView, QuoteEnvelope, QrView, LinkView); each card narrows it. */
  view: unknown;
  /** The screen-reader summary of the card. */
  alt: string;
  /** Runs a trusted action from the card, when the host can act on one. */
  onaction?: (action: Action) => void;
}

const registry = new Map<ComponentName, Component<ComponentBlockProps>>();

/** The component registered for `name`, or undefined. Inherited keys such as `constructor` never match. */
export function lookupComponent(name: string): Component<ComponentBlockProps> | undefined {
  return registry.get(name as ComponentName);
}
