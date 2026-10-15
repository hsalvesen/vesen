// The repository's own documents: every relative link and image in its Markdown points at a file
// that is there, and the README's banner is the terminal's, each row as wide as the widest, since
// GitHub centres each row of a <pre> on its own and a shorter row would sit half a letter off.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BANNER_ROWS } from '../../src/commands/lib/banner';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** The Markdown files under a folder, leaving out node_modules and tools' dot-folders. */
function markdown(folder: string): string[] {
  return readdirSync(join(ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : markdown(path);
    return entry.name.endsWith('.md') ? [relative(ROOT, join(ROOT, path))] : [];
  });
}

const DOCUMENTS = ['README.md', ...['docs', '.github', 'scripts', 'tests', 'worker'].flatMap(markdown)];

/** The relative targets of a document's links and images, outside its code. */
function targets(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const found = [
    ...Array.from(prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g), (match) => match[1]),
    ...Array.from(prose.matchAll(/\b(?:src|href)="([^"]+)"/g), (match) => match[1]),
  ];
  return found.filter((target): target is string => target !== undefined && !/^[a-z][a-z+.-]*:/i.test(target) && !target.startsWith('#'));
}

describe('the Markdown documents', () => {
  it('include the README, the docs and the contributor files', () => {
    expect(DOCUMENTS).toEqual(expect.arrayContaining(['README.md', 'docs/CHANGELOG.md', '.github/CONTRIBUTING.md', 'worker/stock/README.md']));
  });

  it.each(DOCUMENTS)('%s links only to files that are there', (path) => {
    const missing = targets(read(path)).filter((target) => {
      const file = decodeURIComponent(target.replace(/[#?].*$/, ''));
      if (file === '') return false;
      // GitHub reads a link that starts with / from the top of the repository.
      return !existsSync(file.startsWith('/') ? join(ROOT, file) : join(ROOT, dirname(path), file));
    });
    expect(missing).toEqual([]);
  });
});

describe("the README's banner", () => {
  const rows = /<pre>\n([\s\S]*?)\n<\/pre>/.exec(read('README.md'))?.[1]?.split('\n') ?? [];

  it("is the terminal's", () => {
    expect(rows.map((row) => row.trimEnd())).toEqual([...BANNER_ROWS]);
  });

  it('has each row as wide as the widest, so that centring each row keeps the letters in line', () => {
    const width = Math.max(...BANNER_ROWS.map((row) => row.length));
    expect(rows.map((row) => row.length)).toEqual(rows.map(() => width));
  });
});
