// The animals cowsay and cowthink draw, and the speech bubble above them. Every animal is drawn
// for vesen, after the themes' names: a cow of its own, then a kangaroo, a cassowary, a
// kookaburra, a wombat and a crocodile. Loaded only with cowsay's body, never with the catalogue.
//
// In the art, `$t` is the bubble's trail (`\` for speech, `o` for thought), `$L` and `$R` the left
// and right eye, and `$T` the two characters of the tongue. An animal drawn side-on shows only
// its left eye.

import { textWidth } from '../../output/model';

/** One animal: its art, and what it says when given nothing to say. */
export interface Cow {
  readonly name: string;
  readonly art: string;
  /** Said when there is no message and nothing piped in. */
  readonly greeting: string;
}

/** The art without its first and last line break, so each can start on a line of its own. */
function art(raw: string): string {
  return raw.replace(/^\n/, '').replace(/\n$/, '');
}

export const COWS: readonly Cow[] = [
  {
    name: 'cow',
    greeting: 'Moo.',
    art: art(String.raw`
  $t
   $t   ._                 _.
    $t   \'-.__        __.-'/
          '-._ '-.__.-' _.-'
        .----./        \.----.
         '--.|  $L    $R  |.--'
             |            |
              \  ______  /
               |/      \|
               ( ()  () )
                \__$T__/
`),
  },
  {
    name: 'kangaroo',
    greeting: "G'day.",
    art: art(String.raw`
  $t
   $t     /|  /|
    $t   / | / |
        /  $L    \
       <__        \
          '-$T-.   \
               /    \
              /  .-. \
          ,-./  (oo)  \
          '-'|   '-'   \
             |          \___
              \   ___       '-._
               \_/   \__        '-._
               /_/   /__/           '-.
`),
  },
  {
    name: 'cassowary',
    greeting: 'Boom. Boom.',
    art: art(String.raw`
  $t
   $t      __
    $t    (  \
         /$L  |
        <_    |
          \$T |
          (_)(_)
           |  |    ________
           |   \__/ /////  \
            \ ///////////// \
             \\\\\\\\\\\\\\\/
               '----------'
                 |    |
                /|   /|
               '-'  '-'
`),
  },
  {
    name: 'kookaburra',
    greeting: 'Ha ha ha ha!',
    art: art(String.raw`
  $t
   $t
    $t        ___
          .-''   ''-.
    <=====(  $L  ~~~  \
     '====._ $T        |
            \          |\
             |  .---.  | \
             | (     ) |  \
             |  '---'  |\  \
              \       /  \  \
               '.___.'    \  \
          ======##===##======
                ''   ''
`),
  },
  {
    name: 'wombat',
    greeting: 'Hrrm.',
    art: art(String.raw`
  $t
   $t   _      _
    $t ( '-..-' )
      /  $L  $R  \_________
     |     __     |        '-.
      \   (__)   /            \
       '-.$T.-'               |
          |  |   ______  |   /
          |__|__/      \_|__/   []
`),
  },
  {
    name: 'crocodile',
    greeting: 'Snap.',
    art: art(String.raw`
  $t
   $t     $L $R
    $t  _(_)(_)__________
    .-' ^^^ ^^^ ^^^ ^^ '--.__
   /v v v v v               '-.__
   \^ ^ ^ ^ ^$T  ____   ____      '->
    '--------'   \_\ \  \_\ \
`),
  },
];

/** The animals' names, as `cowsay -l` lists them and `-f` takes them. */
export const COW_NAMES: readonly string[] = COWS.map((cow) => cow.name);

/** The animal of that name, ignoring case, or undefined. */
export function findCow(name: string): Cow | undefined {
  const wanted = name.toLowerCase();
  return COWS.find((cow) => cow.name === wanted);
}

/** The eyes and tongue, as `-e`, `-T` and the mood flags leave them. */
export interface Face {
  /** Two characters: the left eye, then the right. */
  readonly eyes: string;
  /** Two characters; spaces when the tongue is in. */
  readonly tongue: string;
}

export const DEFAULT_FACE: Face = { eyes: 'oo', tongue: '  ' };

