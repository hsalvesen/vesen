// The body of sudo; its spec, in sudo.ts, loads this the first time sudo runs, so the kernel's
// chunk carries only the spec. The password read here is dropped: never compared, kept, shown or
// sent anywhere.

import { out } from '../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { SUDO_HINT, SUDO_VIDEO } from './sudo';

/** What --help, help and man say about sudo, besides its spec (sudo.ts). */
export const doc: CommandDoc = {
  description:
    "Asks for guest's password, as sudo does, and then says what sudo says to a user who is not in the sudoers file. It is a joke: what is typed at the password prompt is hidden, and is never kept, shown or sent anywhere.",
  man: [{ heading: 'EXIT STATUS', body: '1: guest is not in the sudoers file.' }],
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const shell = ctx.opts.login === true || ctx.opts.shell === true;
  if (ctx.args.length === 0 && !shell) return ctx.usage('a command is required');
  if (!ctx.tty.interactive) return ctx.fail('a terminal is required to read the password');

  const password = await ctx.tty.readLine({ prompt: `[sudo] password for ${ctx.user.name}: `, secret: true, hint: SUDO_HINT, opens: SUDO_VIDEO });
  if (password === null) {
    if (ctx.signal.aborted) throw ctx.signal.reason;
    return ctx.fail('a password is required');
  }

  // The one request sudo grants here.
  if (ctx.args.join(' ').toLowerCase() === 'make me a sandwich') {
    await ctx.stdout.line('Okay. One sandwich, made with superuser care.');
    await ctx.stdout.line(out.span(`(${ctx.user.name} is still not in the sudoers file. This one is on the house.)`, { fg: 'muted' }));
    return 0;
  }
  await ctx.stderr.line(`${ctx.user.name} is not in the sudoers file. This incident will be reported.`);
  // The card everywhere; on a desktop browser the answer's key press has opened it already.
  const opened = await ctx.tty.open(SUDO_VIDEO, 'sudo');
  await ctx.stdout.block(out.card({ title: 'Your incident report', href: SUDO_VIDEO }));
  if (opened === 'opened') await ctx.stdout.line(out.span('(opened in a new tab)', { fg: 'muted' }));
  return 1;
}
