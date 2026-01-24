export function getCommandSuggestions(input: string, commandNames: string[]): string[] {
  const prefix = input.trim();
  if (!prefix || prefix.includes(' ')) return [];

  const matches = commandNames
    .filter((cmd) => cmd.startsWith(prefix))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));

  if (matches.length === 1 && matches[0] === prefix) return [];
  return matches;
}