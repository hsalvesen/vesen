import { describe, expect, it } from 'vitest';
import { joinContinuation } from './continuation';

describe('joinContinuation', () => {
  it.each([
    ['echo a \\', 'b', 'backslash', 'echo a b'],
    ['ec\\', 'ho hi', 'backslash', 'echo hi'],
    ["echo 'one", "two'", 'quote', "echo 'one\ntwo'"],
    ['echo $(ls', ')', 'subst', 'echo $(ls\n)'],
    ['ls |', 'wc -l', 'pipe', 'ls | wc -l'],
    ['true &&', 'echo yes', 'andor', 'true && echo yes'],
  ] as const)('%j + %j (%s)', (previous, next, reason, joined) => {
    expect(joinContinuation(previous, next, reason)).toBe(joined);
  });
});
