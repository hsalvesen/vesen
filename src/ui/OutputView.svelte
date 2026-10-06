<!--
  Renders output blocks with text interpolation only. Legacy HTML is the one exception, and it
  goes through the sanitising use:legacyHtml action. Lines, legacy HTML and art (the banner, which
  boot shows before anything has loaded) are drawn here; the layout blocks are drawn by
  RichBlock, loaded the first time one appears (or sooner: bootstrap fetches it beside the kernel).

  Markup inside text containers is written without whitespace between tags on purpose: those
  containers preserve whitespace, so any space Svelte kept there would show.
-->
<script lang="ts">
  import { textWidth, type Action, type Block } from '../output/model';
  import LineView from './LineView.svelte';
  import { legacyHtml } from './legacy-html';
  import { loadRichBlock } from './rich-block';
  import { spanClasses, spanCss } from './span-style';

  let { blocks, onaction }: { blocks: readonly Block[]; onaction?: (action: Action) => void } = $props();

  /** The widest row of some art, in cells, which .art-fit scales it to. */
  function artColumns(text: string): number {
    return text.split('\n').reduce((widest, row) => Math.max(widest, textWidth(row)), 1);
  }
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
    {:else if block.type === 'art'}
      <!-- Hidden from screen readers, which hear the alternative text instead of the glyphs. -->
      <div class="art-wrap">
        <div
          class="art {spanClasses(block.style)}"
          class:art-fit={block.fit === 'scale'}
          aria-hidden="true"
          style="--art-cols: {artColumns(block.text)}; {spanCss(block.style) ?? ''}"
        >{block.text}</div><span class="sr-only">{block.alt}</span>
      </div>
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

  .art-wrap {
    max-width: 100%;
  }

  /* Legacy HTML is drawn, and takes taps, only inside its own box: padding or a negative margin
     in it can never reach over later output or the prompt. */
  .legacy {
    contain: paint;
  }
</style>
