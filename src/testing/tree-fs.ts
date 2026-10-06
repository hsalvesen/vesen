// A glob file system over a nested object, for tests: a string is a file, an object a folder.
import type { GlobFs } from '../shell/glob';

export function treeFs(tree: Record<string, unknown>): GlobFs {
  const find = (path: string): unknown => {
    let node: unknown = tree;
    for (const segment of path.split('/').filter((s) => s !== '')) {
      if (typeof node !== 'object' || node === null) return undefined;
      node = (node as Record<string, unknown>)[segment];
    }
    return node;
  };
  const isFolder = (node: unknown): node is Record<string, unknown> => typeof node === 'object' && node !== null;
  return {
    readdir: (path) => {
      const node = find(path);
      return isFolder(node) ? Object.keys(node) : null;
    },
    exists: (path) => find(path) !== undefined,
    isDirectory: (path) => isFolder(find(path)),
  };
}
