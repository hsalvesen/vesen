// What less, more and man share: text turned into the pager's lines with a cap, so `yes | less`
// ends and a huge file cannot fill the page, and the pager itself (src/ui/apps/Pager.svelte,
// through ctx.tty.fullscreen) wherever the terminal can show it. Where it cannot (a pipe, a
// script, a screen that did not load) the caller prints the lines instead, as less does when its
// output is not a terminal.

import { PAGER_CLOSED, type PagerMode, type PagerView } from '../../lib/pager';
import type { Block, Line } from '../../output/model';
import { plain } from '../../output/plain';
import { parseSgr } from '../../output/sgr';
import type { CommandContext } from '../../shell/types';

/** The most lines the pager is given; the rest is left out, with a note saying so. */
export const MAX_PAGER_LINES = 5000;
/** The most text read for it, in UTF-16 units: half a megabyte, the file system's whole quota. */
export const MAX_PAGER_CHARS = 512 * 1024;

export interface PagerText {
  readonly lines: readonly Line[];
  /** Why some of the text was left out, for the status line; absent when nothing was. */
  readonly note?: string;
}

export function capNote(lines: number): string {
  return `Only the first ${lines.toLocaleString('en-US')} lines are shown.`;
}

/** Lines cut down to MAX_PAGER_LINES, with the note when any were left out. */
export function capLines(lines: readonly Line[], cut = false): PagerText {
  if (lines.length > MAX_PAGER_LINES) return { lines: lines.slice(0, MAX_PAGER_LINES), note: capNote(MAX_PAGER_LINES) };
  return cut ? { lines, note: capNote(lines.length) } : { lines };
}

/** Text, its colours kept (less -R), as the pager's lines. */
export function textLines(text: string): Line[] {
  return parseSgr(text).lines;
}

/**
 * Standard input, read until it ends or the cap is reached; then it is closed, so the writer
 * before the pipe stops (`yes | less`). `cut` says the cap was reached.
 */
export async function readCapped(ctx: CommandContext): Promise<{ text: string; cut: boolean }> {
  let text = '';
  let lines = 0;
  for await (const chunk of ctx.stdin.chunks()) {
    text += chunk;
    for (let at = chunk.indexOf('\n'); at !== -1; at = chunk.indexOf('\n', at + 1)) lines += 1;
    if (text.length >= MAX_PAGER_CHARS || lines >= MAX_PAGER_LINES) {
      ctx.stdin.close();
      return { text: text.slice(0, MAX_PAGER_CHARS), cut: true };
    }
  }
  return { text, cut: false };
}

/** The lines a command's blocks show: lines blocks as they are, anything else as its plain text. */
export function blockLines(blocks: readonly Block[]): Line[] {
  const lines: Line[] = [];
  for (const block of blocks) {
    if (block.type === 'lines') lines.push(...block.lines);
    else lines.push(...plain(block).replace(/\n$/, '').split('\n').map((text): Line => [{ text }]));
  }
  return lines;
}

export interface PagerRequest extends PagerText {
  readonly title: string;
  readonly mode?: PagerMode;
  readonly numbers?: boolean;
  readonly ignoreCase?: boolean;
}

/**
 * Shows lines in the pager until the visitor closes it. True when they did; false when the pager
 * could not show here (stdout is not the terminal, the line came from a script, or its screen did
 * not load), and the caller should print the lines instead. ^C ends the command as usual.
 */
export async function showPager(ctx: CommandContext, request: PagerRequest): Promise<boolean> {
  if (!ctx.stdout.isTTY || ctx.signal.aborted) return false;
  const view: PagerView = {
    title: request.title,
    lines: request.lines,
    mode: request.mode ?? 'less',
    touch: ctx.tty.touch,
    columns: ctx.tty.columns,
    rows: ctx.tty.rows,
    ...(request.numbers === true ? { numbers: true } : {}),
    ...(request.ignoreCase === true ? { ignoreCase: true } : {}),
    ...(request.note === undefined ? {} : { note: request.note }),
  };
  try {
    return (await ctx.tty.fullscreen<unknown>('pager', view)) === PAGER_CLOSED;
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return false;
  }
}

/** Prints lines on the terminal, as the pager would have shown them, and the note after them. */
export async function printLines(ctx: CommandContext, text: PagerText): Promise<void> {
  for (const line of text.lines) await ctx.stdout.line(...line);
  if (text.note !== undefined) await ctx.stderr.line({ text: text.note, style: { fg: 'muted' } });
}

/** man: its pages in the pager on a terminal; false when they should be printed instead. */
export function pageBlocks(ctx: CommandContext, title: string, pages: readonly (readonly Block[])[]): Promise<boolean> {
  const lines: Line[] = [];
  pages.forEach((blocks, i) => {
    if (i > 0) lines.push([]);
    lines.push(...blockLines(blocks));
  });
  return showPager(ctx, { title, ...capLines(lines) });
}
