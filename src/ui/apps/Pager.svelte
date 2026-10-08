<!--
  The pager: less, more, and man on a terminal (src/lib/pager.ts has the model). The text fills
  the screen, wrapped at its edge as less wraps it, with a status line under it: the name, the
  lines on screen and how far through, or (END). less's keys move it (q, space, b, j, k, d, u, g,
  G, the arrows and Page keys); /text and ?text search, highlighting every match, n and N go on;
  h shows the keys. On a touch screen, swipes scroll and a toolbar of 44px buttons pages, searches
  and closes, since a phone has no q. Colours come from the theme's roles.

  It draws only the rows on screen, so a long file costs no more than a short one. AppHost has
  focus while it shows, so keys come to the window listener here, never to the prompt under it.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    asPagerView,
    clampTop,
    findLine,
    firstRowOf,
    matchRanges,
    maxTop,
    moveTop,
    PAGER_CLOSED,
    PAGER_HELP,
    pagerCommand,
    percentThrough,
    prepareLines,
    segments,
    wrapRows,
    type PagerCommand,
    type Segment,
  } from '../../lib/pager';
  import { spanClasses, spanCss } from '../span-style';
  import type { AppProps } from './registry';

  let { props, close }: AppProps = $props();

  // svelte-ignore state_referenced_locally
  const view = asPagerView(props);
  const text = prepareLines(view.lines);
  const helpText = prepareLines(PAGER_HELP.map((line) => [{ text: line }]));
  /** Ten cells of the font, to measure one by. */
  const PROBE = 'MMMMMMMMMM';

  /** The screen in characters: the terminal's until the pager has measured its own. */
  let columns = $state(view.columns);
  let page = $state(Math.max(1, view.rows - 1));
  let lineHeight = 18;

  let helping = $state(false);
  /** Where the text was when the help took its place. */
  let textTop = 0;
  const lines = $derived(helping ? helpText : text);
  const gutter = $derived(view.numbers === true && !helping ? String(text.length).length + 1 : 0);
  const rows = $derived(wrapRows(lines, Math.max(8, columns - gutter)));

  let top = $state(0);
  /** The first row on the screen, kept inside the text whatever the size. */
  const at = $derived(clampTop(top, rows.length, page));
  const atEnd = $derived(at >= maxTop(rows.length, page));

  /** The last search, its way, and the line its last match was on. */
  let query = $state('');
  let direction: 1 | -1 = 1;
  let matchLine: number | null = null;
  /** The search box: open, and which way it searches. */
  let searching = $state<1 | -1 | null>(null);
  let draft = $state('');
  let message = $state(view.note ?? '');
  let closed = false;

  let root: HTMLElement | undefined = $state();
  let body: HTMLElement | undefined = $state();
  let probe: HTMLElement | undefined = $state();
  let searchBox: HTMLInputElement | undefined = $state();

  /** The rows on the screen, cut where a match begins and ends. */
  const shown = $derived.by(() => {
    const ranges = new Map<number, [number, number][]>();
    return rows.slice(at, at + page).map((row) => {
      let found = ranges.get(row.line);
      if (found === undefined) {
        found = query === '' ? [] : matchRanges(lines[row.line]?.text ?? '', query, view.ignoreCase);
        ranges.set(row.line, found);
      }
      const number = gutter === 0 ? '' : `${row.start === 0 ? String(row.line + 1) : ''}`.padStart(gutter - 1);
      return { key: `${row.line}:${row.start}`, number, segments: segments(row, found) };
    });
  });

  const status = $derived.by(() => {
    if (message !== '') return message;
    if (helping) return 'HELP -- press q when done';
    const percent = percentThrough(at, page, rows.length);
    if (view.mode === 'more') return atEnd ? '(END)' : `--More--(${percent}%)`;
    const first = (rows[at]?.line ?? 0) + 1;
    const last = (rows[Math.min(rows.length, at + page) - 1]?.line ?? 0) + 1;
    const where = text.length === 0 ? '' : ` lines ${first}-${last}/${lines.length}`;
    return `${view.title}${where} ${atEnd ? '(END)' : `${percent}%`}`;
  });

  function finish(): void {
    if (closed) return;
    closed = true;
    close(PAGER_CLOSED);
  }

  function scrollTo(next: number): void {
    message = '';
    top = clampTop(next, rows.length, page);
  }

  function toggleHelp(): void {
    message = '';
    if (helping) {
      helping = false;
      top = textTop;
    } else {
      textTop = at;
      helping = true;
      top = 0;
    }
  }

  /** Puts the next line holding `wanted` at the top, from `from` on, the way `way` goes. */
  function search(wanted: string, way: 1 | -1, from: number): void {
    query = wanted;
    const found = findLine(lines, wanted, from, way, view.ignoreCase);
    if (found === null) {
      message = 'Pattern not found';
      return;
    }
    matchLine = found;
    scrollTo(firstRowOf(rows, found));
  }

  /** n and N: the last search again, from its last match. */
  function repeat(way: 1 | -1): void {
    if (query === '') {
      message = 'No previous search';
      return;
    }
    const from = matchLine ?? rows[at]?.line ?? 0;
    search(query, way, from + way);
  }

  async function openSearch(way: 1 | -1): Promise<void> {
    searching = way;
    draft = '';
    message = '';
    await tick();
    searchBox?.focus({ preventScroll: true });
  }

  function endSearch(): void {
    searching = null;
    // Back to the pager, so the keys go on working and a phone's keyboard goes away.
    root?.focus({ preventScroll: true });
  }

  function submitSearch(): void {
    const way = searching ?? 1;
    const wanted = draft === '' ? query : draft;
    endSearch();
    if (wanted === '') return;
    direction = way;
    matchLine = null;
    const topLine = rows[at]?.line ?? 0;
    search(wanted, way, way === 1 ? topLine : topLine - 1);
  }

  function onSearchKey(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      submitSearch();
    } else if (event.key === 'Escape' || (event.key === 'Backspace' && draft === '')) {
      event.preventDefault();
      endSearch();
    }
    // The pager's keys are letters too: while typing they are the search's.
    event.stopPropagation();
  }

  function act(command: PagerCommand): void {
    switch (command) {
      case 'quit':
        if (helping) toggleHelp();
        else finish();
        return;
      case 'help':
        toggleHelp();
        return;
      case 'searchForward':
        void openSearch(1);
        return;
      case 'searchBackward':
        void openSearch(-1);
        return;
      case 'next':
        repeat(direction);
        return;
      case 'previous':
        repeat(direction === 1 ? -1 : 1);
        return;
      default:
        // more leaves when a screen forward goes past the end.
        if (view.mode === 'more' && command === 'pageDown' && atEnd && !helping) {
          finish();
          return;
        }
        scrollTo(moveTop(at, command, page, rows.length));
    }
  }

  function onKey(event: KeyboardEvent): void {
    if (closed || event.defaultPrevented || event.isComposing) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea') != null) return;
    // Enter and Space on a focused button press it.
    if (target?.closest('button') != null && (event.key === 'Enter' || event.key === ' ')) return;
    const command = pagerCommand(event);
    if (command === null) return;
    event.preventDefault();
    event.stopPropagation();
    act(command);
  }

  // ── Swipes and the wheel ──
  let drag: { id: number; y: number; top: number } | null = null;
  let wheelRest = 0;

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'touch') return;
    drag = { id: event.pointerId, y: event.clientY, top: at };
  }

  function onPointerMove(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.id) return;
    const rowsMoved = Math.round((drag.y - event.clientY) / lineHeight);
    if (rowsMoved !== 0 || at !== drag.top) scrollTo(drag.top + rowsMoved);
  }

  function onPointerEnd(event: PointerEvent): void {
    if (drag?.id === event.pointerId) drag = null;
  }

  function onWheel(event: WheelEvent): void {
    wheelRest += event.deltaMode === 1 ? event.deltaY : event.deltaY / lineHeight;
    const step = Math.trunc(wheelRest);
    if (step === 0) return;
    wheelRest -= step;
    scrollTo(at + step);
  }

  // ── Measuring ──
  function measure(): void {
    if (body === undefined || probe === undefined) return;
    const cell = probe.getBoundingClientRect();
    const width = body.clientWidth;
    const height = body.clientHeight;
    if (!(cell.width > 0) || !(cell.height > 0) || !(width > 0) || !(height > 0)) return;
    lineHeight = cell.height;
    const nextColumns = Math.max(8, Math.floor(width / (cell.width / PROBE.length)));
    if (nextColumns !== columns) {
      // The same line stays at the top when the text wraps again.
      const anchor = rows[at]?.line ?? 0;
      columns = nextColumns;
      top = firstRowOf(rows, anchor);
    }
    page = Math.max(1, Math.floor(height / cell.height));
  }

  onMount(() => {
    measure();
    // less +G, +NUMBER, +/pattern: where it opens.
    const start = view.start;
    if (start !== undefined) {
      if ('end' in start) scrollTo(maxTop(rows.length, page));
      else if ('line' in start) scrollTo(firstRowOf(rows, Math.min(start.line, text.length) - 1));
      else search(start.search, 1, 0);
    }
    if (typeof ResizeObserver !== 'function' || body === undefined) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(body);
    return () => observer.disconnect();
  });

  function classesOf(segment: Segment): string {
    return [spanClasses(segment.style), segment.hit ? 'hit' : ''].filter(Boolean).join(' ');
  }

  /** Taps on the toolbar keep the keyboard as it is; a mouse press takes no focus. */
  function keepFocus(event: PointerEvent): void {
    if (event.pointerType !== 'touch') event.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="pager" class:touch={view.touch} bind:this={root} tabindex="-1" data-pager>
  <div
    class="rows"
    role="document"
    aria-label={helping ? 'Pager help' : view.title}
    bind:this={body}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerEnd}
    onpointercancel={onPointerEnd}
    onwheel={onWheel}
  >
    {#each shown as row (row.key)}
      <div class="row">{#if gutter > 0}<span class="number">{`${row.number} `}</span>{/if}{#each row.segments as segment}<span
            class={classesOf(segment) || undefined}
            style={segment.hit ? undefined : spanCss(segment.style)}>{segment.text}</span
          >{/each}</div>
    {/each}
  </div>

  <div class="bottom">
    {#if searching !== null}
      <form
        class="search"
        onsubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
      >
        <label for="pager-search">{searching === 1 ? '/' : '?'}</label>
        <input
          id="pager-search"
          type="text"
          bind:this={searchBox}
          bind:value={draft}
          onkeydown={onSearchKey}
          aria-label={searching === 1 ? 'Search forward for' : 'Search back for'}
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          enterkeyhint="search"
        />
        {#if view.touch}
          <button type="button" class="tool" onclick={endSearch}>Cancel</button>
        {/if}
      </form>
    {:else}
      <div class="status">
        <span class="where">{status}</span>
        {#if !view.touch}<span class="hint">h help · q quit</span>{/if}
      </div>
    {/if}
    <p class="sr-only" role="status" aria-live="polite">{message}</p>

    {#if view.touch}
      <div class="toolbar" role="toolbar" aria-label="Pager">
        <button type="button" class="tool" aria-label="Back a screen" onpointerdown={keepFocus} onmousedown={(event) => event.preventDefault()} onclick={() => act('pageUp')}>▲</button>
        <button type="button" class="tool" aria-label="On a screen" onpointerdown={keepFocus} onmousedown={(event) => event.preventDefault()} onclick={() => act('pageDown')}>▼</button>
        <button type="button" class="tool" onclick={() => void openSearch(1)}>Search</button>
        <button type="button" class="tool" onclick={finish}>Close</button>
      </div>
    {/if}
  </div>

  <span class="probe" aria-hidden="true" bind:this={probe}>{PROBE}</span>
</div>

<style>
  .pager {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    box-sizing: border-box;
    padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(4px, env(safe-area-inset-bottom))
      max(8px, env(safe-area-inset-left));
    background: var(--theme-background);
    color: var(--role-fg, var(--theme-foreground));
    font-family: var(--term-font);
    font-size: var(--term-fs);
    line-height: var(--term-lh);
    outline: none;
  }

  .rows {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    /* Swipes are the pager's; pinching still zooms. */
    touch-action: pinch-zoom;
    overscroll-behavior: contain;
  }

  .row {
    height: calc(1em * var(--term-lh));
    overflow: hidden;
    white-space: pre;
  }

  .number {
    color: var(--role-muted);
  }

  .hit {
    background: var(--role-selection);
    color: var(--role-fg-strong);
  }

  .b {
    font-weight: bold;
  }

  .dim {
    opacity: 0.65;
  }

  .i {
    font-style: italic;
  }

  .u {
    text-decoration: underline;
  }

  .s {
    text-decoration: line-through;
  }

  .bottom {
    flex: none;
  }

  /* less's status line, in reverse video: the background's colour on the text's. */
  .status {
    display: flex;
    gap: 2ch;
    justify-content: space-between;
    background: var(--role-fg, var(--theme-foreground));
    color: var(--theme-background);
    white-space: pre;
  }

  .where {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hint {
    flex: none;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 1ch;
    margin: 0;
  }

  .search input {
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

  /* 16px on a touch screen, so focusing it never zooms the page. */
  .touch .search input {
    font-size: 16px;
  }

  .toolbar {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    padding-top: 8px;
  }

  .tool {
    min-height: 44px;
    min-width: 44px;
    padding: 0 12px;
    border: 1px solid var(--role-muted);
    border-radius: 8px;
    background: var(--role-chip-bg);
    color: var(--role-chip-fg);
    font: inherit;
    cursor: pointer;
    touch-action: manipulation;
  }

  .tool:active {
    background: var(--role-fg, var(--theme-foreground));
    color: var(--theme-background);
  }

  .tool:focus-visible {
    outline: 2px solid var(--role-accent);
    outline-offset: 2px;
  }

  .probe {
    position: absolute;
    top: 0;
    left: 0;
    display: inline-block;
    visibility: hidden;
    white-space: pre;
    pointer-events: none;
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
