<!--
  The Rick app, for sudo (src/commands/shell/sudo.run.ts): after the password prompt, the dancer
  from commands/lib/rick.ts dances in theme colours (the coat in the accent, the face in the
  strong foreground, the floor muted) to the owner's own track, played through an <audio> element
  made here when the show opens and never before (services/track.ts); where the track cannot load
  or play, vesen's own 8-bit tune takes over (services/chiptune.ts, through the page's one
  AudioContext). Frames change on animation frames at their own pace, and rest while the page is
  hidden. Esc, ^C, q and Back close it, with a short fade; m mutes whichever plays; on a touch
  screen a row of 44 px buttons does both. Under reduced motion one frame stands still while the
  sound plays (sound is not motion), with the same way out.

  The owner may supply frames of their own (commands/lib/rick.ts, RICK_FRAMES): the file is
  fetched when the show opens (services/frames.ts), and when it is there and well formed its frames
  take the dancer's place, started together with the track (from where the track is, if it is
  already playing; at once where no sound plays). Missing or malformed, the drawn dancer plays on.

  A browser may hold the sound back until it has seen a gesture of its own; then the status line
  asks for a key or a tap, and the first one starts it, and the file's frames with it.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { RICK_ALT, RICK_CLOSED, RICK_FPS, RICK_TITLE, FRAME_COLS, FRAME_ROWS, type FrameSpan, type RickFrame, type RickView } from '../../commands/lib/rick';
  import type { Song } from '../../lib/chiptune';
  import type { FramesFile } from '../../lib/frames';
  import { isRole, type Role } from '../../output/model';
  import { createChiptune, type Chiptune, type ChiptuneOptions } from '../../services/chiptune';
  import { loadFrames, type FramesLoader } from '../../services/frames';
  import { audioElement, createTrack, type Track, type TrackElement } from '../../services/track';
  import { cssColour } from '../span-style';
  import type { AppProps } from './registry';

  let {
    props,
    close,
    synth = createChiptune,
    audio = audioElement,
    fetchFrames = loadFrames,
  }: AppProps & {
    /** Makes the synth; tests give a fake. */
    synth?: (song: Song, options: ChiptuneOptions) => Chiptune;
    /** Makes the audio element the track plays through, or null for none; tests give a fake. */
    audio?: () => TrackElement | null;
    /** Fetches the owner's frames file; tests give a fake. */
    fetchFrames?: FramesLoader;
  } = $props();

  /** The most one step may advance, so a page that was hidden does not skip ahead. */
  const MAX_STEP_MS = 250;
  /** Keys that are not a key press on their own. */
  const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'];
  const BLANK: RickFrame = { text: '', rows: [] };

  /** The frames on the stage: the drawn dancer, or the owner's file. */
  interface Shown {
    readonly frames: readonly RickFrame[];
    readonly fps: number;
    readonly cols: number;
    readonly rows: number;
    readonly source: 'drawn' | 'file';
  }

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
      track: typeof raw.track === 'string' ? raw.track : '',
      framesFile: typeof raw.framesFile === 'string' ? raw.framesFile : '',
      song: (typeof raw.song === 'object' && raw.song !== null ? raw.song : { title: '', bpm: 0, stepsPerBeat: 0, duty: {}, envelope: {}, patterns: {} }) as Song,
      touch: raw.touch === true,
    };
  }

  // svelte-ignore state_referenced_locally
  const view = viewOf(props);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canAnimate = typeof requestAnimationFrame === 'function';

  let shown: Shown = $state.raw({ frames: view.frames, fps: view.fps, cols: FRAME_COLS, rows: FRAME_ROWS, source: 'drawn' });
  const still = $derived(reduce || !canAnimate || shown.frames.length < 2);

  let frame = $state(0);
  let motion: 'running' | 'paused' | 'still' = $state(reduce || !canAnimate || view.frames.length < 2 ? 'still' : 'running');
  /** off: nothing plays (no track, no Web Audio); waiting: the browser wants a gesture first; on; muted. */
  let sound: 'off' | 'waiting' | 'on' | 'muted' = $state('off');
  /** What the sound comes from: the owner's track, the synth, or nothing. */
  let source: 'track' | 'synth' | 'none' = $state('none');

  let root: HTMLElement | undefined = $state();
  let player: Chiptune | null = null;
  let track: Track | null = null;
  let raf = 0;
  let elapsed = 0;
  let last: number | null = null;
  let done = false;

  const current = $derived(shown.frames[still ? 0 : frame] ?? BLANK);
  const status = $derived.by(() => {
    const parts: string[] = [];
    if (sound === 'waiting') parts.push('tap or press any key for sound');
    if (!view.touch) {
      parts.push('Esc, ^C or q to leave');
      if (sound === 'on' || sound === 'muted') parts.push(`m to ${sound === 'muted' ? 'unmute' : 'mute'}`);
    }
    return parts.join('; ');
  });

  function soundNow(): void {
    if (player === null) sound = 'off';
    else if (player.playing) sound = player.muted ? 'muted' : 'on';
    else if (!player.available) sound = 'off';
    else if (sound !== 'off') sound = 'waiting';
  }

  /** Starts the sound, or asks again inside a gesture. The file's frames start with the track. */
  function tryPlay(): void {
    if (player === null || done) return;
    const asked = player;
    void asked.play().then((ok) => {
      if (done || player !== asked) return;
      if (!ok) {
        sound = asked.available ? 'waiting' : 'off';
        return;
      }
      soundNow();
      if (asked === track && shown.source === 'file') restartFrames(0);
    });
  }

  /** The synth plays the tune: where there is no track, or the track failed. */
  function playSynth(): void {
    const wasMuted = player?.muted === true;
    let next: Chiptune | null = null;
    try {
      next = synth(view.song, { onChange: soundNow });
    } catch {
      // A song the synth cannot read: the show goes on in silence.
      next = null;
    }
    player = next;
    track = null;
    source = next === null ? 'none' : 'synth';
    if (next !== null && wasMuted) next.mute();
    soundNow();
    tryPlay();
  }

  /** The track, through an element made now; false where there is no track or no element. */
  function playTrack(): boolean {
    if (view.track === '') return false;
    let element: TrackElement | null = null;
    try {
      element = audio();
    } catch {
      element = null;
    }
    if (element === null) return false;
    const made = createTrack(view.track, element, {
      onChange: soundNow,
      onFail: () => {
        if (!done && player === made) playSynth();
      },
    });
    player = made;
    track = made;
    source = 'track';
    // In the page while it plays, so the show owns it; release() takes it out again.
    if (typeof Node !== 'undefined' && element instanceof Node) root?.appendChild(element);
    tryPlay();
    return true;
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

  function frameAt(ms: number): number {
    return Math.floor((ms / 1000) * shown.fps) % shown.frames.length;
  }

  function step(now: number): void {
    if (done) return;
    if (last !== null) elapsed += Math.min(MAX_STEP_MS, Math.max(0, now - last));
    last = now;
    frame = frameAt(elapsed);
    raf = requestAnimationFrame(step);
  }

  function startFrames(): void {
    if (done || still || raf !== 0) return;
    motion = 'running';
    raf = requestAnimationFrame(step);
  }

  /** The frames from `seconds` in: where the track is, or the start. */
  function restartFrames(seconds: number): void {
    elapsed = Math.max(0, seconds) * 1000;
    last = null;
    frame = frameAt(elapsed);
  }

  /** The owner's frames take the stage, together with the track. */
  function useFile(file: FramesFile): void {
    shown = { frames: file.frames, fps: file.fps, cols: file.cols, rows: file.rows, source: 'file' };
    restartFrames(track !== null && track.playing ? track.position() : 0);
    if (still) {
      stopFrames();
      motion = 'still';
    } else if (typeof document === 'undefined' || document.visibilityState !== 'hidden') startFrames();
    else motion = 'paused';
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

  /** Nothing is drawn while the page is hidden; the dance goes on when it is back, with the track. */
  function onVisibility(): void {
    if (done || still) return;
    if (document.visibilityState === 'hidden') {
      stopFrames();
      motion = 'paused';
      return;
    }
    if (shown.source === 'file' && track !== null && track.playing) restartFrames(track.position());
    startFrames();
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
    if (!playTrack()) playSynth();
    document.addEventListener('visibilitychange', onVisibility);
    if (!still && document.visibilityState !== 'hidden') startFrames();
    else if (!still) motion = 'paused';
    if (view.framesFile !== '') {
      fetchFrames(view.framesFile).then(
        (file) => {
          if (!done && file !== null) useFile(file);
        },
        () => {
          // The loader never throws; the drawn dancer plays anyway.
        },
      );
    }
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
<div
  class="rick"
  class:touch={view.touch}
  role="dialog"
  aria-label={view.title}
  tabindex="-1"
  data-rick
  data-motion={motion}
  data-sound={sound}
  data-source={source}
  data-frames={shown.source}
  onclick={onTap}
  bind:this={root}
>
  <h1 class="title">{view.title}</h1>
  <div class="stage">
    <pre class="frame" aria-hidden="true" style:--cols={shown.cols} style:--rows={shown.rows}>{#each current.rows as row, r (r)}{#if r > 0}{'\n'}{/if}{#each row as span, s (s)}<span style:color={cssColour(span.role)}>{span.text}</span>{/each}{/each}</pre>
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

  /*
    As large as the screen allows, within reason, for a frame of --cols by --rows cells: a cell is
    about 0.62 em wide in the terminal's font and the rows are 1.15 em tall, and the title, the
    status line and the buttons take about 220 px.
  */
  .frame {
    --cols: 24;
    --rows: 14;
    margin: 0;
    font: inherit;
    font-size: clamp(5px, min(calc((100vw - 32px) / (var(--cols) * 0.62)), calc((100vh - 220px) / (var(--rows) * 1.15))), 30px);
    line-height: 1.15;
    white-space: pre;
  }

  .status {
    margin: 0;
    min-height: 1.15em;
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
