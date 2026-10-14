// sudo's show: the owner's video, traced to text (public/audio/incident-report.frames, in the
// format src/lib/frames.ts reads; scripts/ascii-video.py writes it), played to the owner's own
// track, with an 8-bit tune of vesen's own as the fallback where the track cannot play. sudo
// hands all of it to the Rick app (src/ui/apps/Rick.svelte) through tty.fullscreen after the
// password prompt; the app fetches the frames when it opens (the boot warmed the cache at idle,
// services/warm-show.ts), the portrait cut on a screen taller than wide and the whole picture
// elsewhere, changing cut when the screen turns; draws them in the foreground colour at the pace
// the file names, filling a touch screen edge to edge, keeps them to the track, and shows nothing
// else but, on a keyboard, how to leave once it has played a few seconds. Until the file comes,
// or where it is missing or malformed, the stage is empty; nothing else is drawn.
//
// The frames file is a header line, then the frames, each `rows` lines of `cols` characters,
// with a line of `===` between frames:
//
//   vesen-frames fps=19.4874 cols=120 rows=45
//   ...45 rows of 120 characters...
//   ===
//   ...the next frame...
//
// The files shipped are the owner's video at fifteen frames a second, written at the rate that
// makes one loop of the frames one loop of the track: the whole picture at 120 by 45, and the
// middle of it at 72 by 56 (scripts/ascii-video.py --aspect 0.64). Over its caps (32 MB, 10,000
// frames) a file is ignored. The tune is an original chiptune in the style of a handheld's sound chip: it
// quotes nothing.

import { loopSeconds, type Song } from '../../lib/chiptune';
import { SHOW_FRAMES, SHOW_FRAMES_PORTRAIT, SHOW_TRACK } from '../../lib/show-files';

/** The Rick app's result when it was closed, by whatever means. */
export const RICK_CLOSED = 'rickrolled';

/** The meme's name, which is the show's title. */
export const RICK_TITLE = 'You have been rickrolled';

/** How the show reads to a screen reader. */
export const RICK_ALT = "The owner's video, traced to text, plays on the terminal to their track.";

/** How to leave on a keyboard, under the picture once it has played a few seconds (^C leaves too). */
export const RICK_KEYS_HINT = 'Press q or Esc to exit';

/** How long the show plays before it says how to leave on a keyboard. */
export const RICK_HINT_AFTER_MS = 3000;

/** How to leave on a touch screen, for a screen reader: the screen itself shows the picture alone. */
export const RICK_TAP_HINT = 'Tap to exit.';

/**
 * The owner's track (public/audio/incident-report.mp3, served from this origin; lib/show-files.ts),
 * warmed at idle after boot and played when the show opens. An empty string means no track: the
 * song alone.
 */
export const RICK_TRACK = SHOW_TRACK;

/**
 * The owner's frames file (public/audio/incident-report.frames, in the format above), warmed into
 * the browser's cache at idle and fetched when the show opens. An empty string means an empty
 * stage.
 */
export const RICK_FRAMES = SHOW_FRAMES;

/**
 * The portrait cut of the frames (public/audio/incident-report.portrait.frames): the middle of
 * the picture, for a screen taller than wide, frame for frame with RICK_FRAMES. An empty string
 * means the whole picture there too.
 */
export const RICK_FRAMES_PORTRAIT = SHOW_FRAMES_PORTRAIT;

/** What sudo hands the Rick app. */
export interface RickView {
  readonly title: string;
  readonly alt: string;
  /** The path of the track to play, on this origin; '' for none. */
  readonly track: string;
  /** The path of the owner's frames file, on this origin; '' for an empty stage. */
  readonly framesFile: string;
  /** The path of its portrait cut, played on a screen taller than wide; '' for the whole picture there too. */
  readonly portraitFramesFile: string;
  /** The tune played where the track cannot be. */
  readonly song: Song;
  readonly touch: boolean;
}

// ── The tune ───────────────────────────────────────────────────────────────────────────────

/** Sixteen steps of chord tones, bouncing: root, third, fifth, third, twice. */
const bounce = (root: string, third: string, fifth: string): string => `${root}:2 ${third}:2 ${fifth}:2 ${third}:2 ${root}:2 ${third}:2 ${fifth}:2 ${third}:2`;

/** Sixteen steps of chord tones in sixteenths, climbing to the octave and back. */
const climb = (root: string, third: string, fifth: string, octave: string): string =>
  `${root}:1 ${third}:1 ${fifth}:1 ${octave}:1 ${fifth}:1 ${third}:1 ${root}:1 ${third}:1 ${root}:1 ${third}:1 ${fifth}:1 ${octave}:1 ${fifth}:1 ${third}:1 ${root}:1 -:1`;

/** A bar of the beat: kick on one and three, snare on two and four, hats between. */
const BEAT = 'K:2 H:2 S:2 H:2 K:2 H:2 S:2 H:2';
/** A bar with the kick pushed, for the chorus. */
const DRIVE = 'K:2 H:2 S:2 K:2 H:2 K:2 S:2 H:2';
/** A fill into the next section. */
const FILL = 'K:2 H:2 S:2 H:2 S:1 S:1 S:2 S:1 S:1 K:2';

/**
 * vesen's own 8-bit number: an upbeat, bouncy synth-pop tune at 113 bpm in C, written for this
 * show. Eight bars of verse (C, Em, F, G) and an eight-bar chorus hook (Am, F, C, G), about 34
 * seconds a loop. The lead is a pulse wave, chords bounce on a thinner pulse, the triangle walks
 * the bass and the noise channel keeps the beat.
 */
