<!--
  The app shell: a column of the screen and, below it, the dock (empty until the phone dock
  lands). The screen frame holds the scrolling transcript, the new-output pill and the CRT
  overlay, so the overlay covers the terminal and never the dock. The shell itself is sized to
  the visible viewport by styles/shell.css and platform/viewport.ts.
-->
<script lang="ts">
  import Input, { type CompletionView } from './components/Input.svelte';
  import Cathode from './components/Cathode.svelte';
  import type { Action } from './output/model';
  import type { ShellPort } from './shell/index';
  import CompletionRow from './ui/CompletionRow.svelte';
  import Prompt from './ui/Prompt.svelte';
  import Transcript from './ui/Transcript.svelte';
  import { focusPolicy } from './ui/actions/focusPolicy';
  import { scrollToEnd, stickToBottom } from './ui/actions/stickToBottom';

  let { shell }: { shell: ShellPort } = $props();

  let prompt: ReturnType<typeof Input> | undefined = $state();
  let isPasswordMode = $state(false);
  let isProcessing = $state(false);
  let loadingText = $state('');
  let command = $state('');
  let completion: CompletionView | undefined = $state();
  let screen: HTMLElement | undefined = $state();
  let newOutput = $state(false);

  // Phones get a tap target; keyboards get the shortcut. Both can click the line.
  const cancelHint =
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
      ? 'tap to cancel'
      : 'Ctrl+C to cancel';

  const commandInput = (): HTMLInputElement | null => screen?.querySelector('input.command-input') ?? null;

  /** A tap on a trusted action in the output: a did-you-mean, a chip, a link card. */
  function onaction(action: Action): void {
    switch (action.kind) {
      case 'run':
        void prompt?.submit(action.line);
        prompt?.focusPrompt();
        break;
      case 'insert':
        // The text is at the prompt to be finished: bring the prompt into view, and on a phone
        // open the keyboard now, inside the tap, with the text ready.
        prompt?.insert(action.text);
        prompt?.focusPrompt({ keyboard: true });
        if (screen) scrollToEnd(screen);
        break;
      case 'open':
        window.open(action.href, '_blank', 'noopener');
        break;
      case 'copy':
        void navigator.clipboard?.writeText(action.text).catch(() => {});
        break;
      case 'share':
        void navigator.share?.({ url: action.url, ...(action.title ? { title: action.title } : {}) }).catch(() => {});
        break;
    }
  }
</script>

<div class="shell" use:focusPolicy={{ input: commandInput }}>
  <div class="screen-frame">
    <main
      bind:this={screen}
      class="screen"
      use:stickToBottom={{ content: '.scrollback', entries: '[role="log"]', onpill: (visible) => (newOutput = visible) }}
    >
      <div class="scrollback">
        <h1 class="sr-only">Vesen terminal</h1>

        <!-- Announced politely as entries are added; held back while a command is still running. -->
        <div role="log" aria-live="polite" aria-relevant="additions" aria-busy={isProcessing} aria-label="Terminal output">
          <Transcript {onaction} />
        </div>

        <div class="prompt-area" data-prompt-area>
          <!--
            The prompt takes what it needs and may wrap; the input always keeps 10 cells, so the row
            never overflows at 320px, however long the folder name.
          -->
          <div class="grid items-center gap-x-1" style="grid-template-columns: minmax(0, max-content) minmax(10ch, 1fr);">
            <div class="flex items-center min-w-0">
              <Prompt cwd={shell.cwd} status={shell.lastStatus} secret={isPasswordMode} />
            </div>
            <div class="min-w-0">
              <Input
                bind:this={prompt}
                {shell}
                bind:command
                bind:isPasswordMode
                bind:isProcessing
                bind:loadingText
                bind:completionView={completion}
              />
            </div>
          </div>

          <!-- Tab's list, the chips while typing, and the starters on an empty phone prompt. -->
          <CompletionRow
            chips={completion?.chips}
            more={completion?.more}
            listed={completion?.listed}
            question={completion?.question}
            announce={completion?.announce}
            onchoose={(chip) => prompt?.choose(chip)}
          />

          {#if isProcessing && loadingText}
            <!--
              mousedown is cancelled so the tap does not take focus, and the keyboard, from the prompt.
              Not pointerdown: WebKit on iOS drops the whole tap, click included, when pointerdown is cancelled.
            -->
            <button
              type="button"
              class="processing mt-1"
              aria-label="Cancel running command"
              onmousedown={(event) => event.preventDefault()}
              onclick={() => shell.abort()}
            >{loadingText} ({cancelHint})</button>
          {/if}
        </div>
      </div>

      <!-- The empty space under the prompt: tapping it opens the keyboard. -->
      <div class="tap-to-type" data-prompt-area aria-hidden="true"></div>
    </main>

    {#if newOutput}
      <button
        type="button"
        class="new-output"
        aria-label="Scroll to new output"
        onmousedown={(event) => event.preventDefault()}
        onclick={() => screen && scrollToEnd(screen)}
      >↓ New output</button>
    {/if}

    <Cathode />
  </div>

  <!-- The phone dock goes here (docs/plan/04-phone-and-instagram.md). -->
  <div class="dock-slot"></div>
</div>

<style>
  .processing {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    color: var(--role-accent);
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

  .new-output {
    position: absolute;
    z-index: 3;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 12px;
    border: 1px solid var(--role-accent);
    border-radius: 999px;
    background: var(--theme-background);
    color: var(--role-accent);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }

  @media (pointer: coarse) {
    .new-output {
      min-height: 44px;
      padding-inline: 16px;
    }
  }

  .new-output:active {
    background: var(--role-accent);
    color: var(--theme-background);
  }
</style>
