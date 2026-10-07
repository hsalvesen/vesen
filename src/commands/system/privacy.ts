// privacy: every third party vesen talks to, what it is sent and which command asks; and that IP
// and location lookups happen only on request (docs/plan/10-tooling-hosting-docs.md, 0.10).

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'privacy',
  category: 'system',
  summary: 'what vesen sends, and where',
  examples: [{ line: 'privacy', offline: true }],
  seeAlso: ['debug'],
  load: () => import('./privacy.run'),
});
