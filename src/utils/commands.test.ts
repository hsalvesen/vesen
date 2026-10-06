// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('./commands/network');
  vi.doUnmock('./commands/fastfetch');
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('the lazily loaded network commands', () => {
  it('are all listed up front, so help and completion know them before they load', async () => {
    const { commands, NETWORK_COMMAND_NAMES } = await import('./commands');
    const { networkCommands } = await import('./commands/network');

    expect([...NETWORK_COMMAND_NAMES].sort()).toEqual(Object.keys(networkCommands).sort());
    for (const name of NETWORK_COMMAND_NAMES) expect(commands[name], name).toBeTypeOf('function');
  });

  it('say so, and ring the bell, when the command cannot be loaded', async () => {
    const beep = vi.fn();
    vi.doMock('./beep', () => ({ playBeep: beep }));
    vi.doMock('./commands/network', () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    const { commands } = await import('./commands');

    const output = await commands.weather?.(['Oslo']);

    expect(output).toContain('weather: could not load the command. Check the connection and try again.');
    expect(beep).toHaveBeenCalledTimes(1);
    vi.doUnmock('./beep');
  });
});

describe('fastfetch', () => {
  it('loads on first use, and says so when it cannot', async () => {
    const beep = vi.fn();
    vi.doMock('./beep', () => ({ playBeep: beep }));
    vi.doMock('./commands/fastfetch', () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    const { commands } = await import('./commands');

    expect(await commands.fastfetch?.([])).toContain('fastfetch: could not load the command. Check the connection and try again.');
    expect(beep).toHaveBeenCalledTimes(1);
    vi.doUnmock('./beep');
  });
});

describe('cathode', () => {
  it('lists the variations with the quality in force and why', async () => {
    const { processCommand } = await import('./commands');
    const { crtTier } = await import('../stores/cathode');
    crtTier.set({ tier: 'lite', reason: 'a touch screen', quality: 'auto' });

    const output = String(processCommand('cathode ls'));
    expect(output).toContain('<span class="out-accent">Quality:</span> <span class="out-strong">lite (auto: a touch screen)</span>');
    expect(output).toContain('cathode quality');
  });

  it('sets, reports and rejects a quality', async () => {
    const { processCommand } = await import('./commands');
    const { cathodeQuality, crtTier } = await import('../stores/cathode');
    const { get } = await import('svelte/store');
    // What bootstrap does when the quality changes.
    const stop = cathodeQuality.subscribe((quality) =>
      crtTier.set({ tier: quality === 'auto' ? 'full' : quality, reason: quality === 'auto' ? 'a desktop' : `set with cathode quality ${quality}`, quality }),
    );

    expect(processCommand('cathode quality lite')).toBe('Cathode quality set to lite: lite (set with cathode quality lite).');
    expect(get(cathodeQuality)).toBe('lite');
    expect(String(processCommand('cathode quality'))).toContain('Cathode quality: lite (set with cathode quality lite)');
    expect(processCommand('cathode quality AUTO')).toBe('Cathode quality set to auto: full (auto: a desktop).');

    const rejected = String(processCommand('cathode quality ultra'));
    expect(rejected).toContain('<span class="out-error">cathode: quality: ultra: not a quality</span>');
    expect(rejected).toContain('Choose one of: auto, full, lite, off.');
    expect(get(cathodeQuality)).toBe('auto');
    stop();
  });

  it('shows its usage, with the quality subcommand, in the help panels', async () => {
    const { processCommand } = await import('./commands');
    const usage = String(processCommand('cathode'));
    expect(usage).toContain('<div class="out-panel tone-link"><div class="out-panel-title">Usage:</div>');
    expect(usage).toContain('quality: auto, full, lite or off');
    expect(usage).toContain('cathode quality lite');
  });
});

describe('theme ls', () => {
  it('draws one row per theme with eight swatches in its own colours on its own background', async () => {
    const { processCommand } = await import('./commands');
    const output = String(processCommand('theme ls'));
    const rows = output.split('\n').filter((row) => row.includes('class="theme-name'));
    expect(rows).toHaveLength(10);
    const swamphen = rows.find((row) => row.includes('data-theme-name="swamphen"')) ?? '';
    expect(swamphen).toContain('theme-name is-current');
    expect(swamphen).toContain('<span class="swatches" aria-hidden="true" style="background-color: #222235;">');
    expect(swamphen.match(/██/g)).toHaveLength(8);
    expect(swamphen).toContain('<span style="color: #f60055;">██</span>');
  });
});

describe('errors', () => {
  it('report an unknown command the way a shell does, with a hint', async () => {
    const { processCommand } = await import('./commands');
    expect(processCommand('lss')).toBe(
      '<span class="out-error">vesen: lss: command not found</span>\n<span class="out-muted">Did you mean ls? Type \'help\' to see all commands.</span>',
    );
    expect(processCommand('qqqq')).toBe(
      '<span class="out-error">vesen: qqqq: command not found</span>\n<span class="out-muted">Type \'help\' to see all commands.</span>',
    );
    expect(String(processCommand('theme set nope'))).toContain('<span class="out-error">theme: nope: no such theme</span>');
  });
});

