import themes from '../../themes.json';
import { getCurrentDirectory } from './virtualFileSystem';

const themeNames = themes.map((t) => t.name);
const weatherExamples = ['weather Gadigal', 'weather Oslo', 'weather Aotearoa'];

function getCurrentDirectoryEntries(kind: 'all' | 'files' | 'directories' = 'all'): string[] {
  const dir = getCurrentDirectory();
  if (!dir?.children) return [];

  return Object.keys(dir.children)
    .sort((a, b) => a.localeCompare(b))
    .filter((name) => {
      const node = dir.children?.[name];
      if (!node) return false;

      if (kind === 'all') return true;
      if (kind === 'directories') return node.type === 'directory';
      return node.type !== 'directory';
    });
}

export function getCommandSuggestions(input: string, commandNames: string[]): string[] {
  const endsWithSpace = /\s$/.test(input);
  const normalised = input.replace(/\s+/g, ' ').trim();
  if (!normalised) return [];

  const parts = normalised.split(' ');
  const command = parts[0];

  if (parts.length === 1) {
    if (command === 'theme') {
      return ['theme ls', 'theme set'];
    }

    if (command === 'weather') {
      return weatherExamples;
    }

    if (command === 'cd') {
      const dirs = getCurrentDirectoryEntries('directories');
      return ['..', ...dirs].map((name) => `cd ${name}`);
    }

    if (command === 'cat' || command === 'rm') {
      const files = getCurrentDirectoryEntries('files');
      return files.map((name) => `${command} ${name}`);
    }

    const matches = commandNames
      .filter((cmd) => cmd.startsWith(command))
      .sort((a, b) => a.length - b.length || a.localeCompare(b));

    if (matches.length === 1 && matches[0] === command) return [];
    return matches;
  }

  if (command === 'weather') {
    const prefix = parts[1] ?? '';
    const prefixLower = prefix.toLowerCase();

    if (!prefix && endsWithSpace) {
      return weatherExamples;
    }

    return weatherExamples.filter((ex) => ex.toLowerCase().startsWith(`weather ${prefixLower}`));
  }

  if (command === 'cd') {
    const prefix = parts[1] ?? '';

    const entries = ['..', ...getCurrentDirectoryEntries('directories')];
    if (!prefix && endsWithSpace) {
      return entries.map((name) => `cd ${name}`);
    }

    return entries.filter((name) => name.startsWith(prefix)).map((name) => `cd ${name}`);
  }

  if (command === 'cat' || command === 'rm') {
    const prefix = parts[1] ?? '';

    const entries = getCurrentDirectoryEntries('files');
    if (!prefix && endsWithSpace) {
      return entries.map((name) => `${command} ${name}`);
    }

    return entries.filter((name) => name.startsWith(prefix)).map((name) => `${command} ${name}`);
  }

  if (command === 'theme') {
    const subcommands = ['ls', 'set'];
    const subcommand = parts[1] ?? '';

    if (parts.length === 2) {
      if (subcommand === 'set') {
        return themeNames.map((name) => `theme set ${name}`);
      }

      if (subcommands.includes(subcommand)) {
        return [];
      }

      return subcommands.filter((s) => s.startsWith(subcommand)).map((s) => `theme ${s}`);
    }

    if (parts.length >= 3 && parts[1] === 'set') {
      const themePrefix = parts[2] ?? '';
      const prefixLower = themePrefix.toLowerCase();

      if (!themePrefix && endsWithSpace) {
        return themeNames.map((name) => `theme set ${name}`);
      }

      return themeNames
        .filter((name) => name.toLowerCase().startsWith(prefixLower))
        .map((name) => `theme set ${name}`);
    }
  }

  return [];
}