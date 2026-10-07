<!--
  The line being typed (docs/plan/designs/terminal-input.md, "DOM STRATEGY"; 02, section 5). A
  real <input> is the editing surface everywhere, so input methods, autocorrect, dictation, paste
  and selection stay the browser's own.

  - With a mouse (a fine pointer): the input is transparent and lies over an aria-hidden mirror
    that draws the text, a block cursor in --role-cursor (hollow when the terminal is not
    focused or a line is running, still while typing, never blinking under reduced motion) and
    the grey ghost in --role-ghost. A click on the ghost takes it. The mirror scrolls sideways
    with the input.
  - On touch: the native input shows, really 16px so iOS never zooms, drawn at the terminal's
    size by --input-scale (platform/measure.ts). There is no mirror.
  - A secret (sudo's password) is masked: the input holds only bullets (the controller keeps the
    password), drawn as discs on touch; the mirror shows nothing but the cursor. The read's dim
    hint (that it is a joke, and nothing is kept) describes the input to screen readers.
  - The input is keyed on controller.inputEpoch: after a password an input method typed into, a
    fresh input, with no undo history, takes its place.
-->
<script lang="ts">
  import { nextBoundary } from '../../shell/editor/readline';
  import { COMPLETION_LIST_ID, optionId } from '../completion-ids';
  import { READ_HINT_ID, STEADY_MS, type PromptController } from './promptController.svelte';

  let { controller }: { controller: PromptController } = $props();

  let input: HTMLInputElement | undefined = $state();
  let mirror: HTMLElement | undefined = $state();
  let ghostElement: HTMLElement | undefined = $state();

  const mirrored = $derived(!controller.touch);
  const secret = $derived(controller.mode === 'secret');
  // While a line runs the cursor is an outline: what is typed waits for the next prompt.
  const hollow = $derived(!controller.focused || controller.mode === 'busy');
  const selecting = $derived(controller.selEnd !== controller.cursor);

  // The mirror's three parts: the text before the cursor, the character under it, the rest.
  const parts = $derived.by(() => {
    const text = controller.text;
    const at = Math.min(controller.cursor, text.length);
    const end = nextBoundary(text, at);
    return { before: text.slice(0, at), under: text.slice(at, end), after: text.slice(end) };
  });

  const chips = $derived(controller.chipList.chips);
  const activeOption = $derived.by(() => {
    const index = chips.findIndex((chip) => chip.selected === true);
    return index === -1 ? undefined : optionId(index);
  });

  const label = $derived.by(() => {
    const read = controller.read;
    if (read !== null && !read.keepLine) return read.prompt.trim();
    if (controller.search !== null) return 'Search history';
    return 'Terminal command';
  });

  const search = $derived(controller.searchView);

  // The read's hint (PromptLine draws it) is said with the prompt's own description.
  const describedBy = $derived(controller.read !== null && !controller.read.keepLine && controller.read.hint ? `${READ_HINT_ID} prompt-keys` : 'prompt-keys');

  // The grey ghost, split where the block cursor sits on its first character.
  const ghost = $derived.by(() => {
    const value = controller.ghost;
    if (value === null) return null;
    const end = nextBoundary(value.text, 0);
    return { first: value.text.slice(0, end), rest: value.text.slice(end), acceptable: value.acceptable };
  });

  // The cursor holds still while typing and blinks once typing stops.
  let steady = $state(true);
  $effect(() => {
    void controller.editedAt;
    steady = true;
    const timer = setTimeout(() => (steady = false), STEADY_MS);
    return () => clearTimeout(timer);
  });

  // A long line scrolls sideways, as readline's horizontal-scroll-mode does: the input and the
  // mirror together, far enough that the block cursor, a cell wider than the caret, is in view.
  // The browser keeps a typed caret in view itself, but not one moved by setSelectionRange.
  function syncScroll(): void {
    if (!mirror || !input) return;
    const cursor = mirror.querySelector<HTMLElement>('.cursor');
    let left = input.scrollLeft;
    if (cursor) {
      const start = cursor.offsetLeft;
      const end = start + cursor.offsetWidth;
      if (end > left + mirror.clientWidth) left = end - mirror.clientWidth;
      if (start < left) left = start;
    }
    if (input.scrollLeft !== left) input.scrollLeft = left;
    mirror.scrollLeft = input.scrollLeft;
  }
  $effect(() => {
    void controller.text;
    void controller.cursor;
    if (!mirrored) return;
    const frame = requestAnimationFrame(syncScroll);
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    controller.ghostElement = ghostElement ?? null;
  });

  let first = true;
  /** Wires each input the key block makes to the controller, and unwires it when it goes. */
  function attachInput(node: HTMLInputElement): { destroy(): void } {
    input = node;
    const detach = controller.attach(node);
    if (first) {
      first = false;
      // A keyboard and mouse can start typing at once. On touch, focus opens the soft keyboard
      // over the page, so the prompt waits for a tap (ui/actions/focusPolicy.ts).
      controller.focus();
    }
    return {
      destroy() {
        detach();
        if (input === node) input = undefined;
      },
    };
  }
