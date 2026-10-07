// nohup: run a command immune to hangups, as coreutils' nohup does. vesen never hangs up on a
// command, so it runs as it is, with a note saying so.

import { out } from '../../../output/model';
import { defineCommand } from '../../../shell/types';
import { shellQuote } from '../../shell/alias';

export default defineCommand({
  name: 'nohup',
  category: 'shell',
  summary: 'run a command immune to hangups',
  synopsis: ['nohup COMMAND [ARG]...'],
  description:
    "Runs COMMAND with its ARGs so that a hangup cannot stop it. vesen never sends one, and runs one line at a time in the foreground, so COMMAND runs as it would without nohup, and its output stays on the screen rather than going to nohup.out. When standard input is the terminal, nohup says it is ignoring it, as coreutils' does.",
  man: [{ heading: 'EXIT STATUS', body: "COMMAND's status; 125 when nohup itself failed; 127 when COMMAND is not found." }],
  posixArgs: true,
  usageStatus: 125,
  args: [{ name: 'COMMAND', source: { kind: 'commandLine' }, variadic: true }],
  examples: [{ line: 'nohup echo still here', offline: true }],
  seeAlso: ['timeout', 'time'],
  async run(ctx) {
    if (ctx.args.length === 0) return ctx.usage('missing operand');
    if (ctx.stdin.isTTY) {
      const note = 'nohup: ignoring input; the output stays on the screen, as vesen never hangs up';
      // At the prompt, without the bell an error rings; elsewhere on standard error, as coreutils writes it.
      if (ctx.stdout.isTTY && ctx.stderr.isTTY) await ctx.stdout.block(out.text(note, { fg: 'muted' }));
      else await ctx.stderr.write(`${note}\n`);
    }
    return ctx.shell.exec(ctx.args.map(shellQuote).join(' '), { stdout: ctx.stdout, stderr: ctx.stderr });
  },
});
