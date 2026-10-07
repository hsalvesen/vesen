<!-- A card for the component registry's tests: its view's text, labelled with its alt. -->
<script lang="ts">
  import type { ComponentBlockProps } from '../ui/components/registry';

  let { view, alt }: ComponentBlockProps = $props();
</script>

<div data-fake-card role="img" aria-label={alt}>{(view as { text?: string }).text}</div>
