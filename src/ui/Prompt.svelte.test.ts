import { render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { writable } from '../shell/observable';
import { promptLine, promptPath } from '../shell/prompt';
import { columns } from '../stores/term';
import Prompt from './Prompt.svelte';

const text = (container: Element) => container.textContent?.replace(/\s+/g, '') ?? '';

afterEach(() => {
  columns.set(80);
});

describe('Prompt', () => {
  it('renders the guest prompt at home', () => {
    const { container } = render(Prompt);
    expect(screen.getByText('guest')).toBeInTheDocument();
    expect(screen.getByText('$')).toBeInTheDocument();
    expect(text(container)).toBe('guest@vesen:~$');
  });

  it('names the brand as the host, whatever domain serves the page', () => {
    const { container } = render(Prompt);
    expect(location.hostname).not.toBe('vesen');
    expect(text(container)).toBe('guest@vesen:~$');
  });

  it('is a span, not a heading, so the page keeps one h1', () => {
    const { container } = render(Prompt);
    expect(container.querySelector('h1, h2, h3, [role="heading"]')).toBeNull();
    expect(container.firstElementChild?.localName).toBe('span');
  });

  it('follows the cwd and status stores, and turns the $ red after a failure', () => {
    const cwd = writable('/home/guest');
    const status = writable(0);
    const { container } = render(Prompt, { cwd, status });
    cwd.set('/home/guest/documents');
    flushSync();
    expect(text(container)).toBe('guest@vesen:~/documents$');
    cwd.set('/etc');
    status.set(1);
    flushSync();
    expect(text(container)).toBe('guest@vesen:/etc$');
    expect(screen.getByText('$').getAttribute('style')).toContain('--role-error');
    expect(screen.getByText('guest').getAttribute('style')).toContain('--role-prompt-user');
    expect(screen.getByText('vesen').getAttribute('style')).toContain('--role-prompt-host');
    expect(screen.getByText('/etc').getAttribute('style')).toContain('--role-prompt-path');
  });

  it('shortens a deep path below 50 columns', () => {
    const cwd = writable('/home/guest/projects/vesen/src');
    const { container } = render(Prompt, { cwd });
    expect(text(container)).toBe('guest@vesen:~/projects/vesen/src$');
    columns.set(40);
    flushSync();
    expect(text(container)).toBe('guest@vesen:~/.../src$');
  });

  it('draws a snapshot as it was, whatever the stores say now', () => {
    const cwd = writable('/tmp');
    const { container } = render(Prompt, { line: promptLine({ cwd: '/home/guest/documents', status: 0, columns: 80 }), cwd });
    expect(text(container)).toBe('guest@vesen:~/documents$');
  });
});

describe('promptPath', () => {
  it.each([
    ['/home/guest', 80, '~'],
    ['/home/guest/documents', 80, '~/documents'],
    ['/home/guests', 80, '/home/guests'],
    ['/home/guest/projects/vesen', 40, '~/.../vesen'],
    ['/home/guest/documents', 40, '~/documents'],
    ['/usr/share/man/man1', 40, '/.../man1'],
    ['/usr/share', 40, '/usr/share'],
    ['/', 40, '/'],
    // A long folder name keeps its end, so the prompt takes at most 60% of a 320 px phone.
    ['/home/guest/my-portfolio-website-2026', 37, '…ite-2026'],
    ['/home/guest/projects/my-awesome-project', 44, '…some-project'],
    ['/home/guest/projects/my-awesome-project', 80, '~/projects/my-awesome-project'],
    ['/home/guest/a/very/deep/folder/tree/with/many/levels/inside', 80, '~/.../inside'],
    ['/home/guest/x', 10, '~/x'],
    ['/home/guest/abcdefghij', 10, '…fghij'],
  ])('%s at %i columns is %s', (cwd, cols, expected) => {
    expect(promptPath(cwd, cols)).toBe(expected);
  });

  it('keeps the whole prompt within 60% of the columns, whatever the folder', () => {
    for (const cols of [37, 44, 60, 80, 120]) {
      const line = promptLine({ cwd: `/home/guest/${'long-folder-name-'.repeat(8)}end`, status: 0, columns: cols });
      expect(line.map((span) => span.text).join('').length, `${cols}`).toBeLessThanOrEqual(Math.floor(cols * 0.6));
    }
  });
});
