// sl's train, drawn for vesen: a steam locomotive, its tender and one carriage, heading left. The
// frames differ in the wheels' spokes, which turn, and the smoke, which drifts back over the
// train. sl hands them to the Train app (src/ui/apps/Train.svelte) through tty.fullscreen; in a
// pipe, or wherever no full-screen app can show, sl prints the first frame instead.

/** What sl hands the Train app. */
export interface TrainView {
  /** The frames, each the same number of rows. */
  readonly frames: readonly string[];
  /** The widest row of any frame, in columns. */
  readonly width: number;
  /** How the train sounds to a screen reader. */
  readonly label: string;
}

/** The Train app's result: it crossed the screen, a key or tap stopped it, or it stood still. */
export type TrainResult = 'crossed' | 'stopped' | 'still';

const SMOKE: readonly (readonly string[])[] = [
  ['              (  )    (   )     (    )', '          ( )   (  )    (   )', '       o  ()', '     .'],
  ['             (   )   (    )    (     )', '         ()  (  )   (   )', '      .  ( )', '     o'],
  ['            ( )   (   )   (    )   (   )', '        o  (  )  (  )', '      o  ()', '     .'],
];

const LOCOMOTIVE: readonly string[] = [
  '   _____                       ___________',
  '   \\___/      _               |  _______  |',
  '    | |______| |______________| |       | |',
  '   _| |______|_|______________| |_______| |',
  '  |                           |           |',
  '  | ()   ====== VESEN ======  |           |',
  '  |___________________________|___________|',
  ' /    ___     ___     ___         ___',
  '/__,_/(W)\\___/(W)\\___/(W)\\_______/(W)\\____',
];

const TENDER: readonly string[] = [
  '',
  ' _______________',
  '|_______________|',
  '|@@@@@@@@@@@@@@@|',
  '|               |',
  '|               |',
  '|_______________|',
  '   ___     ___',
  '__/(W)\\___/(W)\\__',
];

const CARRIAGE: readonly string[] = [
  '',
  ' ______________________',
  '|  __   __   __   __   |',
  '| |__| |__| |__| |__|  |',
  '|                      |',
  '|                      |',
  '|______________________|',
  '   ___            ___',
  '__/(W)\\__________/(W)\\__',
];

/** Between the vehicles: the couplings, on the row they meet. */
const COUPLING_ROW = 5;

/** The spokes, in the order they turn. */
const SPOKES = ['|', '/', '-', '\\'] as const;

/** How many frames make one turn of the wheels and one puff of the smoke. */
export const FRAME_COUNT = 12;

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** Frame `n`: the smoke for it, then the train with the spokes at their turn. */
export function trainFrame(n: number): string {
  const spoke = SPOKES[n % SPOKES.length] ?? '|';
  const smoke = SMOKE[n % SMOKE.length] ?? [];
  const width = (rows: readonly string[]): number => Math.max(...rows.map((row) => row.length));
  const rows = LOCOMOTIVE.map((row, r) => {
    const join = r === COUPLING_ROW ? '==' : '  ';
    return (pad(row, width(LOCOMOTIVE)) + join + pad(TENDER[r] ?? '', width(TENDER)) + join + (CARRIAGE[r] ?? '')).replace(/W/g, spoke).trimEnd();
  });
  return [...smoke, ...rows].join('\n');
}

/** Every frame, for the Train app. */
export function trainFrames(): string[] {
  return Array.from({ length: FRAME_COUNT }, (_, n) => trainFrame(n));
}

/** What a screen reader hears for the train printed standing still. */
export const STILL_LABEL = 'A steam train stands on the screen';

/** The train's view model. */
export function trainView(): TrainView {
  const frames = trainFrames();
  const width = Math.max(...frames.flatMap((frame) => frame.split('\n').map((row) => row.length)));
  return { frames, width, label: 'A steam train crosses the screen' };
}
