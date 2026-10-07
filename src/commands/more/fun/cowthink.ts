// cowthink: cowsay with a thought bubble. The flags and the animals are cowsay's (cowsay.ts), and
// so is the body (cowsay.run.ts).

import { defineCommand } from '../../../shell/types';
import { animalChips, COW_FLAGS } from './cowsay';

export default defineCommand({
  name: 'cowthink',
  category: 'fun',
  summary: 'an animal thinks something in a thought bubble',
  synopsis: ['cowthink [-bdgpstwy] [-e EYES] [-T TONGUE] [-W WIDTH] [-n] [-f ANIMAL | -r] [MESSAGE]...', 'cowthink -l'],
  featured: false,
  flags: COW_FLAGS,
  args: [{ name: 'MESSAGE', source: { kind: 'free', placeholder: 'MESSAGE' }, optional: true, variadic: true }],
  examples: [
    { line: 'cowthink -f kookaburra what is so funny', note: 'a thought, not a word', offline: true },
    { line: 'fortune -s | cowthink -t', note: 'a tired cow thinks it over', offline: true },
  ],
  seeAlso: ['cowsay', 'fortune'],
  next: ({ status, argv }) => (status === 0 ? animalChips('cowthink', argv) : []),
  load: () => import('./cowsay.run').then((m) => ({ run: m.think, doc: m.thinkDoc })),
});
