// The catalogue's chunk: every spec file under src/commands/more/<category>/<name>.ts (text,
// files, shell, system, network, fun, editor), gathered here so they load together, after the
// kernel, as one chunk (`catalogue-*.js`, budgeted by scripts/check-bundle.mjs). src/commands/index.ts
// reaches this module only through import(), so nothing here is in the kernel's chunk, and a new
// command adds nothing to it. As in the core folders, a `name.run.ts` is a lazily loaded body,
// with its long help as `doc`, and stays out of this chunk too.

import type { CommandSpec } from '../../shell/types';

const modules = import.meta.glob<{ default?: CommandSpec }>(['./*/*.ts', '!./*/*.test.ts', '!./*/*.run.ts', '!./*/*.logos.ts', '!./lib/*.ts'], { eager: true });

/** The catalogue's specs, in path order. */
export function catalogueSpecs(): CommandSpec[] {
  return Object.keys(modules)
    .sort()
    .map((path) => modules[path]?.default)
    .filter((spec): spec is CommandSpec => spec !== undefined);
}
