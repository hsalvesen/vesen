// git: a read-only window on vesen's own repository, inside ~/projects/vesen only: its log and
// newest commit from GitHub's API (commands/lib/github.ts), its remote, and a clean status.
// It reads its own words, as git does (git -C DIR log --oneline -n 5).

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, RunnerChoice } from '../../../shell/types';

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'git',
  category: 'network',
  summary: "vesen's own history, read-only",
  synopsis: ['git [-C DIR] log [--oneline] [-n N]', 'git [-C DIR] show [REV]', 'git [-C DIR] status | remote [-v] | branch | diff'],
  rawArgs: true,
  network: true,
  usageStatus: 129,
  flags: [{ short: 'C', description: 'run as if started in DIR', value: { name: 'DIR', source: { kind: 'path', accept: 'dir' } } }],
  subcommands: {
    log: {
      summary: 'the newest commits, from GitHub',
      flags: [
        { long: 'oneline', description: 'one line a commit' },
        { short: 'n', long: 'max-count', description: 'at most N commits', value: { name: 'N', source: { kind: 'int' } } },
      ],
    },
    show: { summary: 'a commit and its message', args: [{ name: 'REV', source: { kind: 'enum', values: () => [{ value: 'HEAD' }, { value: 'HEAD~1' }] }, optional: true }] },
    status: { summary: 'the working tree: always clean' },
    remote: { summary: 'where it came from', flags: [{ short: 'v', long: 'verbose', description: 'with the URLs' }] },
    branch: { summary: 'the branch: main' },
    diff: { summary: 'changes in the working tree: none' },
  },
  loadingLabel: (argv) => (argv.includes('log') || argv.includes('show') ? 'git: asking GitHub for the newest commits…' : 'git'),
  examples: [
    { line: 'cd ~/projects/vesen && git log --oneline -n 5', note: 'the five newest commits' },
    { line: 'git -C ~/projects/vesen show', note: 'the newest commit' },
    { line: 'git -C ~/projects/vesen status', note: 'always clean', offline: true },
    { line: 'git -C ~/projects/vesen remote -v', note: 'where it lives', offline: true },
  ],
  seeAlso: ['repo', 'privacy'],
  load: () => import('./git.run'),
};

export default spec;
