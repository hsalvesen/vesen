// file: types from what files hold, and from the names of the seed's stand-in pictures and
// archives; file's layout, -b, -i and -L.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';

describe('file', () => {
  it('names folders, links, devices, empty files and what cannot be read or found', async () => {
    const result = await runLine('file .ssh /bin /dev/null /proc/cpuinfo /tmp /etc/shadow nope', { tty: false });
    expect(result.status).toBe(0);
    expect(result.stdoutPlain.split('\n')).toEqual([
      '.ssh:          directory',
      '/bin:          symbolic link to usr/bin',
      '/dev/null:     character special (1/3)',
      '/proc/cpuinfo: empty',
      '/tmp:          sticky, directory',
      '/etc/shadow:   regular file, no read permission',
      "nope:          cannot open `nope' (No such file or directory)",
    ]);
  });

  it('reads scripts, sources, documents and data from their content', async () => {
    const result = await runLine('file bin/deploy scripts/setup.py src/main.c projects/portfolio/index.html projects/learning/javascript-basics.js music/playlist.m3u README.md history.txt projects/vesen/info.txt', { tty: false });
    expect(result.stdoutPlain.split('\n')).toEqual([
      'bin/deploy:                             vesh shell script, ASCII text executable',
      'scripts/setup.py:                       Python script, ASCII text executable',
      'src/main.c:                             C source, ASCII text',
      'projects/portfolio/index.html:          HTML document, ASCII text',
      'projects/learning/javascript-basics.js: JavaScript source, ASCII text',
      'music/playlist.m3u:                     M3U playlist, ASCII text',
      'README.md:                              Markdown document, ASCII text',
      'history.txt:                            Unicode text, UTF-8 text',
      'projects/vesen/info.txt:                ASCII text',
    ]);
  });

  it('notices line endings, long lines, escapes, JSON, interpreters and binary data', async () => {
    const s = await session({ tty: false });
    await s.run("printf 'abc' > a; printf 'one\\r\\ntwo\\r\\n' > b; printf '\\033[1mbold\\n' > c; echo '{\"a\": [1, 2]}' > d.json; echo '{nope' > e.json");
    await s.run("printf '#!/usr/bin/env bash\\necho hi\\n' > f; printf '#!/bin/sh\\n' > g; printf 'x\\001y' > h; truncate -s 2 i");
    await s.run(`printf '%0400d\\n' 0 > j`);
    // More lines than a function call takes arguments.
    s.app.vfs.writeFile('/home/guest/k', 'y\n'.repeat(200_000));
    expect((await s.run('file -b k')).stdoutPlain).toBe('ASCII text');
    expect((await s.run('file -b a b c d.json e.json f g h i j')).stdoutPlain.split('\n')).toEqual([
      'ASCII text, with no line terminators',
      'ASCII text, with CRLF line terminators',
      'ASCII text, with escape sequences',
      'JSON text data',
      'ASCII text',
      'Bourne-Again shell script, ASCII text executable',
      'POSIX shell script, ASCII text executable',
      'data',
      'data',
      'ASCII text, with very long lines (400)',
    ]);
    s.stop();
  });

  it('judges a file of blank lines at once: no test runs on from one line into the next', async () => {
    const s = await session({ tty: false });
    s.app.vfs.writeFile('/home/guest/blank', '\n'.repeat(300_000));
    const started = Date.now();
    expect((await s.run('file -b blank')).stdoutPlain).toBe('ASCII text');
    // A \s* under /m took about a minute here.
    expect(Date.now() - started).toBeLessThan(2000);
    s.stop();
  });

  it("names the seed's stand-in pictures, videos and archives from their names, and only those", async () => {
    const s = await session({ tty: false });
    expect((await s.run('file pictures/vacation.jpg videos/tutorial.mp4 downloads/software.tar.gz')).stdoutPlain.split('\n')).toEqual([
      'pictures/vacation.jpg:     JPEG image data, JFIF standard 1.01',
      'videos/tutorial.mp4:       ISO Media, MP4 v2 [ISO 14496-14]',
      'downloads/software.tar.gz: gzip compressed data, from Unix',
    ]);
    await s.run('echo just text > pictures/mine.png');
    expect((await s.run('file pictures/mine.png')).stdoutPlain).toBe('pictures/mine.png: ASCII text');
    s.stop();
  });

  it('prints MIME types with -i and --mime-type', async () => {
    expect((await runLine('file -i README.md src/main.c .ssh pictures/vacation.jpg', { tty: false })).stdoutPlain.split('\n')).toEqual([
      'README.md:             text/markdown; charset=us-ascii',
      'src/main.c:            text/x-c; charset=us-ascii',
      '.ssh:                  inode/directory; charset=binary',
      'pictures/vacation.jpg: image/jpeg; charset=binary',
    ]);
    expect((await runLine('file --mime-type -b history.txt /bin', { tty: false })).stdoutPlain).toBe('text/plain\ninode/symlink');
  });

  it('follows links with -L, and calls a link to nothing broken', async () => {
    const s = await session({ tty: false });
    await s.run('ln -s nope dangling');
    expect((await s.run('file dangling')).stdoutPlain).toBe('dangling: broken symbolic link to nope');
    expect((await s.run('file -L /bin /home/user')).stdoutPlain).toBe('/bin:       directory\n/home/user: directory');
    s.stop();
  });

  it('needs a FILE', async () => {
    expect(await runLine('file', { tty: false })).toMatchObject({
      status: 1,
      stderrPlain: "Usage: file [-bhiL] [--mime-type] FILE...\nTry 'file --help' for more information.",
    });
  });
});
