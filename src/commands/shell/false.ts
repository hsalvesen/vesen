// false: do nothing, unsuccessfully.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'false',
  category: 'shell',
  summary: 'do nothing, unsuccessfully',
  description: 'Exits with status 1. Useful in && and || chains.',
  examples: [{ line: 'false || echo no', offline: true }],
  seeAlso: ['true', 'test'],
  run: () => 1,
});
