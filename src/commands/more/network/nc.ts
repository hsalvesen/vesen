// nc: a browser tab cannot open raw TCP or UDP sockets; it says so in one line.

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, RunnerChoice } from '../../../shell/types';
import { sandboxed } from '../../lib/sandbox';

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'nc',
  aliases: ['netcat'],
  category: 'network',
  summary: 'read and write network sockets (not in a browser)',
  synopsis: ['nc HOST PORT'],
  description: 'Says why there is no nc here: it reads and writes raw TCP and UDP sockets, which a browser tab cannot open. curl and wget speak HTTPS. Exits 1.',
  rawArgs: true,
  // A stand-in that says why not: left out of help, Tab and the chips, it answers when typed.
  hidden: true,
  args: [
    { name: 'HOST', source: { kind: 'examples', caseInsensitive: true } },
    { name: 'PORT', source: { kind: 'int' }, optional: true },
  ],
  examples: [
    { line: 'nc -zv vesen.app 443', note: 'says why not' },
    { line: 'nc --help', offline: true },
  ],
  seeAlso: ['telnet', 'curl', 'wget'],
  run: sandboxed('a browser tab cannot open raw TCP or UDP sockets; curl and wget speak HTTPS'),
};

export default spec;
