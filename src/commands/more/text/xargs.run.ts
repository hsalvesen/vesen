// The body of xargs; its spec, in xargs.ts, loads this the first time xargs runs. Each command
// line it builds runs through the shell (ctx.shell.exec), with its arguments quoted so they reach
// the command exactly as read, and with nothing on its standard input, as GNU xargs gives it.

import { StringIn } from '../../../shell/streams';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { reason } from '../../lib/files';
import { inputRecords, optOn, optString, pacer, quoted, splitChunks, type Rec } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    'Reads items from standard input, separated by blanks (which can be protected with double or single quotes or a backslash) or new lines, and runs COMMAND (echo by default) with INITIAL-ARGS and then as many items as fit, or -n of them; as many times as needed to use every item. Without -r, COMMAND runs once even when there are no items. With -I R, each input line is one item, and R is replaced by it wherever it appears in INITIAL-ARGS.',
  man: [
    {
      heading: 'EXIT STATUS',
      body: '0 when every command succeeded; 123 when any exited with a status from 1 to 125; 124 when one exited with 255; 125 when one was stopped by a signal, such as a closed pipe; 126 when COMMAND cannot be run; 127 when it is not found; 1 for any other error.',
    },
  ],
};

/** The longest command line built from items before it runs, in characters. */
const MAX_CHARS = 128 * 1024;

/** A word quoted so the shell reads it back exactly: never an assignment, a glob or a `~`. */
export function shellWord(word: string): string {
  if (/^[\w@%+:,./-]+$/.test(word)) return word;
  return `'${word.replace(/'/g, "'\\''")}'`;
}

class InputError extends Error {}

/** Splits one line into items the way xargs does by default: blanks, quotes and backslashes. */
export function splitItems(line: string): string[] {
  const items: string[] = [];
  let item = '';
  let has = false;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charAt(i);
    if (quote !== null) {
      if (c === quote) quote = null;
      else item += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
      continue;
    }
    if (c === '\\' && i + 1 < line.length) {
      item += line.charAt(i + 1);
      has = true;
      i += 1;
      continue;
    }
    if (c === ' ' || c === '\t') {
      if (has) items.push(item);
      item = '';
      has = false;
      continue;
    }
    item += c;
    has = true;
  }
  if (quote !== null) {
    throw new InputError(`unmatched ${quote === '"' ? 'double' : 'single'} quote; by default quotes are special to xargs unless you use the -0 option`);
  }
  if (has) items.push(item);
  return items;
}

/** -d's CHARACTER: one character, or an escape such as \n, \t, \0 or \x41. */
function readDelimiter(text: string): string | null {
  const named: Record<string, string> = { '\\n': '\n', '\\t': '\t', '\\0': '\0', '\\\\': '\\', '\\a': '\x07', '\\b': '\b', '\\f': '\f', '\\r': '\r', '\\v': '\v' };
  if (named[text] !== undefined) return named[text] ?? null;
  const hex = /^\\x([0-9a-fA-F]{1,2})$/.exec(text);
  if (hex !== null) return String.fromCharCode(parseInt(hex[1] ?? '0', 16));
  const octal = /^\\([0-7]{1,3})$/.exec(text);
  if (octal !== null) return String.fromCharCode(parseInt(octal[1] ?? '0', 8));
  return Array.from(text).length === 1 ? text : null;
}

