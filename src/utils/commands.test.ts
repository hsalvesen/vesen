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

    const output = await commands.stock?.(['AAPL']);

    expect(output).toContain('stock: could not load the command. Check the connection and try again.');
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

describe('qr', () => {
  it('loads on first use, with its encoder, and says so when it cannot', async () => {
    const beep = vi.fn();
    vi.doMock('./beep', () => ({ playBeep: beep }));
    vi.doMock('./commands/qr', () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    const { commands } = await import('./commands');

    expect(await commands.qr?.(['https://www.vesen.app'])).toContain('qr: could not load the command. Check the connection and try again.');
    expect(beep).toHaveBeenCalledTimes(1);
    vi.doUnmock('./beep');
    vi.doUnmock('./commands/qr');
  });
});

describe('help', () => {
  it('lays out each legacy help text as panels, for the shell to show on --help', async () => {
    const { legacyHelpHtml } = await import('./commands');
    expect(legacyHelpHtml('stock')).toContain('<div class="out-panel tone-link"><div class="out-panel-title">Usage:</div>');
    expect(legacyHelpHtml('constructor')).toBeUndefined();
    // A ported command's help comes from its spec, so its legacy help text is gone.
    for (const ported of ['ls', 'help', 'theme', 'cathode', 'banner']) expect(legacyHelpHtml(ported), ported).toBeUndefined();
  });
});

