// The body of sudo; its spec, in sudo.ts, loads this the first time sudo runs, so the kernel's
// chunk carries only the spec. The password read here is dropped: never compared, kept, shown or
// sent anywhere. The show (the dancer and the tune, commands/lib/rick.ts) comes with this body
// too, and the Rick app's chunk with its first showing.

import { out } from '../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { rickView } from '../lib/rick';
import { SUDO_HINT } from './sudo';

/** What --help, help and man say about sudo, besides its spec (sudo.ts). */
export const doc: CommandDoc = {
  description:
    "Asks for guest's password, as sudo does, puts on a short show (a dancer and an 8-bit tune of vesen's own, until Esc, ^C, q or Back), and then says what sudo says to a user who is not in the sudoers file. It is a joke: what is typed at the password prompt is hidden, and is never kept, shown or sent anywhere. In a pipe or a script there is no show, only the message.",
  man: [
    { heading: 'THE SHOW', body: 'The tune and the dancer are drawn and played in your browser; nothing is fetched. Press m to mute, or use the Mute button on a touch screen.' },
    { heading: 'EXIT STATUS', body: '1: guest is not in the sudoers file.' },
  ],
};

/**
 * How long sudo seems to check the password before the show. It also puts the prompt's echo and
 * the app's opening in different frames: in one frame, the transcript growing while the app takes
 * the focus (and the phone's key bar closes) makes WebKit report a ResizeObserver loop.
 */
export const CHECKING_MS = 200;

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const shell = ctx.opts.login === true || ctx.opts.shell === true;
  if (ctx.args.length === 0 && !shell) return ctx.usage('a command is required');
  if (!ctx.tty.interactive) return ctx.fail('a terminal is required to read the password');

  const password = await ctx.tty.readLine({ prompt: `[sudo] password for ${ctx.user.name}: `, secret: true, hint: SUDO_HINT });
  if (password === null) {
    if (ctx.signal.aborted) throw ctx.signal.reason;
    return ctx.fail('a password is required');
  }

  // The show, on the terminal; into a file there is only the message.
  if (ctx.stdout.isTTY) {
    await ctx.clock.sleep(CHECKING_MS, ctx.signal);
    try {
      await ctx.tty.fullscreen('rick', rickView(ctx.tty.touch));
    } catch (error) {
      // ^C ends it as usual; with no full-screen app here, the message follows at once.
      if (ctx.signal.aborted) throw error;
    }
  }

  // The one request sudo grants here.
  if (ctx.args.join(' ').toLowerCase() === 'make me a sandwich') {
    await ctx.stdout.line('Okay. One sandwich, made with superuser care.');
    await ctx.stdout.line(out.span(`(${ctx.user.name} is still not in the sudoers file. This one is on the house.)`, { fg: 'muted' }));
    return 0;
  }
  await ctx.stderr.line(`${ctx.user.name} is not in the sudoers file. This incident will be reported.`);
  return 1;
}
