<!--
  The Train app, for sl (src/commands/more/fun/sl.ts): the train from commands/lib/train.ts crosses
  the screen once from right to left, its wheels turning and its smoke drifting, then hands the
  command 'crossed'. Any key or a tap stops it early ('stopped'). Under reduced motion it does not
  move: the train stands in the middle for a moment, then goes ('still'). Each step is drawn on an
  animation frame, so it rests while the page is hidden and picks up where it was.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { TrainResult, TrainView } from '../../commands/lib/train';
  import type { AppProps } from './registry';

  let { props, close }: AppProps = $props();

  /** Columns crossed per second, frames of the wheels per second, and how long a still train stays. */
  const SPEED = 30;
  const FPS = 10;
  const HOLD_MS = 2000;
  /** The most one step may advance, so a page that was hidden does not jump ahead. */
  const MAX_STEP_MS = 100;
  /** Keys that are not a key press on their own. */
  const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'];

  function viewOf(value: unknown): TrainView {
    const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<TrainView>;
    const frames = Array.isArray(raw.frames) ? raw.frames.filter((frame): frame is string => typeof frame === 'string') : [];
    const widest = Math.max(1, ...frames.flatMap((frame) => frame.split('\n').map((row) => row.length)));
    return {
      frames: frames.length > 0 ? frames : [''],
      width: typeof raw.width === 'number' && raw.width > 0 ? raw.width : widest,
      label: typeof raw.label === 'string' ? raw.label : 'A train',
    };
  }

  // svelte-ignore state_referenced_locally
  const view = viewOf(props);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const still = reduce || typeof requestAnimationFrame !== 'function';

  let screen: HTMLElement | undefined = $state();
  let probe: HTMLElement | undefined = $state();
  let frame = $state(0);
  /** The train's left edge, in columns from the left of the screen. */
  let x = $state(0);
  let moving = $state(false);

  let raf = 0;
  let hold: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  let elapsed = 0;
  let last: number | null = null;
  let columns = 80;

  function finish(result: TrainResult): void {
    if (done) return;
    done = true;
    if (raf !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    if (hold !== undefined) clearTimeout(hold);
    close(result);
  }

  /** Back (AppHost) stops it, as a key does. */
  export function back(): void {
    finish(still ? 'still' : 'stopped');
  }

  /** The screen's width in columns of the terminal's font; 80 when it cannot be measured. */
  function measure(): number {
    const width = screen?.clientWidth ?? 0;
    const cell = (probe?.getBoundingClientRect().width ?? 0) / 10;
    return width > 0 && cell > 0 ? width / cell : 80;
  }

  function step(now: number): void {
    if (done) return;
    if (last !== null) elapsed += Math.min(MAX_STEP_MS, Math.max(0, now - last));
    last = now;
    x = columns - (elapsed / 1000) * SPEED;
    frame = Math.floor((elapsed / 1000) * FPS) % view.frames.length;
    if (x <= -view.width) {
      finish('crossed');
      return;
    }
    raf = requestAnimationFrame(step);
  }

  function onKey(event: KeyboardEvent): void {
    if (done || event.repeat || MODIFIERS.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    finish(still ? 'still' : 'stopped');
  }

  onMount(() => {
    if (still) {
      hold = setTimeout(() => finish('still'), HOLD_MS);
      return;
    }
    columns = measure();
    x = columns;
    moving = true;
    raf = requestAnimationFrame(step);
  });

  onDestroy(() => {
    done = true;
    if (raf !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    if (hold !== undefined) clearTimeout(hold);
  });
</script>

<svelte:window onkeydown={onKey} />

<button
  type="button"
  class="sl"
  class:still
  data-motion={still ? 'still' : moving ? 'running' : 'waiting'}
  aria-label="{view.label}. Press any key or tap to stop it."
  style="--train-cols: {view.width}"
  bind:this={screen}
  onclick={() => finish(still ? 'still' : 'stopped')}
>
  <span class="probe" aria-hidden="true" bind:this={probe}>0000000000</span>
  <span class="track">
    <span class="train" aria-hidden="true" style:transform={still ? undefined : `translateX(${x}ch)`}>{view.frames[still ? 0 : frame]}</span>
  </span>
  <span class="rails" aria-hidden="true"></span>
</button>

<style>
  .sl {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    justify-content: center;
    min-height: 0;
    width: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    background: transparent;
    color: inherit;
    font-family: var(--term-font, monospace);
    font-size: var(--term-fs, 13px);
    line-height: var(--term-lh, 1.35);
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .sl:focus {
    outline: none;
  }

  .probe {
    position: absolute;
    visibility: hidden;
    white-space: pre;
  }

  .track {
    display: block;
    overflow: visible;
  }

  .train {
    display: block;
    width: max-content;
    margin: 0;
    font: inherit;
    white-space: pre;
    will-change: transform;
  }

  .rails {
    display: block;
    height: 0;
    border-top: 2px dashed var(--role-muted, var(--theme-bright-black));
  }

  /* Standing still: the whole train, as large as fits, in the middle. */
  .still .track {
    display: flex;
    justify-content: center;
  }

  .still .train {
    font-size: min(var(--term-fs, 13px), calc((100vw - 32px) / (var(--train-cols) * 0.62)));
    will-change: auto;
  }
</style>
