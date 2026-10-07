// The body of hostname; its spec, in hostname.ts, loads this the first time hostname runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { HOST } from '../../../vfs/identity';
import { siteDomain } from '../../lib/domain';

/** What --help, help and man say about hostname, besides its spec (hostname.ts). */
export const doc: CommandDoc = {
  description:
    "Prints the host name, vesen, which is the same on every domain the site is served from, as the prompt shows it. With -f, the fully qualified name: the site's own, such as www.vesen.app. With -d, the domain part of that; with -s, the name up to its first dot; with -i, the address /etc/hosts gives it. Only root may set the host name, so NAME is refused.",
  man: [{ heading: 'EXIT STATUS', body: '0, or 1 when asked to set the name.' }],
};

/** The address /etc/hosts gives the host name, as Debian writes it. */
const HOST_ADDRESS = '127.0.1.1';

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length > 0) return ctx.fail('you must be root to change the host name');
  const fqdn = siteDomain() ?? HOST;
  let answer = HOST;
  if (ctx.opts.fqdn === true) answer = fqdn;
  else if (ctx.opts.domain === true) answer = fqdn.includes('.') ? fqdn.slice(fqdn.indexOf('.') + 1) : '';
  else if (ctx.opts['ip-address'] === true) answer = HOST_ADDRESS;
  else if (ctx.opts.short === true) answer = HOST.split('.')[0] ?? HOST;
  await ctx.stdout.write(`${answer}\n`);
  return 0;
}
