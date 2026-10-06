// @vitest-environment happy-dom
// The legacy file system reads window and navigator when it is built, so it needs a DOM.
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The visible text of legacy HTML output. */
function text(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.textContent ?? '';
}

/** A fresh page load, running legacy commands directly: `ls -a ~` is ls with the words -a and ~. */
async function freshTerminal() {
  vi.resetModules();
  vi.stubGlobal('AudioContext', undefined);
  const { commands } = await import('./commands');
  return async (line: string) => {
    const [name = '', ...args] = line.split(' ');
    const fn = commands[name];
    if (!fn) throw new Error(`no legacy command ${name}`);
    return text(String(await fn(args)));
  };
}

describe('the home folder (F003)', () => {
  let run: (line: string) => Promise<string>;

  beforeEach(async () => {
    run = await freshTerminal();
  });

  it('holds the dotfiles, so ls -a ~ lists .bashrc', async () => {
    const listing = await run('ls -a ~');

    expect(listing).toContain('.bashrc');
    expect(listing).toContain('.ssh/');
    expect(listing).toContain('projects/');
  });

  it('is the only thing in /home', async () => {
    expect((await run('ls /home')).trim()).toBe('user/');
  });

  it('opens its files by their home paths', async () => {
    expect(await run('cat ~/.bashrc')).toContain('alias ll="ls -la"');
    expect(await run('cat ~/.ssh/known_hosts')).toContain('github.com ssh-rsa');
  });
});
