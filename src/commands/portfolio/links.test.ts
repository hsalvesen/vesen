// The openers (docs/plan/04-phone-and-instagram.md, "Inside Instagram's browser"; F051): whoami,
// about, contact and email, repo, open and xdg-open print link cards everywhere, open a tab only
// on a desktop browser through the spec's opens(), and never open a mail app by itself.
import { describe, expect, it, vi } from 'vitest';
import { session, type RunOptions } from '../../../tests/harness';
import type { Block, CardBlock } from '../../output/model';
import { fakeOpener } from '../../testing/opener';
import { autoOpenUrl, firstOperand, webUrl } from '../lib/web-url';
import { mailHref } from '../lib/cards';

const cards = (blocks: readonly Block[]): CardBlock[] => blocks.filter((block): block is CardBlock => block.type === 'card');

/** A session, the line's preflight inside the "gesture", then the line. */
async function typed(line: string, options: RunOptions = {}) {
  const s = await session(options);
  const preflight = s.app.shell.preflight(line);
  const result = await s.run(line);
  s.stop();
  return { ...result, preflight };
}

/** A desktop browser's opener, recording what it opened. */
function desktop() {
  const opened: string[] = [];
  return {
    opened,
    opener: fakeOpener({
      autoOpen: true,
      plan: (url) => ({ mode: /^https?:/.test(url) ? 'window' : 'card-only', target: '_blank' }),
      preflight: (url) => {
        if (!/^https?:/.test(url)) return 'skipped';
        opened.push(url);
        return 'opened';
      },
    }),
  };
}

describe('whoami', () => {
  it('names the developer and prints cards for LinkedIn, GitHub and email', async () => {
    const { status, blocks, stdoutPlain } = await typed('whoami');
    expect(status).toBe(0);
    expect(stdoutPlain.split('\n')[0]).toBe('Has Salvesen');
    expect(cards(blocks).map((card) => [card.title, card.href])).toEqual([
      ['LinkedIn', 'https://www.linkedin.com/in/harrysalvesen/'],
      ['GitHub', 'https://github.com/hsalvesen'],
      ['Email', expect.stringMatching(/^mailto:has@salvesen\.app\?subject=Terminal%20Contact%20-%20/)],
    ]);
    const email = cards(blocks)[2];
    expect(email).toMatchObject({ label: 'has@salvesen.app', copy: 'has@salvesen.app', openLabel: '✉ Open mail app', copyLabel: '⧉ Copy address' });
    // Outside an in-app browser there is no way out to offer.
    expect(email?.escape).toBeUndefined();
    expect(stdoutPlain).not.toContain('opened in a new tab');
  });

  it('opens LinkedIn on a desktop browser inside the gesture, once, and says so', async () => {
    const { opened, opener } = desktop();
    const { stdoutPlain, preflight } = await typed('whoami', { opener });
    expect(preflight?.opened).toBe('opened');
    expect(opened).toEqual(['https://www.linkedin.com/in/harrysalvesen/']);
    expect(stdoutPlain).toContain('(opened in a new tab)');
  });

  it('opens nothing inside an in-app browser, and offers the real browser beside the email', async () => {
    const preflight = vi.fn(() => 'skipped' as const);
    const { blocks, stdoutPlain } = await typed('whoami', { inApp: 'instagram', touch: true, opener: fakeOpener({ preflight }) });
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(stdoutPlain).not.toContain('opened');
    expect(cards(blocks)[2]?.escape).toEqual({ url: 'https://www.vesen.app/', hint: expect.stringContaining("mail app doesn't open") });
  });

  it('says when the browser blocked the tab', async () => {
    const { stdoutPlain } = await typed('whoami', { opener: fakeOpener({ autoOpen: true, preflight: () => 'blocked' }) });
    expect(stdoutPlain).toContain('the browser blocked the new tab');
  });

  it('prints the user name in a pipe, as the Linux command does', async () => {
    const s = await session({ tty: false });
    expect(await s.run('whoami')).toMatchObject({ status: 0, stdoutPlain: 'guest' });
    s.stop();
    const piped = await typed('whoami | cat');
    expect(piped.stdoutPlain).toBe('guest');
    expect(piped.preflight).toBeNull();
  });

  it('takes no operands', async () => {
    expect(await typed('whoami me')).toMatchObject({ status: 1, stderrPlain: expect.stringContaining("extra operand 'me'") });
  });
});

describe('repo', () => {
  it('prints one card, and opens it on a desktop', async () => {
    const { opened, opener } = desktop();
    const repo = await typed('repo', { opener });
    expect(cards(repo.blocks).map((card) => [card.title, card.href])).toEqual([['vesen on GitHub', 'https://github.com/hsalvesen/vesen']]);
    expect(opened).toEqual(['https://github.com/hsalvesen/vesen']);
  });

  it('prints the URL in a pipe', async () => {
    const s = await session({ tty: false });
    expect((await s.run('repo')).stdoutPlain).toBe('https://github.com/hsalvesen/vesen');
    s.stop();
  });

  it('is the only way to LinkedIn besides whoami and about: there is no linkedin command', async () => {
    // whoami shows the LinkedIn card and opens it on a desktop, so a command of its own went.
    expect(await typed('linkedin')).toMatchObject({ status: 127, stderrPlain: expect.stringContaining('linkedin: command not found') });
  });
});

