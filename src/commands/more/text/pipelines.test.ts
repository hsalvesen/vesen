// The text tools together, as the plan's acceptance lines use them (docs/plan/08-shell-and-
// commands.md): each pipeline on the terminal and into a pipe, with the exit status of its last
// command, and a stream that ends as soon as its reader has enough.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';

describe('pipelines of text tools', () => {
  it.each([
    ['cat README.md | grep -i theme | wc -l', '1'],
    ['seq 10 | sort -rn | head -3', '10\n9\n8'],
    ['echo hello | tr a-z A-Z', 'HELLO'],
    ['ls | xargs -n1 echo | head -n 3', 'bin\nconfig\ndesktop'],
    ['cut -d : -f 7 /etc/passwd | sort | uniq -c', '      3 /bin/vesh\n      1 /usr/sbin/nologin'],
    ["printf 'b\\na\\nb\\nc\\nb\\n' | sort | uniq -c | sort -rn | head -n 1", '      3 b'],
    ['seq 5 | tr "\\n" " " | sed "s/ $//"', '1 2 3 4 5'],
    ["echo 'The quick brown fox' | tr ' ' '\\n' | sort -f | head -n 2", 'brown\nfox'],
    ['wc -l < .profile | xargs expr 1 +', '7'],
    ['seq 3 | sed s/^/n/ | nl -w1 -s=', '1=n1\n2=n2\n3=n3'],
    ['echo hello | base64 | base64 -d | rev', 'olleh'],
    ["echo 'a,b,c' | cut -d , -f 2- | tr , '\\n' | tail -n 1", 'c'],
    ["seq 4 | xargs -n2 | column -t", '1  2\n3  4'],
    ["echo '6 * 7' | bc | xargs printf '%05d\\n'", '00042'],
    ['seq 100 | grep 7 | wc -l', '19'],
    ['yes | head -n 1000 | uniq -c', '   1000 y'],
    ['seq 20 | tail -n 3 | sort -rn | fold -w 1 | head -n 2', '2\n0'],
  ])('%s', async (line, expected) => {
    for (const tty of [false, true]) {
      const result = await runLine(line, { tty });
      expect(result.stdoutPlain, `tty ${tty}`).toBe(expected);
      expect(result.status, `tty ${tty}`).toBe(0);
    }
  });

  it('gives the status of the last command, and ends an endless writer at once', async () => {
    expect((await runLine('seq 3 | grep 9', { tty: false })).status).toBe(1);
    expect((await runLine('grep -q x /nope | true', { tty: false })).status).toBe(0);
    const started = performance.now();
    expect(await runLine('yes | sed s/y/n/ | tr n m | grep -v x | cut -c1 | head -n 2', { tty: false })).toMatchObject({ status: 0, stdoutPlain: 'm\nm' });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('edits a file with the tools and keeps the result', async () => {
    const s = await session({ tty: false });
    await s.run("printf 'pear\\napple\\nfig\\napple\\n' > fruit.txt");
    await s.run('sort -u fruit.txt | tee sorted.txt | wc -l > count.txt');
    expect(s.app.vfs.readFile('/home/guest/sorted.txt')).toBe('apple\nfig\npear\n');
    expect(s.app.vfs.readFile('/home/guest/count.txt')).toBe('3\n');
    await s.run("sed -i 's/fig/plum/' sorted.txt");
    expect((await s.run('diff -q fruit.txt sorted.txt')).status).toBe(1);
    expect((await s.run('grep -c apple sorted.txt')).stdoutPlain).toBe('1');
    s.stop();
  });
});
