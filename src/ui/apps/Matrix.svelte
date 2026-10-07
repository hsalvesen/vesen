<!--
  The Matrix app, for cmatrix (src/commands/more/fun/cmatrix.ts): characters fall down the screen
  in columns, each column's leading character in the theme's accent and its trail in green (the
  ok role), fading into the background. It is drawn on a canvas, a step at a time on animation
  frames, and stops drawing while the page is hidden. Any key or a tap ends it. Under reduced
  motion the rain stands still until then.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { MATRIX_GLYPHS, stepFor, stillRain, type MatrixView } from '../../commands/lib/matrix';
  import type { AppProps } from './registry';

  let { props, close }: AppProps = $props();

  /** How much of the background each step paints over the rain, so its trail fades. */
  const FADE = 0.1;
  /** Keys that are not a key press on their own. */
  const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'];

  function viewOf(value: unknown): MatrixView {
    const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<MatrixView>;
    return {
      glyphs: typeof raw.glyphs === 'string' && raw.glyphs !== '' ? raw.glyphs : MATRIX_GLYPHS,
      stepMs: typeof raw.stepMs === 'number' && raw.stepMs > 0 ? raw.stepMs : stepFor(4),
      touch: raw.touch === true,
    };
  }

  // svelte-ignore state_referenced_locally
  const view = viewOf(props);
  const glyphs = Array.from(view.glyphs);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const still = reduce || typeof requestAnimationFrame !== 'function';

  let screen: HTMLElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let motion: 'running' | 'paused' | 'still' = $state(still ? 'still' : 'running');

  interface Drop {
    /** The row of the leading character; above the screen while it is negative. */
    y: number;
    /** Rows per step. */
    speed: number;
  }

  let paint: CanvasRenderingContext2D | null = null;
  let drops: Drop[] = [];
  let cellWidth = 8;
  let cellHeight = 16;
  let rows = 24;
  let colours = { accent: '#9ef0a0', trail: '#3fbf5f', background: '#000000' };
  let raf = 0;
  let lastStep = 0;
  let done = false;

  const pick = (): string => glyphs[Math.floor(Math.random() * glyphs.length)] ?? '0';

  function finish(): void {
    if (done) return;
    done = true;
    stop();
    close('stopped');
  }

  function stop(): void {
    if (raf !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    raf = 0;
  }

  /** A CSS custom property's value on the screen, or the fallback. */
  function cssColour(name: string, fallback: string): string {
    if (screen === undefined || typeof getComputedStyle !== 'function') return fallback;
    const value = getComputedStyle(screen).getPropertyValue(name).trim();
    return value === '' ? fallback : value;
  }

  /** Sizes the canvas to the screen, reads the font and the colours, and starts the drops over. */
  function setup(): void {
    if (screen === undefined || canvas === undefined) return;
    const width = screen.clientWidth;
    const height = screen.clientHeight;
    const ratio = Math.min(2, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    paint = canvas.getContext('2d');
    colours = {
      accent: cssColour('--role-accent', colours.accent),
      trail: cssColour('--role-ok', colours.trail),
      background: cssColour('--theme-background', colours.background),
    };
    const style = getComputedStyle(screen);
    const size = Number.parseFloat(style.fontSize) || 13;
    cellHeight = Math.round(size * 1.25);
    if (paint !== null) {
      paint.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint.font = `${size}px ${style.fontFamily || 'monospace'}`;
      paint.textBaseline = 'top';
      cellWidth = Math.max(4, paint.measureText('M').width);
      paint.fillStyle = colours.background;
      paint.fillRect(0, 0, width, height);
    }
    const columns = Math.max(1, Math.floor(width / cellWidth));
    rows = Math.max(1, Math.ceil(height / cellHeight));
    // A drop in every other column, so the characters have room to read.
    drops = Array.from({ length: Math.ceil(columns / 2) }, () => ({ y: -Math.floor(Math.random() * rows), speed: 1 }));
    if (still) drawStill(columns);
  }

  /** The rain standing still: streaks in green, each ending in the accent. */
  function drawStill(columns: number): void {
    if (paint === null) return;
    const grid = stillRain(columns, rows, Math.random, view.glyphs);
    grid.forEach((row, r) => {
      Array.from(row).forEach((ch, c) => {
        if (ch === ' ' || paint === null) return;
        const below = grid[r + 1]?.[c];
        paint.fillStyle = below === undefined || below === ' ' ? colours.accent : colours.trail;
        paint.fillText(ch, c * cellWidth, r * cellHeight);
      });
    });
  }

  /** One step of the rain: the old fades, every drop moves down a row. */
  function rain(): void {
    if (paint === null || canvas === undefined || screen === undefined) return;
    paint.globalAlpha = FADE;
    paint.fillStyle = colours.background;
    paint.fillRect(0, 0, screen.clientWidth, screen.clientHeight);
    paint.globalAlpha = 1;
    drops.forEach((drop, c) => {
      const x = c * 2 * cellWidth;
      if (drop.y >= 0 && paint !== null) {
        // The character that led is part of the trail now.
        paint.fillStyle = colours.background;
        paint.fillRect(x, drop.y * cellHeight, cellWidth, cellHeight);
        paint.fillStyle = colours.trail;
        paint.fillText(pick(), x, drop.y * cellHeight);
      }
      drop.y += drop.speed;
      if (drop.y >= 0 && paint !== null) {
        paint.fillStyle = colours.accent;
        paint.fillText(pick(), x, drop.y * cellHeight);
      }
      if (drop.y > rows + Math.random() * rows) drop.y = -Math.floor(Math.random() * rows);
    });
  }

  function loop(now: number): void {
    if (done) return;
    if (now - lastStep >= view.stepMs) {
      lastStep = now;
      rain();
    }
    raf = requestAnimationFrame(loop);
  }

  function start(): void {
    if (done || still || raf !== 0) return;
    motion = 'running';
    raf = requestAnimationFrame(loop);
  }

  /** Nothing is drawn while the page is hidden; the rain goes on when it is back. */
  function onVisibility(): void {
    if (done || still) return;
    if (document.visibilityState === 'hidden') {
      stop();
      motion = 'paused';
    } else start();
  }

  function onKey(event: KeyboardEvent): void {
    if (done || event.repeat || MODIFIERS.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    finish();
  }

  function onResize(): void {
    if (!done) setup();
  }

  onMount(() => {
    setup();
    document.addEventListener('visibilitychange', onVisibility);
    if (!still && document.visibilityState !== 'hidden') start();
    else if (!still) motion = 'paused';
  });

  onDestroy(() => {
    done = true;
    stop();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  });
</script>

<svelte:window onkeydown={onKey} onresize={onResize} />

<button type="button" class="matrix" data-motion={motion} aria-label="Characters rain down the screen. Press any key or tap to stop." bind:this={screen} onclick={finish}>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  <span class="hint" aria-hidden="true">{view.touch ? 'tap to stop' : 'any key stops it'}</span>
</button>

<style>
  .matrix {
    position: relative;
    display: block;
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    background: var(--theme-background);
    color: var(--role-ok, var(--theme-green));
    font-family: var(--term-font, monospace);
    font-size: var(--term-fs, 13px);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .matrix:focus {
    outline: none;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .hint {
    position: absolute;
    right: max(12px, env(safe-area-inset-right));
    bottom: max(12px, env(safe-area-inset-bottom));
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--theme-background);
    color: var(--role-muted, var(--theme-bright-black));
  }
</style>
