// cmatrix: characters rain down the screen until a key or a tap. The rain runs in the Matrix app
// (src/ui/apps/Matrix.svelte); the body is cmatrix.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'cmatrix',
  category: 'fun',
  summary: 'characters rain down the screen',
  synopsis: ['cmatrix [-u DELAY]'],
  featured: false,
  flags: [{ short: 'u', description: 'the delay between steps, 0 (fastest) to 10 (4 unless given)', value: { name: 'DELAY', source: { kind: 'int' } } }],
  examples: [
    { line: 'cmatrix', note: 'any key or a tap ends it' },
    { line: 'cmatrix -u 8', note: 'slower' },
    { line: 'cmatrix | cat', note: 'in a pipe, one still screen', offline: true },
  ],
  seeAlso: ['sl', 'clear'],
  load: () => import('./cmatrix.run'),
});
