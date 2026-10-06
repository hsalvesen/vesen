<!--
  The prompt, guest@vesen:~/documents$, in the prompt roles. A past entry draws the snapshot of
  the prompt it was typed at (`line`), so it keeps its folder after cd (F023); the input row
  draws the live prompt from the shell's cwd and last status, with the $ in the error role after
  a failure and the path shortened on a narrow terminal. A span, not a heading (F094).
-->
<script lang="ts">
  import type { Line } from '../output/model';
  import type { Readable } from '../shell/observable';
  import { promptLine } from '../shell/prompt';
  import { columns } from '../stores/term';
  import { GUEST } from '../vfs/identity';
  import LineView from './LineView.svelte';

  let {
    line = null,
    cwd,
    status,
    secret = false,
  }: {
    /** A snapshot to draw; without one, the live prompt. */
    line?: Line | null;
    cwd?: Readable<string>;
    status?: Readable<number>;
    /** The password prompt sudo asks at. */
    secret?: boolean;
  } = $props();

  let liveCwd = $state(GUEST.home);
  let liveStatus = $state(0);
  $effect(() => cwd?.subscribe((value) => (liveCwd = value)));
  $effect(() => status?.subscribe((value) => (liveStatus = value)));

  const shown = $derived(line ?? promptLine({ cwd: liveCwd, status: liveStatus, columns: $columns }));
</script>

{#if secret}
  <span class="prompt"><span class="punct">Password:</span></span>
{:else}
  <span class="prompt"><LineView line={shown} /></span>
{/if}

<style>
  /* Inline, so the prompt copies as one line of text: guest@vesen:~$ */
  .prompt {
    white-space: pre;
  }

  .punct {
    color: var(--role-fg-strong);
  }
</style>
