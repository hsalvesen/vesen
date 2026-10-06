// exit and logout: end the session, as a login shell does. The terminal shows `logout`, then
// `[Process completed]` as a terminal window does, with a chip that starts a new session; any
// line typed after it starts one too. Files, history and the theme are kept; variables and
// aliases start again from /etc/profile and ~/.bashrc. In a script, exit ends the script.

import { out } from '../../output/model';
import type { RawArgsSpec } from '../../shell/flags';
import { ExitRequest, type CommandSpec, type RunnerChoice } from '../../shell/types';

// Its words are taken as they are, so `exit -1` is status 255, as in bash.
const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'exit',
  aliases: ['logout'],
  category: 'shell',
  summary: 'end the session',
  synopsis: ['exit [N]', 'logout [N]'],
  description:
    'Ends the session with status N, or the status of the last command. A new session starts at the tap of a chip, or with the next line typed: files, history and the theme stay, and variables and aliases start again. In a script, ends the script.',
  builtin: true,
  rawArgs: true,
  args: [{ name: 'N', source: { kind: 'int' }, optional: true }],
  examples: [
    { line: 'exit', offline: true },
    { line: 'logout', offline: true },
  ],
  seeAlso: ['reset', 'clear'],
  async run(ctx) {
    if (ctx.args.length > 1) return ctx.fail('too many arguments');
    const [given] = ctx.args;
    let status = ctx.shell.lastStatus();
    if (given !== undefined) {
      if (/^[+-]?\d+$/.test(given)) status = ((Number(given) % 256) + 256) % 256;
      else {
        await ctx.fail(`${given}: numeric argument required`, 2);
        status = 2;
      }
    }
    if (ctx.tty.interactive && ctx.stdout.isTTY) {
      await ctx.stdout.line('logout');
      await ctx.stdout.block(out.lines([[], [out.span('[Process completed]', { fg: 'muted' })]]));
      await ctx.stdout.block(out.chips([{ label: 'Start a new session', action: out.action.run('login') }]));
    }
    throw new ExitRequest(status);
  },
};

export default spec;
