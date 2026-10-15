// sudo: it asks for guest's password in sudo's own words, and everything a visitor sees before the
// answer reads like sudo's (the summary, --help, man, and a dim line saying how to cancel). The
// password is masked as it is typed, never echoed, and dropped: it is not compared, kept, shown or
// sent anywhere (docs/plan/02-architecture-and-contracts.md, section 12). What follows the answer
// is in sudo.run.ts, with the long help, so the kernel's chunk carries only this spec.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'sudo',
  category: 'shell',
  summary: 'run a command as the superuser',
  synopsis: ['sudo [-u USER] COMMAND [ARG]...', 'sudo -i', 'sudo -s'],
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
  // Nothing comes between the line, the password and the show, as nothing does in a terminal.
  statusLine: false,
  load: () => import('./sudo.run'),
});
