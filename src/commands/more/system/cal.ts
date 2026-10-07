// cal: display a calendar, as util-linux's cal does, with today picked out. The body is in
// cal.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'cal',
  category: 'system',
  summary: 'display a calendar',
  synopsis: ['cal [-1 | -3 | -y] [-m] [[[DAY] MONTH] YEAR]'],
  flags: [
    { short: '1', long: 'one', description: 'show only one month (the default)' },
    { short: '3', long: 'three', description: 'show the months before and after too' },
    { short: 'y', long: 'year', description: 'show the whole year' },
    { short: 'm', long: 'monday', description: 'start the week on Monday' },
    { short: 's', long: 'sunday', description: 'start the week on Sunday (the default)' },
  ],
  args: [
    { name: 'MONTH', source: { kind: 'free', placeholder: 'month' }, optional: true },
    { name: 'YEAR', source: { kind: 'free', placeholder: 'year' }, optional: true },
  ],
  examples: [
    { line: 'cal', note: 'this month, with today picked out', offline: true },
    { line: 'cal -3', note: 'last month, this month and next', offline: true },
    { line: 'cal 12 2026', offline: true },
    { line: 'cal -y', note: 'the whole year', offline: true },
  ],
  seeAlso: ['date'],
  load: () => import('./cal.run'),
});
