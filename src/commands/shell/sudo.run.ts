// The body of sudo; its spec, in sudo.ts, loads this the first time sudo runs, so the kernel's
// chunk carries only the spec. The password read here is dropped: never compared, kept, shown or
// sent anywhere. The prompt is `Password: ` and nothing else, as a Unix terminal asks, each key
// shown as an asterisk. After it, on a terminal, comes the show (the Rick app: the owner's video
// traced to text, to their track, commands/lib/rick.ts; the app's chunk comes with its first
// showing), and then what sudo says to a user who is not in the sudoers file. The command never
// runs. In a pipe or a script there is no show, only the message. Nothing a visitor sees before
// the answer gives the show away: the long help below reads like sudo's own.

import { out } from '../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { RICK_TRACK, rickView } from '../lib/rick';

/** The password prompt: sudo's word alone, as a Unix terminal prints it. */
export const SUDO_PROMPT = 'Password: ';

/** What --help, help and man say about sudo, besides its spec (sudo.ts). */
export const doc: CommandDoc = {
  description:
    "Asks for guest's password, then runs COMMAND as the superuser, or as USER with -u. With -i it runs the target user's login shell instead, and with -s a shell. Whether guest may run a command as another user is decided by the sudoers file. The password is read at the terminal, so sudo cannot run from a pipe, a script or $( ).",
  man: [{ heading: 'EXIT STATUS', body: '1: guest is not in the sudoers file.' }],
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

  // No hint above it: Esc and ^C cancel, as they cancel any read, and on a touch screen the dock
  // offers its Cancel chip. Where the show follows, the key press that answers readies its track:
  // Safari, iOS and in-app browsers start sound only inside one, and the show opens after it.
  const unlocks = ctx.stdout.isTTY ? { unlocks: RICK_TRACK } : {};
  const password = await ctx.tty.readLine({ prompt: SUDO_PROMPT, secret: true, feedback: true, ...unlocks });
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
  await ctx.stderr.line(out.span(`${ctx.user.name} is not in the sudoers file.`, { fg: 'error' }));
  return 1;
}