/** The mood flags: each sets the eyes, and a couple the tongue, over -e and -T. */
export const MOODS: Readonly<Record<string, Partial<Face>>> = {
  borg: { eyes: '==' },
  dead: { eyes: 'xx', tongue: 'U ' },
  greedy: { eyes: '$$' },
  paranoid: { eyes: '@@' },
  stoned: { eyes: '**', tongue: 'U ' },
  tired: { eyes: '--' },
  wired: { eyes: 'OO' },
  youthful: { eyes: '..' },
};

/** The first two characters of `text`, padded with spaces, with no control characters. */
export function twoChars(text: string): string {
  const chars = Array.from(text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ''));
  return `${chars[0] ?? ' '}${chars[1] ?? ' '}`;
}

/** The animal's art with the face and the bubble's trail filled in. */
export function drawCow(cow: Cow, face: Face, think: boolean): string {
  const [left = ' ', right = ' '] = Array.from(twoChars(face.eyes));
  const values: Readonly<Record<string, string>> = { t: think ? 'o' : '\\', L: left, R: right, T: twoChars(face.tongue) };
  return cow.art.replace(/\$([tLRT])/g, (_match, key: string) => values[key] ?? '');
}

/** Tabs to the next multiple of eight columns, as a terminal shows them. */
export function expandTabs(line: string): string {
  if (!line.includes('\t')) return line;
  let out = '';
  for (const ch of line) {
    if (ch === '\t') out += ' '.repeat(8 - (textWidth(out) % 8));
    else out += ch;
  }
  return out;
}

/** `text` cut into pieces of at most `width` cells, by whole characters. */
function chop(text: string, width: number): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const ch of text) {
    if (piece !== '' && textWidth(piece + ch) > width) {
      pieces.push(piece);
      piece = '';
    }
    piece += ch;
  }
  if (piece !== '') pieces.push(piece);
  return pieces;
}

/** One paragraph's words in lines of at most `width` cells; a longer word is cut. */
function fill(words: readonly string[], width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    for (const piece of textWidth(word) > width ? chop(word, width) : [word]) {
      if (line === '') line = piece;
      else if (textWidth(`${line} ${piece}`) <= width) line += ` ${piece}`;
      else {
        lines.push(line);
        line = piece;
      }
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/**
 * The message as the bubble's lines. Wrapped, each paragraph (lines between blank lines) is
 * filled to lines shorter than `wrapAt` columns, as cowsay fills its text; a blank line between
 * paragraphs stays. Unwrapped (-n), every line is kept as it is.
 */
export function messageLines(message: string, options: { readonly wrapAt: number; readonly wrap: boolean }): string[] {
  const rows = message.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map(expandTabs);
  if (!options.wrap) return rows.map((row) => row.trimEnd());
  const width = Math.max(1, options.wrapAt - 1);
  const lines: string[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) lines.push(...fill(paragraph, width));
    paragraph = [];
  };
  for (const row of rows) {
    const words = row.split(/\s+/).filter((word) => word !== '');
    if (words.length === 0) {
      flush();
      if (lines.length > 0) lines.push('');
    } else paragraph.push(...words);
  }
  flush();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * The bubble around `lines`: a single line in `< >`, several in `/ \`, `| |` and `\ /`; a
 * thought is always in `( )`.
 */
export function bubble(lines: readonly string[], think: boolean): string[] {
  const body = lines.length === 0 ? [''] : lines;
  const width = Math.max(0, ...body.map((line) => textWidth(line)));
  const last = body.length - 1;
  const sides = (i: number): [string, string] => {
    if (think) return ['(', ')'];
    if (last === 0) return ['<', '>'];
    if (i === 0) return ['/', '\\'];
    return i === last ? ['\\', '/'] : ['|', '|'];
  };
  return [
    ` ${'_'.repeat(width + 2)}`,
    ...body.map((line, i) => {
      const [open, shut] = sides(i);
      return `${open} ${line}${' '.repeat(width - textWidth(line))} ${shut}`;
    }),
    ` ${'-'.repeat(width + 2)}`,
  ];
}

/** The whole picture: the bubble, then the animal. */
export function cowsay(message: string, options: { readonly cow: Cow; readonly face: Face; readonly think: boolean; readonly wrapAt: number; readonly wrap: boolean }): string {
  const lines = messageLines(message, options);
  return [...bubble(lines, options.think), drawCow(options.cow, options.face, options.think)].join('\n');
}
