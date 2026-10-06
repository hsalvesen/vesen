// @vitest-environment happy-dom
// The legacy shim over the VFS, beside the file commands, which are specs now and share the VFS
// with what is left of the legacy code. The legacy modules lay out output with window, so they
// need a DOM.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Shell } from '../shell/index';
import { screenText } from '../testing/shell-harness';

let shell: Shell;
let shim: typeof import('./virtualFileSystem');

/** A fresh page load with the shell built; `run` runs a line and gives what it printed, stdout then stderr. */
async function freshTerminal() {
  vi.resetModules();
  vi.stubGlobal('AudioContext', undefined);
  const { legacyAppShell } = await import('./legacyShell');
  shell = legacyAppShell({ banner: () => '', yieldToHost: () => Promise.resolve() }).shell;
  shim = await import('./virtualFileSystem');
  return async (line: string) => {
    const { blocks } = await shell.run(line);
    return [screenText(blocks, 'stdout'), screenText(blocks, 'stderr')].filter((text) => text !== '').join('\n');
  };
}

describe('the home folder (F003)', () => {
  let run: (line: string) => Promise<string>;

  beforeEach(async () => {
    run = await freshTerminal();
  });

  it('holds the dotfiles, so ls -a ~ lists .bashrc', async () => {
    const listing = await run('ls -a ~');

    expect(listing.split('\n')).toEqual(expect.arrayContaining(['.bashrc', '.ssh', 'projects']));
  });

  it('is /home/guest, beside the owner\'s home and the /home/user link to it', async () => {
    expect(await run('ls /home')).toBe('guest\nhas\nuser');
    expect(await run('ls /home/user')).toBe(await run('ls ~'));
  });

  it('opens its files by their home paths, and through /home/user', async () => {
    expect(await run('cat ~/.bashrc')).toContain('alias ll="ls -la"');
    expect(await run('cat ~/.ssh/known_hosts')).toContain('github.com ssh-rsa');
    expect(await run('cat /home/user/.bashrc')).toContain('alias ll="ls -la"');
  });
});

describe('the shim', () => {
  beforeEach(async () => {
    await freshTerminal();
  });

  it('exports the VFS\'s own tree, so legacy walks see the shell\'s files', async () => {
    await shell.run('mkdir made');
    expect(shim.virtualFileSystem.children?.home?.children?.guest?.children?.made?.type).toBe('directory');
    expect(shim.legacyFs().exists('/home/guest/made')).toBe(true);
  });

  it('mirrors the cwd store in currentPath, with links resolved', async () => {
    expect(shim.currentPath).toEqual(['home', 'guest']);
    await shell.run('cd /home/user/documents');
    expect(shell.cwd.get()).toBe('/home/user/documents');
    expect(shim.currentPath).toEqual(['home', 'guest', 'documents']);
    expect(shim.getCurrentDirectory()?.children?.['linux.txt']?.type).toBe('file');
  });

  it('resolves paths with HOME = /home/guest, following links to the folder', async () => {
    expect(shim.resolvePath('~')).toEqual(['home', 'guest']);
    expect(shim.resolvePath('~/documents/../projects')).toEqual(['home', 'guest', 'projects']);
    expect(shim.resolvePath('/home/user/README.md')).toEqual(['home', 'guest', 'README.md']);
    expect(shim.resolvePath('../..')).toEqual([]);
  });
});

describe('the file commands over the VFS', () => {
  let run: (line: string) => Promise<string>;

  beforeEach(async () => {
    run = await freshTerminal();
  });

  it('get Linux permissions: touch /etc/x and cat /etc/shadow are refused (F082)', async () => {
    expect(await run('touch /etc/x')).toBe("touch: cannot touch '/etc/x': Permission denied");
    expect(await run('cat /etc/shadow')).toBe('cat: /etc/shadow: Permission denied');
    expect(await run('mkdir /root/x')).toBe("mkdir: cannot create directory '/root/x': Permission denied");
    expect(await run('ls /root')).toBe("ls: cannot open directory '/root': Permission denied");
  });

  it('refuse to remove . .. and /, in GNU rm words (F020)', async () => {
    expect(await run('rm -r .')).toBe("rm: refusing to remove '.' or '..' directory: skipping '.'");
    expect(await run('rm -r ..')).toBe("rm: refusing to remove '.' or '..' directory: skipping '..'");
    expect(await run('rm -r /')).toBe("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe");
    expect(shim.legacyFs().exists('/home/guest/README.md')).toBe(true);
  });

  it('read /proc, made from the device on every read', async () => {
    expect(await run('cat /proc/uptime')).toMatch(/^\d+\.\d\d \d+\.\d\d$/);
    expect(await run('cat /proc/meminfo')).toContain('MemTotal:');
  });

  it('print the owner documents as plain text, with no markup in them (F093)', async () => {
    const readme = await run('cat README.md');
    expect(readme).toContain('The Terminal');
    expect(readme).not.toMatch(/[{<]/);
  });
});