export const RICK_SONG: Song = {
  title: 'Never Logging Out',
  bpm: 113,
  stepsPerBeat: 4,
  duty: { pulse1: 0.5, pulse2: 0.25 },
  envelope: {
    pulse1: { attack: 0.004, decay: 0.09, sustain: 0.65, release: 0.04 },
    pulse2: { attack: 0.002, decay: 0.05, sustain: 0.4, release: 0.02 },
    triangle: { attack: 0.004, decay: 0.06, sustain: 0.8, release: 0.03 },
    noise: { attack: 0.001, decay: 0.03, sustain: 0.3, release: 0.02 },
  },
  patterns: {
    pulse1: [
      // Verse: a hook that climbs to the high C and tumbles back.
      'E5:2 G5:2 C6:3 -:1 G5:2 E5:2 D5:2 C5:2',
      '-:1 E5:2 G5:1 B5:4 G5:2 E5:2 -:4',
      'F5:2 A5:2 C6:4 A5:2 F5:2 G5:2 A5:2',
      'B5:2 G5:2 D5:4 G5:2 A5:2 B5:4',
      'E5:2 G5:2 C6:3 -:1 G5:2 C6:2 D6:2 E6:2',
      '-:1 E6:2 D6:1 B5:4 G5:2 E5:2 -:4',
      'F5:2 A5:2 C6:2 F6:2 C6:2 A5:2 G5:2 A5:2',
      'B5:2 D6:2 G5:4 -:2 D5:2 E5:2 F5:2',
      // Chorus: repeated notes that leap up, then the answer.
      'A5:2! A5:2 C6:2 E6:2 D6:2 C6:2 A5:4',
      'F5:2! F5:2 A5:2 C6:2 D6:2 C6:2 A5:4',
      'G5:2! G5:2 C6:2 E6:2 G6:3 -:1 E6:2 C6:2',
      'D6:2 B5:2 G5:2 B5:2 D6:4 -:4',
      'A5:2! A5:2 C6:2 E6:2 D6:2 C6:2 A5:4',
      'F5:2! F5:2 A5:2 C6:2 D6:2 E6:2 F6:4',
      'E6:2! E6:2 G6:2 E6:2 D6:2 C6:2 G5:4',
      'A5:2 B5:2 D6:4 B5:2 A5:2 G5:2 -:2',
    ].join(' | '),
    pulse2: [
      bounce('C4', 'E4', 'G4'),
      bounce('E4', 'G4', 'B4'),
      bounce('F4', 'A4', 'C5'),
      bounce('G4', 'B4', 'D5'),
      bounce('C4', 'E4', 'G4'),
      bounce('E4', 'G4', 'B4'),
      bounce('F4', 'A4', 'C5'),
      bounce('G4', 'B4', 'D5'),
      climb('A3', 'C4', 'E4', 'A4'),
      climb('F3', 'A3', 'C4', 'F4'),
      climb('C4', 'E4', 'G4', 'C5'),
      climb('G3', 'B3', 'D4', 'G4'),
      climb('A3', 'C4', 'E4', 'A4'),
      climb('F3', 'A3', 'C4', 'F4'),
      climb('C4', 'E4', 'G4', 'C5'),
      climb('G3', 'B3', 'D4', 'G4'),
    ].join(' | '),
    triangle: [
      // A walking bass: root and fifth, up to the octave, then a step towards the next chord.
      'C2:2 C2:2 G2:2 C3:2 G2:2 E2:2 D2:2 E2:2',
      'E2:2 E2:2 B2:2 E3:2 B2:2 G2:2 F2:2 E2:2',
      'F2:2 F2:2 C3:2 F3:2 C3:2 A2:2 G2:2 F#2:2',
      'G2:2 G2:2 D3:2 G3:2 D3:2 B2:2 A2:2 B2:2',
      'C2:2 C2:2 G2:2 C3:2 G2:2 E2:2 D2:2 E2:2',
      'E2:2 E2:2 B2:2 E3:2 B2:2 G2:2 F2:2 E2:2',
      'F2:2 F2:2 C3:2 F3:2 C3:2 A2:2 G2:2 F#2:2',
      'G2:2 G2:2 D3:2 G3:2 D3:2 B2:2 G2:2 G#2:2',
      'A2:2 A2:2 E3:2 A3:2 E3:2 C3:2 B2:2 G2:2',
      'F2:2 F2:2 C3:2 F3:2 C3:2 A2:2 B2:2 B2:2',
      'C3:2 C3:2 G3:2 C4:2 G3:2 E3:2 D3:2 D3:2',
      'G2:2 G2:2 D3:2 G3:2 D3:2 B2:2 G2:2 G#2:2',
      'A2:2 A2:2 E3:2 A3:2 E3:2 C3:2 B2:2 G2:2',
      'F2:2 F2:2 C3:2 F3:2 C3:2 A2:2 B2:2 B2:2',
      'C3:2 C3:2 G3:2 C4:2 G3:2 E3:2 D3:2 D3:2',
      'G2:2 G2:2 D3:2 G3:2 D3:2 B2:2 D3:2 B2:2',
    ].join(' | '),
    noise: [BEAT, BEAT, BEAT, BEAT, BEAT, BEAT, BEAT, FILL, DRIVE, DRIVE, DRIVE, DRIVE, DRIVE, DRIVE, DRIVE, FILL].join(' | '),
  },
};

/** How long one loop of the tune lasts. */
export function rickLoopSeconds(): number {
  return loopSeconds(RICK_SONG);
}

/** What sudo hands the app. */
export function rickView(touch: boolean): RickView {
  return { title: RICK_TITLE, alt: RICK_ALT, track: RICK_TRACK, framesFile: RICK_FRAMES, portraitFramesFile: RICK_FRAMES_PORTRAIT, song: RICK_SONG, touch };
}
