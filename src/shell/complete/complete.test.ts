// The completion table (docs/plan/03-terminal-input.md, acceptance checks): what one Tab does to
// a line, against the real specs and the seed's files, plus a few files with awkward names.
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lex } from '../lexer';
import { at, completionHarness, type CompletionHarness } from '../../testing/completion-env';
import { accept, complete } from './engine';
import { pressTab } from './tab';
import { TAB_IDLE, type CompletionEnv, type EditState } from './types';

let h: CompletionHarness;
let env: CompletionEnv;

beforeAll(async () => {
  h = await completionHarness();
  env = h.env;
  const fs = h.app.vfs;
  fs.writeFile('/home/guest/documents/my notes.txt', 'notes');
  fs.writeFile("/home/guest/documents/it's.txt", 'quote');
  fs.mkdir('/home/guest/my dir');
  fs.writeFile('/home/guest/my dir/a.txt', 'a');
  fs.mkdir('/home/guest/odd');
  for (const name of ['a$b', '#tag', 'x*y', 'q&a', 'big!']) fs.writeFile(`/home/guest/odd/${name}`, name);
  await h.run('weather Paris >/dev/null 2>&1');
});

afterAll(() => h.stop());

/** The line with the cursor shown as ‸ when it is not at the end. */
function show(state: EditState): string {
  return state.cursor === state.text.length ? state.text : `${state.text.slice(0, state.cursor)}‸${state.text.slice(state.cursor)}`;
}

/** What one Tab does: the new line, the list it shows, 'BELL', or the question it asks. */
function tab(line: string, environment: CompletionEnv = env): string | string[] {
  const step = pressTab(TAB_IDLE, at(line), environment);
  if (step.effect.bell === true) return 'BELL';
  if (step.effect.edit !== undefined) return show(step.effect.edit);
  if (step.tab.phase === 'listed') return step.tab.result.candidates.map((c) => c.label);
  if (step.tab.phase === 'asking') return `ASK ${step.tab.result.total}`;
  return 'NOTHING';
}

describe('command names', () => {
  it.each([
    ['ca', 'cat'],
    ['c', ['cat', 'cathode', 'cd', 'clear', 'command', 'contact', 'cp', 'curl']],
    ['he', 'help '],
    ['the', 'theme '],
    ['theme', 'theme '],
    ['logo', 'logout '],
    ['my-s', 'my-script '],
    ['CATH', 'cathode '],
    ['constructor', 'BELL'],
    ['__proto__', 'BELL'],
    ['~/bin/d', '~/bin/deploy '],
  ])('%s -> %j', (line, expected) => {
    expect(tab(line)).toEqual(expected);
  });

  it('completes after | || && ; & and inside $( )', () => {
    expect(tab('ls | ca')).toBe('ls | cat');
    expect(tab('ls || he')).toBe('ls || help ');
    expect(tab('ls && he')).toBe('ls && help ');
    expect(tab('ls; he')).toBe('ls; help ');
    expect(tab('sleep 1 & he')).toBe('sleep 1 & help ');
    expect(tab('echo $(he')).toBe('echo $(help ');
    // Nothing is called gr: still a command name, so the bell.
    expect(complete(at('ls | gr'), env).slot).toBe('command');
    expect(tab('ls | gr')).toBe('BELL');
  });

  it('treats sudo, time, env and command as running the rest, and skips assignments', () => {
    expect(tab('sudo ca')).toBe('sudo cat');
    expect(tab('sudo he')).toBe('sudo help ');
    expect(tab('time he')).toBe('time help ');
    expect(tab('env FOO=1 he')).toBe('env FOO=1 help ');
    expect(tab('command he')).toBe('command help ');
    expect(tab('FOO=1 he')).toBe('FOO=1 help ');
    expect(tab('sudo theme k')).toEqual(['kangaroo', 'kookaburra']);
  });

  it('lists every command, with its summary, on an empty line', () => {
    const result = complete(at(''), env);
    expect(result.slot).toBe('command');
    expect(result.candidates.map((c) => c.value)).toEqual(expect.arrayContaining(['help', 'ls', 'theme', 'weather', 'll']));
    expect(result.candidates.find((c) => c.value === 'help')?.summary).toBe(env.registry.get('help')?.summary);
    // Hidden commands stay hidden.
    expect(result.candidates.some((c) => c.value === 'login')).toBe(false);
  });

  it('offers near command names when nothing matches', () => {
    expect(complete(at('fastfecth'), env).near).toEqual(['fastfetch']);
    expect(complete(at('constructor'), env).near).toBeUndefined();
  });
});

