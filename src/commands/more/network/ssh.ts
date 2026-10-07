// ssh: a browser tab cannot open a raw TCP connection, so there is no SSH here; it says so in
// one line.

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, RunnerChoice } from '../../../shell/types';
import { sandboxed } from '../../lib/sandbox';

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'ssh',
  category: 'network',
  summary: 'log in to another machine (not in a browser)',
  synopsis: ['ssh [USER@]HOST'],
  description:
    'Says why there is no ssh here: SSH needs a raw TCP connection, which a browser tab cannot open, and everything vesen runs is inside this tab. Exits 1.',
  rawArgs: true,
  // A stand-in that says why not: left out of help, Tab and the chips, it answers when typed.
  hidden: true,
  args: [{ name: 'HOST', source: { kind: 'examples', caseInsensitive: true } }],
  examples: [
    { line: 'ssh guest@vesen.app', note: 'says why not' },
    { line: 'ssh --help', offline: true },
  ],
  seeAlso: ['telnet', 'nc', 'curl'],
  run: sandboxed((host) => `${host === null ? '' : `connect to host ${host} port 22: `}a browser tab cannot open raw TCP connections, so there is no SSH here`, 'BbcDEeFIiJLlmOoPpQRSWw'),
};

export default spec;
