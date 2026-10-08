<!--
  The editor: nano, and vi and vim, which open it (src/lib/nano.ts has the model). A title bar,
  the text, a status line and, on a keyboard, nano's two rows of shortcuts. The text is a native
  textarea everywhere, so typing, the caret keys, selection, IME and autocorrect are the
  browser's own; nano's Ctrl keys are added on top: ^O writes out (asking the file name), ^S
  saves, ^X leaves (asking 'Save modified buffer?' when there are changes), ^F or ^W finds, ^K
  cuts the line and ^U pastes it, ^C says where the caret is and ^G shows the keys. The bar shows
  ^W only on a Mac: elsewhere Ctrl+W closes the browser's tab. Its prompts are its own, at the
  bottom, never the terminal's. On a touch screen a toolbar of 44px buttons stands in for the
  keys a phone keyboard lacks, and Back (AppHost) leaves as ^X does.

  Writing goes through the command's `save`, which writes as the visitor, so a file they may not
  change says [ File is unwritable ] and what is saved under ~ persists. While there are unsaved
  changes, leaving the page asks first. Back with changes asks 'Save modified buffer?', and keeps
  asking until Y, N or ^C answers; the buffer goes to the command's `keep` meanwhile, and when
  the page is put away, so a Back that leaves vesen anyway (a phone's browser may skip the entry)
  loses nothing: the next nano of the file asks 'Restore unsaved changes from before?'.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    asEditorView,
    cutLine,
    EDITOR_CLOSED,
    EDITOR_HELP,
    findMessage,
    findNext,
    location,
    offsetOf,
    pasteAt,
    shortcutsFor,
    withFinalNewline,
    type Shortcuts,
  } from '../../lib/nano';
  import { keyPlatform } from '../../platform/env';
  import type { AppProps } from './registry';

  let { props, close }: AppProps = $props();

  // svelte-ignore state_referenced_locally
  const view = asEditorView(props);
  const touch = view?.touch === true;

  let text = $state(view?.text ?? '');
  /** What the file holds, as last read or written: the buffer is modified when it differs. */
  let saved = $state(view?.text ?? '');
  let name = $state<string | null>(view?.name ?? null);
  let message = $state(view?.message ?? '');
  const modified = $derived(text !== saved);

  type Prompt = { readonly kind: 'write'; readonly then: 'stay' | 'exit' } | { readonly kind: 'search' };
  let prompt = $state<Prompt | null>(null);
  let answer = $state('');
  /** A Y or N question is waiting for Y, N or ^C: 'Save modified buffer?', or whether to restore what was kept. */
  let asking = $state<'save' | 'restore' | null>(view?.kept === undefined ? null : 'restore');
  const QUESTIONS = { save: 'Save modified buffer?', restore: 'Restore unsaved changes from before?' } as const;
  /** The name the buffer is kept under (null for a new buffer), while something is kept for it. */
  let keptAs: { readonly name: string | null } | null = view?.kept === undefined ? null : { name: view.name };
  let helping = $state(false);
  let lastSearch = $state('');
  /** What ^K cut; cuts in a row collect, as nano's do. */
  let clip = '';
  let cutting = false;
  let closed = false;

  let area: HTMLTextAreaElement | undefined = $state();
  let promptBox: HTMLInputElement | undefined = $state();

  const busy = $derived(prompt !== null || asking !== null || helping);
  /** nano's words on a keyboard; shorter on a touch screen, where Save or Find and Cancel share the row. */
  const promptLabel = $derived.by(() => {
    if (prompt === null) return '';
    if (prompt.kind === 'write') return touch ? 'Write to:' : 'File Name to Write:';
    const word = touch ? 'Find' : 'Search';
    return lastSearch === '' ? `${word}:` : `${word} [${lastSearch}]:`;
  });
  /** ^W closes the tab off a Mac, so the bar offers ^F there instead. */
  const SHORTCUTS = shortcutsFor(keyPlatform(typeof navigator === 'undefined' ? undefined : navigator));
  const ASKING: Shortcuts = [[['Y', 'Yes'], ['N', 'No']], [['^C', 'Cancel']]];
  const shortcuts: Shortcuts = $derived(
    asking !== null ? ASKING : prompt !== null ? [[['Enter', prompt.kind === 'write' ? 'Write' : 'Find']], [['^C', 'Cancel']]] : SHORTCUTS,
  );

  function finish(): void {
    if (closed) return;
    closed = true;
    close(EDITOR_CLOSED);
  }

  function caret(): number {
    return area?.selectionStart ?? text.length;
  }

  /** Back to the text, the caret where it was. */
  function focusArea(): void {
    area?.focus({ preventScroll: true });
  }

  /** New text, with the caret at `at` once the textarea has it. */
  async function setText(next: string, at: number): Promise<void> {
    text = next;
    await tick();
    area?.setSelectionRange(at, at);
  }

  // ── Keeping what is not saved ──

  /** Hands the unsaved buffer to the command to keep, under its name now. */
  function keepBuffer(): void {
    if (view?.keep === undefined || !modified || closed) return;
    view.keep(name, text);
    if (keptAs !== null && keptAs.name !== name) view.keep(keptAs.name, null);
    keptAs = { name };
  }

  /** The buffer was saved or discarded: nothing kept for it is wanted now. */
  function forgetKept(): void {
    if (keptAs === null) return;
    view?.keep?.(keptAs.name, null);
    keptAs = null;
  }

  // ── Writing ──

  /** Writes the buffer as `target`; true when it was written. */
  function write(target: string): boolean {
    if (view === null) return false;
    const body = withFinalNewline(text);
    const result = view.save(target, body);
    message = result.message;
    if (!result.ok) return false;
    name = result.name;
    forgetKept();
    if (body !== text) {
      // The newline nano adds at the end; the caret stays where it is.
      const start = area?.selectionStart ?? 0;
      const end = area?.selectionEnd ?? start;
      void setText(body, start).then(() => area?.setSelectionRange(start, end));
    }
    saved = body;
    return true;
  }

  async function ask(next: Prompt, value: string): Promise<void> {
    prompt = next;
    answer = value;
    message = '';
    await tick();
    promptBox?.focus({ preventScroll: true });
  }

  /** ^O: the file name first, then the write; `then` leaves afterwards, for ^X's Yes. */
  function writeOut(then: 'stay' | 'exit'): void {
    void ask({ kind: 'write', then }, name ?? '');
  }

  /** ^S: under the current name, asking only when there is none. */
  function save(): void {
    if (name === null) writeOut('stay');
    else write(name);
  }

  // ── Leaving ──

  /** ^X: straight out, or 'Save modified buffer?' first. */
  function leave(): void {
    if (!modified) {
      finish();
      return;
    }
    message = '';
    asking = 'save';
  }

  function answerSave(yes: boolean): void {
    asking = null;
    if (yes) writeOut('exit');
    else {
      forgetKept();
      finish();
    }
  }

  /** Y puts back what was kept, still to be saved; N forgets it. */
  function answerRestore(yes: boolean): void {
    asking = null;
    if (yes && view?.kept !== undefined) {
      void setText(view.kept, 0);
      message = '[ Restored unsaved changes ]';
    } else {
      forgetKept();
    }
    focusArea();
  }

  function answerQuestion(yes: boolean): void {
    if (asking === 'restore') answerRestore(yes);
    else answerSave(yes);
  }

  function cancel(): void {
    // Not now: what was kept stays kept, and is offered again next time.
    if (asking === 'restore') keptAs = null;
    asking = null;
    prompt = null;
    message = '[ Cancelled ]';
    focusArea();
  }

  /**
   * Back (AppHost): what is on top goes first (the help, a prompt, the offer to restore, each
   * cancelled as ^C would), then it leaves as ^X does. With changes it asks 'Save modified
   * buffer?', and goes on asking at each Back until it is answered, while the buffer is kept in
   * case Back leaves the page instead. AppHost puts the history entry back while it stays open.
   */
  export function back(): void {
    if (closed) return;
    if (view === null) close();
    else if (helping) toggleHelp();
    else if (prompt !== null || asking === 'restore') cancel();
    else {
      keepBuffer();
      leave();
    }
  }

  // ── Finding ──

  function whereIs(): void {
    void ask({ kind: 'search' }, '');
  }

  async function find(wanted: string): Promise<void> {
    const result = findNext(text, wanted, caret());
    message = findMessage(result, wanted);
    focusArea();
    if (result.kind === 'none') return;
    await tick();
    area?.setSelectionRange(result.index, result.index + wanted.length);
  }

  function submitPrompt(): void {
    const current = prompt;
    if (current === null) return;
    if (current.kind === 'write') {
      if (answer === '') {
        cancel();
        return;
      }
      prompt = null;
      if (write(answer) && current.then === 'exit') finish();
      else focusArea();
      return;
    }
    const wanted = answer === '' ? lastSearch : answer;
    prompt = null;
    if (wanted === '') {
      cancel();
      return;
    }
    lastSearch = wanted;
    void find(wanted);
  }

  function onPromptKey(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === 'Escape' || (event.ctrlKey && event.key.toLowerCase() === 'c')) {
      event.preventDefault();
      cancel();
    }
    // Typing here is the prompt's; nano's keys wait until it is answered.
    event.stopPropagation();
  }

  // ── Cutting and pasting ──

  function cut(): void {
    const result = cutLine(text, caret());
    if (result.cut === '') return;
    clip = cutting ? clip + result.cut : result.cut;
    cutting = true;
    message = '';
    void setText(result.text, result.caret);
  }

  function paste(): void {
    cutting = false;
    if (clip === '') {
      message = '[ Cutbuffer is empty ]';
      return;
    }
    const result = pasteAt(text, caret(), clip);
    message = '';
    void setText(result.text, result.caret);
  }

  /** Typing: a cut after it starts afresh, and the last message goes. */
  function onInput(): void {
    cutting = false;
    message = '';
  }

  function insertTab(): void {
    const start = area?.selectionStart ?? text.length;
    const end = area?.selectionEnd ?? start;
    void setText(text.slice(0, start) + '\t' + text.slice(end), start + 1);
  }

  function toggleHelp(): void {
    helping = !helping;
    if (!helping) focusArea();
  }

  function hasSelection(): boolean {
    return area !== undefined && area.selectionStart !== area.selectionEnd;
  }

  // ── Keys ──

  const MODIFIERS = ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock'];

  /** nano's keys, in the text. Everything else is the textarea's. */
  function onAreaKey(event: KeyboardEvent): void {
    if (event.isComposing || busy) return;
    if (MODIFIERS.includes(event.key)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
    if (!(ctrl && key === 'k')) cutting = false;
    let handled = true;
    if (ctrl && key === 'o') writeOut('stay');
    else if (ctrl && key === 's') save();
    else if (ctrl && key === 'x') leave();
    else if (ctrl && (key === 'w' || key === 'f')) whereIs();
    else if (ctrl && key === 'k') cut();
    else if (ctrl && key === 'u') paste();
    else if (ctrl && key === 'g') toggleHelp();
    else if (ctrl && key === 'c' && !hasSelection()) message = location(text, caret());
    // Cmd+S saves on a Mac too.
    else if (event.metaKey && !event.ctrlKey && !event.altKey && key === 's') save();
    else if (key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) insertTab();
    else if (key === 'F1') toggleHelp();
    else if (key === 'F6') whereIs();
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /** Before anything else: the Y/N question and the help screen take every key. */
  function onWindowKey(event: KeyboardEvent): void {
    if (closed || event.isComposing || MODIFIERS.includes(event.key)) return;
    const key = event.key.toLowerCase();
    if (asking !== null) {
      if (key === 'y') answerQuestion(true);
      else if (key === 'n') answerQuestion(false);
      else if (key === 'escape' || (event.ctrlKey && key === 'c')) cancel();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (helping && (key === 'escape' || key === 'q' || key === 'f1' || (event.ctrlKey && (key === 'x' || key === 'g')))) {
      event.preventDefault();
      event.stopPropagation();
      toggleHelp();
    }
  }

  /** Taps on the toolbar leave focus (and a phone's keyboard) where it was. */
  function keepFocus(event: PointerEvent): void {
    if (event.pointerType !== 'touch') event.preventDefault();
  }

  // Unsaved changes: leaving the page asks first, and the buffer is kept whenever the page is put
  // away (left, hidden, or closed by a phone that needs the memory), in case it never comes back.
  $effect(() => {
    if (!modified || typeof window === 'undefined') return;
    const warn = (event: BeforeUnloadEvent): void => {
      keepBuffer();
      event.preventDefault();
    };
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') keepBuffer();
    };
    window.addEventListener('beforeunload', warn);
    window.addEventListener('pagehide', keepBuffer);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('pagehide', keepBuffer);
      document.removeEventListener('visibilitychange', hidden);
    };
  });

  onMount(() => {
    // After AppHost has focused itself: the caret goes in the text, where +LINE put it. On a
    // touch screen focus would not open the keyboard outside a tap, so a tap on the text does.
    const start = view?.line === undefined ? 0 : offsetOf(text, view.line, view.column ?? 1);
    area?.setSelectionRange(start, start);
    const timer = setTimeout(() => {
      if (!touch) focusArea();
    }, 0);
    return () => clearTimeout(timer);
  });
</script>

<svelte:window onkeydowncapture={onWindowKey} />

{#if view === null}
  <div class="nano failed">
    <p>This file could not be opened.</p>
    <button type="button" class="tool" onclick={() => close()}>Back to the terminal</button>
  </div>
{:else}
  <div class="nano" class:touch data-editor>
    <header class="title">
      <span class="brand">vesen nano</span>
      <span class="name">{name ?? 'New Buffer'}</span>
      <span class="state">{modified ? 'Modified' : ''}</span>
    </header>

    <div class="body">
      <textarea
        class="buffer"
        bind:this={area}
        bind:value={text}
        aria-label={name === null ? 'New buffer' : `Editing ${name}`}
        readonly={busy}
        wrap="soft"
        spellcheck={touch ? undefined : false}
        onkeydown={onAreaKey}
        oninput={onInput}
        onpointerdown={() => (cutting = false)}
      ></textarea>
      {#if helping}
        <div class="help" role="document" aria-label="nano help">
          {#each EDITOR_HELP as line, index (index)}
            <div class="help-line">{line}</div>
          {/each}
          {#if touch}
            <button type="button" class="tool" onclick={toggleHelp}>Close help</button>
          {/if}
        </div>
      {/if}
    </div>

    <div class="bottom">
      {#if prompt !== null}
        <form
          class="prompt"
          onsubmit={(event) => {
            event.preventDefault();
            submitPrompt();
          }}
        >
          <label for="nano-answer">{promptLabel}</label>
          <input
            id="nano-answer"
            type="text"
            bind:this={promptBox}
            bind:value={answer}
            onkeydown={onPromptKey}
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            enterkeyhint={prompt.kind === 'write' ? 'done' : 'search'}
          />
          {#if touch}
            <button type="submit" class="tool">{prompt.kind === 'write' ? 'Save' : 'Find'}</button>
            <button type="button" class="tool" onclick={cancel}>Cancel</button>
          {/if}
        </form>
      {:else if asking !== null}
        <div class="question">{QUESTIONS[asking]}</div>
      {:else}
        <div class="status-line">
          {#if message !== ''}<span class="status">{message}</span>{/if}
        </div>
      {/if}
      <p class="sr-only" role="status" aria-live="polite">{asking !== null ? `${QUESTIONS[asking]} Y or N` : message}</p>

      {#if touch}
        <!-- A prompt has its own buttons beside it, in the toolbar's place. -->
        {#if prompt === null}
          <div class="toolbar" class:three={asking !== null} role="toolbar" aria-label="Editor">
            {#if asking !== null}
              <button type="button" class="tool" onclick={() => answerQuestion(true)}>Yes</button>
              <button type="button" class="tool" onclick={() => answerQuestion(false)}>No</button>
              <button type="button" class="tool" onclick={cancel}>Cancel</button>
            {:else}
              <button type="button" class="tool" disabled={busy} onpointerdown={keepFocus} onmousedown={(event) => event.preventDefault()} onclick={save}>Save</button>
              <button type="button" class="tool" disabled={busy} onpointerdown={keepFocus} onmousedown={(event) => event.preventDefault()} onclick={leave}>Exit</button>
              <button type="button" class="tool" disabled={busy} onclick={whereIs}>Find</button>
              <button type="button" class="tool" disabled={busy} onpointerdown={keepFocus} onmousedown={(event) => event.preventDefault()} onclick={cut}>Cut</button>
              <button type="button" class="tool" disabled={busy} onpointerdown={keepFocus} onmousedown={(event) => event.preventDefault()} onclick={paste}>Paste</button>
            {/if}
          </div>
        {/if}
      {:else}
        <div class="shortcuts">
          {#each shortcuts as row, r (r)}
            <div class="keys">
              {#each row as [key, label] (key)}
                <span class="shortcut"><kbd>{key}</kbd> {label}</span>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .nano {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    box-sizing: border-box;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) max(4px, env(safe-area-inset-bottom)) env(safe-area-inset-left);
    background: var(--theme-background);
    color: var(--role-fg, var(--theme-foreground));
    font-family: var(--term-font);
    font-size: var(--term-fs);
    line-height: var(--term-lh);
  }

  .failed {
    align-items: center;
    justify-content: center;
    gap: 12px;
  }

  /* nano's title bar and keys, in reverse video: the background's colour on the text's. */
  .title,
  .status,
  kbd {
    background: var(--role-fg, var(--theme-foreground));
    color: var(--theme-background);
  }

  .title {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 2ch;
    padding: 0 1ch;
    white-space: pre;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .state {
    text-align: right;
  }

  .body {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
  }

  .buffer {
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    padding: 0 1ch;
    border: 0;
    border-radius: 0;
    resize: none;
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: inherit;
    tab-size: 8;
    caret-color: var(--role-cursor, currentColor);
    outline: none;
    overscroll-behavior: contain;
  }

  .buffer::selection {
    background: var(--role-selection);
    color: var(--role-fg-strong);
  }

  /* 16px on a touch screen, so typing never zooms the page. */
  .touch .buffer,
  .touch .prompt input {
    font-size: 16px;
  }

  .help {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding: 0 1ch;
    background: var(--theme-background);
    white-space: pre-wrap;
  }

  .help-line {
    min-height: calc(1em * var(--term-lh));
  }

  .bottom {
    flex: none;
  }

  .status-line,
  .question {
    min-height: calc(1em * var(--term-lh));
    text-align: center;
    white-space: pre;
    overflow: hidden;
  }

  .question {
    text-align: left;
    padding: 0 1ch;
  }

  .prompt {
    display: flex;
    align-items: center;
    gap: 1ch;
    margin: 0;
    padding: 0 1ch;
  }

  /* The label keeps to one line; only a long one (a long last search) gives way, with an ellipsis. */
  .prompt label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .prompt input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    caret-color: var(--role-cursor, currentColor);
    outline: none;
  }

  /* Save or Find and Cancel stay whole beside it. */
  .prompt .tool {
    flex: none;
  }

  /* On a phone the field is a line to type on, at least six characters wide, and takes what the
     label and the buttons leave. */
  .touch .prompt input {
    flex: 1 1 0;
    min-width: 6ch;
    border-bottom: 1px solid var(--role-muted);
  }

  .shortcuts {
    padding: 0 1ch;
  }

  .keys {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    white-space: pre;
    overflow: hidden;
  }

  .shortcut {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  kbd {
    font: inherit;
  }

  .toolbar {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
    padding: 6px 6px 0;
  }

  .toolbar.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .tool {
    min-height: 44px;
    min-width: 44px;
    padding: 0 6px;
    border: 1px solid var(--role-muted);
    border-radius: 8px;
    background: var(--role-chip-bg);
    color: var(--role-chip-fg);
    font: inherit;
    cursor: pointer;
    touch-action: manipulation;
  }

  .tool:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .tool:active:not(:disabled) {
    background: var(--role-fg, var(--theme-foreground));
    color: var(--theme-background);
  }

  .tool:focus-visible {
    outline: 2px solid var(--role-accent);
    outline-offset: 2px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
