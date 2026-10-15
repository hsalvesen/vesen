<!--
  The live prompt row (docs/plan/designs/terminal-input.md, PromptLine.svelte), from top to bottom:

  - the lines already typed at a `> ` continuation prompt;
  - while a command reads a line (rm -i, sudo's password): its dim hint. The line that is running
    and what the command has printed so far are its entry in the transcript, just above;
  - the edit row: PS1, or the command's prompt, `> `, or `(reverse-i-search)`, then the line
    editor. While a line runs, its entry and the status line are above, and the row holds only
    the type-ahead, where the next prompt will be: the prompt keeps its room, unseen, so the input
    keeps its width, since WebKit scrolls a focused input back into view whenever its width
    changes, which would drag a visitor reading further up to the bottom. A tap read (sudo's
    `Tap to elevate privileges` on a touch screen) has nothing to type: its prompt is a button in
    the row, which takes the focus, so the keyboard goes and Enter or Space answers too, and the
    line editor waits unseen.
-->
<script lang="ts">
  import type { ShellPort } from '../../shell/index';
  import Prompt from '../Prompt.svelte';
  import { PS2 } from '../../shell/editor/continuation';
  import { tapTarget } from '../actions/tapTarget';
  import LineEditor from './LineEditor.svelte';
  import { READ_HINT_ID, type PromptController } from './promptController.svelte';

  let { controller, shell }: { controller: PromptController; shell: ShellPort } = $props();

  const read = $derived(controller.read !== null && !controller.read.keepLine ? controller.read : null);
  const busy = $derived(controller.running !== null && read === null);

  /** The tap read's button has the focus while it waits: a screen reader says what to do, and Enter answers. */
  function takeFocus(node: HTMLElement): void {
    node.focus({ preventScroll: true });
  }
</script>

<!-- A tap anywhere on the row is the row's, never a tappable name's on the line above (actions/tapTarget.ts). -->
<div class="prompt-line" use:tapTarget>
  {#if controller.ps2}
    {#each controller.ps2.lines as typed, index (index)}
      <div class="frozen">
        {#if index === 0}<Prompt line={controller.ps2.prompt} />{:else}<span class="ps2">{PS2}</span>{/if}<span class="frozen-line">{typed}</span>
      </div>
    {/each}
  {/if}

  {#if read?.hint}
    <div class="hint" id={READ_HINT_ID}>{read.hint}</div>
  {/if}

  <!--
    The prompt takes what it needs and may wrap; the input always keeps 10 cells, so the row never
    overflows at 320px, however long the folder name.
  -->
  <div class="edit-row" class:busy class:searching={controller.searchView !== null} class:tap={read?.tap === true}>
    <span class="label" aria-hidden={busy ? 'true' : undefined}>
      {#if read?.tap}
        <button type="button" class="tap-read" use:takeFocus onclick={() => controller.answerTap()}>{read.prompt}</button>
      {:else if read}
        <span class="read-prompt">{read.prompt}</span>
      {:else if controller.searchView}
        <span class="read-prompt">{controller.searchView.label}`</span>
      {:else if controller.ps2}
        <span class="ps2">{PS2}</span>
      {:else if controller.running}
        <Prompt line={controller.running.prompt} />
      {:else}
        <Prompt cwd={shell.cwd} status={shell.lastStatus} />
      {/if}
    </span>
    <div class="editor">
      <LineEditor {controller} />
    </div>
  </div>
</div>

<style>
  .prompt-line {
    min-width: 0;
  }

  .frozen {
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--role-fg);
  }

  .frozen-line {
    margin-left: 0.25rem;
    color: var(--role-fg-strong);
  }

  .edit-row {
    display: grid;
    grid-template-columns: minmax(0, max-content) minmax(10ch, 1fr);
    align-items: center;
    column-gap: 0.25rem;
  }

  .label {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  /* The query follows the search's opening quote directly: (reverse-i-search)`query'. */
  .edit-row.searching {
    column-gap: 0;
  }

  /* While a line runs, the prompt it was typed at keeps its room, unseen. */
  .edit-row.busy .label {
    visibility: hidden;
  }

  .read-prompt,
  .ps2 {
    color: var(--role-fg-strong);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .editor {
    min-width: 0;
  }

  /* A tap read: the button alone, a thumb's size, and the line editor out of the way. */
  .edit-row.tap {
    grid-template-columns: minmax(0, 1fr);
  }

  .edit-row.tap .editor {
    display: none;
  }

  .tap-read {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    min-height: 44px;
    margin: 2px 0;
    padding: 0 1.5ch;
    border: 1px solid var(--role-accent);
    border-radius: 4px;
    background: var(--role-chip-bg, transparent);
    color: var(--role-fg-strong);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .tap-read:focus-visible {
    outline: 2px solid var(--role-accent);
    outline-offset: 1px;
  }

  .tap-read:active {
    background: var(--role-accent);
    color: var(--theme-background);
  }

  .hint {
    color: var(--role-muted);
  }
</style>
