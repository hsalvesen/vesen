import themes from '../../themes.json';
import { cathodeModes, crtQualities } from '../stores/cathode';
import { getCurrentDirectory } from './virtualFileSystem';

const themeNames = themes.map((t) => t.name);
// `off` is offered via its own `cathode off` subcommand, so the `set` list
// only surfaces the actual visual variations.
const cathodeVariations = cathodeModes.filter((m) => m !== 'off');
const weatherExamples = ['weather Gadigal', 'weather Oslo', 'weather Aotearoa'];
const curlExamples = [
  'curl explainshell.com',
  'curl https://httpbin.org/get',
];
const qrExamples = [
  'qr https://tldr.sh',
  'qr explainshell.com',
  "qr www.wikipedia.org/wiki/Computer_terminal",
  'qr shellcheck.net',
  'qr commandlinefu.com',
];

/** The most files or folders listed at once; the rest are counted on one line. */
const MAX_ENTRY_SUGGESTIONS = 6;

/**
 * The current folder's entries that start with `prefix`. Dot entries stay hidden, as in `ls`,
 * unless the prefix starts with a dot. Names sort by code point, like `ls` in the C locale, so
 * README.md comes before the lower-case names.
 */
function getCurrentDirectoryEntries(kind: 'all' | 'files' | 'directories' = 'all', prefix = ''): string[] {
  const dir = getCurrentDirectory();
  if (!dir?.children) return [];
  const showHidden = prefix.startsWith('.');

  return Object.keys(dir.children)
    .filter((name) => {
      const node = dir.children?.[name];
      if (!node || !name.startsWith(prefix)) return false;
      if (name.startsWith('.') && !showHidden) return false;

      if (kind === 'all') return true;
      if (kind === 'directories') return node.type === 'directory';
      return node.type !== 'directory';
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `cd` also offers the parent folder, when the prefix allows it. */
function cdTargets(prefix: string): string[] {
  const parent = '..'.startsWith(prefix) ? ['..'] : [];
  return [...parent, ...getCurrentDirectoryEntries('directories', prefix)];
}

/** Keeps a list of files or folders to a few lines on a phone: the first few, then a count. */
function capped(lines: string[]): string[] {
  if (lines.length <= MAX_ENTRY_SUGGESTIONS) return lines;
  return [...lines.slice(0, MAX_ENTRY_SUGGESTIONS), `… ${lines.length - MAX_ENTRY_SUGGESTIONS} more`];
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

    if (command === 'cathode') {
      return ['cathode ls', 'cathode set', 'cathode off', 'cathode quality'];
    }

    if (command === 'weather') {
      return weatherExamples;
    }

    if (command === 'qr') {
      return qrExamples;
    }

    if (command === 'cd') {
      return capped(cdTargets('').map((name) => `cd ${name}`));
    }

    if (command === 'cat') {
      return capped(getCurrentDirectoryEntries('files').map((name) => `cat ${name}`));
    }

    if (command === 'rm') {
      const files = getCurrentDirectoryEntries('files').map((name) => `rm ${name}`);
      const dirs = getCurrentDirectoryEntries('directories').map((name) => `rm -r ${name}`);
      return capped([...files, ...dirs]);
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

  if (command === 'curl') {
    const prefix = parts[1] ?? '';
    const prefixLower = prefix.toLowerCase();

    if (!prefix && endsWithSpace) {
      return curlExamples;
    }

    return curlExamples.filter((ex) => ex.toLowerCase().startsWith(`curl ${prefixLower}`));
  }

  if (command === 'qr') {
    const prefix = parts[1] ?? '';
    const prefixLower = prefix.toLowerCase();

    if (!prefix && endsWithSpace) {
      return qrExamples;
    }

    return qrExamples.filter((ex) => ex.toLowerCase().startsWith(`qr ${prefixLower}`));
  }

  if (command === 'cd') {
    return capped(cdTargets(parts[1] ?? '').map((name) => `cd ${name}`));
  }

  if (command === 'cat') {
    return capped(getCurrentDirectoryEntries('files', parts[1] ?? '').map((name) => `cat ${name}`));
  }

  if (command === 'rm') {
    const arg1 = parts[1] ?? '';

    if (arg1.startsWith('-')) {
      if (parts.length === 2 && !endsWithSpace) {
        if (arg1 === '-f') return [];
        return ['-f'].filter((opt) => opt.startsWith(arg1)).map((opt) => `rm ${opt}`);
      }

      if (arg1 === '-f') {
        return capped(getCurrentDirectoryEntries('directories', parts[2] ?? '').map((name) => `rm -f ${name}`));
      }

      return [];
    }

    return capped(getCurrentDirectoryEntries('files', arg1).map((name) => `rm ${name}`));
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

  if (command === 'cathode') {
    const subcommands = ['ls', 'set', 'off', 'quality'];
    const subcommand = parts[1] ?? '';

    if (parts.length === 2) {
      if (subcommand === 'set') {
        return cathodeVariations.map((name) => `cathode set ${name}`);
      }

      if (subcommand === 'quality') {
        return crtQualities.map((quality) => `cathode quality ${quality}`);
      }

      if (subcommands.includes(subcommand)) {
        return [];
      }

      return subcommands.filter((s) => s.startsWith(subcommand)).map((s) => `cathode ${s}`);
    }

    if (parts.length === 3 && parts[1] === 'quality') {
      const prefix = (parts[2] ?? '').toLowerCase();
      return crtQualities.filter((quality) => quality.startsWith(prefix)).map((quality) => `cathode quality ${quality}`);
    }

    if (parts.length >= 3 && parts[1] === 'set') {
      const variationPrefix = parts[2] ?? '';
      const prefixLower = variationPrefix.toLowerCase();

      if (!variationPrefix && endsWithSpace) {
        return cathodeVariations.map((name) => `cathode set ${name}`);
      }

      return cathodeVariations
        .filter((name) => name.toLowerCase().startsWith(prefixLower))
        .map((name) => `cathode set ${name}`);
    }
  }

  return [];
}