<!--
  The app shell: a column of the screen and, below it, the dock (empty until the phone dock
  lands). The screen frame holds the scrolling transcript, the new-output pill and the CRT
  overlay, so the overlay covers the terminal and never the dock. The shell itself is sized to
  the visible viewport by styles/shell.css and platform/viewport.ts.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import Cathode from './components/Cathode.svelte';
  import type { Action } from './output/model';
  import { coarsePointer, keyPlatform } from './platform/env';
  import type { ShellPort } from './shell/index';
  import { screen as transcript } from './stores/screen';
  import CompletionRow from './ui/CompletionRow.svelte';
  import PromptLine from './ui/prompt/PromptLine.svelte';
  import { PromptController } from './ui/prompt/promptController.svelte';
  import Transcript from './ui/Transcript.svelte';
  import { focusPolicy } from './ui/actions/focusPolicy';
  import { scrollToEnd, stickToBottom } from './ui/actions/stickToBottom';

  let { shell }: { shell: ShellPort } = $props();

  const win = typeof window === 'undefined' ? undefined : window;
  // The prompt: the line being typed, its keys, the running line and everything Tab offers.
  // svelte-ignore state_referenced_locally
  const prompt = new PromptController({ shell, screen: transcript, platform: keyPlatform(win?.navigator), touch: coarsePointer(win) });
  onDestroy(() => prompt.destroy());

  let screen: HTMLElement | undefined = $state();
  let newOutput = $state(false);

  /** A tap on a trusted action in the output: a did-you-mean, a chip, a link card. */
  function onaction(action: Action): void {
    switch (action.kind) {
      case 'run':
        prompt.submit(action.line, 'chip');
        prompt.focus();
        break;
      case 'insert':
        // The text is at the prompt to be finished: bring the prompt into view, and on a phone
        // open the keyboard now, inside the tap, with the text ready.
        prompt.insert(action.text);
        prompt.focus({ keyboard: true });
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

<div class="shell" use:focusPolicy={{ input: () => prompt.element }}>
  <div class="screen-frame">
    <main
      bind:this={screen}
      class="screen"
      use:stickToBottom={{ content: '.scrollback', entries: '[role="log"]', onpill: (visible) => (newOutput = visible) }}
    >
      <div class="scrollback">
        <h1 class="sr-only">Vesen terminal</h1>

        <!-- Announced politely as entries are added; held back while a command is still running. -->
        <div role="log" aria-live="polite" aria-relevant="additions" aria-busy={prompt.running !== null} aria-label="Terminal output">
          <Transcript {onaction} />
        </div>

        <div class="prompt-area" data-prompt-area>
          <PromptLine controller={prompt} {shell} {onaction} />

          <!-- Tab's list, the chips while typing, and the starters on an empty phone prompt. -->
          <CompletionRow
            chips={prompt.chipList.chips}
            more={prompt.chipList.more}
            listed={prompt.listed}
            question={prompt.question}
            announce={prompt.announce}
            onchoose={(chip) => prompt.choose(chip)}
          />
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
