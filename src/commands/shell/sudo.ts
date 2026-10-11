// sudo: the joke. It asks for guest's password in sudo's own words, with a dim line saying it is a
// joke and nothing typed is kept (docs/plan/02-architecture-and-contracts.md, section 12), puts
// on a short show on the terminal (the Rick app: a dancer drawn for vesen and an 8-bit tune of
// its own, src/commands/lib/rick.ts), then says what sudo says to a user who is not in the sudoers
// file. The command never runs. The password is masked as it is typed, never echoed, and dropped
// here: it is not compared, kept, shown or sent anywhere. In a pipe or a script there is no show,
// only the message. The body is in sudo.run.ts.

import { defineCommand } from '../../shell/types';

/** The dim line above the password prompt, so nobody is coaxed into typing a real password. */
export const SUDO_HINT = '(this is a joke; nothing you type is kept)';

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
  load: () => import('./sudo.run'),
});