describe('subcommands and enums', () => {
  it.each([
    // Where a subcommand goes, the first operand may stand instead: the subcommands, then the themes by name.
    ['theme ', ['ls', 'cassowary', 'cockatoo', 'crocodile', 'galah', 'kangaroo', 'kookaburra', 'lorikeet', 'magpie', 'petroica', 'platypus', 'quokka', 'swamphen', 'treefrog', 'wallaby', 'wombat']],
    ['theme s', 'theme swamphen '],
    ['theme l', ['ls', 'lorikeet']],
    ['theme ls', 'theme ls '],
    ['theme lo', 'theme lorikeet '],
    ['theme sw', 'theme swamphen '],
    ['theme SW', 'theme swamphen '],
    ['theme k', ['kangaroo', 'kookaburra']],
    ['theme w', ['wallaby', 'wombat']],
    ['theme wa', 'theme wallaby '],
    ['theme zz', 'BELL'],
    // `set` is no subcommand and no theme.
    ['theme set', 'BELL'],
    ['theme set w', 'BELL'],
    ['cathode ', ['ls', 'set', 'off', 'quality', 'phosphor', 'scanlines', 'vintage']],
    ['cathode q', 'cathode quality '],
    ['cathode o', 'cathode off '],
    ['cathode s', ['set', 'scanlines']],
    ['cathode v', 'cathode vintage '],
    ['cathode quality ', ['auto', 'full', 'lite', 'off']],
    ['cathode quality l', 'cathode quality lite '],
    ['cathode set p', 'cathode set phosphor '],
    ['ls --color=al', 'ls --color=always '],
    ['ls --color=', ['always', 'auto', 'never']],
    ['set -o ', 'set -o no'],
    ['set -o noc', 'set -o noclobber '],
  ])('%s -> %j', (line, expected) => {
    expect(tab(line)).toEqual(expected);
  });

  it('gives theme names their background as a swatch', () => {
    const result = complete(at('theme k'), env);
    expect(result.candidates.map((c) => c.swatch)).toEqual(['#262626', '#222222']);
    const all = complete(at('theme '), env);
    expect(all.candidates.filter((c) => c.kind === 'value').map((c) => c.swatch)).toEqual(env.appearance?.themes().map((theme) => theme.background));
  });

  it("looks ahead when the word is typed in full: 'theme' still offers ls and every theme", () => {
    const result = complete(at('theme'), env);
    expect(result.candidates.map((c) => c.value)).toEqual(['theme']);
    const themes = env.appearance?.themes().map((theme) => theme.name.toLowerCase()) ?? [];
    expect(themes).toHaveLength(15);
    expect(result.next?.candidates.map((c) => c.value)).toEqual(['ls', ...themes]);
    expect(result.next?.total).toBe(16);
    // A word with nothing enumerable after it has no lookahead.
    expect(complete(at('pwd'), env).next).toBeUndefined();
  });
});

