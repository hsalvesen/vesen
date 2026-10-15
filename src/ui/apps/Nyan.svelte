<!--
  The Nyan app, for nyancat (src/commands/more/fun/nyancat.run.ts): Nyan Cat flies across the
  screen with its rainbow behind it, K. Lange's nyancat drawn in ASCII in the cat's own colours
  (lib/nyancat.ts: two characters a cell, `::` sky, `@@` stars, `##==--++~~$$` the rainbow, `;;`
  the cat), to the owner's track (commands/lib/nyancat.ts, NYAN_TRACK), through an <audio> element
  (services/track.ts). The frame covers the window inside the terminal's green frame (AppHost), as
  large as it must be, cropped evenly about the cat, on any screen: it fills the screen, as sudo's
  show does. Like nyancat, it counts how long it has shown at the foot of the screen, and hands
  that back when it closes, so nyancat can say it.

  The frames bob to the beat: twelve to two beats of the track's 140 beats a minute, from its first
  beat (lib/nyancat.ts nyanFrameAt), and every couple of seconds they are set to where the track is,
  so the two never part, loop after loop. All twelve frames are drawn once, stacked, and only the one
  showing is visible, so a step changes nothing but which one that is. Frames change on animation
  frames, rest while the page is hidden, and play under reduced motion too, as an animation the
  visitor asked for; only a browser that cannot animate shows one still frame.

  On a keyboard it starts at once: nyancat's spec names the track (CommandSpec.plays), so the Enter
  that ran it readied it (services/warm-show.ts unlockAudio), and a browser that starts sound only
  from a gesture lets it play; one that holds it back anyway gets a gesture from the first key, which
  starts the sound, and the frames follow it. Once it has played a few seconds, a line says how to
  leave. On a touch screen the cat stands still over 'Tap to nyan' until a tap, which starts it,
  sound and picture together, since a tap is a gesture every browser lets start sound; after that a
  tap leaves (a screen reader hears so). Esc, ^C, q and Back close it; m mutes the sound,
  unannounced; nyancat -f closes it after that many frames.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    NYAN_ALT,
    NYAN_HINT_AFTER_MS,
    NYAN_KEYS_HINT,
    NYAN_START,
    NYAN_TAP_HINT,
    NYAN_TITLE,
    nyanedLine,
    type NyanResult,
    type NyanView,
  } from '../../commands/lib/nyancat';
  import { NYAN_COLS, NYAN_FPS, NYAN_FRAMES, NYAN_ROWS, NYAN_SKY, frameRuns, nyanFrameAt } from '../../lib/nyancat';
  import { audioElement, createTrack, type Track, type TrackElement } from '../../services/track';
  import type { AppProps } from './registry';

  let {
    props,
    close,
    audio = audioElement,
  }: AppProps & {
    /** Makes (or takes, when readied) the audio element the track plays through, or null for none; tests give a fake. */
    audio?: (src: string) => TrackElement | null;
  } = $props();

  /** The most one step may advance, so a page that was hidden does not skip ahead. */
  const MAX_STEP_MS = 250;
  /** How often the frames are set to where the track is, and how far off they may be first. */
  const SYNC_EVERY_MS = 2000;
  const SYNC_SLACK_MS = 120;
  /** Keys that are not a key press on their own. */
  const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'];
  /** Every frame, drawn once: rows of runs of one colour. */
  const RUNS = NYAN_FRAMES.map(frameRuns);

  function viewOf(value: unknown): NyanView {
    const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<NyanView>;
    const frames = typeof raw.frames === 'number' && Number.isInteger(raw.frames) && raw.frames > 0 ? raw.frames : null;
    return {
      title: typeof raw.title === 'string' && raw.title !== '' ? raw.title : NYAN_TITLE,
      alt: typeof raw.alt === 'string' && raw.alt !== '' ? raw.alt : NYAN_ALT,
      track: typeof raw.track === 'string' ? raw.track : '',
      touch: raw.touch === true,
      counter: raw.counter !== false,
      frames,
    };
  }

  // svelte-ignore state_referenced_locally
  const view = viewOf(props);
  const canAnimate = typeof requestAnimationFrame === 'function';

  /** The frame showing. */
  let frame = $state(0);
  /** running, paused while the page is hidden, still where it cannot animate, or waiting for the tap that starts it. */
  let motion: 'running' | 'paused' | 'still' | 'waiting' = $state(view.touch ? 'waiting' : canAnimate ? 'running' : 'still');
  /** On a touch screen the show waits for a tap; on a keyboard it starts at once. */
  let started = $state(!view.touch);
  /** off: nothing plays (no track, or it failed); waiting: the browser wants a gesture first; on; muted. */
  let sound: 'off' | 'waiting' | 'on' | 'muted' = $state('off');
  /** Whole seconds it has shown, for the count at the foot. */
  let seconds = $state(0);
  /** On a keyboard, how to leave shows once the show has played a few seconds. */
  let hinted = $state(false);

  let root: HTMLElement | undefined = $state();
  let track: Track | null = null;
  let raf = 0;
  let last: number | null = null;
  /** Where the frames are, in ms into the track. */
  let position = 0;
  /** How long it has shown, in ms, for the count and for -f. */
  let shown = 0;
  let synced = 0;
  let done = false;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;

  function soundNow(): void {
    if (track === null) sound = 'off';
    else if (track.playing) sound = track.muted ? 'muted' : 'on';
    else if (track.failed || !track.available) sound = 'off';
    else if (sound !== 'off') sound = 'waiting';
  }

  /** Starts the sound, or asks again inside a gesture; the frames follow it from where it is. */
  function tryPlay(): void {
    if (track === null || done) return;
    const asked = track;
    void asked.play().then((ok) => {
      if (done || track !== asked) return;
      if (!ok) {
        sound = asked.available && !asked.failed ? 'waiting' : 'off';
        return;
      }
      soundNow();
      position = asked.position() * 1000;
    });
  }

  /** The track, through an element made (or readied) now; nothing where there is none. */
  function startSound(): void {
    if (view.track === '' || track !== null) return;
    let element: TrackElement | null = null;
    try {
      element = audio(view.track);
    } catch {
      element = null;
    }
    if (element === null) return;
    const made = createTrack(view.track, element, {
      onChange: soundNow,
      // A track that cannot play leaves the cat to fly in silence.
      onFail: () => {
        if (!done && track === made) sound = 'off';
      },
    });
    track = made;
    sound = 'waiting';
    // In the page while it plays, so the show owns it; stop() takes it out again.
    if (typeof Node !== 'undefined' && element instanceof Node) root?.appendChild(element);
    tryPlay();
  }

  function toggleMute(): void {
    if (track === null) return;
    if (track.muted) track.unmute();
    else track.mute();
    soundNow();
  }

  function stopFrames(): void {
    if (raf !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    raf = 0;
    last = null;
  }

  function step(now: number): void {
    if (done) return;
    if (last !== null) {
      const delta = Math.min(MAX_STEP_MS, Math.max(0, now - last));
      position += delta;
      shown += delta;
    }
    last = now;
    // The frames follow the track: set to where it is every couple of seconds, so a loop of the
    // track is a loop of the bobbing, and a stall in either does not part them.
    if (track !== null && track.playing && now - synced >= SYNC_EVERY_MS) {
      synced = now;
      const at = track.position() * 1000;
      if (Math.abs(at - position) > SYNC_SLACK_MS) position = at;
    }
    frame = nyanFrameAt(position / 1000);
    seconds = Math.floor(shown / 1000);
    // nyancat -f: that many frames, then it ends.
    if (view.frames !== null && Math.floor((shown / 1000) * NYAN_FPS) >= view.frames) {
      finish();
      return;
    }
    raf = requestAnimationFrame(step);
  }

  function startFrames(): void {
    if (done || !canAnimate || raf !== 0 || !started) return;
    motion = 'running';
    raf = requestAnimationFrame(step);
  }

  /** On a keyboard, how to leave shows a few seconds in; a touch screen shows the picture alone. */
  function startHint(): void {
    if (view.touch || done || hintTimer !== null) return;
    hintTimer = setTimeout(() => {
      hintTimer = null;
      if (!done) hinted = true;
    }, NYAN_HINT_AFTER_MS);
  }

  /** The show begins, from the top: sound, frames, and on a keyboard the hint to come. */
  function start(): void {
    if (done) return;
    started = true;
    position = 0;
    shown = 0;
    startSound();
    startHint();
    if (!canAnimate) motion = 'still';
    else if (typeof document !== 'undefined' && document.visibilityState === 'hidden') motion = 'paused';
    else startFrames();
  }

  function finish(): void {
    if (done) return;
    done = true;
    stopFrames();
    if (hintTimer !== null) clearTimeout(hintTimer);
    hintTimer = null;
    track?.stop();
    const result: NyanResult = { seconds: Math.floor(shown / 1000) };
    close(result);
  }

  /** Back (AppHost) closes it, as Esc does. */
  export function back(): void {
    finish();
  }

  /** Nothing is drawn while the page is hidden; the frames go on when it is back, with the track. */
  function onVisibility(): void {
    if (done || !started || !canAnimate) return;
    if (document.visibilityState === 'hidden') {
      stopFrames();
      motion = 'paused';
      return;
    }
    if (track !== null && track.playing) position = track.position() * 1000;
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
    // Any other key starts a show that waits for it, or is the gesture a waiting browser asked for.
    if (!started) start();
    else if (sound === 'waiting') tryPlay();
  }

  /** A tap starts a show that waits for it; then it starts sound a browser held back, or leaves. */
  function onTap(): void {
    if (!started) start();
    else if (sound === 'waiting') tryPlay();
    else if (view.touch) finish();
  }

  onMount(() => {
    document.addEventListener('visibilitychange', onVisibility);
    if (started) start();
  });

  onDestroy(() => {
    done = true;
    stopFrames();
    if (hintTimer !== null) clearTimeout(hintTimer);
    track?.stop();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  });
</script>

<svelte:window onkeydown={onKey} />

<!-- The keys are on the window; a tap starts the show, or the sound a browser held back, or leaves. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="nyan"
  class:touch={view.touch}
  role="dialog"
  aria-label={view.title}
  tabindex="-1"
  data-nyan
  data-motion={motion}
  data-sound={sound}
  data-frame={frame}
  style:--sky={NYAN_SKY}
  style:--cols={NYAN_COLS * 2}
  style:--rows={NYAN_ROWS}
  onclick={onTap}
  bind:this={root}
>
  <div class="stage">
    <div class="art" aria-hidden="true">
      {#each RUNS as rows, i (i)}
        <pre class="frame" class:shown={i === frame}>{#each rows as row, r (r)}{#if r > 0}{'\n'}{/if}{#each row as run, s (s)}<span style:color={run.colour}>{run.text}</span>{/each}{/each}</pre>
      {/each}
    </div>
    <p class="sr-only">{view.alt}</p>
    {#if view.touch && started}<p class="sr-only">{NYAN_TAP_HINT}</p>{/if}
    <div class="foot">
      {#if !started}
        <p class="start">{NYAN_START}</p>
      {:else if view.counter}
        <p class="counter" aria-hidden="true">{nyanedLine(seconds)}</p>
      {/if}
      <!-- On a keyboard: empty until the show has played a few seconds, so the line is there to be announced. -->
      {#if !view.touch}<p class="status" class:shown={hinted} role="status">{hinted ? NYAN_KEYS_HINT : ''}</p>{/if}
    </div>
  </div>
</div>

<style>
  .nyan {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    width: 100%;
    overflow: hidden;
    background: var(--sky);
    color: #ffffff;
    font-family: var(--term-font, monospace);
    font-size: var(--term-fs, 13px);
    outline: none;
  }

  /*
    The picture covers the stage, as large as it must be in both directions and centred, so what
    overflows is cut evenly from both sides: the sky above and below on a wide screen, the tail of
    the rainbow and the sky ahead of the cat on a phone held upright. The stage is a size
    container, so the font follows its own width and height: a frame is --cols characters (two a
    cell) by --rows rows, a character 0.585 em wide (Vesen Mono's advance, 1200 of 2048) and a row
    1.15 em tall. Where container units are missing (iOS 15), the viewport less the frame (12 px
    each way) stands in for the stage.
  */
  .stage {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    overflow: hidden;
    container-type: size;
  }

  /*
    The twelve frames in one place, one over another; only the one showing is visible. Each is as
    wide as its text, not the stage, and centred by position, so a frame wider or taller than the
    stage overflows it evenly on both sides.
  */
  .art {
    position: absolute;
    inset: 0;
  }

  .frame {
    position: absolute;
    top: 50%;
    left: 50%;
    width: max-content;
    margin: 0;
    font: inherit;
    font-size: max(calc((100vw - 12px) / (var(--cols) * 0.585)), calc((100vh - 12px) / (var(--rows) * 1.15)));
    line-height: 1.15;
    white-space: pre;
    visibility: hidden;
    transform: translate(-50%, -50%);
  }

  @supports (width: 1cqw) {
    .frame {
      font-size: max(calc(100cqw / (var(--cols) * 0.585)), calc(100cqh / (var(--rows) * 1.15)));
    }
  }

  .frame.shown {
    visibility: visible;
  }

  /* The count, the tap that starts it and how to leave: along the foot of the picture, over it, as nyancat puts its count on its last row. */
  .foot {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    padding: 0.5em 1em max(0.75em, env(safe-area-inset-bottom));
    text-align: center;
    pointer-events: none;
  }

  .foot p {
    margin: 0;
    text-shadow:
      0 0 3px #000000,
      0 0 1px #000000;
  }

  .counter,
  .start {
    font-weight: bold;
  }

  .start {
    font-size: 1.25em;
  }

  .status {
    min-height: 1.15em;
    color: #c7d4e8;
  }

  .status.shown {
    animation: hint-in 0.6s ease-out;
  }

  @keyframes hint-in {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .status.shown {
      animation: none;
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
