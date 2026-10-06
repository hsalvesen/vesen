<!-- One line of output: its spans, with no whitespace between them. -->
<script lang="ts">
  import type { Action, Line } from '../output/model';
  import SpanView from './SpanView.svelte';

  let { line, onaction }: { line: Line; onaction?: (action: Action) => void } = $props();
</script>

{#each line as span}<SpanView {span} {onaction} />{/each}
