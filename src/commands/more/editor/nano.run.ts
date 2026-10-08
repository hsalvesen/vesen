// The body of nano, which vi and vim open too. It reads the file, hands the editor its text and a
// way to write it back (src/lib/nano.ts), and waits for the visitor to leave.

import { countLines, EDITOR_CLOSED, linesMessage, type EditorView, type SaveResult } from '../../../lib/nano';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { strerror } from '../../../vfs/errors';
import { VfsError } from '../../../vfs/types';
import { keepBuffer, keptBuffer } from '../../lib/nano-keep';

/** What --help, help and man say about nano, besides its spec (nano.ts). */
export const doc: CommandDoc = {
  description:
    "Edits FILE, or a new buffer with none, full screen. Type as in any text box. ^O writes the buffer out, asking for the file name; ^S saves under the current name; ^X leaves, asking 'Save modified buffer?' when there are changes. ^W (or ^F) finds text, ^K cuts the line the caret is on and ^U pastes it back, ^C says where the caret is, and ^G lists the keys. A ^ means Ctrl. On a touch screen, buttons along the bottom save, leave, find, cut and paste. A FILE that does not exist yet is made when it is first saved, and +LINE,COLUMN puts the caret there to begin with.",
  man: [
    {
      heading: 'FILES',
      body: "nano writes with your permissions: a file you cannot change, such as /etc/hostname, opens with a warning, and saving it says [ File is unwritable ]. What you save under ~ is kept in this browser, as other files are. Saving adds a newline at the end of the file if it has none, as nano does.",
    },
    {
      heading: 'BACK AND UNSAVED CHANGES',
      body: "The browser's Back leaves nano as ^X does: with changes it asks 'Save modified buffer?', and asks again at each Back until Y, N or ^C answers. Meanwhile, and whenever the page is put away with changes, the buffer is kept in this browser, as nano writes FILE.save when it is stopped, so a Back that leaves vesen loses nothing: the next nano of that file asks 'Restore unsaved changes from before?'. Saving or discarding the buffer forgets it, as do reset and 30 days.",
    },
    { heading: 'EXIT STATUS', body: "0 when nano opened, whether or not anything was saved; 1 when it could not." },
  ],
};

/** The operands: an optional +LINE[,COLUMN], then at most one FILE. */
export function readOperands(args: readonly string[]): { file: string | null; line?: number; column?: number } | { error: string } {
  let file: string | null = null;
  let line: number | undefined;
  let column: number | undefined;
  for (const arg of args) {
    const position = /^\+(\d*)(?:,(\d*))?$/.exec(arg);
    if (position !== null && file === null && line === undefined) {
      line = position[1] === '' || position[1] === undefined ? undefined : Number(position[1]);
      column = position[2] === '' || position[2] === undefined ? undefined : Number(position[2]);
      continue;
    }
    if (file !== null) return { error: 'one FILE at a time' };
    file = arg;
  }
  return {
    file,
    ...(line === undefined || line < 1 ? {} : { line }),
    ...(column === undefined || column < 1 ? {} : { column }),
  };
}

/** Writes the buffer as the visitor, with nano's words for what happened; never throws. */
export function saveAs(ctx: CommandContext, name: string, text: string): SaveResult {
  try {
    ctx.fs.writeFile(ctx.resolve(name), text);
    return { ok: true, name, message: linesMessage('Wrote', countLines(text)) };
  } catch (error) {
    if (!(error instanceof VfsError)) return { ok: false, message: `[ Error writing ${name} ]` };
    if (error.code === 'EACCES' || error.code === 'EPERM') return { ok: false, message: '[ File is unwritable ]' };
    return { ok: false, message: `[ Error writing ${name}: ${strerror(error.code)} ]` };
  }
}

/** The file's text and the status line nano opens with; an error for a folder. */
function open(ctx: CommandContext, name: string): { text: string; message: string } | { error: string } {
  const path = ctx.resolve(name);
  try {
    if (ctx.fs.stat(path).type === 'directory') return { error: `${name}: Is a directory` };
    const text = ctx.fs.readFile(path);
    const message = ctx.fs.access(path, 'w') ? linesMessage('Read', countLines(text)) : `[ File '${name}' is unwritable ]`;
    return { text, message };
  } catch (error) {
    if (!(error instanceof VfsError)) throw error;
    if (error.code === 'ENOENT') return { text: '', message: '[ New File ]' };
    if (error.code === 'EISDIR') return { error: `${name}: Is a directory` };
    return { text: '', message: `[ Error reading ${name}: ${strerror(error.code)} ]` };
  }
}

/** nano, and vi and vim after their note: the editor until the visitor leaves it. */
export async function edit(ctx: CommandContext): Promise<ExitCode> {
  const operands = readOperands(ctx.args);
  if ('error' in operands) return ctx.usage(operands.error);
  const opened = operands.file === null ? { text: '', message: '' } : open(ctx, operands.file);
  if ('error' in opened) return ctx.fail(opened.error);
  // A buffer kept when Back or leaving the page might have lost it ('' is one with no name).
  const keptAs = (name: string | null): string => (name === null ? '' : ctx.resolve(name));
  let kept = keptBuffer(keptAs(operands.file), ctx.clock.now());
  if (kept === opened.text) {
    keepBuffer(keptAs(operands.file), null, ctx.clock.now());
    kept = null;
  }
  const view: EditorView = {
    name: operands.file,
    text: opened.text,
    message: opened.message,
    touch: ctx.tty.touch,
    ...(operands.line === undefined ? {} : { line: operands.line }),
    ...(operands.column === undefined ? {} : { column: operands.column }),
    save: (name, text) => saveAs(ctx, name, text),
    ...(kept === null ? {} : { kept }),
    keep: (name, text) => keepBuffer(keptAs(name), text, ctx.clock.now()),
  };
  let result: unknown;
  try {
    result = await ctx.tty.fullscreen<unknown>('editor', view);
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return ctx.fail('the editor needs the terminal');
  }
  return result === EDITOR_CLOSED ? 0 : ctx.fail('the editor could not be opened');
}

export function run(ctx: CommandContext): Promise<ExitCode> {
  return edit(ctx);
}
