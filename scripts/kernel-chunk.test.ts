import { describe, expect, it } from 'vitest';
import { kernelChunk, kernelModules, type ChunkingContextLike } from './kernel-chunk.ts';

const ROOT = '/app';

/** A module graph: id -> [static imports, dynamic imports]. */
function graph(edges: Record<string, [string[], string[]?]>): ChunkingContextLike {
  return {
    getModuleInfo: (id) => {
      const entry = edges[id];
      return entry === undefined ? null : { importedIds: entry[0], dynamicallyImportedIds: entry[1] ?? [] };
    },
  };
}

const ctx = graph({
  '/app/src/main.ts': [['/app/src/output/model.ts'], ['/app/src/app/shell.ts', '/app/src/ui/RichBlock.svelte']],
  '/app/src/app/shell.ts': [['/app/src/shell/index.ts', '/app/src/output/model.ts', '/app/src/services/net.ts']],
  '/app/src/shell/index.ts': [['/app/src/shell/glob.ts', '/app/src/output/plain.ts'], ['/app/src/shell/help.ts']],
  '/app/src/shell/help.ts': [['/app/src/output/plain.ts']],
  '/app/src/ui/RichBlock.svelte': [['/app/src/services/net.ts']],
  '/app/src/output/model.ts': [[]],
  '/app/src/output/plain.ts': [[]],
  '/app/src/shell/glob.ts': [[]],
  '/app/src/services/net.ts': [[]],
});

describe('the kernel chunk', () => {
  it('groups what only the kernel imports, statically', () => {
    expect([...kernelModules('/app/src/main.ts', '/app/src/app/shell.ts', ctx)].sort()).toEqual([
      '/app/src/app/shell.ts',
      '/app/src/output/plain.ts',
      '/app/src/shell/glob.ts',
      '/app/src/shell/index.ts',
    ]);
  });

  it("leaves out the page's modules, what an earlier chunk shares, and what the kernel only import()s", () => {
    const name = kernelChunk(ROOT);
    expect(name('/app/src/output/model.ts', ctx)).toBeNull();
    expect(name('/app/src/services/net.ts', ctx)).toBeNull();
    expect(name('/app/src/shell/help.ts', ctx)).toBeNull();
    expect(name('/app/src/shell/glob.ts', ctx)).toBe('shell');
  });
});
