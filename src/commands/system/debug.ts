// debug report: the browser, the screen, the build and the page's recent errors, copied for an
// issue, because Instagram's in-app browsers cannot be inspected remotely.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'debug',
  category: 'system',
  summary: 'copy a report for a bug',
  synopsis: ['debug report'],
  description: "'debug report' copies the browser, screen, build and recent errors, to paste into an issue. Nothing is sent.",
  subcommands: { report: { summary: 'copy a report' } },
  examples: [{ line: 'debug report', offline: true }],
  seeAlso: ['privacy'],
  load: () => import('./debug.run'),
});
