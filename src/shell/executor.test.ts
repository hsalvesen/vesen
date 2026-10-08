// Transcripts through the kernel with stand-in commands (src/testing/shell-harness.ts): lists,
// && and ||, pipes, redirection, expansion, statuses, errors, ^C and the network deadline.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTrustedAction, lineText, type Block, type Span } from '../output/model';
import type { Opener } from '../services/types';
import { fakeOpener } from '../testing/opener';
import { harness, sampleTree } from '../testing/shell-harness';
import type { VirtualFile } from '../vfs/types';
import { MAX_SCRIPT_DEPTH } from './executor';
import { defineCommand } from './types';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function spans(blocks: readonly Block[]): Span[] {
  return blocks.flatMap((block) => (block.type === 'lines' ? block.lines.flat() : []));
}

describe('lists and && / ||', () => {
  it('pipes echo into wc', async () => {
    const { run } = harness();
    expect(await run('echo a b | wc -w')).toMatchObject({ status: 0, stdout: '2', stderr: '' });
  });

  it('runs the right side of || only after a failure, and of && only after a success', async () => {
    const { run } = harness();
    expect(await run('false || echo x')).toMatchObject({ status: 0, stdout: 'x' });
    expect(await run('true || echo x')).toMatchObject({ status: 0, stdout: '' });
    expect(await run('false && echo x')).toMatchObject({ status: 1, stdout: '' });
    expect(await run('false && echo x || echo y')).toMatchObject({ status: 0, stdout: 'y' });
    expect(await run('true; false; echo $?')).toMatchObject({ stdout: '1' });
  });

  it('negates a pipeline with !', async () => {
    const { run } = harness();
    expect((await run('! false; echo $?')).stdout).toBe('0');
    expect((await run('! true; echo $?')).stdout).toBe('1');
  });

  it('sets $? and the lastStatus store after every line', async () => {
    const { run, shell } = harness();
    await run('false');
    expect(shell.lastStatus.get()).toBe(1);
    expect((await run('echo $?')).stdout).toBe('1');
    expect(shell.lastStatus.get()).toBe(0);
  });

  it('runs a backgrounded command in the foreground, with a notice', async () => {
    const { run } = harness();
    const result = await run('echo hi &');
    expect(result.stdout).toBe('hi');
    expect(result.stderr).toContain('no job control');
  });
});

describe('pipelines', () => {
  it('end at once when the reader is done: yes | head -n 2, with the writer’s 141 hidden', async () => {
    const { run } = harness();
    const started = Date.now();
    const result = await run('yes | head -n 2');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result).toMatchObject({ status: 0, stdout: 'y\ny', stderr: '' });
    expect((await run('yes | head -n 1; echo $?')).stdout).toBe('y\n0');
  });

  it('take the status of the last stage', async () => {
    const { run } = harness();
    expect((await run('false | true')).status).toBe(0);
    expect((await run('true | false')).status).toBe(1);
  });

  it('carry plain text between stages, and spans keep only their text', async () => {
    const { run } = harness();
    expect((await run('lss 2>&1 | cat')).stdout).toBe("vesen: lss: command not found\nDid you mean ls? Type 'help' to see all commands.");
  });
});

