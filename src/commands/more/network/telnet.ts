// telnet: a browser tab cannot open a raw TCP connection; it says so in one line.

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, RunnerChoice } from '../../../shell/types';
import { sandboxed } from '../../lib/sandbox';

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'telnet',
  category: 'network',
  summary: 'talk to a TCP port (not in a browser)',
  synopsis: ['telnet HOST [PORT]'],
  description: 'Says why there is no telnet here: it needs a raw TCP connection, which a browser tab cannot open. curl and wget speak HTTPS. Exits 1.',
  rawArgs: true,
  // A stand-in that says why not: left out of help, Tab and the chips, it answers when typed.
  hidden: true,
  args: [
    { name: 'HOST', source: { kind: 'examples', caseInsensitive: true } },
    { name: 'PORT', source: { kind: 'int' }, optional: true },
  ],
  examples: [
    { line: 'telnet example.com 23', note: 'says why not' },
    { line: 'telnet --help', offline: true },
  ],
  seeAlso: ['nc', 'ssh', 'curl'],
  run: sandboxed((host) => `${host === null ? '' : `could not connect to ${host}: `}a browser tab cannot open raw TCP connections`, 'bel'),
};

export default spec;
