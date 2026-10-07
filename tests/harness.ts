// The command harness (docs/plan/designs/shell-architecture.md, "tests/harness.ts"): the app's
// shell over a fresh seed VFS, with every spec file and the kernel's stand-ins for commands not
// yet ported, a frozen clock and no storage. A line runs with stdout on the terminal (tty: true),
// as typed at the prompt, or into a pipe (tty: false), as `line | cat` would see it, at a given
// width. runLine gives a fresh session per line; session() keeps one for a transcript.

import { createAppShell, type AppShell } from '../src/app/shell';
import { lineText, type Block, type Line } from '../src/output/model';
import { plain } from '../src/output/plain';
import { createClock } from '../src/services/clock';
import { expandAliases } from '../src/shell/alias';
import { wrapText } from '../src/shell/help';
import { CaptureOut } from '../src/shell/streams';
import type { Clipboard, Opener, SysInfo } from '../src/services/types';
import { defineCommand, type CommandSpec, type FullscreenView, type InAppBrowser } from '../src/shell/types';
import { createScreen } from '../src/stores/screen';
import { screenText, stubCommands } from '../src/testing/shell-harness';

/** 2026-10-06 09:00 UTC, which is 20:00 in Sydney. */
export const FROZEN_NOW = Date.UTC(2026, 9, 6, 9, 0, 0);
export const TIME_ZONE = 'Australia/Sydney';

export interface RunOptions {
  /** The terminal's width in columns; 80 by default. */
  readonly cols?: number;
  /** stdout is the terminal (true, the default) or a pipe (false). */
  readonly tty?: boolean;
  /** Answers tty.readLine, as a visitor typing at a prompt; null is ^D. */
  readonly answer?: (prompt: string) => string | null;
  /** The in-app browser the terminal is in; none by default. */
  readonly inApp?: InAppBrowser | null;
  /** A touch screen; false by default. */
  readonly touch?: boolean;
  /** Links under a policy; without one nothing opens and tty.open says 'card'. */
  readonly opener?: Opener;
  /** The clipboard tty.copy writes to; without one every copy fails. */
  readonly clipboard?: Clipboard;
  /** Shows a full-screen app, as AppHost would, and closes it with a result. */
  readonly fullscreen?: (view: FullscreenView, props: unknown) => Promise<unknown>;
  /** The system facts; none by default, as with no page to read them from. */
  readonly sys?: SysInfo;
}

export interface LineResult {
  readonly status: number;
  /** What stdout received, as plain text. */
  readonly stdoutPlain: string;
  readonly stderrPlain: string;
  /** On a terminal, the blocks it drew; in a pipe, none. */
  readonly blocks: readonly Block[];
  /** The prompts tty.readLine was asked to show. */
  readonly prompts: readonly string[];
  /** Everything written, in order, as rows of text: stderr rows start with `! ` (renderScreen). */
  readonly screen: readonly string[];
}

/** A capture that also logs what it is given, in order with the other stream. */
class Tap extends CaptureOut {
  constructor(
    columns: number,
    private readonly log: { stream: 'stdout' | 'stderr'; text: string }[],
    private readonly stream: 'stdout' | 'stderr',
  ) {
    super(columns);
  }

  override write(text: string): Promise<void> {
    this.log.push({ stream: this.stream, text });
    return super.write(text);
  }
}

/** Two streams' writes as rows, in the order they were written; stderr rows start with `! `. */
function interleave(log: readonly { stream: 'stdout' | 'stderr'; text: string }[]): string[] {
  const rows: string[] = [];
  const open: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
  const mark = (stream: 'stdout' | 'stderr', row: string): string => (stream === 'stderr' ? `! ${row}` : row);
  for (const { stream, text } of log) {
    const pieces = (open[stream] + text).split('\n');
    open[stream] = pieces.pop() ?? '';
    for (const piece of pieces) rows.push(mark(stream, piece));
  }
  for (const stream of ['stdout', 'stderr'] as const) if (open[stream] !== '') rows.push(mark(stream, open[stream]));
  return rows;
}

export interface Session {
  readonly app: AppShell;
  run(line: string): Promise<LineResult>;
  stop(): void;
}