describe('redirection', () => {
  it('writes a file that cat reads back, through the VFS', async () => {
    const { run, tree } = harness();
    expect(await run('echo hi > f; cat f')).toMatchObject({ status: 0, stdout: 'hi' });
    expect(tree.children?.home?.children?.guest?.children?.f?.content).toBe('hi\n');
  });

  it('appends with >>, and truncates with > before the command reads', async () => {
    const { run, fs } = harness();
    await run('echo one > f; echo two >> f');
    expect(fs.readFile('/home/guest/f')).toBe('one\ntwo\n');
    expect(await run('cat f > f; cat f')).toMatchObject({ status: 0, stdout: '' });
  });

  it('sends stderr away with 2>/dev/null, and $? still reports the failure', async () => {
    const { run } = harness();
    expect(await run('cat nope 2>/dev/null; echo $?')).toMatchObject({ stdout: '1', stderr: '' });
    expect(await run('cat nope 2>/dev/null || echo missing')).toMatchObject({ stdout: 'missing', stderr: '' });
  });

  it('applies redirections left to right: > f 2>&1 versus 2>&1 > f', async () => {
    const { run, fs } = harness();
    expect(await run('cat nope > both 2>&1')).toMatchObject({ stdout: '', stderr: '' });
    expect(fs.readFile('/home/guest/both')).toBe('cat: nope: No such file or directory\n');
    expect(await run('cat nope 2>&1 > out')).toMatchObject({ stdout: 'cat: nope: No such file or directory' });
    expect(fs.readFile('/home/guest/out')).toBe('');
    await run('cat a.txt nope &> all');
    expect(fs.readFile('/home/guest/all')).toBe('alpha\ncat: nope: No such file or directory\n');
    expect((await run('echo to-err >&2')).stderr).toBe('to-err');
    await run('cat nope 2> err; cat nope 2>> err');
    expect(fs.readFile('/home/guest/err')).toBe('cat: nope: No such file or directory\n'.repeat(2));
  });

  it('reads stdin from a file with <, and from a word with <<<', async () => {
    const { run } = harness();
    expect((await run('cat < a.txt')).stdout).toBe('alpha');
    expect((await run("wc -w <<< 'a b c'")).stdout).toBe('3');
    expect((await run('cat < /dev/null; echo end')).stdout).toBe('end');
  });

  it('reports a target it cannot open, and does not run the command', async () => {
    const { run } = harness();
    expect(await run('echo x > /nope/f')).toMatchObject({ status: 1, stdout: '', stderr: 'vesen: /nope/f: No such file or directory' });
    expect(await run('cat < missing')).toMatchObject({ status: 1, stderr: 'vesen: missing: No such file or directory' });
    expect(await run('echo x > docs')).toMatchObject({ status: 1, stderr: 'vesen: docs: Is a directory' });
  });

  it('refuses an ambiguous redirect', async () => {
    const { run } = harness();
    expect(await run('echo x > *.txt')).toMatchObject({ status: 1, stderr: 'vesen: *.txt: ambiguous redirect' });
  });

  it('truncates with a redirection alone', async () => {
    const { run, fs } = harness();
    await run('> a.txt');
    expect(fs.readFile('/home/guest/a.txt')).toBe('');
  });
});

describe('expansion', () => {
  it('expands variables, globs, ~ and command substitution', async () => {
    const { run } = harness();
    expect((await run('echo *.txt')).stdout).toBe('a.txt b.txt');
    expect((await run('echo ~ ~/x')).stdout).toBe('/home/guest /home/guest/x');
    expect((await run(`echo $(echo hi) "$(echo 'a  b')"`)).stdout).toBe('hi a  b');
    expect((await run('echo $((6 * 7))')).stdout).toBe('42');
    expect((await run('echo "$HOME" $USER $HOSTNAME')).stdout).toBe('/home/guest guest vesen');
  });

  it('sets shell variables with a bare assignment, and a command’s environment with a prefix', async () => {
    const { run } = harness();
    expect((await run('A=1; echo $A')).stdout).toBe('1');
    expect((await run('printenv A; echo $?')).stdout).toBe('1');
    expect((await run('B=2 printenv B; echo "[$B]"')).stdout).toBe('2\n[]');
  });

  it('reports a bad substitution without running the command', async () => {
    const { run } = harness();
    expect(await run('echo ${A/x/y}')).toMatchObject({ status: 1, stderr: 'vesen: ${A/x/y}: not supported in vesen' });
  });
});

