// command: run a command without its alias, or with -v and -V say what a name runs, as bash's
// builtin does.

import { out } from '../../output/model';
import { defineCommand } from '../../shell/types';
import { shellQuote } from './alias';
import { brief, describe, lookup } from '../lib/lookup';

export default defineCommand({
  name: 'command',
  category: 'shell',
  summary: 'run a command, or say what a name runs',
  synopsis: ['command [-pVv] COMMAND [ARG]...'],
  description:
    "Runs COMMAND with its ARGs as a command, never as an alias. With -v, prints what COMMAND would run: a path, a builtin's name, or the alias as it was defined; nothing, and status 1, when there is none. With -V, says so in words, as type does.",
  builtin: true,
  posixArgs: true,
  flags: [
    { short: 'v', description: 'print what COMMAND would run' },
    { short: 'V', description: 'describe what COMMAND would run, as type does' },
    { short: 'p', description: 'search the default $PATH (vesen keeps one)' },
  ],
  args: [
    { name: 'COMMAND', source: { kind: 'command' }, optional: true },
    { name: 'ARG', source: { kind: 'commandLine' }, optional: true, variadic: true },
  ],
  examples: [
    { line: 'command -v ls', offline: true },
    { line: 'command -v ll', note: 'an alias, as it was defined', offline: true },
    { line: 'command ls', note: 'ls itself, never an alias', offline: true },
  ],
  seeAlso: ['type', 'which', 'alias'],
  async run(ctx) {
    if (ctx.opts.v === true || ctx.opts.V === true) {
      let status = 0;
      for (const name of ctx.args) {
        const [found] = lookup(ctx, name);
        if (found === undefined) {
          status = 1;
          if (ctx.opts.V === true) await ctx.stderr.line(out.span(`vesen: command: ${name}: not found`, { fg: 'error' }));
          continue;
        }
        await ctx.stdout.write(`${ctx.opts.V === true ? describe(name, found) : brief(name, found)}\n`);
      }
      return status;
    }
    if (ctx.args.length === 0) return 0;
    // The words, quoted, as a line the shell runs without looking up aliases.
    return ctx.shell.exec(ctx.args.map(shellQuote).join(' '), { stdin: ctx.stdin, stdout: ctx.stdout, stderr: ctx.stderr });
  },
});
