// locale: get locale-specific information, as glibc's locale does: the settings $LANG and the
// LC_ variables make, and with -a the locales there are. The body is in locale.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'locale',
  category: 'system',
  summary: 'get locale-specific information',
  synopsis: ['locale [-a | charmap]'],
  flags: [{ short: 'a', long: 'all-locales', description: 'list the available locales' }],
  args: [{ name: 'NAME', source: { kind: 'enum', values: () => [{ value: 'charmap', summary: 'the character set' }] }, optional: true }],
  examples: [
    { line: 'locale', offline: true },
    { line: 'locale -a', note: "with your browser's languages", offline: true },
    { line: 'LC_ALL=C locale', offline: true },
  ],
  seeAlso: ['date', 'env'],
  load: () => import('./locale.run'),
});
