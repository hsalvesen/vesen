// The body of lsb_release; its spec, in lsb_release.ts, loads this the first time it runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { osRelease } from '../../lib/sysread';

/** What --help, help and man say about lsb_release, besides its spec (lsb_release.ts). */
export const doc: CommandDoc = {
  description:
    "Prints facts about the distribution from /etc/os-release: its id, its description, its release (vesen's own version) and its codename, which it does not have. With -s, only the values, one to a line. With no option, says that no LSB modules are available, as Debian's does.",
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args[0] !== undefined) return ctx.usage(`extra operand '${ctx.args[0]}'`);
  const os = osRelease(ctx);
  const id = os.ID ?? 'vesen';
  const fields: [string, string, string][] = [
    ['id', 'Distributor ID', id.charAt(0).toUpperCase() + id.slice(1)],
    ['description', 'Description', os.PRETTY_NAME ?? os.NAME ?? 'n/a'],
    ['release', 'Release', os.VERSION_ID ?? 'n/a'],
    ['codename', 'Codename', os.VERSION_CODENAME ?? 'n/a'],
  ];
  const all = ctx.opts.all === true;
  const chosen = fields.filter(([key]) => all || ctx.opts[key] === true);
  if (chosen.length === 0) {
    await ctx.stdout.write('No LSB modules are available.\n');
    return 0;
  }
  const short = ctx.opts.short === true;
  const lines = chosen.map(([, label, value]) => (short ? value : `${label}:\t${value}`));
  await ctx.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}
