// Loads RichBlock, the renderer of the layout blocks (grid, table, panel, chips, card, columns,
// component), once. OutputView loads it the first time it draws such a block; bootstrap fetches
// it beside the kernel, so the first ls or help does not wait for it after it has run.

import type { Component } from 'svelte';
import type { Action, Block } from '../output/model';

export type RichBlockComponent = Component<{ block: Block; onaction?: (action: Action) => void }>;

let richBlock: Promise<RichBlockComponent> | undefined;

/** The layout-block renderer, loaded once; a failed load is tried again next time. */
export function loadRichBlock(): Promise<RichBlockComponent> {
  if (richBlock === undefined) {
    const loading = import('./RichBlock.svelte').then((module) => module.default as RichBlockComponent);
    loading.catch(() => {
      if (richBlock === loading) richBlock = undefined;
    });
    richBlock = loading;
  }
  return richBlock;
}
