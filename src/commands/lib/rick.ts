// sudo's show, drawn and written for vesen: a singer in a long coat with a tall quiff dances with
// a microphone, side-stepping and swinging arms and hips, to an 8-bit tune of vesen's own. sudo
// hands both to the Rick app (src/ui/apps/Rick.svelte) through tty.fullscreen after the joke
// password prompt; the app draws the frames in theme colours and plays the song through Web Audio.
//
// The dancer is composed from sprites (hair, face, coat, arms, legs, microphone, floor), each with
// a colour role, placed a little differently in each frame, so every frame is the same size and
// every cell knows what it is. The tune is an original chiptune in the style of a handheld's sound
// chip: it quotes nothing.

import type { Role } from '../../output/model';
import { loopSeconds, type Song } from '../../lib/chiptune';

/** The size of every frame, in cells. */
export const FRAME_COLS = 24;
export const FRAME_ROWS = 14;

/** Frames a second: a sixteenth note at the song's tempo, so the steps land on the beat. */
export const RICK_FPS = (113 * 4) / 60;

/** The Rick app's result when it was closed, by whatever means. */
export const RICK_CLOSED = 'rickrolled';

/** The meme's name, which is the show's title. */
export const RICK_TITLE = 'You have been rickrolled';

/** How the dancer reads to a screen reader. */
export const RICK_ALT = 'A singer in a long coat with a tall quiff dances with a microphone, side-stepping and swinging their arms.';

/** A run of same-coloured cells in a frame row. */
export interface FrameSpan {
  readonly text: string;
  readonly role: Role;
}

export interface RickFrame {
  /** The frame as text, FRAME_ROWS rows of FRAME_COLS cells. */
  readonly text: string;
  /** Each row as coloured spans. */
  readonly rows: readonly (readonly FrameSpan[])[];
}

/** What sudo hands the Rick app. */
export interface RickView {
  readonly title: string;
  readonly alt: string;
  readonly frames: readonly RickFrame[];
  readonly fps: number;
  readonly song: Song;
  readonly touch: boolean;
}

// ── Sprites ────────────────────────────────────────────────────────────────────────────────

interface Sprite {
  readonly rows: readonly string[];
  readonly role: Role;
}

interface Placed {
  readonly sprite: Sprite;
  readonly x: number;
  readonly y: number;
}

const sprite = (role: Role, ...rows: string[]): Sprite => ({ rows, role });

/** The quiff: tall, swept up from the left temple to a curl at the top. Ten cells wide, like the face. */
const HAIR = sprite(
  'fg',
  "   _,.-=-.",
  " ,'_,-'  \\",
  "|,'      |",
);

/** The face, mouth closed, and singing. */
const FACE = sprite('fg-strong', '|  o  o  |', '|    L   |', ' \\__--__/ ');
const FACE_SINGING = sprite('fg-strong', '|  o  o  |', '|    L   |', ' \\__()__/ ');

/** The long coat: shoulders, lapels, and a hem below the hips. Fourteen cells wide. */
const COAT = sprite(
  'accent',
  " _.-'\\  /'-._ ",
  '|    \\  /    |',
  '|    |  |    |',
  '|    |__|    |',
  '|____|  |____|',
);

/** The shirt between the lapels: a collar and buttons. */
const SHIRT = sprite('fg', "''", '::');

/** The trousers and shoes: standing, and a foot planted out to the left or the right. */
const LEGS = sprite('fg', '|  |', '|  |');
const LEGS_LEFT = sprite('fg', '/  |', '   |');
const LEGS_RIGHT = sprite('fg', '|  \\', '|   ');
const SHOES = sprite('fg-strong', '_|  |_');
const SHOES_LEFT = sprite('fg-strong', '_/   |_');
const SHOES_RIGHT = sprite('fg-strong', '_|   \\_');

/** Sleeves swung out from the coat, and hands. */
const SLEEVE_OUT = sprite('accent', '--');
const SLEEVE_OUT_R = sprite('accent', '-');
const SLEEVE_UP_L = sprite('accent', ' \\', '\\ ');
const SLEEVE_UP_R = sprite('accent', '/');
const HAND_L = sprite('fg-strong', ')');
const HAND_R = sprite('fg-strong', '(');
/** The microphone: its head and its handle. */
const MIC = sprite('fg-strong', 'o', '|');
const MIC_FLAT = sprite('fg-strong', 'o');

/** The stage. */
const FLOOR = sprite('muted', '━'.repeat(FRAME_COLS));

// ── Composing ──────────────────────────────────────────────────────────────────────────────

