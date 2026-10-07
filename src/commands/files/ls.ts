// ls: list directory contents, as GNU ls does (F018). Names are sorted with the locale's
// collation; several operands are listed files first, then each folder under a header; a file
// operand lists the file. On a terminal a listing is a grid that reflows with the width, one name
// per line in a pipe; -l is GNU's long format. Colours come from a dircolors-style table in theme
// tokens (lib/listing.ts), so a listing follows the theme. Nothing gets a / unless -F or -p asks.
// The body and the long help are in ls.run.ts, loaded the first time ls runs, so the kernel's
// chunk carries only the spec and the follow-ups.

import { defineCommand, PLAIN_ARG, type EnumValue, type ExitCode, type NextContext } from '../../shell/types';

const COLOR_WHEN: readonly EnumValue[] = [
  { value: 'always', summary: 'colour even in a pipe or a file' },
  { value: 'auto', summary: 'colour on the terminal only (the default)' },
  { value: 'never', summary: 'no colour' },
];

/** The most follow-ups a listing offers. */
const NEXT_MAX = 10;

/**
 * After a listing of one folder: its files to read, then its folders to go into, one tap each.
 * Hidden names, and names that are not plain words, are left out.
 */
export function lsNext({ status, argv }: { status: ExitCode; argv: readonly string[] }, context?: NextContext): string[] {
  const operands = argv.slice(1).filter((word) => !word.startsWith('-'));
  if (status !== 0 || operands.length > 1 || context?.list === undefined) return [];
  const [folder] = operands;
  const entries = context.list(folder ?? '.');
  if (entries === null) return [];
  const prefix = folder === undefined ? '' : folder.endsWith('/') ? folder : `${folder}/`;
  const shown = entries
    .filter((entry) => !entry.name.startsWith('.') && PLAIN_ARG.test(`${prefix}${entry.name}`))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const files = shown.filter((entry) => entry.type === 'file').map((entry) => `cat ${prefix}${entry.name}`);
  const folders = shown.filter((entry) => entry.type === 'dir').map((entry) => `cd ${prefix}${entry.name}`);
  return [...files, ...folders].slice(0, NEXT_MAX);
}

export default defineCommand({
  name: 'ls',
  category: 'files',
  // A usage error exits 2, as GNU ls does.
  usageStatus: 2,
  summary: 'list directory contents',
  synopsis: ['ls [OPTION]... [FILE]...'],
  flags: [
    { short: 'a', long: 'all', description: 'do not hide entries starting with ., and list . and ..' },
    { short: 'A', long: 'almost-all', description: 'do not hide entries starting with ., but leave out . and ..' },
    { short: 'C', key: 'columns', description: 'list in columns, even in a pipe' },
    { short: 'd', long: 'directory', description: 'list folders themselves, not their contents' },
    { short: 'F', long: 'classify', description: 'append an indicator: / folder, * program, @ link' },
    { short: 'h', long: 'human-readable', description: 'with -l, print sizes like 1.5K and 2.0M' },
    { short: 'l', key: 'long', description: 'use the long listing format' },
    { short: 'n', long: 'numeric-uid-gid', description: 'like -l, but list user and group IDs' },
    { short: 'p', key: 'slash', description: 'append / to folders' },
    { short: 'r', long: 'reverse', description: 'reverse the order of the sort' },
    { short: 'R', long: 'recursive', description: 'list subfolders recursively' },
    { short: 'S', key: 'size', description: 'sort by file size, largest first' },
    { short: 't', key: 'time', description: 'sort by modification time, newest first' },
    { short: '1', key: 'one', description: 'list one file per line' },
    {
      long: 'color',
      description: "colour the names: 'always', 'auto' (on the terminal, the default) or 'never'",
      value: { name: 'WHEN', source: { kind: 'enum', values: () => COLOR_WHEN }, optional: true },
    },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'any', includeParent: true }, optional: true, variadic: true }],
  examples: [
    { line: 'ls', note: 'the working directory', offline: true, starter: 4 },
    { line: 'ls -la ~', note: 'everything in home, in detail', offline: true },
    { line: 'ls -lh /etc', note: 'sizes like 1.5K', offline: true },
    { line: 'ls *.txt', note: 'the shell expands the pattern', offline: true },
    { line: 'ls -R documents', note: 'and every folder inside', offline: true },
    { line: 'ls -lt', note: 'newest first', offline: true },
  ],
  seeAlso: ['cd', 'stat', 'cat'],
  next: lsNext,
  load: () => import('./ls.run'),
});
