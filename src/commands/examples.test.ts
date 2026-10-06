// Every spec file's offline examples run with status 0 on a fresh session, so the examples help,
// man and the starter chips show always work (docs/plan/08-shell-and-commands.md, acceptance).
import { describe, expect, it } from 'vitest';
import { createAppShell } from '../app/shell';
import { createScreen } from '../stores/screen';
import { stubCommands } from '../testing/shell-harness';
import { specFiles } from './index';

const examples = specFiles().flatMap((spec) => (spec.examples ?? []).filter((example) => example.offline).map((example) => [spec.name, example.line] as const));

describe('offline examples', () => {
  it('exist', () => {
    expect(examples.length).toBeGreaterThan(5);
  });

  it.each(examples)('%s: %s exits 0', async (_name, line) => {
    const app = createAppShell({ banner: () => '', specs: stubCommands(), screen: createScreen(), version: '0.0.0', yieldToHost: () => Promise.resolve() });
    await app.boot();
    const result = await app.shell.run(line);
    app.stop();
    expect(result.status, JSON.stringify(result.blocks)).toBe(0);
  });
});
