// Every spec file's offline examples run with status 0 on a fresh VFS, on the terminal and into a
// pipe, so the examples help, man and the starter chips show always work
// (docs/plan/08-shell-and-commands.md, acceptance).
import { describe, expect, it } from 'vitest';
import { runLine } from '../../tests/harness';
import { specFiles } from './index';

const examples = specFiles().flatMap((spec) => (spec.examples ?? []).filter((example) => example.offline).map((example) => [spec.name, example.line] as const));

describe('offline examples', () => {
  it('exist for every spec file', () => {
    const without = specFiles()
      .filter((spec) => !(spec.examples ?? []).some((example) => example.offline))
      .map((spec) => spec.name);
    expect(without).toEqual([]);
    expect(examples.length).toBeGreaterThan(40);
  });

  it.each(examples)('%s: %s exits 0 on the terminal', async (_name, line) => {
    const result = await runLine(line, { cols: 80, tty: true });
    expect(result.status, result.stderrPlain).toBe(0);
  });

  it.each(examples)('%s: %s exits 0 into a pipe', async (_name, line) => {
    const result = await runLine(line, { cols: 80, tty: false });
    expect(result.status, result.stderrPlain).toBe(0);
  });
});
