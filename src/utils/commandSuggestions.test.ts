// @vitest-environment happy-dom
// The legacy file system reads window and navigator when it is built, so it needs a DOM.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Suggest = (input: string) => string[];

async function freshSuggestions(): Promise<Suggest> {
  vi.resetModules();
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
    expect(suggest('cat .')).toEqual(['cat .bashrc', 'cat .gitconfig', 'cat .profile', 'cat .vimrc']);
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