describe('statuses and errors', () => {
  it('says command not found with status 127, a tappable did-you-mean, and one bell', async () => {
    const h = harness();
    const result = await h.run('lss -a');
    expect(result.status).toBe(127);
    expect(result.stderr).toBe("vesen: lss: command not found\nDid you mean ls? Type 'help' to see all commands.");
    const suggestion = spans(result.blocks).find((span) => span.action !== undefined);
    expect(suggestion?.text).toBe('ls');
    expect(isTrustedAction(suggestion?.action)).toBe(true);
    expect(suggestion?.action).toMatchObject({ kind: 'run', line: 'ls -a' });
    expect(h.bells).toBe(1);
  });

  it('does not repeat words that are not plain in the did-you-mean line', async () => {
    const { run } = harness();
    const result = await run('lss "a b"');
    expect(spans(result.blocks).find((span) => span.action)?.action).toMatchObject({ line: 'ls' });
  });

  it('keeps the hint for a glued --help, and for commands from elsewhere', async () => {
    const { run } = harness();
    expect(spans((await run('pwd--help')).blocks).find((span) => span.action)?.action).toMatchObject({ line: 'pwd --help' });
    expect((await run('apt install x')).stderr).toBe('vesen: apt: command not found\nvesen has no package manager.');
    expect((await run('qqqq')).stderr).toBe("vesen: qqqq: command not found\nType 'help' to see all commands.");
  });

  // Before, the engine's own words reached the visitor: `md5sum: Invalid string length`.
  it("words an engine's failure to make a string or an array that large as GNU's memory exhausted", async () => {
    const { run } = harness({
      specs: [
        defineCommand({ name: 'huge', category: 'text', summary: 'x', run: () => Promise.reject(new RangeError('Invalid string length')) }),
        defineCommand({ name: 'wide', category: 'text', summary: 'x', run: () => Promise.reject(new RangeError('Invalid array length')) }),
        defineCommand({ name: 'jsc', category: 'text', summary: 'x', run: () => Promise.reject(new RangeError('Out of memory')) }),
        defineCommand({ name: 'other', category: 'text', summary: 'x', run: () => Promise.reject(new RangeError('Invalid time value')) }),
      ],
    });
    expect(await run('huge')).toMatchObject({ status: 1, stderr: 'huge: memory exhausted' });
    expect((await run('wide')).stderr).toBe('wide: memory exhausted');
    expect((await run('jsc')).stderr).toBe('jsc: memory exhausted');
    // Any other range error keeps its own words.
    expect((await run('other')).stderr).toBe('other: Invalid time value');
  });

  it('never runs an inherited name such as constructor', async () => {
    const { run } = harness();
    expect((await run('constructor')).status).toBe(127);
    expect((await run('__proto__')).status).toBe(127);
  });

  it('words an unknown option as coreutils does, with status 1, or 2 for a builtin or a spec that says so', async () => {
    const { run } = harness({
      specs: [
        defineCommand({ name: 'bi', category: 'shell', summary: 'x', builtin: true, run: () => 0 }),
        defineCommand({ name: 'two', category: 'files', summary: 'x', usageStatus: 2, run: () => 0 }),
      ],
    });
    expect(await run('wc -z')).toMatchObject({ status: 1, stderr: "wc: invalid option -- 'z'\nTry 'wc --help' for more information." });
    expect(await run('bi -z')).toMatchObject({ status: 2, stderr: "vesen: bi: invalid option -- 'z'\nTry 'bi --help' for more information." });
    expect(await run('two -z')).toMatchObject({ status: 2, stderr: "two: invalid option -- 'z'\nTry 'two --help' for more information." });
  });

  it('answers --help from the spec, and -h too when the spec has no h flag', async () => {
    const { run } = harness();
    const help = await run('wc --help');
    expect(help.status).toBe(0);
    expect(help.blocks.map((block) => block.type)).toEqual(['panel', 'panel', 'panel', 'lines']);
    expect(help.stdout).toContain('-w, --words');
    expect((await run('wc -h')).blocks[0]?.type).toBe('panel');
  });

  it('maps a UsageError to 1 (2 for a builtin), a VfsError to its strerror text and other errors to 1', async () => {
    const { UsageError } = await import('./types');
    const { VfsError } = await import('../vfs/types');
    const { run } = harness({
      specs: [
        defineCommand({ name: 'usage', category: 'shell', summary: 'x', run: () => { throw new UsageError('missing operand'); } }),
        defineCommand({ name: 'vfs', category: 'shell', summary: 'x', run: () => { throw new VfsError('EACCES', '/etc/shadow'); } }),
        defineCommand({ name: 'boom', category: 'shell', summary: 'x', run: () => { throw new Error('kaput'); } }),
      ],
    });
    expect(await run('usage')).toMatchObject({ status: 1, stderr: "usage: missing operand\nTry 'usage --help' for more information." });
    expect(await run('vfs')).toMatchObject({ status: 1, stderr: 'vfs: /etc/shadow: Permission denied' });
    expect(await run('boom')).toMatchObject({ status: 1, stderr: 'boom: kaput' });
  });

  it('reports syntax errors and unfinished lines with status 2 and the bell', async () => {
    const h = harness();
    expect(await h.run('| x')).toMatchObject({ status: 2, stderr: "vesen: syntax error near unexpected token '|'" });
    expect(await h.run('for i in a; do echo $i; done')).toMatchObject({ status: 2, stderr: 'vesen: for: not supported in vesen' });
    expect(await h.run('echo "open')).toMatchObject({ status: 2, stderr: "vesen: unexpected EOF while looking for matching '\"'" });
    expect(h.bells).toBe(3);
  });

  it('rings once for a stderr write on the terminal, however many', async () => {
    const h = harness();
    await h.run('fail; fail; fail');
    expect(h.bells).toBe(1);
    await h.run('fail 2>/dev/null');
    expect(h.bells).toBe(1);
  });

  it('says so when a lazy command cannot load', async () => {
    const { run } = harness({
      specs: [defineCommand({ name: 'lazy', category: 'fun', summary: 'x', load: () => Promise.reject(new Error('chunk')) })],
    });
    expect(await run('lazy')).toMatchObject({ status: 1, stderr: 'lazy: could not load the command. Check the connection and try again.' });
  });

  it('runs a lazy command once it has loaded', async () => {
    const { run } = harness({
      specs: [defineCommand({ name: 'lazy', category: 'fun', summary: 'x', load: async () => ({ run: async (ctx) => void (await ctx.stdout.write('loaded\n')) }) })],
    });
    expect((await run('lazy')).stdout).toBe('loaded');
  });
});

