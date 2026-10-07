// @vitest-environment happy-dom
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '../output/model';
import type { Booted, BootOptions } from './bootstrap';

const AREAS = ['localStorage', 'sessionStorage'] as const;
const saved = AREAS.map((name) => [name, Object.getOwnPropertyDescriptor(window, name)] as const);
let booted: Booted | null = null;

/** The banner the tests boot with: one line. */
const BANNER: Block[] = [{ type: 'lines', stream: 'stdout', lines: [[{ text: 'BANNER' }]] }];

/** The head index.html ships with, as far as bootstrap is concerned. */
const STATIC_HEAD = `
  <meta name="theme-color" content="#222235" />
  <link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png" />
  <link rel="icon" href="/icons/theme/swamphen.svg" sizes="any" type="image/svg+xml" />`;

beforeEach(() => {
  vi.resetModules();
  document.head.innerHTML = STATIC_HEAD;
});

afterEach(() => {
  booted?.stop();
  booted = null;
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(window, name, descriptor);
    else Reflect.deleteProperty(window, name);
  }
  localStorage.clear();
  sessionStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('class');
  vi.restoreAllMocks();
});

function blockStorage(): void {
  for (const name of AREAS) {
    Object.defineProperty(window, name, {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  }
}

/** Fresh modules, as on a page load. */
async function load() {
  const app = await import('./bootstrap');
  const { theme, findTheme } = await import('../stores/theme');
  const { cathode, cathodeQuality, crtTier } = await import('../stores/cathode');
  const { screen } = await import('../stores/screen');
  const boot = (options: Partial<BootOptions> = {}) => {
    booted = app.bootstrap({ window, build: '/assets/index-test.js', banner: () => BANNER, ...options });
    return booted;
  };
  const setTheme = (name: string) => {
    const found = findTheme(name);
    if (!found) throw new Error(`no theme ${name}`);
    theme.set(found);
  };
  return { ...app, boot, theme, setTheme, cathode, cathodeQuality, crtTier, screen };
}

/** What an entry shows: its prompt and line, then its lines' text, and other blocks by type. */
function shown(entry: { prompt: readonly { text: string }[] | null; line: string; blocks: readonly Block[] }): string[] {
  return [
    ...(entry.prompt === null ? [] : [`${entry.prompt.map((span) => span.text).join('')} ${entry.line}`]),
    ...entry.blocks.flatMap((block) =>
      block.type === 'lines' ? block.lines.map((line) => line.map((span) => span.text).join('')) : [`[${block.type}]`],
    ),
  ];
}

const themeColor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
const svgIcon = () => document.querySelector('link[type="image/svg+xml"]')?.getAttribute('href');

describe('bootstrap', () => {
  it('boots with the defaults and the banner when storage is blocked', async () => {
    blockStorage();
    const { boot, screen, setTheme } = await load();

    const result = boot();

    expect(result?.storage.local.persistent).toBe(false);
    expect(screen.entries().map(shown)).toEqual([['guest@vesen:~$ banner', 'BANNER']]);
    expect(themeColor()).toBe('#222235');
    expect(svgIcon()).toBe('/icons/theme/swamphen.svg');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect([...document.documentElement.classList].sort()).toEqual(['crt-on', 'crt-scanlines', 'crt-tier-full']);

    // Themes still change for the session.
    setTheme('cockatoo');
    expect(themeColor()).toBe('#e8ddd0');
  });

  it('migrates and applies what a returning visitor chose before the overhaul', async () => {
    localStorage.setItem('colorscheme', JSON.stringify({ name: 'cockatoo', background: '#000000' }));
    localStorage.setItem('cathode', 'vintage');
    localStorage.setItem('history', '[{"command":"echo secret","outputs":[]}]');
    localStorage.setItem('commandHistory', '["echo secret"]');
    const { boot, theme, cathode } = await load();

    boot();

    expect(get(theme).background).toBe('#e8ddd0');
    expect(get(cathode)).toBe('vintage');
    expect(themeColor()).toBe('#e8ddd0');
    expect(svgIcon()).toBe('/icons/theme/cockatoo.svg');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(document.documentElement.classList.contains('crt-vintage')).toBe(true);
    expect({ ...localStorage }).toEqual({ 'vesen:theme:v1': 'cockatoo', 'vesen:cathode:v1': '{"mode":"vintage"}' });
  });

  it('saves a new theme by name', async () => {
    const { boot, setTheme, cathode } = await load();
    boot();
    expect(localStorage.length).toBe(0);

    setTheme('wombat');
    cathode.set('off');

    expect(localStorage.getItem('vesen:theme:v1')).toBe('wombat');
    expect(localStorage.getItem('vesen:cathode:v1')).toBe('{"mode":"off"}');
    expect(document.documentElement.classList.contains('crt-on')).toBe(false);
  });

  it('applies the role colours with the palette, and again on each theme change', async () => {
    const { boot, setTheme } = await load();
    const { deriveRoles } = await import('../lib/roles');
    const { themes } = await import('../stores/theme');
    boot();
    const role = (name: string) => document.documentElement.style.getPropertyValue(`--role-${name}`);
    const swamphen = deriveRoles(themes.find((t) => t.name === 'swamphen') ?? themes[0]!);
    expect(role('error')).toBe(swamphen.error);
    expect(role('warn')).toBe('#f4c95d');

    setTheme('cockatoo');
    expect(role('fg-strong')).toBe('#20111b');
    expect(document.documentElement.style.getPropertyValue('--theme-white')).toBe('#625a53');
  });

  it('decides the CRT tier from the device, follows its settings, and lets the quality override it', async () => {
    const queries = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      const entry = queries.get(query) ?? { matches: query === '(pointer: coarse)', listeners: new Set<() => void>() };
      queries.set(query, entry);
      return {
        media: query,
        get matches() {
          return entry.matches;
        },
        addEventListener: (_: string, listener: () => void) => entry.listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => entry.listeners.delete(listener),
      } as unknown as MediaQueryList;
    });
    const { boot, cathodeQuality, crtTier } = await load();
    boot();
    const classes = () => [...document.documentElement.classList].sort();
    expect(classes()).toEqual(['crt-on', 'crt-scanlines', 'crt-tier-lite']);
    expect(get(crtTier)).toEqual({ tier: 'lite', reason: 'a touch screen', quality: 'auto' });

    // Reduced motion switched on while the page is open.
    const motion = queries.get('(prefers-reduced-motion: reduce)');
    if (!motion) throw new Error('reduced motion is not watched');
    motion.matches = true;
    for (const listener of motion.listeners) listener();
    expect(classes()).toEqual(['crt-tier-off']);

    cathodeQuality.set('full');
    expect(classes()).toEqual(['crt-on', 'crt-scanlines', 'crt-tier-full']);
    expect(localStorage.getItem('vesen:cathode:v1')).toBe('{"mode":"scanlines","quality":"full"}');
  });

  it('pauses the CRT animations while the page is hidden', async () => {
    let state: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    const { boot } = await load();
    boot();
    expect(document.documentElement.classList.contains('crt-paused')).toBe(false);
    state = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.documentElement.classList.contains('crt-paused')).toBe(true);
    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.documentElement.classList.contains('crt-paused')).toBe(false);
  });

  it('announces a reload for a stale chunk in the transcript', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    const { boot, screen } = await load();
    boot();

    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    const entries = screen.entries();
    const last = entries[entries.length - 1];
    expect(last?.line).toBe('');
    // A lines block, which the first paint's chunk draws itself: never a layout block, whose
    // renderer is in a chunk of its own, which may be one of those that failed to load.
    expect(last?.blocks).toMatchObject([{ type: 'lines', lines: [[{ text: 'vesen was updated, reloading…', style: { fg: 'warn', bold: true } }]] }]);
  });

  // `lss` is not a command, so the line waits for the whole catalogue, which a cold test run
  // compiles first: give it room.
  it('runs lines through the shell, whose kernel loads after the first paint, and keeps history', { timeout: 15_000 }, async () => {
    const { boot, screen } = await load();
    const shell = boot()?.shell;
    const running = shell?.run('lss');
    // On the screen from the moment it is typed, before the kernel has arrived.
    expect(screen.entries().find((entry) => entry.line === 'lss')).toMatchObject({ state: 'running', blocks: [] });
    const result = await running;
    expect(result?.status).toBe(127);
    // The kernel carried on with that entry: one entry, finished.
    const entries = screen.entries().filter((entry) => entry.line === 'lss');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ state: 'done', status: 127 });
    expect(JSON.parse(localStorage.getItem('vesen:history:v1') ?? '')).toEqual({ v: 1, lines: ['lss'] });
  });

  it('fetches the layout renderer beside the kernel, and the lazy commands once the page is idle', async () => {
    const richBlock = vi.fn(() => Promise.resolve({}));
    vi.doMock('../ui/rich-block', () => ({ loadRichBlock: richBlock }));
    const idle: (() => void)[] = [];
    vi.stubGlobal('requestIdleCallback', (run: () => void) => idle.push(run));
    try {
      const { boot } = await load();
      const booted = boot();
      expect(richBlock).toHaveBeenCalledTimes(1);
      const before = idle.length;
      await booted?.shell.run('true');
      // Queued for when the page is idle, once the kernel has booted.
      expect(idle).toHaveLength(before + 1);
      for (const run of idle.splice(before)) run();
    } finally {
      vi.doUnmock('../ui/rich-block');
      vi.unstubAllGlobals();
    }
  });

  it('sources ~/.bashrc before the first line, and saves files under ~ when the page is hidden', async () => {
    const { boot } = await load();
    const booted = boot();
    expect((await booted?.shell.run('alias ll'))?.status).toBe(0);
    await booted?.shell.run('pwd > where.txt');
    expect(localStorage.getItem('vesen:fs:v1')).toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    const saved = JSON.parse(localStorage.getItem('vesen:fs:v1') ?? '{}') as { overlay?: Record<string, { content?: string }> };
    expect(saved.overlay?.['/home/guest/where.txt']?.content).toBe('/home/guest\n');
  });

  it('keeps history for the session when storage is blocked', async () => {
    blockStorage();
    const { boot } = await load();
    const booted = boot();
    await booted?.shell.run('echo-nothing');
    expect(booted?.storage.local.persistent).toBe(false);
  });

  it('sends an alias host to the canonical origin and boots nothing', async () => {
    const replace = vi.fn();
    const { bootstrap, screen } = await load();
    const alias = { location: { href: 'https://vesen.app/docs?x=1#top', replace } } as unknown as Window;

    expect(bootstrap({ window: alias, build: 'b', banner: () => BANNER })).toBeNull();
    expect(replace).toHaveBeenCalledWith('https://www.vesen.app/docs?x=1#top');
    expect(screen.entries()).toEqual([]);
  });
});

describe('renderBootError', () => {
  it('replaces the app with a plain-text explanation', async () => {
    const { renderBootError } = await load();
    const target = document.createElement('div');
    target.innerHTML = '<main>half mounted</main>';
    document.body.append(target);

    renderBootError(document, target, new Error('mount failed <b>here</b>'));

    expect(target.children).toHaveLength(1);
    const message = target.querySelector('pre');
    expect(message?.getAttribute('role')).toBe('alert');
    expect(message?.textContent).toBe('vesen: failed to start\nmount failed <b>here</b>\n\nReload the page to try again.');
    expect(target.querySelector('b')).toBeNull();
  });

  it('writes into the body when #app is missing, whatever was thrown', async () => {
    const { renderBootError } = await load();
    renderBootError(document, null, 'storage exploded');
    expect(document.body.textContent).toContain('storage exploded');
  });
});
