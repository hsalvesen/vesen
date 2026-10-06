<!--
  The live prompt row (docs/plan/designs/terminal-input.md, PromptLine.svelte), from top to bottom:

  - the lines already typed at a `> ` continuation prompt;
  - while a command reads a line (rm -i, sudo's password): the line that is running, what the
    command has printed so far and its dim hint;
  - the edit row: PS1, or the command's prompt, `> `, or `(reverse-i-search)`, then the line
    editor. While a line runs, the line sits frozen beside its prompt and the editor under it
    holds the type-ahead, the same width as before: WebKit scrolls a focused input back into
    view whenever its width changes, which would drag a visitor reading further up to the bottom;
  - the status line while a command runs: what it is doing, for how long, and how to stop it.
    A tap or click on it stops the command.
-->
<script lang="ts">
  import type { Action } from '../../output/model';
  import type { ShellPort } from '../../shell/index';
  import OutputView from '../OutputView.svelte';
  import Prompt from '../Prompt.svelte';
  import { PS2 } from '../../shell/editor/continuation';
  import LineEditor from './LineEditor.svelte';
  import type { PromptController } from './promptController.svelte';

  let {
    controller,
    shell,
    onaction,
  }: {
    controller: PromptController;
    shell: ShellPort;
    onaction?: (action: Action) => void;
  } = $props();

  const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  // Phones get a tap target; keyboards get the shortcut. Both can click the line.
  const cancelHint = $derived(controller.touch ? 'tap to cancel' : 'Ctrl+C to cancel');

  const read = $derived(controller.read !== null && !controller.read.keepLine ? controller.read : null);
  const busy = $derived(controller.running !== null && read === null);

  // The spinner, and the seconds the command has run once it has run one.
  let frame = $state(0);
  let now = $state(Date.now());
  $effect(() => {
    if (!busy) return;
    frame = 0;
    now = Date.now();
    const timer = setInterval(() => {
      frame = (frame + 1) % FRAMES.length;
      now = Date.now();
    }, 100);
    return () => clearInterval(timer);
  });

  const status = $derived.by(() => {
    const running = controller.status;
    const label = running?.label ?? 'Processing…';
    const seconds = running === null || running.startedAt === 0 ? 0 : Math.floor((now - running.startedAt) / 1000);
    return `${FRAMES[frame]} ${label}${seconds >= 1 ? ` ${seconds}s` : ''} (${cancelHint})`;
  });
</script>

<div class="prompt-line">
  {#if controller.ps2}
    {#each controller.ps2.lines as typed, index (index)}
      <div class="frozen">
        {#if index === 0}<Prompt line={controller.ps2.prompt} />{:else}<span class="ps2">{PS2}</span>{/if}<span class="frozen-line">{typed}</span>
      </div>
    {/each}
  {/if}

  {#if read}
    {#if controller.running}
      <!-- Inline, so a long line wraps under its prompt as a past entry's does. -->
      <div class="frozen"><Prompt line={controller.running.prompt} /><span class="frozen-line">{controller.running.line}</span></div>
    {/if}
    {#if read.before.length > 0}
      <div class="read-before"><OutputView blocks={read.before} {onaction} /></div>
    {/if}
    {#if read.hint}
      <div class="hint">{read.hint}</div>
    {/if}
  {/if}

  <!--
    The prompt takes what it needs and may wrap; the input always keeps 10 cells, so the row never
    overflows at 320px, however long the folder name.
  -->
  <div class="edit-row" class:busy class:searching={controller.searchView !== null}>
    <span class="label">
      {#if read}
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
      {#if busy && controller.running}
        <span class="running-line">{controller.running.line}</span>
      {/if}
      <LineEditor {controller} />
    </div>
  </div>

  {#if busy}
    <!--
      mousedown is cancelled so the tap does not take focus, and the keyboard, from the prompt.
      Not pointerdown: WebKit on iOS drops the whole tap, click included, when pointerdown is cancelled.
    -->
    <button
      type="button"
      class="processing mt-1"
      aria-label="Cancel running command"
      onmousedown={(event) => event.preventDefault()}
      onclick={() => controller.interrupt()}>{status}</button
    >
  {/if}
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

  /* The prompt sits beside the running line, the type-ahead under both. */
  .edit-row.busy {
    align-items: start;
  }

  .running-line {
    display: block;
    color: var(--role-fg-strong);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
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

  .hint {
    color: var(--role-muted);
  }

  .processing {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    color: var(--role-accent);
    font: inherit;
    cursor: pointer;
  }

  @media (pointer: coarse) {
    .processing {
      min-height: 44px;
    }
  }

  /* Feedback for a tap, in place of the tap highlight styles/shell.css turns off. */
  .processing:active {
    opacity: 0.6;
  }
</style>