describe('^C', () => {
  it('ends the line at once with ^C and 130, skipping the rest of it', async () => {
    const h = harness();
    const handle = h.shell.start('echo before; hang; echo after');
    await vi.waitFor(() => expect(h.shell.job.get()?.name).toBe('hang'));
    expect(h.shell.abort()).toBe(true);
    const result = await handle.done;
    expect(result.status).toBe(130);
    expect(result.interrupted).toBe(true);
    expect(result.blocks.flatMap((block) => (block.type === 'lines' ? block.lines.map(lineText) : []))).toEqual(['before', '^C']);
    expect(h.shell.lastStatus.get()).toBe(130);
    expect(h.shell.job.get()).toBeNull();
    expect(h.commits.at(-1)).toMatchObject({ line: 'echo before; hang; echo after', status: 130, interrupted: true });
  });

  it('drops what the job writes after it was interrupted', async () => {
    const h = harness();
    const handle = h.shell.start('late; echo next');
    await vi.waitFor(() => expect(h.shell.job.get()?.name).toBe('late'));
    handle.abort();
    const result = await handle.done;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(spans(result.blocks).map((span) => span.text)).toEqual(['^C']);
    expect(spans(h.commits.at(-1)?.blocks ?? []).map((span) => span.text)).toEqual(['^C']);
  });

  it('shows ^C where the output was, before what the command says on its way out', async () => {
    let ready = false;
    const lastWords = defineCommand({
      name: 'last-words',
      category: 'shell',
      summary: 'say something on ^C',
      run: async (ctx) => {
        await ctx.stdout.write('working\nhalf');
        ctx.signal.addEventListener('abort', () => void ctx.stdout.write('\nsummary\n').catch(() => {}), { once: true });
        ready = true;
        await new Promise(() => {});
      },
    });
    const h = harness({ specs: [lastWords] });
    const handle = h.shell.start('last-words');
    await vi.waitFor(() => expect(ready).toBe(true));
    h.shell.abort();
    const result = await handle.done;
    expect(result.status).toBe(130);
    // As a terminal: the caret ends the unfinished line, and the summary's newline ends the caret's.
    expect(result.blocks.flatMap((block) => (block.type === 'lines' ? block.lines.map(lineText) : []))).toEqual(['working', 'half^C', 'summary']);
    expect(h.commits.at(-1)?.blocks).toEqual(result.blocks);
  });

  it('interrupts a pipeline, and a new line interrupts the old one', async () => {
    const h = harness();
    const first = h.shell.start('yes | hang');
    const second = h.shell.start('echo next');
    expect((await first.done).status).toBe(130);
    expect(await second.done).toMatchObject({ status: 0, interrupted: false });
  });
});