describe('flags', () => {
  it('lists --all and --almost-all with their descriptions for ls --al', () => {
    expect(tab('ls --al')).toEqual(['--all', '--almost-all']);
    const result = complete(at('ls --al'), env);
    expect(result.candidates.map((c) => c.summary)).toEqual(
      (env.registry.get('ls')?.flags ?? []).filter((f) => f.long === 'all' || f.long === 'almost-all').map((f) => f.description),
    );
  });

  it.each([
    ['ls --alm', 'ls --almost-all '],
    ['rm --rec', 'rm --recursive '],
    ['ls --he', 'ls --help '],
    ['mkdir --mo', 'mkdir --mode='],
    ['cat -- -', 'BELL'],
  ])('%s -> %j', (line, expected) => {
    expect(tab(line)).toEqual(expected);
  });

  it('offers only the flags rm implements, in declared order, and --help (F017)', () => {
    const rm = env.registry.get('rm');
    const declared = (rm?.flags ?? []).flatMap((f) => [f.short && `-${f.short}`, f.long && `--${f.long}`].filter((x): x is string => !!x));
    expect(complete(at('rm -'), env).candidates.map((c) => c.value)).toEqual([...declared, '--help']);
  });

  it('does not offer a flag again once it is given, through an alias too', () => {
    const after = complete(at('ls -a -'), env).candidates.map((c) => c.value);
    expect(after).not.toContain('-a');
    expect(after).not.toContain('--all');
    expect(after).toContain('-A');
    // ll is ls -la, from ~/.bashrc.
    const ll = complete(at('ll -'), env).candidates.map((c) => c.value);
    expect(ll).not.toContain('-l');
    expect(ll).not.toContain('-a');
    expect(ll).toContain('-h');
  });

  it('offers cd its -L and -P', () => {
    expect(tab('cd -')).toEqual(['-L', '-P', '--help']);
  });
});