/** A session over a fresh seed: the spec files, plus stand-ins for what is not ported yet. */
export async function session(options: RunOptions = {}): Promise<Session> {
  const cols = options.cols ?? 80;
  const tty = options.tty ?? true;
  const prompts: string[] = [];
  let piped: { line: string; out: Tap; err: Tap } | null = null;

  // Runs the pending line with stdout and stderr captured, as a pipe and a file would take them.
  const capture = defineCommand({
    name: '__capture',
    category: 'shell',
    summary: 'run a line into a pipe',
    hidden: true,
    builtin: true,
    run: (ctx) => {
      if (piped === null) return 0;
      return ctx.shell.exec(expandAliases(piped.line, ctx.shell.aliases).line, { stdout: piped.out, stderr: piped.err });
    },
  });
  const specs: CommandSpec[] = [...stubCommands(), capture];
  let now = FROZEN_NOW;
  const app = createAppShell({
    banner: () => '',
    specs,
    screen: createScreen(),
    version: '0.0.0-test',
    clock: createClock({ now: () => now, random: () => 0.5, timeZone: TIME_ZONE }),
    terminal: {
      size: () => ({ cols, rows: 24 }),
      touch: options.touch ?? false,
      inApp: options.inApp ?? null,
      readLine: ({ prompt }) => {
        prompts.push(prompt);
        return Promise.resolve(options.answer?.(prompt) ?? null);
      },
      ...(options.fullscreen === undefined ? {} : { fullscreen: options.fullscreen }),
    },
    ...(options.opener === undefined ? {} : { opener: options.opener }),
    ...(options.clipboard === undefined ? {} : { clipboard: options.clipboard }),
    ...(options.sys === undefined ? {} : { sys: options.sys }),
    yieldToHost: () => Promise.resolve(),
  });
  await app.boot();

  return {
    app,
    async run(line) {
      prompts.length = 0;
      // A minute passes between lines, so new files are newer than the seed's.
      now += 60_000;
      if (tty) {
        const result = await app.shell.run(line);
        return {
          status: result.status,
          stdoutPlain: screenText(result.blocks, 'stdout'),
          stderrPlain: screenText(result.blocks, 'stderr'),
          blocks: result.blocks,
          prompts: [...prompts],
          screen: renderScreen(result.blocks, cols),
        };
      }
      app.shell.remember(line);
      const log: { stream: 'stdout' | 'stderr'; text: string }[] = [];
      piped = { line, out: new Tap(cols, log, 'stdout'), err: new Tap(cols, log, 'stderr') };
      const { out, err } = piped;
      const result = await app.shell.run('__capture', 'boot');
      piped = null;
      return {
        status: result.status,
        stdoutPlain: out.text.replace(/\n$/, ''),
        stderrPlain: err.text.replace(/\n$/, ''),
        blocks: [],
        prompts: [...prompts],
        screen: interleave(log),
      };
    },
    stop: () => app.stop(),
  };
}

/** Runs one line in a fresh session. */
export async function runLine(line: string, options: RunOptions = {}): Promise<LineResult> {
  const fresh = await session(options);
  try {
    return await fresh.run(line);
  } finally {
    fresh.stop();
  }
}

// ── Drawing the screen as text ─────────────────────────────────────────────────────────────

function widthOf(text: string): number {
  return Array.from(text).length;
}

/**
 * A grid as the terminal lays it out at `cols`: as many columns of the widest item plus two as
 * fit, filled row by row, as CSS's repeat(auto-fill) fills them, or with `byColumn` each column
 * top to bottom with the rows balanced, as ls -C (and CSS columns) fill them. With notes, as
 * RichBlock draws them: each column shares out the width, and in each cell the item has a column
 * as wide as the widest item, then a two-cell gap and the note, wrapped to what is left less a
 * two-cell margin.
 */
function gridRows(names: readonly string[], cols: number, minCh?: number, notes?: readonly string[], byColumn = false): string[] {
  if (names.length === 0) return [];
  if (notes === undefined) {
    const column = minCh ?? Math.max(...names.map(widthOf)) + 2;
    const perRow = Math.max(1, Math.floor(cols / column));
    const height = Math.ceil(names.length / perRow);
    const pad = (item: string): string => item + ' '.repeat(Math.max(0, column - widthOf(item)));
    const rows: string[] = [];
    if (byColumn) {
      for (let r = 0; r < height; r += 1) {
        const row: string[] = [];
        for (let i = r; i < names.length; i += height) row.push(pad(names[i] ?? ''));
        rows.push(row.join('').trimEnd());
      }
      return rows;
    }
    for (let i = 0; i < names.length; i += perRow) rows.push(names.slice(i, i + perRow).map(pad).join('').trimEnd());
    return rows;
  }
  const itemWidth = Math.max(...names.map(widthOf));
  const perRow = Math.max(1, Math.floor(cols / (minCh ?? itemWidth + 2)));
  const columnWidth = Math.floor(cols / perRow);
  const noteWidth = Math.max(1, columnWidth - itemWidth - 4);
  const cells = names.map((name, i) =>
    wrapText(notes[i] ?? '', noteWidth).map((row, r) => `${r === 0 ? name : ''}${' '.repeat(itemWidth - (r === 0 ? widthOf(name) : 0))}  ${row}`),
  );
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += perRow) {
    const group = cells.slice(i, i + perRow);
    const height = Math.max(...group.map((cell) => cell.length));
    for (let r = 0; r < height; r += 1) {
      rows.push(group.map((cell) => (cell[r] ?? '').padEnd(columnWidth)).join('').trimEnd());
    }
  }
  return rows;
}

/**
 * What the terminal shows for some blocks at `cols` columns, as text: stderr lines marked with
 * `! `, grids laid out in columns, panels as their title and body, everything else as plain().
 */
export function renderScreen(blocks: readonly Block[], cols: number): string[] {
  const rows: string[] = [];
  const text = (line: Line): string => lineText(line);
  for (const block of blocks) {
    switch (block.type) {
      case 'lines':
        for (const line of block.lines) rows.push(block.stream === 'stderr' ? `! ${text(line)}` : text(line));
        break;
      case 'grid':
        rows.push(...gridRows(block.items.map((item) => item.text), cols, block.minCh, block.notes?.map(text), block.order === 'columns'));
        break;
      case 'panel':
        if (block.title !== undefined) rows.push(`[${block.title}]`);
        for (const line of block.body) rows.push(`  ${text(line)}`.trimEnd());
        break;
      default:
        rows.push(...plain(block).replace(/\n$/, '').split('\n'));
    }
  }
  return rows;
}
