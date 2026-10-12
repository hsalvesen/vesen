<!--
  The Rick app, for sudo (src/commands/shell/sudo.run.ts): after the password prompt, the owner's
  video traced to text (commands/lib/rick.ts, RICK_FRAMES: 120 columns by 45 rows) plays in the
  foreground colour to the owner's own track, through an <audio> element the boot warmed at idle
  (services/warm-show.ts) or one made here when the show opens (services/track.ts); where the
  track cannot load or play, vesen's own 8-bit tune takes over (services/chiptune.ts, through the
  page's one AudioContext). Nothing else is on the screen: the frames, and one line saying how to
  leave (Tap to exit on a touch screen, where a tap leaves). Esc, ^C, q and Back close it, with a short
  fade; m still mutes whichever plays, unannounced. A browser that holds the sound back until it
  has seen a gesture of its own gets one from the first key or tap, which starts the sound (and
  the frames from the top with it); nothing on the screen asks for it.

  The frames are fetched when the show opens (services/frames.ts): on a screen taller than wide
  (a phone held upright) the portrait cut, the middle of the picture, which covers the screen edge
  to edge, as large as it must be, cropped evenly about its centre; elsewhere the whole picture,
  as large as the window allows. Until they come, and where the file is missing or malformed, the
  stage is empty. They start together with the track (from where the track is, if it is already
  playing; at once where no sound plays) and keep to it: every couple of seconds the frames are
  set to where the track is, so the two loop as one (the file's rate is fitted to the track's
  length; scripts/ascii-video.py --fit). Frames change on animation frames at the file's pace, and
  rest while the page is hidden. They play under reduced motion too: they are a video the visitor
  asked for, and a video plays (the cathode's moving layers, which are decoration, still go).
  Only a browser that cannot animate shows one frame: the most detailed, since the video opens on
  black.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { RICK_ALT, RICK_CLOSED, RICK_TITLE, type RickView } from '../../commands/lib/rick';
  import type { Song } from '../../lib/chiptune';
  import { stillFrameIndex, type AsciiFrame, type FramesFile } from '../../lib/frames';
  import { PORTRAIT_QUERY } from '../../lib/show-files';
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
    /** Makes (or takes, when warmed) the audio element the track plays through, or null for none; tests give a fake. */
    audio?: (src: string) => TrackElement | null;
    /** Fetches the owner's frames file; tests give a fake. */
    fetchFrames?: FramesLoader;
  } = $props();

  /** The most one step may advance, so a page that was hidden does not skip ahead. */
  const MAX_STEP_MS = 250;
  /** How often the file's frames are set to where the track is, and how far off they may be first. */
  const SYNC_EVERY_MS = 2000;
  const SYNC_SLACK_MS = 120;
  /** Keys that are not a key press on their own. */
  const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'];
  const BLANK: AsciiFrame = { text: '', rows: [] };

  /** The owner's frames on the stage, once the file has come. */
  interface Shown {
    readonly frames: readonly AsciiFrame[];
    readonly fps: number;
    readonly cols: number;
    readonly rows: number;
    /** The frame a still stage shows: the most detailed (lib/frames.ts), not the first, which a video opens on black. */
    readonly still: number;
  }

  function viewOf(value: unknown): RickView {
    const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<RickView>;
    return {
      title: typeof raw.title === 'string' && raw.title !== '' ? raw.title : RICK_TITLE,
      alt: typeof raw.alt === 'string' && raw.alt !== '' ? raw.alt : RICK_ALT,
      track: typeof raw.track === 'string' ? raw.track : '',
      framesFile: typeof raw.framesFile === 'string' ? raw.framesFile : '',
      portraitFramesFile: typeof raw.portraitFramesFile === 'string' ? raw.portraitFramesFile : '',
      song: (typeof raw.song === 'object' && raw.song !== null ? raw.song : { title: '', bpm: 0, stepsPerBeat: 0, duty: {}, envelope: {}, patterns: {} }) as Song,
      touch: raw.touch === true,
    };
  }

  // svelte-ignore state_referenced_locally
  const view = viewOf(props);
  const canAnimate = typeof requestAnimationFrame === 'function';
  /** The cut that plays, chosen as the show opens: the portrait one on a screen taller than wide, where the view names one. */
  const cut: 'portrait' | 'landscape' =
    view.portraitFramesFile !== '' && typeof matchMedia === 'function' && matchMedia(PORTRAIT_QUERY).matches ? 'portrait' : 'landscape';
  const framesPath = cut === 'portrait' ? view.portraitFramesFile : view.framesFile;

  /** Null until the file has come: an empty stage. */
  let shown = $state.raw<Shown | null>(null);
  const still = $derived(!canAnimate || (shown !== null && shown.frames.length < 2));

  let frame = $state(0);
  let motion: 'running' | 'paused' | 'still' = $state('still');
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
  let synced = 0;
  let done = false;

  const current = $derived(shown === null ? BLANK : (shown.frames[still ? shown.still : frame] ?? BLANK));
  /**
   * The one line under the frames: how to leave. A touch screen has its Close button instead. A
   * browser that holds the sound back until a gesture of its own gets one from the first key or
   * tap (onKey, onTap), and the screen says nothing of it.
   */
  const status = $derived(view.touch ? 'Tap to exit' : 'Ctrl+C, q or Esc to exit');

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
      if (asked === track && shown !== null) restartFrames(0);
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
      element = audio(view.track);
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
    if (shown === null) return 0;
    return Math.floor((ms / 1000) * shown.fps) % shown.frames.length;
  }

  function step(now: number): void {
    if (done) return;
    if (last !== null) elapsed += Math.min(MAX_STEP_MS, Math.max(0, now - last));
    last = now;
    // The file's frames follow the track: set to where it is every couple of seconds, so a loop
    // of the track is a loop of the frames, and a stall in either does not part them.
    if (shown !== null && track !== null && track.playing && now - synced >= SYNC_EVERY_MS) {
      synced = now;
      const at = track.position() * 1000;
      if (Math.abs(at - elapsed) > SYNC_SLACK_MS) elapsed = at;
    }
    frame = frameAt(elapsed);
    raf = requestAnimationFrame(step);
  }

  function startFrames(): void {
    if (done || still || raf !== 0 || shown === null) return;
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
    // The still frame is looked for only where the stage will stand still.
    shown = { frames: file.frames, fps: file.fps, cols: file.cols, rows: file.rows, still: canAnimate ? 0 : stillFrameIndex(file.frames) };
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

  /** Nothing is drawn while the page is hidden; the frames go on when it is back, with the track. */
  function onVisibility(): void {
    if (done || still || shown === null) return;
    if (document.visibilityState === 'hidden') {
      stopFrames();
      motion = 'paused';
      return;
    }
    if (track !== null && track.playing) restartFrames(track.position());
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
    // On a touch screen a tap leaves (the first one starts the sound, where the browser held it back).
    else if (view.touch) finish();
  }

  onMount(() => {
    if (!playTrack()) playSynth();
    document.addEventListener('visibilitychange', onVisibility);
    // The frames: the stage stays empty until they come, and where they never do.
    if (framesPath !== '') {
      fetchFrames(framesPath).then(
        (file) => {
          if (!done && file !== null) useFile(file);
        },
        () => {
          // The loader never throws; the stage stays empty anyway.
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
  data-frames={shown === null ? 'none' : 'file'}
  data-cut={cut}
  onclick={onTap}
  bind:this={root}
>
  <div class="stage">
    <pre class="frame" aria-hidden="true" style:--cols={shown?.cols ?? 1} style:--rows={shown?.rows ?? 1}>{#each current.rows as row, r (r)}{#if r > 0}{'\n'}{/if}{#each row as span, s (s)}<span style:color={cssColour(span.role)}>{span.text}</span>{/each}{/each}</pre>
    <p class="sr-only">{view.alt}</p>
  </div>
  <p class="status" role="status">{status}</p>
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

  .stage {
    display: flex;
    justify-content: center;
    max-width: 100%;
    overflow: hidden;
  }

  /*
    As large as the window allows, within reason, for a frame of --cols by --rows cells: a cell is
    about 0.62 em wide in the terminal's font and the rows are 1.15 em tall; the app host's frame
    and this padding take 68 px of the width, and with the status line or the Close button about
    112 px of the height. The floor of 4 px keeps a wide picture whole on a phone on its side.
  */
  .frame {
    --cols: 24;
    --rows: 14;
    margin: 0;
    font: inherit;
    font-size: clamp(4px, min(calc((100vw - 68px) / (var(--cols) * 0.62)), calc((100vh - 112px) / (var(--rows) * 1.15))), 30px);
    line-height: 1.15;
    white-space: pre;
  }

  .status {
    margin: 0;
    min-height: 1.15em;
    color: var(--role-muted, var(--theme-bright-black));
    text-align: center;
  }

  /*
    A screen taller than wide (a phone held upright): the picture covers the screen edge to edge,
    as large as it must be in both directions, centred, so what overflows is cut evenly from both
    sides (the portrait cut is a little wider than most phones), and the status line sits beneath it. The stage is a size container, so the font follows the stage's
    own width and height: a cell is 0.585 em wide (Vesen Mono's advance, 1200 of 2048) and 1.15 em
    tall. Where container units are missing (iOS 15), the viewport stands in for the stage.
  */
  @media (orientation: portrait) {
    .rick {
      gap: 0;
      padding: 0;
    }

    .stage {
      container-type: size;
      flex: 1 1 0;
      align-self: stretch;
      align-items: center;
      min-height: 0;
      max-width: none;
    }

    .frame {
      font-size: max(calc(100vw / (var(--cols) * 0.585)), calc((100vh - 70px) / (var(--rows) * 1.15)));
    }

    @supports (width: 1cqw) {
      .frame {
        font-size: max(calc(100cqw / (var(--cols) * 0.585)), calc(100cqh / (var(--rows) * 1.15)));
      }
    }

    .status {
      padding: 8px 16px;
    }

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