describe('paths', () => {
  it.each([
    ['cd doc', 'cd documents/'],
    ['cd do', ['documents/', 'downloads/']],
    ['cat documents/li', 'cat documents/linux.txt '],
    ['cd ../../e', 'cd ../../etc/'],
    ['cat ~/.s', 'cat ~/.ssh/'],
    ['cat ~/.ssh/c', 'cat ~/.ssh/config '],
    ['cd ~/doc', 'cd ~/documents/'],
    ['cd ~', 'cd ~/'],
    ['cd ..', 'cd ../'],
    ['cat readme', 'cat README.md '],
    ['cat Documents/li', 'cat documents/linux.txt '],
    ['cat /etc/hostn', 'cat /etc/hostname '],
    ['ls /usr/b', 'ls /usr/bin/'],
    ['cat $HOME/documents/li', 'cat $HOME/documents/linux.txt '],
    ['cat ${HOME}/documents/li', 'cat ${HOME}/documents/linux.txt '],
    ['cat README.md', 'cat README.md '],
    ['cat README.md‸ x', 'cat README.md ‸x'],
    ['cd docu‸ ls', 'cd documents/‸ ls'],
    ['FOO=~/doc', 'FOO=~/documents/'],
    ['echo ~/doc', 'echo ~/documents/'],
    // Free text may still name a file, as bash completes one: echo, printf, test and [.
    ['echo REA', 'echo README.md '],
    ['printf %s REA', 'printf %s README.md '],
    ['test -f REA', 'test -f README.md '],
    ['[ -d doc', '[ -d documents/'],
    // And past the = of export's and env's NAME=VALUE, the value is a path.
    ['export DOCS=~/doc', 'export DOCS=~/documents/'],
    ['env X=~/doc', 'env X=~/documents/'],
    ['export PA', ['PAGER', 'PATH']],
    ['cat /root/', 'BELL'],
    ['cat nope/', 'BELL'],
    ['nosuchcmd READ', 'nosuchcmd README.md '],
    ['pwd ', 'BELL'],
    ['ls # READ', 'BELL'],
  ])('%s -> %j', (line, expected) => {
    expect(tab(line)).toEqual(expected);
  });

  it('completes redirection targets as paths', () => {
    expect(tab('echo hi > ~/do')).toEqual(['documents/', 'downloads/']);
    expect(tab('echo hi >~/doc')).toBe('echo hi >~/documents/');
    expect(tab('cat < READ')).toBe('cat < README.md ');
    expect(tab('ls 2>/dev/nu')).toBe('ls 2>/dev/null ');
    expect(complete(at('echo hi > ~/do'), env).slot).toBe('redirect');
  });

  it('shows dotfiles only once a dot is typed', () => {
    const plain = complete(at('cat '), env).candidates.map((c) => c.value);
    expect(plain).toContain('README.md');
    expect(plain.some((v) => v.startsWith('.'))).toBe(false);
    expect(complete(at('cat .'), env).candidates.map((c) => c.value)).toEqual([
      '.bash_history',
      '.bashrc',
      '.gitconfig',
      '.local/',
      '.profile',
      '.ssh/',
      '.vimrc',
    ]);
    // cd offers the parent folder too.
    expect(complete(at('cd .'), env).candidates.map((c) => c.value)).toEqual(['../', '.local/', '.ssh/']);
  });

  it('offers folders only to cd, and files and folders to cat', () => {
    const cd = complete(at('cd '), env);
    expect(cd.candidates.every((c) => c.kind === 'dir')).toBe(true);
    expect(cd.candidates[0]?.value).toBe('../');
    const cat = complete(at('cat '), env).candidates.map((c) => c.kind);
    expect(cat).toContain('dir');
    expect(cat).toContain('file');
  });

  it('quotes and escapes names with spaces and quotes', () => {
    expect(tab('cat "documents/my no')).toBe('cat "documents/my notes.txt" ');
    expect(tab('cat documents/my')).toBe('cat documents/my\\ notes.txt ');
    expect(tab("cat 'documents/my")).toBe("cat 'documents/my notes.txt' ");
    expect(tab('cat documents/my\\ n')).toBe('cat documents/my\\ notes.txt ');
    expect(tab('cat documents/it')).toBe("cat documents/it\\'s.txt ");
    expect(tab('cat "documents/it')).toBe('cat "documents/it\'s.txt" ');
    expect(tab("cat 'documents/it")).toBe("cat 'documents/it'\\''s.txt' ");
    expect(tab('cd my')).toBe('cd my\\ dir/');
    expect(tab('cd "my')).toBe('cd "my dir/');
    expect(tab('cat "my dir/')).toBe('cat "my dir/a.txt" ');
  });

  it('escapes what the shell would read: $ * & ! and a # only at the start of a word', () => {
    expect(tab('cat odd/a')).toBe('cat odd/a\\$b ');
    expect(tab('cat odd/x')).toBe('cat odd/x\\*y ');
    expect(tab('cat odd/q')).toBe('cat odd/q\\&a ');
    expect(tab('cat odd/b')).toBe('cat odd/big\\! ');
    expect(tab('cat odd/%23'.replace('%23', '#'))).toBe('cat odd/#tag ');
    expect(tab('cat "odd/b')).toBe('cat "odd/big"\\!"" ');
  });

  it('closes a quote the cursor is already before, without doubling it', () => {
    expect(tab('cat "README‸"')).toBe('cat "README.md" ');
  });

  it("completes from where cd went: 'cd ../../../e' from ~/documents", async () => {
    await h.run('cd documents');
    try {
      expect(tab('cd ../../../e')).toBe('cd ../../../etc/');
      expect(tab('cat li')).toBe('cat linux.txt ');
    } finally {
      await h.run('cd');
    }
  });

  it('asks before listing more than 100 names', async () => {
    h.app.vfs.mkdir('/home/guest/many');
    for (let i = 0; i < 150; i += 1) h.app.vfs.writeFile(`/home/guest/many/f${String(i).padStart(3, '0')}`, '');
    try {
      expect(tab('cat many/')).toBe('cat many/f');
      expect(tab('cat many/f')).toBe('ASK 150');
      expect(tab('cat many/f1')).toEqual(['f100', 'f101', 'f102', 'f103', 'f104', 'f105', 'f106', 'f107', 'f108', 'f109', 'f110', 'f111', 'f112', 'f113', 'f114', 'f115', 'f116', 'f117', 'f118', 'f119', 'f120', 'f121', 'f122', 'f123', 'f124', 'f125', 'f126', 'f127', 'f128', 'f129', 'f130', 'f131', 'f132', 'f133', 'f134', 'f135', 'f136', 'f137', 'f138', 'f139', 'f140', 'f141', 'f142', 'f143', 'f144', 'f145', 'f146', 'f147', 'f148', 'f149']);
    } finally {
      h.app.vfs.rm('/home/guest/many', { recursive: true });
    }
  });
});

