// Keeps the kernel in one chunk. Left to itself, Rolldown splits every module the kernel shares
// with a later chunk (a command's body, the catalogue, help, Tab's engine) into a small chunk of
// its own, so the kernel came as a dozen files: on an HTTP/1.1 connection, with six requests at
// a time, the last of them arrived a round later. This names one group, `shell`, for the
// modules only the kernel brings: those its entry (src/app/shell.ts) imports, however deeply,
// that neither the page's entry (src/main.ts) nor anything that may load before the kernel
// (the interface's own chunks, the services and platform code they use) imports too. Those stay
// where Rolldown puts them, so nothing that comes first waits for the kernel.
//
// Vite loads its config with Node, so this imports nothing from src.

/** What a chunking pass says about a module: its static imports. */
interface ModuleLike {
  readonly importedIds: readonly string[];
  readonly dynamicallyImportedIds: readonly string[];
}

export interface ChunkingContextLike {
  getModuleInfo(id: string): ModuleLike | null;
}

/** The folders whose chunks may come before the kernel. */
const EARLY = /[\\/]src[\\/](?:ui|platform|services|stores|app)[\\/]/;

/** `roots` and every module they import statically. */
function staticClosure(roots: readonly string[], ctx: ChunkingContextLike): Set<string> {
  const seen = new Set(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.pop() ?? '';
    for (const next of ctx.getModuleInfo(id)?.importedIds ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Every module reachable from `root`, through dynamic imports too. */
function everything(root: string, ctx: ChunkingContextLike): Set<string> {
  const seen = new Set([root]);
  const queue = [root];
  while (queue.length > 0) {
    const info = ctx.getModuleInfo(queue.pop() ?? '');
    for (const next of [...(info?.importedIds ?? []), ...(info?.dynamicallyImportedIds ?? [])]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * The modules of the `shell` group: the kernel entry's static closure, less the page entry's and
 * less that of any early module outside the kernel's own.
 */
export function kernelModules(page: string, kernelEntry: string, ctx: ChunkingContextLike): Set<string> {
  const ids = everything(page, ctx);
  if (!ids.has(kernelEntry)) return new Set();
  const kernel = staticClosure([kernelEntry], ctx);
  const early = [...ids].filter((id) => EARLY.test(id) && !kernel.has(id));
  const elsewhere = staticClosure([page, ...early], ctx);
  return new Set([...kernel].filter((id) => !elsewhere.has(id) && !id.includes('node_modules') && !id.startsWith('\0')));
}

/**
 * The group's name function for the app in `root`: `shell` for a kernel module, nothing for the
 * rest. The module set is worked out once a chunking pass.
 */
export function kernelChunk(root: string): (id: string, ctx: ChunkingContextLike) => string | null {
  const page = `${root}/src/main.ts`;
  const kernelEntry = `${root}/src/app/shell.ts`;
  let pass: { ctx: ChunkingContextLike; modules: Set<string> } | null = null;
  return (id, ctx) => {
    if (pass === null || pass.ctx !== ctx) pass = { ctx, modules: kernelModules(page, kernelEntry, ctx) };
    return pass.modules.has(id) ? 'shell' : null;
  };
}
