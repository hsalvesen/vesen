// speedtest: latency, download and upload against Cloudflare's speed test, each phase bounded in
// time, read as it streams, and checked (F027, F028). Phones, cellular and Data Saver get a light
// run by default, and the shell asks before it spends the data; --full runs the whole thing.

import { defineCommand } from '../../shell/types';

const MiB = 1024 * 1024;

/** What each run transfers, at most: the time bound may end a phase sooner. */
export const PROFILES = {
  light: { download: [1 * MiB, 5 * MiB], upload: [256 * 1024] },
  full: { download: [1 * MiB, 2 * MiB, 5 * MiB, 10 * MiB, 25 * MiB], upload: [256 * 1024, 1 * MiB, 2 * MiB] },
} as const;

export type ProfileName = keyof typeof PROFILES;

const sum = (sizes: readonly number[]): number => sizes.reduce((total, size) => total + size, 0);

const CHOICES = ['dry-run', 'full', 'light'] as const;

/**
 * The run a line asks for by its flags, read the way the flag parser reads them (--fu is
 * --full), and decided as the command decides: --dry-run, then --full, then --light.
 */
export function requested(argv: readonly string[]): ProfileName | 'dry-run' | null {
  const given = new Set<string>();
  for (const word of argv.slice(1)) {
    if (word === '--') break;
    if (!word.startsWith('--') || word.length === 2) continue;
    for (const flag of CHOICES) if (flag.startsWith(word.slice(2))) given.add(flag);
  }
  return CHOICES.find((flag) => given.has(flag)) ?? null;
}

export default defineCommand({
  name: 'speedtest',
  category: 'network',
  summary: 'measure the speed of the connection',
  synopsis: ['speedtest [--full | --light | --dry-run]'],
  network: true,
  budgetMs: 40_000,
  flags: [
    { long: 'full', description: 'the full run, up to 45 MB down' },
    { long: 'light', description: 'the light run, about 6 MB down' },
    { long: 'dry-run', description: 'say what a run would use, and stop' },
  ],
  // Light by default where it asks, so it asks about the light run unless --full is given.
  dataCost: {
    bytes: (argv) => {
      const choice = requested(argv);
      return choice === 'dry-run' ? 0 : sum(PROFILES[choice ?? 'light'].download);
    },
    confirmOn: ['cellular', 'saveData', 'touch'],
  },
  loadingLabel: () => 'measuring the connection…',
  examples: [
    { line: 'speedtest', note: 'latency, download and upload' },
    { line: 'speedtest --full', note: 'the longer run' },
    { line: 'speedtest --dry-run', note: 'what it would use', offline: true },
  ],
  seeAlso: ['curl', 'privacy'],
  load: () => import('./speedtest.run'),
});
