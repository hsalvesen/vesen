// cowsay: an animal says something in a speech bubble. cowthink (cowthink.ts) is the same with a
// thought bubble, and shares these flags. The animals and the bubble are in the body
// (cowsay.run.ts and commands/lib/cows.ts), which loads the first time either runs.

import { defineCommand, type EnumValue, type FlagSpec } from '../../../shell/types';

/** The animals, for -f's completion; commands/lib/cows.ts draws them, and a test keeps the lists equal. */
export const ANIMALS: readonly EnumValue[] = [
  { value: 'cow', summary: 'the default' },
  { value: 'kangaroo', summary: 'with a joey' },
  { value: 'cassowary', summary: 'casque and all' },
  { value: 'kookaburra', summary: 'on a branch' },
  { value: 'wombat', summary: 'square droppings included' },
  { value: 'crocodile', summary: 'mind the teeth' },
];

/** cowsay's and cowthink's options. */
export const COW_FLAGS: readonly FlagSpec[] = [
  { short: 'f', description: 'the animal: cow unless given (-l lists them)', value: { name: 'ANIMAL', source: { kind: 'enum', values: () => ANIMALS, caseInsensitive: true } } },
  { short: 'l', description: 'list the animals' },
  { short: 'r', description: 'an animal chosen at random' },
  { short: 'e', description: 'the eyes, two characters (oo unless given)', value: { name: 'EYES', source: { kind: 'free', placeholder: 'EYES' } } },
  { short: 'T', description: 'the tongue, two characters (none unless given)', value: { name: 'TONGUE', source: { kind: 'free', placeholder: 'TONGUE' } } },
  { short: 'W', description: 'wrap the message before column WIDTH (40 unless given, or less on a narrow screen)', value: { name: 'WIDTH', source: { kind: 'int' } } },
  { short: 'n', description: 'keep the lines of the message as they are, unwrapped' },
  { short: 'b', description: 'borg: == eyes' },
  { short: 'd', description: 'dead: xx eyes and the tongue out' },
  { short: 'g', description: 'greedy: $$ eyes' },
  { short: 'p', description: 'paranoid: @@ eyes' },
  { short: 's', description: 'stoned: ** eyes and the tongue out' },
  { short: 't', description: 'tired: -- eyes' },
  { short: 'w', description: 'wired: OO eyes' },
  { short: 'y', description: 'youthful: .. eyes' },
];

/** After `cowsay -l`, one chip per animal. */
export function animalChips(command: string, argv: readonly string[]): string[] {
  return argv.slice(1).includes('-l') ? ANIMALS.map((animal) => `${command} -f ${animal.value} hello`) : [];
}

export default defineCommand({
  name: 'cowsay',
  category: 'fun',
  summary: 'an animal says something in a speech bubble',
  synopsis: ['cowsay [-bdgpstwy] [-e EYES] [-T TONGUE] [-W WIDTH] [-n] [-f ANIMAL | -r] [MESSAGE]...', 'cowsay -l'],
  featured: false,
  flags: COW_FLAGS,
  args: [{ name: 'MESSAGE', source: { kind: 'free', placeholder: 'MESSAGE' }, optional: true, variadic: true }],
  examples: [
    { line: 'cowsay hello', note: 'a cow says hello', offline: true },
    { line: 'cowsay -f kangaroo how ya going', note: 'a kangaroo, and its joey', offline: true },
    { line: 'fortune | cowsay -f wombat', note: 'piped in', offline: true },
    { line: 'cowsay -d -f crocodile not today', note: 'a mood', offline: true },
    { line: 'cowsay -l', note: 'the animals', offline: true },
  ],
  seeAlso: ['cowthink', 'fortune', 'figlet', 'lolcat'],
  next: ({ status, argv }) => (status === 0 ? animalChips('cowsay', argv) : []),
  load: () => import('./cowsay.run').then((m) => ({ run: m.say, doc: m.sayDoc })),
});
