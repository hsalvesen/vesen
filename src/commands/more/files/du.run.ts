// The body of du; its spec, in du.ts, loads this the first time du runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import type { Stat } from '../../../vfs/types';
import { childPath, reason } from '../../lib/files';
import { humanSize, kibBlocks } from '../../lib/listing';

/** What --help, help and man say about du, besides its spec (du.ts). */
export const doc: CommandDoc = {
  description:
    'Adds up the space each FILE takes (the working directory when none is given), and every folder inside it, and prints each folder with its total, the deepest first. Sizes are in kibibytes of 4 KiB blocks, as on a Linux disk: a folder takes 4, and a file at least 4 unless it is empty. -h prints them in K, M and G, and --apparent-size counts the bytes files hold instead.',
  man: [{ heading: 'EXIT STATUS', body: '0 when everything could be measured, 1 when a FILE was missing or a folder could not be read.' }],
};

interface Options {
  readonly all: boolean;
  readonly apparent: boolean;
  readonly bytes: boolean;
  readonly human: boolean;
  readonly maxDepth: number;
}

/** The bytes du counts for one file or folder itself. */
function own(stat: Stat, options: Options): number {
  return options.apparent ? (stat.type === 'device' ? 0 : stat.size) : kibBlocks(stat) * 1024;
}

function shown(bytes: number, options: Options): string {
  if (options.human) return humanSize(bytes);
  if (options.bytes) return String(bytes);
  return String(Math.ceil(bytes / 1024));
}

class Measure {
  status = 0;

  constructor(
    private readonly ctx: CommandContext,
    private readonly options: Options,
  ) {}

  private async print(bytes: number, typed: string): Promise<void> {
    await this.ctx.stdout.write(`${shown(bytes, this.options)}\t${typed}\n`);
  }

  /** The total under `path`, printing what the options ask for on the way; null when it is not there. */
  async total(path: string, typed: string, depth: number): Promise<number | null> {
    const { ctx, options } = this;
    if (ctx.signal.aborted) throw ctx.signal.reason;
    let stat: Stat;
    try {
      stat = ctx.fs.lstat(path);
    } catch (error) {
      await ctx.fail(`cannot access '${typed}': ${reason(error)}`);
      this.status = 1;
      return null;
    }
    let sum = own(stat, options);
    if (stat.type === 'directory') {
      let names: string[] = [];
      try {
        names = ctx.fs.readdir(path, { all: true });
      } catch (error) {
        await ctx.fail(`cannot read directory '${typed}': ${reason(error)}`);
        this.status = 1;
      }
      for (const name of names) sum += (await this.total(`${path === '/' ? '' : path}/${name}`, childPath(typed, name), depth + 1)) ?? 0;
      if (depth <= options.maxDepth) await this.print(sum, typed);
    } else if (depth === 0 || (options.all && depth <= options.maxDepth)) {
      await this.print(sum, typed);
    }
    return sum;
  }
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const summarize = ctx.opts.summarize === true;
  const all = ctx.opts.all === true;
  let maxDepth = Number.POSITIVE_INFINITY;
  const given = ctx.opts['max-depth'];
  if (given !== undefined) {
    const text = String(given);
    if (!/^\d+$/.test(text)) return ctx.fail(`invalid maximum depth '${text}'`);
    maxDepth = Number(text);
  }
  if (summarize && all) return ctx.usage('cannot both summarize and show all entries');
  if (summarize && given !== undefined && maxDepth !== 0) return ctx.usage(`warning: summarizing conflicts with --max-depth=${maxDepth}`);
  if (summarize) maxDepth = 0;
  const bytes = ctx.opts.bytes === true;
  const options: Options = {
    all,
    apparent: bytes || ctx.opts['apparent-size'] === true,
    bytes: bytes && ctx.opts['human-readable'] !== true,
    human: ctx.opts['human-readable'] === true,
    maxDepth,
  };
  const measure = new Measure(ctx, options);
  let grand = 0;
  for (const typed of ctx.args.length === 0 ? ['.'] : ctx.args) grand += (await measure.total(ctx.resolve(typed), typed, 0)) ?? 0;
  if (ctx.opts.total === true) await ctx.stdout.write(`${shown(grand, options)}\ttotal\n`);
  return measure.status;
}
