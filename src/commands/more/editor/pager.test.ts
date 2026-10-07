// less, more and man in the pager (wave F): the pager on the terminal, from a file or a pipe; a
// copy into a pipe, as less does when its output is not a terminal; printing where the pager
// cannot open; the cap on what it is given; and less's and more's own error words.
import { describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { PAGER_CLOSED, type PagerView } from '../../../lib/pager';
import { lineText } from '../../../output/model';
import { createAppRunner } from '../../../shell/apps';
import { MAX_PAGER_LINES } from '../../lib/pager';

/**
 * A screen that shows the pager, records what it was given, and closes it at once; or, with
 * `loads` false, closes it with no result, as AppHost does when the pager's chunk fails to load.
 */
function pagerScreen(loads = true) {
  const result = loads ? PAGER_CLOSED : undefined;
  const shown: { view: string; props: PagerView }[] = [];
  const fullscreen = vi.fn(async (view: string, props: unknown) => {
    shown.push({ view, props: props as PagerView });
    return result;
  });
  return { shown, fullscreen, text: (i = 0) => (shown[i]?.props.lines ?? []).map(lineText) };
}

describe('less on the terminal', () => {
  it('opens a file in the pager, with its colours, and leaves nothing on the screen', async () => {
    const screen = pagerScreen();
    const result = await runLine('less README.md', { fullscreen: screen.fullscreen, cols: 60 });
    expect(result).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(screen.shown).toHaveLength(1);
    const [{ view, props }] = screen.shown as [{ view: string; props: PagerView }];
    expect(view).toBe('pager');
    expect(props).toMatchObject({ title: 'README.md', mode: 'less', touch: false, columns: 60, rows: 24 });
    // The owner's document keeps its colours, as cat shows them.
    const cat = await runLine('cat README.md');
    expect(screen.text()).toEqual(cat.stdoutPlain.split('\n'));
    expect(props.lines.some((line) => line.some((span) => span.style?.fg !== undefined))).toBe(true);
  });

  it('pages what a pipe brings, from the last stage of a line typed at the prompt', async () => {
    const screen = pagerScreen();
    const result = await runLine("printf 'one\\ntwo\\n' | less", { fullscreen: screen.fullscreen });
    expect(result.status).toBe(0);
    expect(screen.shown[0]?.props.title).toBe('(standard input)');
    expect(screen.text()).toEqual(['one', 'two']);
  });

  it('keeps the colours a pipe brings, as less -R does', async () => {
    const screen = pagerScreen();
    await runLine("printf '\\033[31mred\\033[0m plain\\n' | less", { fullscreen: screen.fullscreen });
    expect(screen.shown[0]?.props.lines[0]).toEqual([{ text: 'red', style: { fg: 'red' } }, { text: ' plain' }]);
  });

  it('caps what it is given, so yes | less ends, and says so', async () => {
    const screen = pagerScreen();
    const result = await runLine('yes | less', { fullscreen: screen.fullscreen });
    expect(result.status).toBe(0);
    const props = screen.shown[0]?.props;
    expect(props?.lines).toHaveLength(MAX_PAGER_LINES);
    expect(props?.note).toBe('Only the first 5,000 lines are shown.');
  });

  it('passes -N and -i to the pager', async () => {
    const screen = pagerScreen();
    await runLine('less -Ni .bashrc', { fullscreen: screen.fullscreen });
    expect(screen.shown[0]?.props).toMatchObject({ numbers: true, ignoreCase: true });
  });

  it('puts a rule of colons above each file when there are several', async () => {
    const screen = pagerScreen();
    await runLine('less .bashrc .profile', { fullscreen: screen.fullscreen });
    const text = screen.text();
    expect(screen.shown[0]?.props.title).toBe('2 files');
    expect(text.slice(0, 3)).toEqual(['::::::::::::::', '.bashrc', '::::::::::::::']);
    expect(text).toContain('.profile');
  });

  it('prints, with -F, what fits on one screen', async () => {
    const screen = pagerScreen();
    const result = await runLine('less -F .bashrc', { fullscreen: screen.fullscreen });
    expect(screen.fullscreen).not.toHaveBeenCalled();
    expect(result.stdoutPlain).toBe((await runLine('cat .bashrc')).stdoutPlain);
  });

  it('prints the text where the pager cannot open, such as a screen with no apps', async () => {
    // The harness has no screen for apps unless a test gives it one.
    const result = await runLine('less .bashrc');
    expect(result).toMatchObject({ status: 0, stdoutPlain: (await runLine('cat .bashrc')).stdoutPlain });
    // Or its screen did not load: AppHost closes it with no result.
    const failed = pagerScreen(false);
    expect((await runLine('less .profile', { fullscreen: failed.fullscreen })).stdoutPlain).toBe((await runLine('cat .profile')).stdoutPlain);
  });

  it('is never opened from a script, $( ) or the middle of a pipe', async () => {
    const screen = pagerScreen();
    const s = await session({ fullscreen: screen.fullscreen });
    await s.run("echo 'less .bashrc' > page.sh");
    expect((await s.run('source page.sh')).stdoutPlain).toContain('alias ll=');
    expect((await s.run('X=$(less .profile); echo "${#X}"')).stdoutPlain).toMatch(/^\d+$/);
    expect((await s.run('less .bashrc | wc -l')).stdoutPlain).toMatch(/^\d+$/);
    expect(screen.fullscreen).not.toHaveBeenCalled();
    s.stop();
  });

  it('is interrupted by ^C while it shows, and the prompt comes back', async () => {
    const apps = createAppRunner();
    const s = await session({ fullscreen: (view, props) => apps.open(view, props) });
    const handle = s.app.shell.start('less README.md');
    await vi.waitFor(() => expect(apps.request.get()?.view).toBe('pager'));
    handle.abort();
    expect((await handle.done).status).toBe(130);
    s.stop();
  });

  it("says what it cannot read, in less's words", async () => {
    const screen = pagerScreen();
    expect(await runLine('less nope', { fullscreen: screen.fullscreen })).toMatchObject({ status: 1, stderrPlain: 'nope: No such file or directory' });
    expect(await runLine('less documents', { fullscreen: screen.fullscreen })).toMatchObject({ status: 1, stderrPlain: 'documents is a directory' });
    expect(await runLine('less /etc/shadow', { fullscreen: screen.fullscreen })).toMatchObject({ status: 1, stderrPlain: '/etc/shadow: Permission denied' });
    expect(screen.fullscreen).not.toHaveBeenCalled();
    // The files it can read still show.
    const result = await runLine('less nope .bashrc', { fullscreen: screen.fullscreen });
    expect(result.status).toBe(1);
    expect(screen.shown[0]?.props.title).toBe('.bashrc');
    expect(await runLine('less')).toMatchObject({ status: 1, stderrPlain: 'Missing filename ("less --help" for help)' });
  });
});

describe('less beside ls', () => {
  it('is not what a typo of ls is taken for: the guess shares more of the start', async () => {
    expect(await runLine('lss')).toMatchObject({ status: 127, stderrPlain: "vesen: lss: command not found\nDid you mean ls? Type 'help' to see all commands." });
    expect((await runLine('lesss')).stderrPlain).toContain('Did you mean less?');
  });
});

describe('less into a pipe', () => {
  it('copies its input exactly, as cat does', async () => {
    const cat = await runLine('cat .bashrc', { tty: false });
    expect(await runLine('less .bashrc', { tty: false })).toMatchObject({ status: 0, stdoutPlain: cat.stdoutPlain });
    expect((await runLine("printf 'a\\nb' | less", { tty: false })).stdoutPlain).toBe('a\nb');
    expect((await runLine('less .bashrc .profile', { tty: false })).stdoutPlain).toMatch(/^::::::::::::::\n\.bashrc\n::::::::::::::\n/);
    expect(await runLine('less nope', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'nope: No such file or directory' });
  });
});

describe('more', () => {
  it('prints what fits on the screen, with no pager', async () => {
    const screen = pagerScreen();
    const result = await runLine('more .bashrc', { fullscreen: screen.fullscreen });
    expect(screen.fullscreen).not.toHaveBeenCalled();
    expect(result.stdoutPlain).toBe((await runLine('cat .bashrc')).stdoutPlain);
  });

  it('pages what does not, leaving at the end', async () => {
    const screen = pagerScreen();
    const result = await runLine('help --all | more', { fullscreen: screen.fullscreen });
    expect(result).toMatchObject({ status: 0, stdoutPlain: '' });
    expect(screen.shown[0]?.props).toMatchObject({ mode: 'more', title: '(standard input)' });
  });

  it("says what it cannot read, in more's words", async () => {
    expect(await runLine('more nope')).toMatchObject({ status: 1, stderrPlain: 'more: cannot open nope: No such file or directory' });
    expect(await runLine('more documents')).toMatchObject({ status: 1, stderrPlain: '*** documents: directory ***' });
    expect(await runLine('more')).toMatchObject({ status: 1, stderrPlain: "more: bad usage\nTry 'more --help' for more information." });
  });
});

describe('man in the pager', () => {
  it('opens its page in the pager on the terminal, and prints nothing', async () => {
    const screen = pagerScreen();
    const result = await runLine('man ls', { fullscreen: screen.fullscreen, cols: 100 });
    expect(result).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(screen.shown[0]?.props.title).toBe('Manual page ls(1)');
    const text = screen.text();
    expect(text[0]).toMatch(/^LS\(1\) +User Commands +LS\(1\)$/);
    expect(text).toContain('       -a, --all');
    // The same page a pipe receives.
    const piped = await runLine('man ls', { tty: false, cols: 100 });
    expect(text.join('\n')).toBe(piped.stdoutPlain);
  });

  it('pages several pages as one, and reports the ones it lacks first', async () => {
    const screen = pagerScreen();
    const result = await runLine('man pwd nope cd', { fullscreen: screen.fullscreen });
    expect(result).toMatchObject({ status: 16, stderrPlain: 'No manual entry for nope' });
    const text = screen.text();
    expect(text[0]).toMatch(/^PWD\(1\)/);
    expect(text.some((line) => /^CD\(1\)/.test(line))).toBe(true);
    expect(screen.shown[0]?.props.title).toBe('Manual page pwd(1)');
  });

  it('pages vesen(7), and prints when the pager cannot open', async () => {
    const screen = pagerScreen();
    await runLine('man vesen', { fullscreen: screen.fullscreen });
    expect(screen.shown[0]?.props.title).toBe('Manual page vesen(7)');
    const failed = pagerScreen(false);
    expect((await runLine('man pwd', { fullscreen: failed.fullscreen })).stdoutPlain).toMatch(/^PWD\(1\)/);
  });

  it('stays plain in a pipe, and opens the pager at the end of one', async () => {
    const screen = pagerScreen();
    const piped = await runLine('man pwd | cat', { fullscreen: screen.fullscreen });
    expect(piped.stdoutPlain).toMatch(/^PWD\(1\)/);
    expect(screen.fullscreen).not.toHaveBeenCalled();
    await runLine('man pwd | less', { fullscreen: screen.fullscreen });
    expect(screen.shown[0]?.props.title).toBe('(standard input)');
    expect(screen.text()[0]).toMatch(/^PWD\(1\)/);
  });
});