describe('variables, aliases and commands as values', () => {
  it.each([
    ['echo $HO', ['$HOME', '$HOSTNAME']],
    ['echo $HOM', 'echo $HOME '],
    ['echo "$HOM', 'echo "$HOME" '],
    ['echo ${HOM', 'echo ${HOME} '],
    ["echo '$HOM", 'BELL'],
    ['echo \\$HOM', 'BELL'],
    ['export HOM', 'export HOME '],
    ['unalias l', ['l', 'la', 'll']],
    ['help ca', 'help cat'],
    ['which the', 'which theme '],
  ])('%s -> %j', (line, expected) => {
    expect(tab(line)).toEqual(expected);
  });

  it('completes man pages from the commands, not the aliases', () => {
    const labels = complete(at('man l'), env).candidates.map((c) => c.value);
    expect(labels).toEqual(expect.arrayContaining(['ln', 'logout', 'ls']));
    expect(labels).not.toContain('ll');
  });
});

describe('examples and history', () => {
  it("offers weather's curated places, and places from history", () => {
    expect(complete(at('weather '), env).candidates.map((c) => c.value)).toEqual(['Aotearoa', 'Gadigal', 'Oslo', 'Paris']);
    expect(tab('weather o')).toBe('weather Oslo ');
    expect(tab('weather p')).toBe('weather Paris ');
  });

  it.each([
    ['stock t', 'stock TEAM '],
    ['qr https://t', 'qr https://tldr.sh '],
  ])('%s -> %j', (line, expected) => {
    expect(tab(line)).toEqual(expected);
  });

  it('gives a dim placeholder for the argument, never a candidate', () => {
    expect(complete(at('cat '), env).placeholder).toBe('FILE');
    expect(complete(at('echo '), env).placeholder).toBe('text');
    expect(complete(at('weather '), env).placeholder).toBe('PLACE');
    expect(complete(at('ls'), env).placeholder).toBeUndefined();
  });
});

describe('never throws', () => {
  const alphabet = fc.constantFrom(...'aZ.~/-_ =$"\'\\|&;<>(){}`#!*?[]0\n\t'.split(''), 'cat ', 'theme ', 'sudo ', '$(', '${', '--', 'é', '😀');
  const line = fc.array(alphabet, { maxLength: 30 }).map((parts) => parts.join(''));

  it('on any line and any cursor', () => {
    fc.assert(
      fc.property(line, fc.integer({ min: -5, max: 40 }), (text, cursor) => {
        const result = complete({ text, cursor }, env);
        expect(result.candidates.length).toBeLessThanOrEqual(200);
        for (const candidate of result.candidates) {
          // Every candidate shares the common prefix.
          expect(candidate.value.startsWith(result.common)).toBe(true);
          accept(result, candidate, 'final');
        }
      }),
      { numRuns: 400 },
    );
  });

  it('on a cursor that is not a number', () => {
    expect(() => complete({ text: 'ls', cursor: Number.NaN }, env)).not.toThrow();
  });
});

describe('accept round-trips through the lexer', () => {
  const chars = fc.constantFrom(...'abc z\'"\\$*~|>;&!#{'.split(''));
  // A leading ~ is the visitor's own, and expands; a leading dot is a hidden file.
  const name = fc.array(chars, { minLength: 1, maxLength: 12 }).map((parts) => parts.join('')).filter((n) => !n.startsWith('~') && !n.startsWith('.'));

  it.each([['none', ''], ['single', "'"], ['double', '"']])('in %s quotes, the word reads back as the name', (_, opener) => {
    fc.assert(
      fc.property(name, (file) => {
        const one: CompletionEnv = { ...env, fs: { list: (dir) => (dir === '/home/guest' ? [{ name: file, type: 'file' }] : env.fs.list(dir)) } };
        const result = complete({ text: `cat ${opener}`, cursor: 4 + opener.length }, one);
        const candidate = result.candidates[0];
        expect(candidate?.value).toBe(file);
        if (candidate === undefined) return;
        const done = accept(result, candidate, 'final');
        const lexed = lex(done.text);
        expect(lexed.complete).toBe(true);
        const words = lexed.tokens.filter((t) => t.kind === 'word');
        expect(words).toHaveLength(2);
        const word = words[1];
        if (word?.kind !== 'word') return;
        expect(word.parts.every((part) => part.kind === 'lit')).toBe(true);
        expect(word.parts.map((part) => (part.kind === 'lit' ? part.text : '')).join('')).toBe(file);
        expect(done.text.endsWith(' ')).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
