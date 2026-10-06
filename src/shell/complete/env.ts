// The completion environment over a session (docs/plan/designs/terminal-input.md,
// completionEnv): the registry, the files as the visitor may see them, the variables, aliases and
// history. The kernel builds one per shell; it is small and loads with the kernel, while the
// engine itself loads in its own chunk.

import type { Appearance } from '../../services/types';
import type { BoundVfs } from '../../vfs/types';
import type { CompletionEnv, CompletionFs, FsEntry } from './types';

/** The files, listed through the VFS with links followed. Never throws. */
export function vfsLister(fs: Pick<BoundVfs, 'readdir' | 'stat'>): CompletionFs {
  return {
    list(dir: string): readonly FsEntry[] | null {
      let names: string[];
      try {
        names = fs.readdir(dir, { all: true });
      } catch {
        return null;
      }
      const base = dir.endsWith('/') ? dir : `${dir}/`;
      return names.map((name): FsEntry => {
        try {
          const stat = fs.stat(base + name);
          if (stat.type === 'directory') return { name, type: 'dir' };
          return { name, type: 'file', exec: stat.type === 'file' && (stat.mode & 0o111) !== 0 };
        } catch {
          // A link to nothing is still a name.
          return { name, type: 'file' };
        }
      });
    },
  };
}

export interface CompletionParts {
  readonly registry: CompletionEnv['registry'];
  readonly fs: Pick<BoundVfs, 'readdir' | 'stat'>;
  cwd(): string;
  home(): string;
  vars(): readonly (readonly [string, string])[];
  aliases(): ReadonlyMap<string, string>;
  history(): readonly string[];
  readonly appearance?: Appearance;
}

export function createCompletionEnv(parts: CompletionParts): CompletionEnv {
  return {
    registry: parts.registry,
    fs: vfsLister(parts.fs),
    cwd: () => parts.cwd(),
    home: () => parts.home(),
    vars: () => parts.vars(),
    aliases: () => parts.aliases(),
    history: () => parts.history(),
    ...(parts.appearance === undefined ? {} : { appearance: parts.appearance }),
  };
}
