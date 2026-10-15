// nyancat's show: Nyan Cat flying across the screen (lib/nyancat.ts: K. Lange's nyancat, drawn in
// ASCII in the cat's own colours), to the owner's track (public/audio/nyancat.mp3), in the Nyan
// app (src/ui/apps/Nyan.svelte), which nyancat opens through tty.fullscreen. Like nyancat, the app
// counts how long it has shown at the foot of the screen, and it hands that back when it closes.
// Small, so nyancat's spec can name the track for the gesture that runs it without the frames.

/** The track: the owner's Nyan Cat, played on Sega Genesis instruments, served from this origin. */
export const NYAN_TRACK = '/audio/nyancat.mp3';

export const NYAN_TITLE = 'Nyan Cat';

/** How the show reads to a screen reader. */
export const NYAN_ALT = 'Nyan Cat, drawn in coloured text, flies across the screen with its rainbow behind it, to a chiptune.';

/** How to leave on a keyboard, under the picture once it has played a few seconds (^C leaves too). */
export const NYAN_KEYS_HINT = 'Press q or Esc to exit';

/** How long the show plays before it says how to leave on a keyboard. */
export const NYAN_HINT_AFTER_MS = 3000;

/** How to leave on a touch screen, for a screen reader: the screen itself shows the picture alone. */
export const NYAN_TAP_HINT = 'Tap to exit.';

/**
 * What a touch screen shows over the cat, standing still, before the show: a tap starts it,
 * sound and picture together, since a tap is a gesture every browser lets start sound.
 */
export const NYAN_START = 'Tap to nyan';

/** How long the show has run, as nyancat says it at the foot of its screen. */
export function nyanedLine(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `You have nyaned for ${whole} ${whole === 1 ? 'second' : 'seconds'}!`;
}

/** What nyancat hands the Nyan app. */
export interface NyanView {
  readonly title: string;
  readonly alt: string;
  /** The path of the track, on this origin; '' for none. */
  readonly track: string;
  readonly touch: boolean;
  /** The line counting how long it has shown; nyancat -n leaves it out. */
  readonly counter: boolean;
  /** How many frames to show before it closes itself (nyancat -f); null until it is closed. */
  readonly frames: number | null;
}

/** What the Nyan app hands back when it closes: how long it showed. */
export interface NyanResult {
  readonly seconds: number;
}

export function nyanView(touch: boolean, options: { readonly counter?: boolean; readonly frames?: number | null } = {}): NyanView {
  return { title: NYAN_TITLE, alt: NYAN_ALT, track: NYAN_TRACK, touch, counter: options.counter ?? true, frames: options.frames ?? null };
}
