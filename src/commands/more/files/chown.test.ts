// chown and chgrp: only root gives files away, so the visitor may set their own files to guest
// and the guest group, and is refused everything else in GNU's words.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { parseOwnerSpec } from '../../lib/owners';

describe('parseOwnerSpec', () => {
  it('reads OWNER, OWNER:GROUP, OWNER:, :GROUP, OWNER.GROUP and numbers', () => {
    expect(parseOwnerSpec('has')).toEqual({ owner: 'has' });
    expect(parseOwnerSpec('has:guest')).toEqual({ owner: 'has', group: 'guest' });
    expect(parseOwnerSpec('has:')).toEqual({ owner: 'has', group: 'has' });
    expect(parseOwnerSpec(':guest')).toEqual({ group: 'guest' });
    expect(parseOwnerSpec('guest.guest')).toEqual({ owner: 'guest', group: 'guest' });
    expect(parseOwnerSpec('1000:1001')).toEqual({ owner: 'guest', group: 'has' });
    expect(parseOwnerSpec('4242')).toEqual({ owner: '4242' });
    expect(parseOwnerSpec('')).toEqual({});
    expect(parseOwnerSpec(':')).toEqual({});
  });

  it('names the part that is nobody', () => {
    expect(parseOwnerSpec('bob')).toEqual({ error: "invalid user: 'bob'" });
    expect(parseOwnerSpec('guest:bob')).toEqual({ error: "invalid group: 'guest:bob'" });
    expect(parseOwnerSpec(':bob')).toEqual({ error: "invalid group: ':bob'" });
  });
});

describe('chown', () => {
  it("lets the visitor keep their own files as their own, silently", async () => {
    const s = await session({ tty: false });
    expect(await s.run('chown guest README.md')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(await s.run('chown guest:guest README.md history.txt')).toMatchObject({ status: 0, stderrPlain: '' });
    expect(await s.run('chown 1000:1000 README.md')).toMatchObject({ status: 0, stderrPlain: '' });
    expect(await s.run('chown -R :guest projects')).toMatchObject({ status: 0, stderrPlain: '' });
    expect(s.app.vfs.stat('/home/guest/README.md')).toMatchObject({ owner: 'guest', group: 'guest' });
    s.stop();
  });

  it("refuses to give a file away, or to put it in another's group: Operation not permitted", async () => {
    const s = await session({ tty: false });
    expect(await s.run('chown has README.md')).toMatchObject({ status: 1, stderrPlain: "chown: changing ownership of 'README.md': Operation not permitted" });
    expect(await s.run('chown :has README.md')).toMatchObject({ status: 1, stderrPlain: "chown: changing group of 'README.md': Operation not permitted" });
    expect(await s.run('chown guest /etc/passwd')).toMatchObject({ status: 1, stderrPlain: "chown: changing ownership of '/etc/passwd': Operation not permitted" });
    expect(await s.run('chown root:root /home/has/about.md')).toMatchObject({ status: 1 });
    expect(s.app.vfs.stat('/home/guest/README.md')).toMatchObject({ owner: 'guest', group: 'guest' });
    // -f says nothing, and the status still says it failed.
    expect(await s.run('chown -f has README.md')).toMatchObject({ status: 1, stderrPlain: '' });
    s.stop();
  });

  it('says what it did with -v, and only what changed with -c', async () => {
    const s = await session({ tty: false });
    expect((await s.run('chown -v guest README.md')).stdoutPlain).toBe("ownership of 'README.md' retained as guest");
    expect((await s.run('chown -v guest:guest README.md')).stdoutPlain).toBe("ownership of 'README.md' retained as guest:guest");
    expect((await s.run('chown -v :guest README.md')).stdoutPlain).toBe("group of 'README.md' retained as guest");
    expect((await s.run('chown -c guest README.md')).stdoutPlain).toBe('');
    expect((await s.run('chown -v has:has README.md')).screen).toEqual([
      "! chown: changing ownership of 'README.md': Operation not permitted",
      "failed to change ownership of 'README.md' from guest:guest to has:has",
    ]);
    s.stop();
  });

  it('goes through a folder with -R', async () => {
    const result = await runLine('chown -Rv guest documents', { tty: false });
    expect(result).toMatchObject({ status: 0, stdoutPlain: "ownership of 'documents' retained as guest\nownership of 'documents/linux.txt' retained as guest" });
    expect(await runLine('chown -R has projects', { tty: false })).toMatchObject({ status: 1 });
  });

  it.each([
    ['chown', "chown: missing operand\nTry 'chown --help' for more information."],
    ['chown guest', "chown: missing operand after 'guest'\nTry 'chown --help' for more information."],
    ['chown bob README.md', "chown: invalid user: 'bob'"],
    ['chown guest:bob README.md', "chown: invalid group: 'guest:bob'"],
    ['chown guest nope', "chown: cannot access 'nope': No such file or directory"],
    ['chown --reference=nope README.md', "chown: failed to get attributes of 'nope': No such file or directory"],
  ])('%s fails in GNU’s words with status 1', async (line, stderr) => {
    expect(await runLine(line, { tty: false })).toMatchObject({ status: 1, stderrPlain: stderr });
  });

  it("takes --reference's owner and group", async () => {
    expect(await runLine('chown --reference=.bashrc README.md', { tty: false })).toMatchObject({ status: 0 });
    expect(await runLine('chown --reference=/etc/passwd README.md', { tty: false })).toMatchObject({
      status: 1,
      stderrPlain: "chown: changing ownership of 'README.md': Operation not permitted",
    });
  });
});

describe('chgrp', () => {
  it('sets the group of the visitor’s files to guest, and nothing else', async () => {
    const s = await session({ tty: false });
    expect(await s.run('chgrp guest README.md')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(await s.run('chgrp 1000 README.md')).toMatchObject({ status: 0, stderrPlain: '' });
    expect(await s.run('chgrp has README.md')).toMatchObject({ status: 1, stderrPlain: "chgrp: changing group of 'README.md': Operation not permitted" });
    expect(await s.run('chgrp guest /etc/hosts')).toMatchObject({ status: 1, stderrPlain: "chgrp: changing group of '/etc/hosts': Operation not permitted" });
    expect(await s.run('chgrp bob README.md')).toMatchObject({ status: 1, stderrPlain: "chgrp: invalid group: 'bob'" });
    expect((await s.run('chgrp -Rv guest documents')).stdoutPlain).toBe("group of 'documents' retained as guest\ngroup of 'documents/linux.txt' retained as guest");
    expect((await s.run('chgrp -v has README.md')).screen).toEqual([
      "! chgrp: changing group of 'README.md': Operation not permitted",
      "failed to change group of 'README.md' from guest to has",
    ]);
    expect(await s.run('chgrp')).toMatchObject({ status: 1, stderrPlain: "chgrp: missing operand\nTry 'chgrp --help' for more information." });
    expect(await s.run('chgrp guest')).toMatchObject({ status: 1, stderrPlain: "chgrp: missing operand after 'guest'\nTry 'chgrp --help' for more information." });
    s.stop();
  });
});
