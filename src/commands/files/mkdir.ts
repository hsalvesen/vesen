// mkdir: make directories, as GNU mkdir does (F019): every operand, -p for parents (and no error
// when the folder is there), -m for the mode, silent on success unless -v.

import { defineCommand } from '../../shell/types';
import { reason, tryStat } from '../lib/files';
import { parseMode } from '../lib/mode';

/** Each folder on the way to `typed`, as typed: a/b/c gives a, a/b, a/b/c. */
export function prefixes(typed: string): string[] {
  const parts = typed.split('/').filter((part) => part !== '');
  let at = typed.startsWith('/') ? '/' : '';
  return parts.map((part) => {
    at = at === '' ? part : at.endsWith('/') ? `${at}${part}` : `${at}/${part}`;
    return at;
  });
}

export default defineCommand({
  name: 'mkdir',
  category: 'files',
  summary: 'make directories',
  synopsis: ['mkdir [OPTION]... DIRECTORY...'],
  description:
    'Creates each DIRECTORY. With -p, the folders on the way are made too, and a folder that is already there is not an error. Like Linux, it prints nothing when it works; -v says what it made.',
  flags: [
    {
      short: 'm',
      long: 'mode',
      description: 'set the permissions, octal or as chmod writes them (700, u=rwx,go=), instead of 755',
      value: { name: 'MODE', source: { kind: 'free', placeholder: '755' } },
    },
    { short: 'p', long: 'parents', description: 'make parent folders as needed; no error if the folder exists' },
    { short: 'v', long: 'verbose', description: 'print a message for each folder made' },
  ],
  args: [{ name: 'DIRECTORY', source: { kind: 'path', accept: 'dir', includeParent: true }, variadic: true }],
  examples: [
    { line: 'mkdir notes', offline: true },
    { line: 'mkdir -p projects/new/src', note: 'parents too', offline: true },
    { line: 'mkdir -v -m 700 private', note: 'only you may enter', offline: true },
  ],
  seeAlso: ['rmdir', 'touch', 'ls'],
  next: ({ status, argv }) => {
    const last = argv[argv.length - 1];
    return status === 0 && last !== undefined && !last.startsWith('-') && /^[\w./~-]+$/.test(last) ? [`cd ${last}`, 'ls'] : [];
  },
  man: [{ heading: 'EXIT STATUS', body: '0 when every DIRECTORY was made, 1 otherwise.' }],
  async run(ctx) {
    if (ctx.args.length === 0) return ctx.usage('missing operand');
    const modeText = typeof ctx.opts.mode === 'string' ? ctx.opts.mode : undefined;
    let mode: number | undefined;
    if (modeText !== undefined) {
      const parsed = parseMode(modeText, 0o777 & ~0o022, true);
      if (parsed === null) return ctx.fail(`invalid mode '${modeText}'`);
      mode = parsed;
    }
    const verbose = ctx.opts.verbose === true;
    const parents = ctx.opts.parents === true;
    let status = 0;

    const make = async (typed: string, shownAs: string): Promise<boolean> => {
      try {
        ctx.fs.mkdir(ctx.resolve(typed));
      } catch (error) {
        status = await ctx.fail(`cannot create directory '${shownAs}': ${reason(error)}`);
        return false;
      }
      if (verbose) await ctx.stdout.write(`mkdir: created directory '${typed}'\n`);
      return true;
    };

    const finish = async (typed: string): Promise<void> => {
      if (mode === undefined) return;
      try {
        ctx.fs.chmod(ctx.resolve(typed), mode);
      } catch (error) {
        status = await ctx.fail(`cannot set permissions of '${typed}': ${reason(error)}`);
      }
    };

    for (const typed of ctx.args) {
      if (!parents) {
        if (await make(typed, typed)) await finish(typed);
        continue;
      }
      const steps = prefixes(typed);
      for (const [i, step] of steps.entries()) {
        const last = i === steps.length - 1;
        const found = tryStat(ctx, ctx.resolve(step));
        if (found?.type === 'directory') continue;
        if (found !== null) {
          status = await ctx.fail(`cannot create directory '${typed}': ${last ? 'File exists' : 'Not a directory'}`);
          break;
        }
        if (!(await make(step, last ? typed : step))) break;
        if (last) await finish(typed);
      }
    }
    return status;
  },
});

