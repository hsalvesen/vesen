// Script injection through the whole pipeline: lines typed at the prompt run through the shell
// exactly as Input.svelte runs them (legacy commands through the adapter), and the transcript is
// mounted with the real History component, which renders the shell's own output as text and
// legacy output through OutputView's sanitising legacy block.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blocksToGoldenHtml } from '../golden/format';
import { activeContent, xssCorpus } from '../support/xss';

interface Session {
  /** Runs one line through the shell, which records it in the transcript; returns its output as HTML. */
  run(line: string): Promise<string>;
  /** Mounts History over everything run so far. */
  render(): Promise<HTMLElement>;
  /** Adds a file straight into the home folder, as persisted or imported files would arrive. */
  plant(name: string): void;
}

let disposers: (() => void)[] = [];

/** A fresh page load: new instances of the file system, the stores and the commands. */
async function boot(): Promise<Session> {
  vi.resetModules();
  const { legacyAppShell } = await import('../../src/utils/legacyShell');
  const { virtualFileSystem } = await import('../../src/utils/virtualFileSystem');
  const { shell } = legacyAppShell({ banner: () => '', yieldToHost: () => Promise.resolve() });

  return {
    async run(line) {
      return blocksToGoldenHtml((await shell.run(line)).blocks);
    },
    async render() {
      // Imported after the reset so the component shares this session's stores.
      const { mount, unmount, flushSync } = await import('svelte');
      const { default: History } = await import('../../src/components/History.svelte');
      const target = document.createElement('div');
      document.body.append(target);
      const component = mount(History, { target });
      flushSync();
      disposers.push(() => {
        unmount(component);
        target.remove();
      });
      // Give any handler that slipped through a chance to run.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return target;
    },
    plant(name) {
      const home = virtualFileSystem.children?.home?.children?.user?.children;
      if (!home) throw new Error('no home folder');
      home[name] = { name, type: 'file', content: '' };
    },
  };
}

function expectInert(root: HTMLElement): void {
  expect(activeContent(root)).toEqual([]);
  expect(window.__x).toBeUndefined();
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', undefined);
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  vi.unstubAllGlobals();
  delete window.__x;
});

describe('the XSS corpus typed at the prompt', () => {
  it('stays inert through echo, quoted echo, unknown commands and their suggestions', async () => {
    const session = await boot();
    for (const payload of xssCorpus()) {
      await session.run(`echo ${payload}`);
      await session.run(`echo "${payload}"`);
      await session.run(payload);
      await session.run(`cat${payload}`);
    }
    expectInert(await session.render());
  });

  it('stays inert when written to a file by echo and read back with cat', async () => {
    const session = await boot();
    for (const [i, payload] of xssCorpus().entries()) {
      await session.run(`echo "${payload}" > f${i}`);
      // The audit's route around echo's redirect parsing: write the closing > on its own.
      await session.run(`echo ${payload.replace(/>/g, '')} > g${i}`);
      await session.run(`echo > >> g${i}`);
      await session.run(`cat f${i}`);
      await session.run(`cat g${i}`);
    }
    expectInert(await session.render());
  });

  it('stays inert in file names listed by ls and in the errors of the file commands', async () => {
    const session = await boot();
    for (const payload of xssCorpus()) {
      session.plant(payload);
      for (const command of ['cd', 'cat', 'rm', 'touch', 'mkdir', 'ls']) await session.run(`${command} ${payload}`);
    }
    await session.run('ls');
    await session.run('ls -a');
    expectInert(await session.render());
  });

  it('stays inert in the history listing and in theme and cathode errors', async () => {
    const session = await boot();
    for (const payload of xssCorpus()) {
      await session.run(`theme set ${payload}`);
      await session.run(`cathode set ${payload}`);
      await session.run(`${payload} --help`);
    }
    await session.run('history');
    expectInert(await session.render());
  });
});

describe('typed and file text shows exactly as written', () => {
  it('echo prints tags literally', async () => {
    const session = await boot();
    await session.run("echo '<b>x</b>'");
    const root = await session.render();
    const output = root.querySelectorAll('.command-output');
    expect(output[output.length - 1]?.textContent).toBe('<b>x</b>');
    expect(root.querySelector('.command-output b')).toBeNull();
  });

  it('echo still redirects to a file, with or without spaces around >', async () => {
    const session = await boot();
    await session.run('echo "<i>a</i>" > a.txt');
    await session.run('echo b>b.txt');
    await session.run("echo '<b>c</b>' >> a.txt");
    expect(await session.run('cat a.txt')).toBe('&lt;i&gt;a&lt;/i&gt;<br>&lt;b&gt;c&lt;/b&gt;<br>');
    expect(await session.run('cat b.txt')).toBe('b<br>');
  });

  it('an unquoted < or > is a redirection, never markup', async () => {
    const session = await boot();
    await session.run('echo <b>c</b>');
    await session.run('echo <b');
    const text = (await session.render()).textContent ?? '';
    expect(text).toContain("vesen: syntax error near unexpected token 'newline'");
    expect(text).toContain('vesen: b: No such file or directory');
  });

  it('cat shows source code with its angle brackets', async () => {
    const session = await boot();
    await session.run('cat /home/user/src/main.c');
    await session.run('cat ~/projects/portfolio/index.html');
    const root = await session.render();
    expect(root.textContent).toContain('#include <stdio.h>');
    expect(root.textContent).toContain('<body><h1>My Portfolio</h1></body>');
    expect(root.querySelector('.command-output h1')).toBeNull();
  });

  it('an unknown command, a file name and the history listing show what was typed', async () => {
    const session = await boot();
    const typed = '<img/src/onerror=window.__x=1>';
    // Quoted, so the shell reads it as a command name rather than redirections.
    await session.run(`'${typed}'`);
    session.plant('<u>planted</u>');
    await session.run('ls');
    await session.run('history');
    const text = (await session.render()).textContent ?? '';
    expect(text).toContain(`vesen: ${typed}: command not found`);
    expect(text).toContain('<u>planted</u>');
    expect(text).toMatch(/1 {2}'<img\/src\/onerror=window\.__x=1>'/);
  });
});