/** Draws the placed sprites, in order, onto a blank frame. A sprite's spaces are transparent. */
export function compose(parts: readonly Placed[]): RickFrame {
  const cells: string[][] = Array.from({ length: FRAME_ROWS }, () => Array.from({ length: FRAME_COLS }, () => ' '));
  const roles: (Role | null)[][] = Array.from({ length: FRAME_ROWS }, () => Array.from({ length: FRAME_COLS }, () => null));
  for (const { sprite: part, x, y } of parts) {
    part.rows.forEach((row, dy) => {
      Array.from(row).forEach((ch, dx) => {
        const r = y + dy;
        const c = x + dx;
        if (ch === ' ' || r < 0 || r >= FRAME_ROWS || c < 0 || c >= FRAME_COLS) return;
        (cells[r] as string[])[c] = ch;
        (roles[r] as (Role | null)[])[c] = part.role;
      });
    });
  }
  const rows = cells.map((row, r) => {
    const spans: FrameSpan[] = [];
    row.forEach((ch, c) => {
      const role = roles[r]?.[c] ?? 'fg';
      const last = spans[spans.length - 1];
      if (last !== undefined && last.role === role) spans[spans.length - 1] = { text: last.text + ch, role };
      else spans.push({ text: ch, role });
    });
    return spans;
  });
  return { text: cells.map((row) => row.join('')).join('\n'), rows };
}

type LeftArm = 'down' | 'out' | 'up';
type RightArm = 'down' | 'out' | 'mic';
type Legs = 'stand' | 'left' | 'right';

interface Pose {
  /** Where the hips are, in columns from the frame's centre. */
  readonly hips: number;
  /** Where the head is, in columns from the frame's centre: the sway. */
  readonly head: number;
  readonly left: LeftArm;
  readonly right: RightArm;
  readonly legs: Legs;
  readonly singing: boolean;
}

/** The dancer in one pose. The coat is 14 columns wide, the head 10, the frame 24. */
export function dancer(pose: Pose): RickFrame {
  const body = 5 + pose.hips;
  const head = body + 2 + (pose.head - pose.hips);
  const parts: Placed[] = [{ sprite: FLOOR, x: 0, y: FRAME_ROWS - 1 }];
  // Legs and shoes under the coat's hem, a foot planted out when stepping.
  const legs = pose.legs === 'stand' ? LEGS : pose.legs === 'left' ? LEGS_LEFT : LEGS_RIGHT;
  parts.push({ sprite: legs, x: body + 5, y: 11 });
  if (pose.legs === 'stand') parts.push({ sprite: SHOES, x: body + 4, y: 12 });
  else if (pose.legs === 'left') parts.push({ sprite: SHOES_LEFT, x: body + 3, y: 12 });
  else parts.push({ sprite: SHOES_RIGHT, x: body + 4, y: 12 });
  parts.push({ sprite: COAT, x: body, y: 6 }, { sprite: SHIRT, x: body + 6, y: 7 });
  // The viewer's-left arm: a hand below the hem, swung out level, or raised.
  if (pose.left === 'down') parts.push({ sprite: HAND_L, x: body + 1, y: 11 });
  else if (pose.left === 'out') parts.push({ sprite: SLEEVE_OUT, x: body - 2, y: 7 }, { sprite: HAND_L, x: body - 3, y: 7 });
  else parts.push({ sprite: SLEEVE_UP_L, x: body - 2, y: 5 }, { sprite: HAND_L, x: body - 3, y: 4 });
  // The viewer's-right arm holds the microphone: hanging, swung out, or up beside the mouth.
  if (pose.right === 'down') parts.push({ sprite: HAND_R, x: body + 12, y: 11 }, { sprite: MIC, x: body + 13, y: 11 });
  else if (pose.right === 'out') parts.push({ sprite: SLEEVE_OUT_R, x: body + 14, y: 7 }, { sprite: HAND_R, x: body + 15, y: 7 }, { sprite: MIC_FLAT, x: body + 16, y: 7 });
  else parts.push({ sprite: SLEEVE_UP_R, x: body + 13, y: 6 }, { sprite: HAND_R, x: body + 12, y: 6 }, { sprite: MIC, x: body + 12, y: 4 });
  parts.push({ sprite: HAIR, x: head, y: 0 }, { sprite: pose.singing ? FACE_SINGING : FACE, x: head, y: 3 });
  return compose(parts);
}

/** The dance: two beats of side-steps, the hips swinging, the arms following, singing into the mic. */
const POSES: readonly Pose[] = [
  { hips: 0, head: 0, left: 'down', right: 'mic', legs: 'stand', singing: true },
  { hips: -1, head: -1, left: 'out', right: 'mic', legs: 'left', singing: true },
  { hips: -2, head: -2, left: 'up', right: 'out', legs: 'left', singing: false },
  { hips: -1, head: -2, left: 'down', right: 'out', legs: 'stand', singing: false },
  { hips: 0, head: 0, left: 'down', right: 'mic', legs: 'stand', singing: true },
  { hips: 1, head: 1, left: 'out', right: 'mic', legs: 'right', singing: true },
  { hips: 2, head: 2, left: 'up', right: 'out', legs: 'right', singing: false },
  { hips: 1, head: 2, left: 'down', right: 'down', legs: 'stand', singing: false },
];

let frames: readonly RickFrame[] | null = null;

/** The dancer's frames, drawn once. */
export function rickFrames(): readonly RickFrame[] {
  if (frames === null) frames = POSES.map(dancer);
  return frames;
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
  return { title: RICK_TITLE, alt: RICK_ALT, frames: rickFrames(), fps: RICK_FPS, song: RICK_SONG, touch };
}
