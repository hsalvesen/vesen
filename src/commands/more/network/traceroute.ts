// traceroute: a browser cannot send packets with a chosen time to live, so there is no route to
// trace; it says so in one line, and points at ping.

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, RunnerChoice } from '../../../shell/types';
import { sandboxed } from '../../lib/sandbox';

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'traceroute',
  category: 'network',
  summary: 'trace the route to a host (not in a browser)',
  synopsis: ['traceroute HOST'],
  description:
    "Says why there is no traceroute here: tracing a route sends packets with a growing time to live and listens for the routers that drop them, and a browser can do neither. ping times HTTPS round trips to a host instead. Exits 1.",
  rawArgs: true,
  // A stand-in that says why not: left out of help, Tab and the chips, it answers when typed.
  hidden: true,
  args: [{ name: 'HOST', source: { kind: 'examples', caseInsensitive: true } }],
  examples: [
    { line: 'traceroute vesen.app', note: 'says why not' },
    { line: 'traceroute --help', offline: true },
  ],
  seeAlso: ['ping', 'dig'],
  run: sandboxed('a browser cannot send packets with a chosen time to live, so there is no route to trace; ping times HTTPS round trips instead'),
};

export default spec;