describe('budgets', () => {
  it('fires the network deadline on a fetch that never answers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const { shell } = harness();
    const done = shell.run('fetch https://example.com/slow');
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await done;
    expect(result.status).toBe(1);
    expect(spans(result.blocks).map((span) => span.text)).toEqual(['fetch: example.com: no response within 8000 ms']);
  });

  it('words a curl timeout as curl does', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const fetchSpec = defineCommand({
      name: 'curl',
      category: 'network',
      summary: 'fetch a URL',
      network: true,
      run: async (ctx) => {
        await ctx.net.text(ctx.args[0] ?? '', { signal: ctx.signal });
      },
    });
    const { shell } = harness({ specs: [fetchSpec] });
    const done = shell.run('curl https://example.com/');
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await done;
    expect(result.status).toBe(1);
    expect(spans(result.blocks).map((span) => span.text)).toEqual(['curl: (28) Operation timed out after 8000 milliseconds']);
  });

  it('stops waiting for a command that outlives its whole-command budget', async () => {
    vi.useFakeTimers();
    const stuck = defineCommand({ name: 'stuck', category: 'network', summary: 'x', network: true, budgetMs: 1000, run: () => new Promise<number>(() => {}) });
    const { shell } = harness({ specs: [stuck] });
    const done = shell.run('stuck; echo next');
    await vi.advanceTimersByTimeAsync(1_300);
    const result = await done;
    expect(result.status).toBe(0);
    expect(spans(result.blocks).map((span) => span.text)).toEqual(['stuck: timed out after 1 s', 'next']);
  });

  it('gives a network command 15 s unless its spec says otherwise', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const watch = defineCommand({
      name: 'watch',
      category: 'network',
      summary: 'x',
      network: true,
      run: (ctx) => {
        signal = ctx.signal;
        return new Promise<number>((resolve) => ctx.signal.addEventListener('abort', () => resolve(9)));
      },
    });
    const { shell } = harness({ specs: [watch] });
    const done = shell.run('watch');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect((await done).status).toBe(9);
  });
});

describe('effects', () => {
  it('clear empties the screen; what follows stays', async () => {
    const { run } = harness();
    const result = await run('echo a; clear; echo b');
    expect(result.screen).toBe('clear');
    expect(result.stdout).toBe('b');
  });

  it('reset restores the session: variables, history, files, theme and folder', async () => {
    const h = harness();
    await h.run('A=1; echo x > new.txt; cd /etc');
    const result = await h.run('reset');
    expect(result.screen).toBe('reset');
    expect(h.appearance.resets).toBe(1);
    expect(h.shell.history.list()).toEqual([]);
    expect(h.shell.cwd.get()).toBe('/home/guest');
    expect((await h.run('echo "[$A]"; cat new.txt')).stdout).toBe('[]');
    expect(h.fs.exists('/home/guest/a.txt')).toBe(true);
  });
});

