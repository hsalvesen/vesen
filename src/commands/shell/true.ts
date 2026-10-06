// true: do nothing, successfully.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'true',
  category: 'shell',
  summary: 'do nothing, successfully',
  description: 'Exits with status 0. Useful in && and || chains.',
  examples: [{ line: 'true && echo yes', offline: true }],
  seeAlso: ['false', 'test'],
  run: () => 0,
});
