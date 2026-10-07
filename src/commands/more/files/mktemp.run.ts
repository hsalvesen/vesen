// The body of mktemp; its spec, in mktemp.ts, loads this the first time mktemp runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { errorCode, reason } from '../../lib/files';

/** What --help, help and man say about mktemp, besides its spec (mktemp.ts). */
export const doc: CommandDoc = {
  description:
    "Creates a new empty file (or with -d a folder) whose name is TEMPLATE with its last run of X's replaced by random letters and digits, and prints its name. Only its owner may read it: a file is made rw-------, a folder rwx------. With no TEMPLATE it makes tmp.XXXXXXXXXX in $TMPDIR, or /tmp; a TEMPLATE of your own is relative to the working directory unless -p or --tmpdir puts it elsewhere.",
  man: [{ heading: 'EXIT STATUS', body: '0 when the file or folder was made, 1 otherwise.' }],
};

const DEFAULT_TEMPLATE = 'tmp.XXXXXXXXXX';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Names tried before giving up, should every one be taken. */
const ATTEMPTS = 100;

/** A template's parts: what comes before the X's, how many there are, and what comes after. */
interface Parts {
  readonly head: string;
  readonly xs: number;
  readonly tail: string;
}

function split(template: string, suffix: string | undefined): Parts | { error: string } {
  const slash = template.lastIndexOf('/');
  const last = template.slice(slash + 1);
  let body = template;
  let tail = suffix ?? '';
  if (suffix === undefined) {
    // A template that does not end in X has its own suffix: what follows the last X.
    const x = last.lastIndexOf('X');
    if (x !== -1) {
      tail = last.slice(x + 1);
      body = template.slice(0, template.length - tail.length);
    }
  } else if (!template.endsWith('X')) {
    return { error: `with --suffix, template '${template}' must end in X` };
  }
  const run = /X*$/.exec(body.slice(slash + 1))?.[0].length ?? 0;
  if (run < 3) return { error: `too few X's in template '${template}${suffix ?? ''}'` };
  return { head: body.slice(0, body.length - run), xs: run, tail };
}

/** A random name from `parts`; the attempt number keeps a repeating random source from looping. */
function candidate(ctx: CommandContext, parts: Parts, attempt: number): string {
  let letters = '';
  for (let i = 0; i < parts.xs; i += 1) {
    letters += ALPHABET.charAt((Math.floor(ctx.clock.random() * ALPHABET.length) + attempt * (i + 1)) % ALPHABET.length);
  }
  return `${parts.head}${letters}${parts.tail}`;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length > 1) return ctx.usage('too many templates');
  const quiet = ctx.opts.quiet === true;
  const folder = ctx.opts.directory === true;
  const say = async (message: string): Promise<ExitCode> => (quiet ? 1 : ctx.fail(message));

  const suffix = typeof ctx.opts.suffix === 'string' ? ctx.opts.suffix : undefined;
  if (suffix?.includes('/')) return say(`invalid suffix '${suffix}', contains directory separator`);
  const given = ctx.args[0];
  const tmpdir = ctx.env.get('TMPDIR') || '/tmp';
  const p = typeof ctx.opts.p === 'string' ? ctx.opts.p : undefined;
  const long = ctx.opts.tmpdir;
  const inTmp = given === undefined || ctx.opts.t === true || p !== undefined || long !== undefined;
  const template = given ?? DEFAULT_TEMPLATE;
  let dir = '';
  if (inTmp) {
    if (template.includes('/')) {
      return say(template.startsWith('/') ? `invalid template, '${template}'; with --tmpdir, it may not be absolute` : `invalid template, '${template}', contains directory separator`);
    }
    dir = ctx.opts.t === true ? (ctx.env.get('TMPDIR') || p || '/tmp') : (p ?? (typeof long === 'string' && long !== '' ? long : tmpdir));
  }
  const full = dir === '' ? template : `${dir.replace(/\/+$/, '')}/${template}`;
  const parts = split(full, suffix);
  if ('error' in parts) return say(parts.error);

  const what = folder ? 'directory' : 'file';
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const name = candidate(ctx, parts, attempt);
    const path = ctx.resolve(name);
    try {
      // Taken, even by a link to nothing: try another name.
      ctx.fs.lstat(path);
      continue;
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') return say(`failed to create ${what} via template '${full}${suffix ?? ''}': ${reason(error)}`);
    }
    if (ctx.opts['dry-run'] !== true) {
      try {
        if (folder) ctx.fs.mkdir(path, { mode: 0o700 });
        else ctx.fs.writeFile(path, '', { mode: 0o600, noclobber: true });
      } catch (error) {
        if (errorCode(error) === 'EEXIST') continue;
        return say(`failed to create ${what} via template '${full}${suffix ?? ''}': ${reason(error)}`);
      }
    }
    await ctx.stdout.write(`${name}\n`);
    return 0;
  }
  return say(`failed to create ${what} via template '${full}${suffix ?? ''}': File exists`);
}