/** True when `name` can be run: a command, or a program at a path. */
async function runnable(ctx: CommandContext, name: string): Promise<boolean> {
  if (name.includes('/')) {
    const path = ctx.resolve(name);
    return ctx.fs.exists(path);
  }
  const registry = ctx.shell.registry;
  if (registry.get(name) !== undefined) return true;
  await registry.whenComplete();
  return registry.get(name) !== undefined;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const command = ctx.args.length > 0 ? [...ctx.args] : ['echo'];
  const name = command[0] ?? 'echo';
  const replace = optString(ctx, 'replace');
  const maxArgs = ctx.opts['max-args'] === undefined ? null : Number(ctx.opts['max-args']);
  const maxLines = replace !== undefined ? 1 : ctx.opts['max-lines'] === undefined ? null : Number(ctx.opts['max-lines']);
  if (maxArgs !== null && maxArgs <= 0) return ctx.fail(`value ${maxArgs} for -n option should be >= 1`);
  if (maxLines !== null && maxLines <= 0) return ctx.fail(`value ${maxLines} for -L option should be >= 1`);
  const delimOpt = optString(ctx, 'delimiter');
  const delim = optOn(ctx, 'null') ? '\0' : delimOpt === undefined ? null : readDelimiter(delimOpt);
  if (delimOpt !== undefined && delim === null) return ctx.fail(`invalid input delimiter specification ${delimOpt}: the delimiter must be either a single character or an escape sequence starting with \\.`);

  if (!(await runnable(ctx, name))) return ctx.fail(`${name}: No such file or directory`, 127);

  // Where the items come from.
  let records: AsyncIterable<Rec>;
  const argFile = optString(ctx, 'arg-file');
  if (argFile !== undefined) {
    let text: string;
    try {
      text = ctx.fs.readFile(ctx.resolve(argFile));
    } catch (error) {
      return ctx.fail(`Cannot open input file ${quoted(argFile)}: ${reason(error)}`);
    }
    records = splitChunks(ctx, [text], delim ?? '\n');
  } else {
    records = delim === null ? inputRecords(ctx) : splitChunks(ctx, ctx.stdin.chunks(), delim);
  }

  const breathe = pacer(ctx);
  let worst = 0;
  let ran = false;
  const execute = async (items: readonly string[]): Promise<ExitCode | null> => {
    ran = true;
    const words = replace !== undefined ? command.map((word) => word.split(replace).join(items[0] ?? '')) : [...command, ...items];
    if (optOn(ctx, 'verbose')) await ctx.stderr.write(`${words.join(' ')}\n`);
    const status = await ctx.shell.exec(words.map(shellWord).join(' '), { stdin: new StringIn(''), stdout: ctx.stdout, stderr: ctx.stderr });
    if (ctx.signal.aborted) throw ctx.signal.reason;
    if (status === 255) {
      await ctx.fail(`${name}: exited with status 255; aborting`);
      return 124;
    }
    if (status === 141 || status === 130) {
      await ctx.fail(`${name}: terminated by signal ${status - 128}`);
      return 125;
    }
    if (status === 126 || status === 127) return status;
    if (status !== 0) worst = 123;
    await breathe();
    return null;
  };

  const base = command.reduce((sum, word) => sum + word.length + 1, 0);
  let batch: string[] = [];
  let chars = 0;
  let lines = 0;
  try {
    for await (const record of records) {
      let items: string[];
      if (replace !== undefined) {
        const line = delim === null ? record.text.replace(/^[ \t]+/, '') : record.text;
        items = line === '' ? [] : [line];
      } else if (delim !== null) {
        items = [record.text];
      } else {
        items = splitItems(record.text);
      }
      if (items.length === 0) continue;
      for (const item of items) {
        // An item that cannot fit on a command line even alone ends xargs, as GNU's does.
        if (base + item.length + 1 > MAX_CHARS) return await ctx.fail('argument line too long');
        batch.push(item);
        chars += item.length + 1;
        if ((maxArgs !== null && batch.length >= maxArgs) || chars >= MAX_CHARS) {
          const stop = await execute(batch);
          if (stop !== null) return stop;
          batch = [];
          chars = 0;
          lines = 0;
        }
      }
      lines += batch.length > 0 ? 1 : 0;
      if (maxLines !== null && lines >= maxLines && batch.length > 0) {
        const stop = await execute(batch);
        if (stop !== null) return stop;
        batch = [];
        chars = 0;
        lines = 0;
      }
    }
  } catch (error) {
    if (error instanceof InputError) return ctx.fail(error.message);
    throw error;
  }
  if (batch.length > 0 || (!ran && !optOn(ctx, 'no-run-if-empty') && replace === undefined)) {
    const stop = await execute(batch);
    if (stop !== null) return stop;
  }
  return worst;
}
