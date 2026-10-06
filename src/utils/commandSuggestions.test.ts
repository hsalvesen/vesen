// @vitest-environment happy-dom
// The legacy commands read window when they lay out output, so they need a DOM.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Suggest = (input: string) => string[];

async function freshSuggestions(): Promise<Suggest> {
  vi.resetModules();
  // The suggestions walk the VFS's tree through the legacy shim, which the shell fills.
  const { legacyAppShell } = await import('./legacyShell');
  legacyAppShell({ banner: () => '' });
  const { getCommandSuggestions } = await import('./commandSuggestions');
  const { commands } = await import('./commands');
  const names = Object.keys(commands);
  return (input) => getCommandSuggestions(input, names);
}

describe('file and folder suggestions in the home folder', () => {
  let suggest: Suggest;

  beforeEach(async () => {
    suggest = await freshSuggestions();
  });

  it('offers README.md first and hides dotfiles from cat', () => {
    expect(suggest('cat')).toEqual(['cat README.md', 'cat history.txt']);
  });

  it('shows dotfiles once the typed name starts with a dot', () => {
    expect(suggest('cat .')).toEqual(['cat .bash_history', 'cat .bashrc', 'cat .gitconfig', 'cat .profile', 'cat .vimrc']);
    expect(suggest('cd .')).toEqual(['cd ..', 'cd .local', 'cd .ssh']);
  });

  it('keeps cd and rm to a few lines, then counts the rest', () => {
    const cd = suggest('cd');
    expect(cd).toHaveLength(7);
    expect(cd.slice(0, 2)).toEqual(['cd ..', 'cd bin']);
    expect(cd[cd.length - 1]).toMatch(/^… \d+ more$/);
    expect(cd.filter((line) => /^cd \.[^.]/.test(line))).toEqual([]);

    const rm = suggest('rm');
    expect(rm).toHaveLength(7);
    expect(rm.slice(0, 2)).toEqual(['rm README.md', 'rm history.txt']);
    expect(rm[rm.length - 1]).toMatch(/^… \d+ more$/);
  });

  it('narrows by the typed prefix', () => {
    expect(suggest('cd do')).toEqual(['cd documents', 'cd downloads']);
    expect(suggest('cat R')).toEqual(['cat README.md']);
    expect(suggest('rm h')).toEqual(['rm history.txt']);
    // Folders come with -r, which rm needs for them (F017); -f comes with files.
    expect(suggest('rm -')).toEqual(['rm -r', 'rm -rf', 'rm -f']);
    expect(suggest('rm -rf do')).toEqual(['rm -rf documents', 'rm -rf downloads']);
    expect(suggest('rm -f h')).toEqual(['rm -f history.txt']);
  });
});

describe('cathode suggestions', () => {
  it('offer the quality subcommand and its values', async () => {
    const suggest = await freshSuggestions();
    expect(suggest('cathode')).toContain('cathode quality');
    expect(suggest('cathode q')).toEqual(['cathode quality']);
    expect(suggest('cathode quality')).toEqual([
      'cathode quality auto',
      'cathode quality full',
      'cathode quality lite',
      'cathode quality off',
    ]);
    expect(suggest('cathode quality l')).toEqual(['cathode quality lite']);
  });
});


describe('theme suggestions', () => {
  it('never offer a cathode command, since theme has no quality subcommand', async () => {
    const suggest = await freshSuggestions();
    expect(suggest('theme quality a')).toEqual([]);
    expect(suggest('theme quality ')).toEqual([]);
    expect(suggest('theme s')).toEqual(['theme set']);
  });
});