</script>

<form
  class="line-form"
  autocomplete="off"
  onsubmit={(event) => {
    // Enter from a keyboard that sends no usable keydown (keyCode 229) submits the form.
    event.preventDefault();
    controller.submit();
  }}
>
  <span
    class="input-box"
    class:mirrored
    class:secret
    class:bell={controller.bell}
    class:focused={controller.focused}
    data-completion={controller.completion === null ? undefined : 'ready'}
  >
    {#if mirrored}
      <!-- At the end of the line the block cursor sits on the first character of what follows,
           the ghost or the search's line, as a terminal draws it. -->
      <span class="mirror" aria-hidden="true" bind:this={mirror}
        >{#if secret}<span class="cursor" class:hollow class:steady>{' '}</span
          >{:else}{parts.before}{#if ghost}<span class="ghost-zone" bind:this={ghostElement}
              ><span class="cursor on-tail" class:hollow class:steady class:selecting>{ghost.first}</span
              ><span class="ghost" class:hint={!ghost.acceptable}>{ghost.rest}</span></span
            >{:else if search && parts.under === ''}<span class="cursor on-tail" class:hollow class:steady class:selecting
              >'</span
            ><span class="search-tail"
              >: {search.line.slice(0, search.at)}<span class="match">{search.line.slice(search.at, search.at + search.length)}</span
              >{search.line.slice(search.at + search.length)}</span
            >{:else}<span class="cursor" class:hollow class:steady class:selecting
              >{parts.under === '' ? ' ' : parts.under}</span
            >{parts.after}{#if search}<span class="search-tail"
                >': {search.line.slice(0, search.at)}<span class="match">{search.line.slice(search.at, search.at + search.length)}</span
                >{search.line.slice(search.at + search.length)}</span
              >{/if}{/if}{/if}</span
      >
    {/if}
    {#key controller.inputEpoch}
    <input
      use:attachInput
      class="command-input"
      type="text"
      role="combobox"
      aria-label={label}
      aria-autocomplete="list"
      aria-expanded={chips.length > 0}
      aria-controls={chips.length > 0 ? COMPLETION_LIST_ID : undefined}
      aria-activedescendant={activeOption}
      aria-describedby={describedBy}
      placeholder={controller.touch && controller.mode === 'edit' && controller.running === null ? 'Type a command…' : undefined}
      enterkeyhint={controller.read !== null ? 'done' : 'go'}
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
      inputmode="text"
      autocorrect="off"
      writingsuggestions="false"
      data-1p-ignore=""
      data-lpignore="true"
      onscroll={syncScroll}
    />
    {/key}
  </span>
  {#if !mirrored && search}
    <span class="search-tail"
      >': {search.line.slice(0, search.at)}<span class="match">{search.line.slice(search.at, search.at + search.length)}</span
      >{search.line.slice(search.at + search.length)}</span
    >
  {/if}
  <span id="prompt-keys" class="sr-only">Tab completes; Escape then Tab leaves the terminal.</span>
</form>

<style>
  .line-form {
    display: block;
    min-width: 0;
  }

  /* The visual bell: nothing to complete, or Enter while a command runs. The underline flashes
     once; there is no beep. */
  .input-box {
    position: relative;
    display: block;
    min-width: 8ch;
    box-shadow: inset 0 -1px 0 transparent;
  }

  .input-box.bell {
    box-shadow: inset 0 -2px 0 var(--role-warn);
  }

  .command-input {
    display: block;
    width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--role-fg-strong);
    caret-color: var(--role-cursor, currentColor);
    font: inherit;
    letter-spacing: inherit;
    font-variant-ligatures: none;
  }

  .command-input::placeholder {
    color: var(--role-muted);
    opacity: 1;
  }

  .command-input:focus::placeholder {
    color: transparent;
  }

  /* With a mouse: the mirror draws the line, and the input over it only takes the keys, the
     caret position and the selection. The phosphor CRT's glow stays off the input. */
  .mirror {
    display: block;
    overflow: hidden;
    white-space: pre;
    color: var(--role-fg-strong);
    pointer-events: none;
  }

  /* The padding lets the input scroll one cell past the end of its text, where the block cursor
     sits, so it can keep in step with the mirror. */
  .mirrored .command-input {
    position: absolute;
    inset: 0;
    height: 100%;
    padding-right: 1ch;
    color: transparent;
    -webkit-text-fill-color: transparent;
    caret-color: transparent;
    text-shadow: none;
  }

  .mirrored .command-input::selection {
    background: var(--role-selection);
    color: transparent;
    -webkit-text-fill-color: transparent;
  }

  .cursor {
    background: var(--role-cursor);
    color: var(--theme-background);
    animation: cursor-blink 1.06s steps(1) infinite;
  }

  .cursor.steady {
    animation: none;
  }

  .cursor.hollow {
    background: transparent;
    color: inherit;
    box-shadow: inset 0 0 0 1px var(--role-cursor);
    animation: none;
  }

  .cursor.selecting {
    background: transparent;
    color: inherit;
    box-shadow: none;
    animation: none;
  }

  @keyframes cursor-blink {
    50% {
      background: transparent;
      color: inherit;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cursor {
      animation: none;
    }
  }

  .ghost {
    color: var(--role-ghost);
  }

  /* Over the ghost or the search's line, the cursor shows the character it covers, dimmed while
     it is only a suggestion. */
  .cursor.on-tail.hollow,
  .cursor.on-tail.selecting {
    color: var(--role-ghost);
  }

  .ghost.hint {
    font-style: italic;
  }

  .search-tail {
    color: var(--role-fg);
    white-space: pre;
  }

  .match {
    background: var(--role-selection);
    color: var(--role-fg-strong);
  }

  /* A secret is never shown: discs on touch, where the input is visible. */
  .secret .command-input {
    -webkit-text-security: disc;
  }

  @supports not (-webkit-text-security: disc) {
    .secret .command-input {
      color: transparent;
      -webkit-text-fill-color: transparent;
    }
  }

  /* Touch: iOS zooms into any input under 16px when it takes focus. The input is really 16px and
     drawn at the terminal's size by --input-scale (platform/measure.ts); the box is one terminal
     line tall and clips the unscaled layout. At --input-scale: 1 this is a plain 16px input. */
  @media (pointer: coarse) {
    .input-box {
      height: calc(16px * var(--term-lh) * var(--input-scale));
      overflow: hidden;
    }

    .command-input {
      font-size: 16px;
      line-height: var(--term-lh);
      height: calc(16px * var(--term-lh));
      width: calc(100% / var(--input-scale));
      transform: scale(var(--input-scale));
      transform-origin: 0 0;
    }
  }
</style>
