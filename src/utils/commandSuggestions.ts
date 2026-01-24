import themes from '../../themes.json';

const themeNames = themes.map((t) => t.name);

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

    const matches = commandNames
      .filter((cmd) => cmd.startsWith(command))
      .sort((a, b) => a.length - b.length || a.localeCompare(b));

    if (matches.length === 1 && matches[0] === command) return [];
    return matches;
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