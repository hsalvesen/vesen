// ftp: browsers no longer speak FTP, and a tab cannot open the connections it needs; it says so
// in one line.

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, RunnerChoice } from '../../../shell/types';
import { sandboxed } from '../../lib/sandbox';

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'ftp',
  category: 'network',
  summary: 'transfer files over FTP (not in a browser)',
  synopsis: ['ftp HOST'],
  description: 'Says why there is no ftp here: FTP needs raw TCP connections, which a browser tab cannot open, and browsers have dropped FTP altogether. wget and curl fetch https:// URLs. Exits 1.',
  rawArgs: true,
  // A stand-in that says why not: left out of help, Tab and the chips, it answers when typed.
  hidden: true,
  args: [{ name: 'HOST', source: { kind: 'examples', caseInsensitive: true } }],
  examples: [
    { line: 'ftp ftp.example.org', note: 'says why not' },
    { line: 'ftp --help', offline: true },
  ],
  seeAlso: ['wget', 'curl'],
  run: sandboxed('a browser cannot speak FTP or open the connections it needs; wget and curl fetch https:// URLs'),
};

export default spec;