describe('contact and email', () => {
  it('print the address card and never open a mail app by themselves', async () => {
    const { opened, opener } = desktop();
    for (const line of ['contact', 'email']) {
      const { status, blocks, preflight } = await typed(line, { opener });
      expect(status).toBe(0);
      expect(preflight?.opened).toBeUndefined();
      expect(cards(blocks)).toHaveLength(1);
      expect(cards(blocks)[0]).toMatchObject({ title: 'Email', label: 'has@salvesen.app' });
    }
    expect(opened).toEqual([]);
  });

  it('print the address in a pipe', async () => {
    const s = await session({ tty: false });
    expect((await s.run('email')).stdoutPlain).toBe('has@salvesen.app');
    s.stop();
  });

  it('carry the time in the subject, so threads stay apart', () => {
    expect(decodeURIComponent(mailHref(Date.UTC(2026, 9, 6, 9, 0, 0)))).toMatch(/^mailto:has@salvesen\.app\?subject=Terminal Contact - 10\/06\/2026, \d\d:00:00$/);
  });
});

describe('about', () => {
  it("prints the developer's own summary, then the cards", async () => {
    const { status, stdoutPlain, blocks } = await typed('about');
    expect(status).toBe(0);
    expect(stdoutPlain).toContain('# Has Salvesen');
    expect(stdoutPlain).toContain('I built vesen');
    expect(cards(blocks).map((card) => card.title)).toEqual(['LinkedIn', 'GitHub', 'Email']);
  });

  it('is only the summary in a pipe', async () => {
    const s = await session({ tty: false });
    const { stdoutPlain } = await s.run('about');
    expect(stdoutPlain.startsWith('# Has Salvesen')).toBe(true);
    expect(stdoutPlain).not.toContain('Email\nhas@salvesen.app');
    s.stop();
  });
});

describe('open and xdg-open', () => {
  it('print a card for a URL, and a desktop opens a web address inside the gesture', async () => {
    const { opened, opener } = desktop();
    const { status, blocks } = await typed('open https://example.com/a', { opener });
    expect(status).toBe(0);
    expect(cards(blocks).map((card) => [card.title, card.href])).toEqual([['example.com', 'https://example.com/a']]);
    expect(opened).toEqual(['https://example.com/a']);
    await typed('xdg-open www.vesen.app', { opener });
    expect(opened).toEqual(['https://example.com/a', 'https://www.vesen.app/']);
  });

  it('take a bare name as https, opened only once it is known not to be a file', async () => {
    const { opened, opener } = desktop();
    // Not in the gesture's preflight, which cannot tell vesen.app from README.md...
    const { blocks, preflight } = await typed('open vesen.app', { opener });
    expect(preflight?.opened).toBeUndefined();
    expect(cards(blocks)[0]?.href).toBe('https://vesen.app/');
    // ...but by the command, as any opener outside a single simple line is.
    expect(opened).toEqual(['https://vesen.app/']);
  });

  it('refuse files and things that are not web links', async () => {
    expect(await typed('open README.md')).toMatchObject({ status: 1, stderrPlain: "open: README.md: a file, not a web link; try 'cat README.md'" });
    expect(await typed('open javascript:alert(1)')).toMatchObject({ status: 1, stderrPlain: expect.stringContaining('not a web link') });
    expect(await typed('open')).toMatchObject({ status: 1, stderrPlain: expect.stringContaining('a URL is required') });
  });

  it('with --external, offer the real browser inside an in-app one, behind a tap only', async () => {
    const openExternal = vi.fn(() => true);
    const { blocks } = await typed('open --external https://example.com', { inApp: 'instagram', touch: true, opener: fakeOpener({ openExternal }) });
    expect(cards(blocks)[0]?.escape).toEqual({ url: 'https://example.com/', hint: 'To open it in the real browser:' });
    expect(openExternal).not.toHaveBeenCalled();
    const outside = await typed('open --external https://example.com');
    expect(cards(outside.blocks)[0]?.escape).toBeUndefined();
    expect(outside.stdoutPlain).toContain('already the real browser');
  });
});

describe('web-url', () => {
  it('reads the first operand past the flags', () => {
    expect(firstOperand(['open', '--external', 'x'])).toBe('x');
    expect(firstOperand(['open', '--', '--x'])).toBe('--x');
    expect(firstOperand(['open', '--help'])).toBeUndefined();
  });

  it('opens only what is written as a web address', () => {
    expect(autoOpenUrl(['open', 'https://a.example'])).toBe('https://a.example/');
    expect(autoOpenUrl(['open', 'www.a.example'])).toBe('https://www.a.example/');
    expect(autoOpenUrl(['open', 'README.md'])).toBeNull();
    expect(autoOpenUrl(['open', 'mailto:a@b.example'])).toBeNull();
    expect(webUrl('mailto:a@b.example')).toBe('mailto:a@b.example');
    expect(webUrl('ftp://a.example')).toBeNull();
    expect(webUrl('hello')).toBeNull();
  });
});
