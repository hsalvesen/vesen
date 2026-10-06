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
  }: {
    /** A snapshot to draw; without one, the live prompt. */
    line?: Line | null;
    cwd?: Readable<string>;
    status?: Readable<number>;
  } = $props();

  let liveCwd = $state(GUEST.home);
  let liveStatus = $state(0);
  $effect(() => cwd?.subscribe((value) => (liveCwd = value)));
  $effect(() => status?.subscribe((value) => (liveStatus = value)));

  const shown = $derived(line ?? promptLine({ cwd: liveCwd, status: liveStatus, columns: $columns }));
</script>

<span class="prompt"><LineView line={shown} /></span>

<style>
  /* Inline, so the prompt copies as one line of text: guest@vesen:~$. It may wrap, anywhere, so
     a long folder name on a narrow screen never pushes the page sideways. */
  .prompt {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