describe('history', () => {
  it('keeps each line before it runs, without lines starting with a space', async () => {
    const { run, shell } = harness();
    await run('echo one');
    await run(' echo secret');
    await run('echo one');
    expect(shell.history.list().map((entry) => entry.line)).toEqual(['echo one']);
  });

  it('expands !! and shows the line that runs', async () => {
    const { run, shell } = harness();
    await run('echo again');
    expect((await run('!!')).stdout).toBe('echo again\nagain');
    expect(shell.history.list().map((entry) => entry.line)).toEqual(['echo again']);
    expect(await run('!nope')).toMatchObject({ status: 1, stderr: 'vesen: !nope: event not found' });
  });

  it('expands aliases', async () => {
    const { run, shell } = harness();
    shell.aliases.set('greet', 'echo hello');
    expect((await run('greet world')).stdout).toBe('hello world');
  });
});

describe('the folder', () => {
  it('follows a cd, into PWD, OLDPWD and the cwd store', async () => {
    const { run, shell } = harness();
    await run('cd docs');
    expect(shell.cwd.get()).toBe('/home/guest/docs');
    expect((await run('pwd; echo $OLDPWD')).stdout).toBe('/home/guest/docs\n/home/guest');
    expect(await run('cd nowhere')).toMatchObject({ status: 1, stderr: 'cd: nowhere: No such file or directory' });
    expect(await run('cd /etc/hostname')).toMatchObject({ status: 1, stderr: 'cd: /etc/hostname: Not a directory' });
  });

  it('needs x to enter a folder, and keeps a dangling folder when it goes', async () => {
    const h = harness();
    h.fs.mkdir('/home/guest/locked');
    h.fs.chmod('/home/guest/locked', 0o600);
    expect(await h.run('cd locked')).toMatchObject({ status: 1, stderr: 'cd: locked: Permission denied' });
    await h.run('cd docs');
    h.fs.rmdir('/home/guest/docs');
    expect(h.shell.cwd.get()).toBe('/home/guest/docs');
    expect((await h.run('pwd')).stdout).toBe('/home/guest/docs');
  });
});

describe('/usr/bin stubs', () => {
  it('run the command they stand for, by path', async () => {
    const tree = (): VirtualFile => {
      const base = sampleTree();
      const children = base.children ?? {};
      children.usr = {
        name: 'usr',
        type: 'directory',
        children: { bin: { name: 'bin', type: 'directory', children: { pwd: { name: 'pwd', type: 'file', mode: 0o755, builtin: 'pwd', content: '#!/bin/vesh\n' } } } },
      };
      children.bin = { name: 'bin', type: 'symlink', target: 'usr/bin' };
      return base;
    };
    const h = harness({ tree });
    expect(await h.run('/bin/pwd; /usr/bin/pwd')).toMatchObject({ status: 0, stdout: '/home/guest\n/home/guest' });
  });
});

