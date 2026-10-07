// $(( )) loads its evaluator (./arith.ts) the first time a line uses it, so the kernel's chunk
// does without it. A load that fails is an expansion error that says why, and is tried again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WordToken } from './lexer-types';
import { lex } from './lexer';

function word(line: string): WordToken {
  const token = lex(line).tokens[0];
  if (token?.kind !== 'word') throw new Error(`no word in ${line}`);
  return token;
}

async function fresh() {
  vi.resetModules();
  const { Expander, loadArith } = await import('./expand');
  const expander = new Expander({
    vars: { get: () => undefined, set: () => {} },
    status: 0,
    pid: 1,
    argv0: 'vesen',
    args: [],
    home: '/home/guest',
    cwd: '/home/guest',
  });
  return { loadArith, expand: (line: string) => expander.fields([word(line)]) };
}

afterEach(() => {
  vi.doUnmock('./arith');
});

describe('the arithmetic evaluator', () => {
  it('loads once, the first time a line uses it', async () => {
    const { loadArith, expand } = await fresh();
    expect(loadArith()).toBe(loadArith());
    await expect(expand('$((6*7))')).resolves.toEqual(['42']);
  });

  it('says so when it cannot be loaded, and tries again next time', async () => {
    vi.doMock('./arith', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const { expand } = await fresh();
    await expect(expand('$((1+1))')).rejects.toThrow('arithmetic could not be loaded; check the connection and try again');
    vi.doUnmock('./arith');
    await expect(expand('$((1+1))')).resolves.toEqual(['2']);
  });
});
