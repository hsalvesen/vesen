// git (docs/plan/08 wave D): only inside ~/projects/vesen; log and show from GitHub's commits API
// (a recorded fixture, its e-mail addresses replaced), kept for 10 minutes in the tab's session
// storage; the rate limit, offline and a timeout; and everything that would change the copy.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { fixture, hang, json, memorySession, serveNet } from '../../../../tests/support/net';
import { STORAGE_KEYS } from '../../../services/storage-keys';
import { COMMITS_URL, parseCommits } from '../../lib/github';
import { provideSessionStore } from '../../lib/session-store';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  provideSessionStore(null);
});

const IN = 'git -C ~/projects/vesen';

describe('git', () => {
  it('works only inside ~/projects/vesen', async () => {
    const s = await session();
    expect(await s.run('git status')).toMatchObject({ status: 128, stderrPlain: 'fatal: not a git repository (or any of the parent directories): .git' });
    await s.run('cd ~/projects/vesen');
    expect(await s.run('git status')).toMatchObject({
      status: 0,
      stdoutPlain: "On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean",
    });
    // A folder inside it, and the same folder through /home/user, are in it too.
    await s.run('mkdir docs && cd docs');
    expect((await s.run('git branch')).stdoutPlain).toBe('* main');
    expect((await s.run('git -C /home/user/projects/vesen remote')).stdoutPlain).toBe('origin');
    expect((await s.run('git -C ~/projects status')).status).toBe(128);
    s.stop();
  });

  it('gives the remote, a clean status and no diff, asking nobody', async () => {
    const net = serveNet();
    expect((await runLine(`${IN} remote -v`)).stdoutPlain).toBe('origin\thttps://github.com/hsalvesen/vesen.git (fetch)\norigin\thttps://github.com/hsalvesen/vesen.git (push)');
    expect(await runLine(`${IN} diff`)).toMatchObject({ status: 0, stdoutPlain: '' });
    expect(await runLine(`${IN} status --short`)).toMatchObject({ status: 0, stdoutPlain: '' });
    expect(net.requests).toEqual([]);
  });

  it('logs the newest commits from GitHub, one line each with --oneline, and says where the rest are', async () => {
    const net = serveNet();
    const oneline = await runLine(`${IN} log --oneline -n 3`, { tty: false });
    expect(oneline).toMatchObject({
      status: 0,
      stdoutPlain: [
        '23758b9 (HEAD -> main, origin/main) New feature: cathode scanlines set as the default on load',
        '2c1a34e New feature: cathode suggestions and help text added for discoverability',
        '8d35dbe New feature: cathode command added to switch between CRT variations',
      ].join('\n'),
      stderrPlain: '',
    });
    expect(net.requests[0]).toMatchObject({ url: COMMITS_URL, init: { headers: { accept: 'application/vnd.github+json' } } });
    const all = await runLine(`${IN} log --oneline`, { tty: false });
    expect(all.stdoutPlain.split('\n')).toHaveLength(10);
    expect(all.stderrPlain).toBe("git: the 10 newest commits, as GitHub's API gives them; the rest are at https://github.com/hsalvesen/vesen/commits");
  });

  it("logs in git's long form, the author by name only, the date in the visitor's zone", async () => {
    serveNet();
    const { stdoutPlain } = await runLine(`${IN} log -2`, { tty: false });
    expect(stdoutPlain).toBe(
      [
        'commit 23758b9f5d781b22ecee3fc85603c2bf10501d34 (HEAD -> main, origin/main)',
        'Author: Has',
        'Date:   Wed Jul 15 17:31:00 2026 +1000',
        '',
        '    New feature: cathode scanlines set as the default on load',
        '',
        'commit 2c1a34e4c1656a4a6ba0865e27e8bd85875aebe5',
        'Author: Has',
        'Date:   Wed Jul 15 17:30:46 2026 +1000',
        '',
        '    New feature: cathode suggestions and help text added for discoverability',
      ].join('\n'),
    );
    expect(stdoutPlain).not.toContain('@');
  });

  it('shows a commit by HEAD, HEAD~N or its hash, with a link to its changes', async () => {
    serveNet();
    const head = await runLine(`${IN} show`, { tty: false });
    expect(head.stdoutPlain).toContain('commit 23758b9f5d781b22ecee3fc85603c2bf10501d34 (HEAD -> main, origin/main)');
    expect(head.stdoutPlain).toContain('The changes are on GitHub: https://github.com/hsalvesen/vesen/commit/23758b9f5d781b22ecee3fc85603c2bf10501d34');
    expect((await runLine(`${IN} show HEAD~2`, { tty: false })).stdoutPlain).toContain('commit 8d35dbe0ac5f3a800a21d8dd960beae80b4adeba');
    expect((await runLine(`${IN} show d029fe8`, { tty: false })).stdoutPlain).toContain('    Speedtest API swapped');
    expect(await runLine(`${IN} show nope`)).toMatchObject({ status: 128, stderrPlain: "fatal: ambiguous argument 'nope': unknown revision or path not in the working tree." });
  });

  it("keeps the commits for 10 minutes in the tab's session storage", async () => {
    const net = serveNet();
    const kv = memorySession();
    let now = Date.UTC(2026, 9, 6, 9, 0, 0);
    const s = await session({ now: () => now });
    provideSessionStore(kv);
    await s.run(`${IN} log --oneline -n 1`);
    const stored = JSON.parse(kv.store.get(STORAGE_KEYS.github.key) ?? '{}') as { v: number; at: number; commits: unknown[] };
    expect(stored).toMatchObject({ v: 1, at: now });
    expect(stored.commits).toHaveLength(10);
    expect(stored.commits[0]).toEqual({
      sha: '23758b9f5d781b22ecee3fc85603c2bf10501d34',
      author: 'Has',
      date: Date.UTC(2026, 6, 15, 7, 31, 0),
      message: 'New feature: cathode scanlines set as the default on load',
      parents: ['2c1a34e4c1656a4a6ba0865e27e8bd85875aebe5'],
    });
    // Another page in the tab, 9 minutes on: from storage, not GitHub.
    const later = await session({ now: () => now });
    provideSessionStore(kv);
    now += 9 * 60_000;
    expect((await later.run(`${IN} log --oneline -n 1`)).status).toBe(0);
    expect(net.requests).toHaveLength(1);
    now += 2 * 60_000;
    await later.run(`${IN} log --oneline -n 1`);
    expect(net.requests).toHaveLength(2);
    s.stop();
    later.stop();
  });

  it("says when GitHub's limit is used up, when it fails, and when it cannot be reached", async () => {
    serveNet(() => json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.UTC(2026, 9, 6, 10, 30) / 1000) }));
    expect(await runLine(`${IN} log`)).toMatchObject({
      status: 128,
      stderrPlain: 'fatal: GitHub allows 60 requests an hour from your address, and they are used up; try again after 21:30, or see https://github.com/hsalvesen/vesen/commits',
    });
    serveNet(() => json({ message: 'oops' }, 500));
    expect((await runLine(`${IN} log`)).stderrPlain).toBe('fatal: unable to read the commits from GitHub: HTTP 500');
    serveNet(() => json({ not: 'a list' }));
    expect((await runLine(`${IN} log`)).stderrPlain).toBe('fatal: unable to read the commits from GitHub: an answer that could not be read');

    serveNet(() => Promise.reject(new TypeError('Failed to fetch')));
    expect((await runLine(`${IN} show`)).stderrPlain).toBe(
      "fatal: unable to access 'https://api.github.com/': blocked by CORS or unreachable (the browser does not say which)",
    );

    vi.stubGlobal('navigator', { onLine: false });
    expect(await runLine(`${IN} log`)).toMatchObject({ status: 128, stderrPlain: "fatal: unable to access 'https://api.github.com/': the browser is offline" });
    vi.unstubAllGlobals();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    serveNet((_url, init) => hang(init));
    const s = await session();
    const pending = s.run(`${IN} log`);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({ status: 128, stderrPlain: "fatal: unable to access 'https://api.github.com/': no answer within 8 s" });
    s.stop();
  });

  it('refuses to change the copy, and knows what is not git', async () => {
    expect(await runLine(`${IN} push`)).toMatchObject({
      status: 1,
      stderrPlain: "git: 'push' is not available here: this copy of vesen's repository is read-only (log, show, status, remote, branch and diff work)",
    });
    expect((await runLine(`${IN} commit -m hi`)).status).toBe(1);
    expect((await runLine(`${IN} branch -d main`)).status).toBe(1);
    expect(await runLine(`${IN} frob`)).toMatchObject({ status: 1, stderrPlain: "git: 'frob' is not a git command. See 'git --help'." });
    expect(await runLine('git -C ~/nowhere status')).toMatchObject({ status: 128, stderrPlain: "fatal: cannot change to '/home/guest/nowhere': No such file or directory" });
    expect((await runLine('git')).stderrPlain).toContain('usage: git [-C <path>] <command> [<args>]');
    expect(await runLine(`${IN} log --stat`)).toMatchObject({ status: 128, stderrPlain: 'fatal: unrecognized argument: --stat' });
  });
});

describe('reading the commits API', () => {
  it("keeps the name, date, message and parents, and nothing that could reach the terminal unescaped", () => {
    const [first] = parseCommits(fixture('github-commits.json'));
    expect(first).toMatchObject({ sha: '23758b9f5d781b22ecee3fc85603c2bf10501d34', author: 'Has', date: Date.UTC(2026, 6, 15, 7, 31, 0) });
    expect(Object.keys(first ?? {})).not.toContain('email');
    const [odd] = parseCommits([
      { sha: 'a'.repeat(40), commit: { author: { name: 'X\u001b[31m', date: '2026-01-01T00:00:00Z' }, message: 'one\u001b]8;;x\u0007\n\ntwo‮' }, parents: [] },
    ]);
    expect(odd?.author).toBe('X [31m');
    expect(odd?.message).toBe('one�]8;;x�\n\ntwo�');
    expect(() => parseCommits({})).toThrow();
    expect(() => parseCommits([{ sha: 'nope' }])).toThrow();
  });
});
