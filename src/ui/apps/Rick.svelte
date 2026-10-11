<!--
  The Rick app, for sudo (src/commands/shell/sudo.run.ts): after the joke password prompt, the
  dancer from commands/lib/rick.ts dances in theme colours (the coat in the accent, the face in
  the strong foreground, the floor muted) to vesen's own 8-bit tune, played by services/chiptune.ts
  through the page's one AudioContext. Frames change at the song's sixteenth notes on animation
  frames, and rest while the page is hidden. Esc, ^C, q and Back close it; m mutes; on a touch
  screen a row of 44 px buttons does both. Under reduced motion one frame stands still while the
  music plays (sound is not motion), with the same way out.

  A browser may keep the AudioContext suspended until it has seen a gesture of its own; then the
  status line asks for a key or a tap, and the first one starts the sound.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { RICK_ALT, RICK_CLOSED, RICK_FPS, RICK_TITLE, type FrameSpan, type RickFrame, type RickView } from '../../commands/lib/rick';
  import type { Song } from '../../lib/chiptune';
  import { isRole, type Role } from '../../output/model';
  import { createChiptune, type Chiptune, type ChiptuneOptions } from '../../services/chiptune';
  import { cssColour } from '../span-style';
  import type { AppProps } from './registry';

  let {
    props,
    close,
    synth = createChiptune,
  }: AppProps & {
    /** Makes the synth; tests give a fake. */
    synth?: (song: Song, options: ChiptuneOptions) => Chiptune;
  } = $props();

  /** The most one step may advance, so a page that was hidden does not skip ahead. */
  const MAX_STEP_MS = 250;
  /** Keys that are not a key press on their own. */
  const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'];
  const BLANK: RickFrame = { text: '', rows: [] };

  function spansOf(value: unknown): readonly FrameSpan[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((span: unknown): FrameSpan[] => {
      const raw = (typeof span === 'object' && span !== null ? span : {}) as Partial<FrameSpan>;
      if (typeof raw.text !== 'string') return [];
      const role: Role = typeof raw.role === 'string' && isRole(raw.role) ? raw.role : 'fg';
      return [{ text: raw.text, role }];
    });
  }

  function framesOf(value: unknown): readonly RickFrame[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((frame: unknown): RickFrame[] => {
      const raw = (typeof frame === 'object' && frame !== null ? frame : {}) as Partial<RickFrame>;
      if (typeof raw.text !== 'string' || !Array.isArray(raw.rows)) return [];
      return [{ text: raw.text, rows: raw.rows.map(spansOf) }];
    });
  }

  function viewOf(value: unknown): RickView {
    const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<RickView>;
    const frames = framesOf(raw.frames);
    return {
      title: typeof raw.title === 'string' && raw.title !== '' ? raw.title : RICK_TITLE,
      alt: typeof raw.alt === 'string' && raw.alt !== '' ? raw.alt : RICK_ALT,
      frames: frames.length > 0 ? frames : [BLANK],
      fps: typeof raw.fps === 'number' && raw.fps > 0 ? raw.fps : RICK_FPS,
      song: (typeof raw.song === 'object' && raw.song !== null ? raw.song : { title: '', bpm: 0, stepsPerBeat: 0, duty: {}, envelope: {}, patterns: {} }) as Song,
      touch: raw.touch === true,
    };
  }

  // svelte-ignore state_referenced_locally
  const view = viewOf(props);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const still = reduce || typeof requestAnimationFrame !== 'function' || view.frames.length < 2;

  let frame = $state(0);
  let motion: 'running' | 'paused' | 'still' = $state(still ? 'still' : 'running');
  /** off: no Web Audio (or no song); waiting: the browser wants a gesture first; on; muted. */
  let sound: 'off' | 'waiting' | 'on' | 'muted' = $state('off');

  let player: Chiptune | null = null;
  let raf = 0;
  let elapsed = 0;
  let last: number | null = null;
  let done = false;

  const current = $derived(view.frames[still ? 0 : frame] ?? BLANK);
  const track = $derived(view.song.title === '' ? "vesen's own 8-bit number" : `${view.song.title}, vesen's own 8-bit number`);
  const status = $derived.by(() => {
    if (sound === 'waiting') return `${track} · tap or press any key for sound`;
    const leave = view.touch ? '' : ' · Esc, ^C or q to leave';
    const mute = view.touch || sound === 'off' ? '' : ` · m to ${sound === 'muted' ? 'unmute' : 'mute'}`;
    return `${track}${sound === 'muted' ? ' (muted)' : ''}${leave}${mute}`;
  });

  function soundNow(): void {
    if (player === null) sound = 'off';
    else if (player.playing) sound = player.muted ? 'muted' : 'on';
    else if (!player.available) sound = 'off';
    else if (sound !== 'off') sound = 'waiting';
  }

  /** Starts the music, or asks again inside a gesture. */
  function tryPlay(): void {
    if (player === null || done) return;
    void player.play().then((ok) => {
      if (done) return;
      if (ok) soundNow();
      else sound = player?.available === true ? 'waiting' : 'off';
    });
  }

  function toggleMute(): void {
    if (player === null) return;
    if (player.muted) player.unmute();
    else player.mute();
    soundNow();
  }

  function stopFrames(): void {
    if (raf !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    raf = 0;
    last = null;
  }

  function step(now: number): void {
    if (done) return;
    if (last !== null) elapsed += Math.min(MAX_STEP_MS, Math.max(0, now - last));
    last = now;
    frame = Math.floor((elapsed / 1000) * view.fps) % view.frames.length;
    raf = requestAnimationFrame(step);
  }

  function startFrames(): void {
    if (done || still || raf !== 0) return;
    motion = 'running';
    raf = requestAnimationFrame(step);
  }

  function finish(): void {
    if (done) return;
    done = true;
    stopFrames();
    player?.stop();
    close(RICK_CLOSED);
  }

  /** Back (AppHost) closes it, as Esc does. */
  export function back(): void {
    finish();
  }

  /** Nothing is drawn while the page is hidden; the dance goes on when it is back. */
  function onVisibility(): void {
    if (done || still) return;
    if (document.visibilityState === 'hidden') {
      stopFrames();
      motion = 'paused';
    } else startFrames();
  }

  function onKey(event: KeyboardEvent): void {
    if (done || event.repeat || MODIFIERS.includes(event.key)) return;
    const key = event.key.toLowerCase();
    if (event.key === 'Escape' || key === 'q' || (event.ctrlKey && key === 'c')) {
      event.preventDefault();
      event.stopPropagation();
      finish();
      return;
    }
    if (key === 'm' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      toggleMute();
      return;
    }
    // Any other key is the gesture a waiting browser asked for.
    if (sound === 'waiting') tryPlay();
  }

  /** A tap on the stage starts the sound where the browser was waiting for one. */
  function onTap(): void {
    if (sound === 'waiting') tryPlay();
  }

  onMount(() => {
    try {
      player = synth(view.song, { onChange: soundNow });
    } catch {
      // A song the synth cannot read: the show goes on in silence.
      player = null;
    }
    document.addEventListener('visibilitychange', onVisibility);
    if (!still && document.visibilityState !== 'hidden') startFrames();
    else if (!still) motion = 'paused';
    tryPlay();
  });

  onDestroy(() => {
    done = true;
    stopFrames();
    player?.stop();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  });
</script>

<svelte:window onkeydown={onKey} />

<!-- The keys are on the window; a tap only starts the sound where the browser waited for one. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="rick" class:touch={view.touch} role="dialog" aria-label={view.title} tabindex="-1" data-rick data-motion={motion} data-sound={sound} onclick={onTap}>
  <h1 class="title">{view.title}</h1>
  <div class="stage">
    <pre class="frame" aria-hidden="true">{#each current.rows as row, r (r)}{#if r > 0}{'\n'}{/if}{#each row as span, s (s)}<span style:color={cssColour(span.role)}>{span.text}</span>{/each}{/each}</pre>
    <p class="sr-only">{view.alt}</p>
  </div>
  <p class="status" role="status">{status}</p>
  {#if view.touch}
    <div class="toolbar" role="toolbar" aria-label="Show">
      <button type="button" class="tool" onclick={finish}>Close</button>
      <button type="button" class="tool" onclick={toggleMute} disabled={sound === 'off'}>{sound === 'muted' ? 'Unmute' : 'Mute'}</button>
    </div>
  {/if}
</div>

<style>
  .rick {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 0;
    width: 100%;
    padding: 16px max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    overflow: hidden;
    background: var(--theme-background);
    color: var(--role-fg, var(--theme-foreground));
    font-family: var(--term-font, monospace);
    font-size: var(--term-fs, 13px);
    outline: none;
  }

  .title {
    margin: 0;
    color: var(--role-accent, var(--theme-cyan));
    font: inherit;
    font-weight: 700;
    text-align: center;
  }

  .stage {
    display: flex;
    justify-content: center;
    max-width: 100%;
    overflow: hidden;
  }

  /* 24 columns wide: as large as the screen allows, within reason. */
  .frame {
    margin: 0;
    font: inherit;
    font-size: clamp(13px, min(calc((100vw - 32px) / 15), calc((100vh - 220px) / 17)), 30px);
    line-height: 1.15;
    white-space: pre;
  }

  .status {
    margin: 0;
    color: var(--role-muted, var(--theme-bright-black));
    text-align: center;
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

  .toolbar {
    display: grid;
    grid-template-columns: repeat(2, minmax(44px, 160px));
    gap: 8px;
    justify-content: center;
    width: 100%;
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
</style>
