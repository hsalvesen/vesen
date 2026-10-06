// @vitest-environment happy-dom
// The legacy file commands read and write through the VFS. They lay out output with window, so
// they need a DOM.
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The visible text of legacy HTML output. */
function text(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.textContent ?? '';
}

let fileSystemCommands: typeof import('./fileSystem').fileSystemCommands;
let legacyFs: typeof import('../virtualFileSystem').legacyFs;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('AudioContext', undefined);
  const { legacyAppShell } = await import('../legacyShell');
  legacyAppShell({ banner: () => '' });
  ({ fileSystemCommands } = await import('./fileSystem'));
  ({ legacyFs } = await import('../virtualFileSystem'));
});

describe('cat', () => {
  it('reads a file from the VFS, escaped, with no request to the site', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    legacyFs().writeFile('/home/guest/tag.txt', '<b>bold?</b>\nline two');
    expect(fileSystemCommands.cat(['tag.txt'])).toBe('&lt;b&gt;bold?&lt;/b&gt;<br>line two');
    expect(fileSystemCommands.cat(['README.md'])).toContain('The Terminal');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says what is wrong, and offers a name in another case', () => {
    expect(text(fileSystemCommands.cat(['readme.md']))).toBe('cat: readme.md: No such file or directory\nDid you mean README.md?');
    expect(text(fileSystemCommands.cat(['documents']))).toBe('cat: documents: Is a directory');
  });
});

describe('writing', () => {
  it('touch, mkdir and rm go through the VFS', () => {
    expect(fileSystemCommands.touch(['new.txt'])).toBe("touch: created 'new.txt'");
    expect(legacyFs().stat('/home/guest/new.txt').owner).toBe('guest');
    expect(fileSystemCommands.touch(['new.txt'])).toBe("touch: 'new.txt' timestamp updated");
    expect(fileSystemCommands.mkdir(['dir'])).toBe("mkdir: created directory 'dir'");
    expect(text(fileSystemCommands.mkdir(['dir']))).toBe("mkdir: cannot create directory 'dir': File exists");
    expect(text(fileSystemCommands.rm(['dir']))).toBe("rm: cannot remove 'dir': Is a directory (use -r to remove directories)");
    expect(fileSystemCommands.rm(['-r', 'dir'])).toBe("rm: removed 'dir'");
    expect(legacyFs().exists('/home/guest/dir')).toBe(false);
  });

  it("echo's own redirect writes through the VFS too", () => {
    fileSystemCommands.echo(['hello', '>', 'out.txt']);
    fileSystemCommands.echo(['again', '>>', 'out.txt']);
    expect(legacyFs().readFile('/home/guest/out.txt')).toBe('hello\nagain');
    expect(text(fileSystemCommands.echo(['x', '>', '/etc/x']))).toBe("echo: cannot create '/etc/x': Permission denied");
  });
});
