// env: print the environment, or run a command with variables added to it, as coreutils' env
// does.

import { isVariableName } from '../../shell/session';
import { defineCommand } from '../../shell/types';
import { shellQuote } from './alias';

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;

export default defineCommand({
  name: 'env',
  category: 'shell',
  summary: 'run a command in a changed environment',
  synopsis: ['env [NAME=VALUE]... [COMMAND [ARG]...]'],
  description:
    'Sets each NAME to VALUE in the environment, then runs COMMAND with its ARGs in it; the shell keeps its own variables. With no COMMAND, prints the environment as NAME=VALUE lines.',
  posixArgs: true,
  args: [
    { name: 'NAME=VALUE', source: { kind: 'var' }, optional: true },
    { name: 'COMMAND', source: { kind: 'commandLine' }, optional: true, variadic: true },
  ],
  examples: [
    { line: 'env', note: 'the environment', offline: true },
    { line: 'env GREETING=hi printenv GREETING', note: 'a variable for one command', offline: true },
  ],
  seeAlso: ['printenv', 'export', 'set'],
  async run(ctx) {
    const assigned: [string, string][] = [];
    let i = 0;
    for (; i < ctx.args.length; i += 1) {
      const match = ASSIGNMENT.exec(ctx.args[i] ?? '');
      if (match === null || !isVariableName(match[1] ?? '')) break;
      assigned.push([match[1] ?? '', match[2] ?? '']);
    }
    const command = ctx.args.slice(i);
    if (command.length === 0) {
      const env = new Map(ctx.env.entries(true));
      for (const [name, value] of assigned) env.set(name, value);
      for (const [name, value] of env) await ctx.stdout.write(`${name}=${value}\n`);
      return 0;
    }
    // The assignments in front of the command, as the shell scopes them to it.
    const line = [...assigned.map(([name, value]) => `${name}=${shellQuote(value)}`), ...command.map(shellQuote)].join(' ');
    return ctx.shell.exec(line, { stdin: ctx.stdin, stdout: ctx.stdout, stderr: ctx.stderr });
  },
});