describe('scripts', () => {
  /** Writes a file and sets its mode, as chmod would. */
  const script = (h: ReturnType<typeof harness>, path: string, text: string, mode = 0o755): void => {
    h.fs.writeFile(path, text);
    h.fs.chmod(path, mode);
  };

  it('run line by line with $1..$9 and $#, from a path or from $PATH, when the x bit is set', async () => {
    const h = harness();
    script(h, '/home/guest/greet.sh', '#!/bin/vesh\necho "hello $1 and $2"\necho $# $0\n');
    h.fs.writeFile('/home/guest/plain.txt', 'echo not a script\n');
    expect((await h.run('./greet.sh a b')).stdout).toBe('hello a and b\n2 ./greet.sh');
    expect(await h.run('./plain.txt')).toMatchObject({ status: 126, stderr: 'vesen: ./plain.txt: Permission denied' });
    h.fs.mkdir('/home/guest/bin');
    script(h, '/home/guest/bin/hi', "#!/bin/vesh\necho 'multi\nline'\n");
    // ~/bin is on PATH once ~/.bashrc puts it there, as on Linux.
    expect((await h.run('hi')).status).toBe(127);
    expect((await h.run('PATH=~/bin:$PATH; hi')).stdout).toBe('multi\nline');
  });

  it(`stop at a depth of ${MAX_SCRIPT_DEPTH}`, async () => {
    const h = harness();
    script(h, '/home/guest/loop.sh', '#!/bin/vesh\n./loop.sh\n');
    const result = await h.run('./loop.sh');
    expect(result.stderr).toBe(`vesen: ./loop.sh: scripts nested more than ${MAX_SCRIPT_DEPTH} deep`);
  });

  it('report a syntax error with its line', async () => {
    const h = harness();
    script(h, '/home/guest/bad.sh', '#!/bin/vesh\necho ok\n| oops\n');
    expect(await h.run('./bad.sh')).toMatchObject({ status: 2, stdout: 'ok', stderr: "./bad.sh: line 3: syntax error near unexpected token '|'" });
  });

  it('are refused without the x bit, and not found on $PATH without it', async () => {
    const h = harness();
    h.fs.writeFile('/home/guest/greet.sh', '#!/bin/vesh\necho hi\n');
    expect(await h.run('./greet.sh')).toMatchObject({ status: 126, stderr: 'vesen: ./greet.sh: Permission denied' });
    h.fs.mkdir('/home/guest/bin');
    h.fs.writeFile('/home/guest/bin/hidden', '#!/bin/vesh\necho hi\n');
    expect((await h.run('hidden')).status).toBe(127);
  });
});

describe('preflight', () => {
  function recordingOpener(autoOpen = true): Opener & { opened: string[] } {
    const opened: string[] = [];
    return {
      ...fakeOpener({ autoOpen }),
      opened,
      preflight: (url) => {
        if (!autoOpen) return 'skipped';
        opened.push(url);
        return 'opened';
      },
      open: (url) => {
        opened.push(url);
        return 'opened';
      },
    };
  }

  const linkedin = defineCommand({
    name: 'linkedin',
    category: 'portfolio',
    summary: 'x',
    opens: () => 'https://www.linkedin.com/in/harrysalvesen/',
    run: async (ctx) => {
      const result = await ctx.tty.open('https://www.linkedin.com/in/harrysalvesen/', 'LinkedIn');
      await ctx.stdout.write(`${result}\n`);
    },
  });

  it('opens the URL synchronously, once, and the job hears that it opened', async () => {
    const opener = recordingOpener();
    const { shell } = harness({ specs: [linkedin], opener });
    const found = shell.preflight('linkedin');
    expect(found).toMatchObject({ argv: ['linkedin'], opened: 'opened' });
    expect(opener.opened).toEqual(['https://www.linkedin.com/in/harrysalvesen/']);
    const result = await shell.run('linkedin');
    expect(spans(result.blocks).map((span) => span.text)).toEqual(['opened']);
    expect(opener.opened).toHaveLength(1);
  });

  it('opens nothing inside an in-app browser, and the command offers a card instead', async () => {
    const opener = recordingOpener(false);
    const { shell } = harness({ specs: [linkedin], opener });
    expect(shell.preflight('linkedin')?.opened).toBe('skipped');
    expect(spans((await shell.run('linkedin')).blocks).map((span) => span.text)).toEqual(['card']);
    expect(opener.opened).toEqual([]);
  });

  it('reads the words of a single simple command, and nothing more', () => {
    const { shell } = harness();
    expect(shell.preflight('  sudo   ls -la')?.argv).toEqual(['sudo', 'ls', '-la']);
    expect(shell.preflight("echo 'a b' ~")?.argv).toEqual(['echo', 'a b', '/home/guest']);
    for (const line of ['echo a | cat', 'a && b', 'echo $HOME', '', 'echo "open', '! x']) expect(shell.preflight(line), line).toBeNull();
  });
});
