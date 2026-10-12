<!--
  Renders output blocks with text interpolation only: no block is ever HTML. Lines and art (the
  banner, which boot shows before anything has loaded) are drawn here; the layout blocks are
  drawn by RichBlock, loaded the first time one appears (or sooner: bootstrap fetches it beside
  the kernel).

  Markup inside text containers is written without whitespace between tags on purpose: those
  containers preserve whitespace, so any space Svelte kept there would show.
-->
<script lang="ts">
  import { textWidth, type Action, type Block } from '../output/model';
  import LineView from './LineView.svelte';
  import { artClass } from './art-class';
  import { hangingIndent } from './hang';
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
    <!-- Lines with an alt are a drawing (tree): screen readers hear the alt instead of them. The
         span and the div are written together, so no whitespace text node sits between them. -->
    {#if block.type === 'lines'}
      {#if block.alt !== undefined}<span class="sr-only">{block.alt}</span>{/if}<div class="lines" class:stderr={block.stream === 'stderr'} aria-hidden={block.alt === undefined ? undefined : 'true'}>
        {#each block.lines as line}
          {@const hang = hangingIndent(line)}
          <!-- A label row's description wraps under itself, not under the label. -->
          <div class="text" style={hang > 0 ? `padding-left: ${hang}ch; text-indent: -${hang}ch` : undefined}>{#if line.length === 0}<br />{:else}<LineView {line} {onaction} />{/if}</div>
        {/each}
      </div>
    {:else if block.type === 'art'}
      <!-- Hidden from screen readers, which hear the alternative text instead of the glyphs. Block
           art (the banner, text-mode QR codes) is drawn with its rows touching; art drawn with
           letters and punctuation (cowsay, sl, figlet, fastfetch's logos) at the terminal's line height. -->
      <div class="art-wrap">
        <div
          class="art {artClass(block.text)} {spanClasses(block.style)}"
          class:art-fit={block.fit === 'scale'}
          aria-hidden="true"
          style="--art-cols: {artColumns(block.text + (block.tail?.text ?? ''))}; {spanCss(block.style) ?? ''}"
        >{block.text}{#if block.tail}<span class={spanClasses(block.tail.style)} style={spanCss(block.tail.style)}>{block.tail.text}</span>{/if}</div><span class="sr-only">{block.alt}</span>
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

  .text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .art-wrap {
    max-width: 100%;
  }
</style>
