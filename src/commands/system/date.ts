// date: print the date and time, as coreutils' date does: in the visitor's time zone (or $TZ),
// or UTC with -u, in date's own format or a +FORMAT of the common conversions.

import { defineCommand } from '../../shell/types';

/** -I's formats, as GNU date names them. */
const ISO_NAMES = ['date', 'hours', 'minutes', 'seconds'] as const;

export default defineCommand({
  name: 'date',
  category: 'system',
  summary: 'print the date and time',
  synopsis: ['date [-u] [-I[FMT]] [+FORMAT]'],
  flags: [
    { short: 'u', long: 'utc', description: 'print Coordinated Universal Time (UTC)' },
    { short: 'R', long: 'rfc-email', description: 'print it as email headers do: Tue, 06 Oct 2026 20:00:00 +1100' },
    {
      short: 'I',
      long: 'iso-8601',
      description: "print it in ISO 8601: FMT is 'date' (the default), 'hours', 'minutes' or 'seconds'",
      value: {
        name: 'FMT',
        optional: true,
        source: { kind: 'enum', values: () => ISO_NAMES.map((value) => ({ value })) },
      },
    },
  ],
  args: [{ name: '+FORMAT', source: { kind: 'free', placeholder: '+%Y-%m-%d' }, optional: true }],
  examples: [
    { line: 'date', offline: true },
    { line: 'date -u', note: 'in UTC', offline: true },
    { line: 'date +%Y-%m-%d', offline: true },
    { line: "date '+%a %e %b, %H:%M'", offline: true },
    { line: 'TZ=Europe/Oslo date', note: 'in another zone', offline: true },
  ],
  seeAlso: ['sleep', 'ls'],
  load: () => import('./date.run'),
});
