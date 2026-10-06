import { describe, expect, it } from 'vitest';
import { BrokenPipe, DEFAULT_BUDGET_MS, EXIT, GUEST, PROMPT_HOST, UsageError, defineCommand, type CommandSpec } from './types';

describe('defineCommand', () => {
  it('returns the spec unchanged', () => {
    const run = (): number => 0;
    const spec = defineCommand({ name: 'true', category: 'shell', summary: 'do nothing, successfully', run });
    expect(spec.run).toBe(run);
    expect(spec.name).toBe('true');
  });

  it('accepts a lazy load instead of run', () => {
    const spec = defineCommand({
      name: 'weather',
      category: 'network',
      summary: 'show the forecast',
      network: true,
      budgetMs: 25_000,
      loadingLabel: (argv) => `fetching forecast for ${argv.slice(1).join(' ') || 'your area'}`,
      args: [{ name: 'PLACE', source: { kind: 'examples', caseInsensitive: true, fromHistory: true }, optional: true, variadic: true }],
      examples: [{ line: 'weather Gadigal', starter: 7 }],
      load: async () => ({ run: () => 0 }),
    });
    expect(spec.loadingLabel?.(['weather', 'Oslo'])).toBe('fetching forecast for Oslo');
  });

  it('requires exactly one of run and load', () => {
    const run = (): number => 0;
    const load = async (): Promise<{ run: typeof run }> => ({ run });
    // @ts-expect-error neither run nor load
    const neither: CommandSpec = defineCommand({ name: 'a', category: 'fun', summary: 'a' });
    // @ts-expect-error both run and load
    const both: CommandSpec = defineCommand({ name: 'b', category: 'fun', summary: 'b', run, load });
    expect([neither, both]).toHaveLength(2);
  });
});

describe('kernel constants', () => {
  it('uses the conventional exit statuses', () => {
    expect(EXIT).toEqual({ ok: 0, error: 1, usage: 2, denied: 126, notFound: 127, interrupted: 130, brokenPipe: 141 });
    expect(DEFAULT_BUDGET_MS).toBe(15_000);
  });

  it('makes the visitor guest, uid 1000, at home in /home/guest, on host vesen', () => {
    expect(GUEST).toMatchObject({ name: 'guest', uid: 1000, gid: 1000, home: '/home/guest' });
    expect(PROMPT_HOST).toBe('vesen');
  });

  it('names its error classes', () => {
    expect(new UsageError('bad flag')).toMatchObject({ name: 'UsageError', message: 'bad flag' });
    expect(new BrokenPipe()).toBeInstanceOf(Error);
    expect(new BrokenPipe().name).toBe('BrokenPipe');
  });
});
