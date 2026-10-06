<!--
  Renders output blocks with text interpolation only. Legacy HTML is the one exception, and it
  goes through the sanitising use:legacyHtml action. Lines and legacy HTML, which is everything
  today's commands print, are drawn here; the layout blocks are drawn by RichBlock, loaded the
  first time one appears.

  Markup inside text containers is written without whitespace between tags on purpose: those
  containers preserve whitespace, so any space Svelte kept there would show.
-->
<script module lang="ts">
  import type { Component } from 'svelte';
  import type { Action, Block } from '../output/model';

  type RichBlockComponent = Component<{ block: Block; onaction?: (action: Action) => void }>;

  let richBlock: Promise<RichBlockComponent> | undefined;

  /** The layout-block renderer, loaded once, the first time a layout block is drawn. */
  function loadRichBlock(): Promise<RichBlockComponent> {
    if (richBlock === undefined) {
      const loading = import('./RichBlock.svelte').then((module) => module.default);
      // A failed load is tried again the next time a layout block is drawn.
      loading.catch(() => {
        if (richBlock === loading) richBlock = undefined;
      });
      richBlock = loading;
    }
    return richBlock;
  }
</script>

<script lang="ts">
  import LineView from './LineView.svelte';
  import { legacyHtml } from './legacy-html';

  let { blocks, onaction }: { blocks: readonly Block[]; onaction?: (action: Action) => void } = $props();
</script>

<div class="output">
  {#each blocks as block}
    {#if block.type === 'lines'}
      <div class="lines" class:stderr={block.stream === 'stderr'}>
        {#each block.lines as line}
          <div class="text">{#if line.length === 0}<br />{:else}<LineView {line} {onaction} />{/if}</div>
        {/each}
      </div>
    {:else if block.type === 'legacyHtml'}
      <div class="legacy" use:legacyHtml={block.html}></div>
    {:else}
      {#await loadRichBlock() then RichBlock}
        <RichBlock {block} {onaction} />
      {:catch}
        <!-- A chunk from an older deploy: platform/chunkReload reloads the page. -->
      {/await}
    {/if}
  {/each}
</div>

<style>
  /* Each output is a size container, so tables and art fit the width they are drawn in. It must
     sit in a box that does not shrink to its content, as a block or a sized flex item does. */
  .output {
    container: output / inline-size;
    min-width: 0;
    white-space: normal;
  }

  .text,
  .legacy {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* Legacy HTML is drawn, and takes taps, only inside its own box: padding or a negative margin
     in it can never reach over later output or the prompt. */
  .legacy {
    contain: paint;
  }
</style>
