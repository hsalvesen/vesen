// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('./commands/network');
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
