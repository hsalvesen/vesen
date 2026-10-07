// sl: a steam train crosses the screen, for when ls was meant. The train is drawn in
// commands/lib/train.ts and runs in the Train app (src/ui/apps/Train.svelte); the body is sl.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'sl',
  category: 'fun',
  summary: 'a steam train crosses the screen',
  helpRank: 3,
  synopsis: ['sl'],
  featured: false,
  examples: [
    { line: 'sl', note: 'mind the gap: any key or a tap stops it' },
    { line: 'sl | cat', note: 'in a pipe, the train stands still', offline: true },
  ],
  seeAlso: ['ls', 'cmatrix'],
  load: () => import('./sl.run'),
});
