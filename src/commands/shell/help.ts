// help: every command by category, or one command's options and examples, or the keys. The
// index, the panels and the key list are all generated from the specs (src/shell/help.ts), so
// help never disagrees with the commands (F042, F043).

import { out } from '../../output/model';
import { defineCommand, PLAIN_ARG } from '../../shell/types';
import { allCommands } from '../lib/catalogue';

export default defineCommand({
  name: 'help',
  category: 'shell',
  // A usage error exits 2, as bash builtins do.
  usageStatus: 2,
  summary: 'list the commands, or explain one',
  synopsis: ['help [-a]', 'help COMMAND...', 'help keys'],
  description:
    "With no COMMAND, lists the portfolio commands with what each does, then the names of the rest by category; with -a, every command with what it does. Tap a name to put it at the prompt. With a COMMAND, shows its options and examples, as 'COMMAND --help' does. 'help keys' lists the keys the terminal answers to.",
  featured: true,
  flags: [{ short: 'a', long: 'all', description: 'list every command, each with what it does' }],
  args: [{ name: 'COMMAND', source: { kind: 'command' }, optional: true, variadic: true }],
  examples: [
    { line: 'help', note: 'the commands', offline: true, starter: 1 },
    { line: 'help --all', note: 'every command, with what it does', offline: true },
    { line: 'help ls', note: "one command's options and examples", offline: true },
    { line: 'help keys', note: 'the keys', offline: true },
  ],
  seeAlso: ['man', 'whatis', 'apropos'],
  // A few places to start after the index; a command's manual after its help.
  next: ({ status, argv }) => {
    if (status !== 0) return [];
    const topics = argv.slice(1).filter((word) => !word.startsWith('-'));
    if (topics.length === 0) return ['cat ~/README.md', 'ls', 'fastfetch', 'theme ls', 'man ls'];
    const [topic] = topics;
    return topics.length === 1 && topic !== undefined && topic !== 'keys' && PLAIN_ARG.test(topic) ? [`man ${topic}`] : [];
  },
  async run(ctx) {
    const [help, registry] = await Promise.all([import('../../shell/help'), allCommands(ctx)]);
    if (ctx.args.length === 0) {
      for (const block of help.helpIndex(registry, { all: ctx.opts.all === true })) await ctx.stdout.block(block);
      return 0;
    }
    let status = 0;
    for (const topic of ctx.args) {
      if (topic === 'keys') {
        const keys = registry.get('keys');
        for (const block of help.keysTopic({ touch: ctx.tty.touch, ...(keys === undefined ? {} : { spec: keys }) })) await ctx.stdout.block(block);
        continue;
      }
      const spec = registry.get(topic);
      if (spec === undefined) {
        await ctx.stderr.line(out.span(`help: no help topics match '${topic}'`, { fg: 'error' }));
        await ctx.stderr.line(out.span(`Try 'help' for the list, or 'apropos ${topic}' to search it.`, { fg: 'muted' }));
        status = 1;
        continue;
      }
      for (const block of help.commandHelp(await help.withDoc(spec))) await ctx.stdout.block(block);
    }
    return status;
  },
});
