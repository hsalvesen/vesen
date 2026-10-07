// sudo: the joke. It asks for guest's password in sudo's own words, with a dim line saying it is a
// joke and nothing typed is kept (docs/plan/02-architecture-and-contracts.md, section 12), then
// says what sudo says to a user who is not in the sudoers file, and links the video. The command
// never runs. The password is masked as it is typed, never echoed, and dropped here: it is not
// compared, kept, shown or sent anywhere.
//
// On a desktop browser outside an in-app browser the video opens in a new tab inside the Enter
// that answers the prompt (the read's `opens`); everywhere, a link card with Copy is printed.

import { out } from '../../output/model';
import { defineCommand } from '../../shell/types';

export const SUDO_VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** The dim line above the password prompt, so nobody is coaxed into typing a real password. */
export const SUDO_HINT = '(this is a joke; nothing you type is kept)';

export default defineCommand({
  name: 'sudo',
  category: 'shell',
  summary: 'run a command as the superuser',
  synopsis: ['sudo [-u USER] COMMAND [ARG]...', 'sudo -i', 'sudo -s'],
  description:
    "Asks for guest's password, as sudo does, and then says what sudo says to a user who is not in the sudoers file. It is a joke: what is typed at the password prompt is hidden, and is never kept, shown or sent anywhere.",
  posixArgs: true,
  flags: [
    { short: 'u', long: 'user', description: 'run the command as USER', value: { name: 'USER', source: { kind: 'user' } } },
    { short: 'i', long: 'login', description: "run the target user's login shell" },
    { short: 's', long: 'shell', description: 'run a shell as the target user' },
  ],
  args: [{ name: 'COMMAND', source: { kind: 'commandLine' }, optional: true }],
  examples: [
    { line: 'sudo ls', note: 'try it' },
    { line: 'sudo --help', note: 'what it would do', offline: true },
  ],
  seeAlso: ['whoami', 'id'],
  man: [{ heading: 'EXIT STATUS', body: '1: guest is not in the sudoers file.' }],
  async run(ctx) {
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
  },
});
