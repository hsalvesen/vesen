// How bash finds what a name runs, for type, which and command -v: an alias, then a keyword, then
// a builtin, then the first executable file of that name on $PATH. The registry's commands are
// files in /usr/bin (the VFS's stubs), except the ones bash builds in.

import type { CommandContext } from '../../shell/types';
import { shellQuote } from '../shell/alias';

/** bash's reserved words. */
export const KEYWORDS: ReadonlySet<string> = new Set([
  '!', '[[', ']]', '{', '}', 'case', 'coproc', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function', 'if', 'in',
  'select', 'then', 'time', 'until', 'while',
]);

/** bash's builtins: the commands the shell runs itself, which have no file on $PATH. */
export const BASH_BUILTINS: ReadonlySet<string> = new Set([
  '.', ':', '[', 'alias', 'bg', 'bind', 'break', 'builtin', 'caller', 'cd', 'command', 'compgen', 'complete', 'compopt',
  'continue', 'declare', 'dirs', 'disown', 'echo', 'enable', 'eval', 'exec', 'exit', 'export', 'false', 'fc', 'fg',
  'getopts', 'hash', 'help', 'history', 'jobs', 'kill', 'let', 'local', 'logout', 'mapfile', 'popd', 'printf', 'pushd',
  'pwd', 'read', 'readarray', 'readonly', 'return', 'set', 'shift', 'shopt', 'source', 'suspend', 'test', 'times', 'trap',
  'true', 'type', 'typeset', 'ulimit', 'umask', 'unalias', 'unset', 'wait',
]);

export type Found =
  | { readonly kind: 'alias'; readonly value: string }
  | { readonly kind: 'keyword' }
  | { readonly kind: 'builtin' }
  | { readonly kind: 'file'; readonly path: string };

/** True when `path` is a file the visitor may run. */
function runnable(ctx: CommandContext, path: string): boolean {
  try {
    return ctx.fs.stat(path).type === 'file' && ctx.fs.access(path, 'x');
  } catch {
    return false;
  }
}

/** The executable files `name` names: itself if it has a slash, else each match on $PATH, in order. */
export function searchPath(ctx: CommandContext, name: string, all: boolean): string[] {
  if (name.includes('/')) return runnable(ctx, ctx.resolve(name)) ? [name] : [];
  const found: string[] = [];
  for (const dir of (ctx.env.get('PATH') ?? '').split(':')) {
    if (dir === '') continue;
    const path = `${dir.replace(/\/+$/, '')}/${name}`;
    if (!runnable(ctx, ctx.resolve(path))) continue;
    found.push(path);
    if (!all) break;
  }
  return found;
}

/** What `name` would run, in bash's order of preference; every match with `all`, else the first. */
export function lookup(ctx: CommandContext, name: string, options: { all?: boolean; aliases?: boolean } = {}): Found[] {
  const all = options.all === true;
  const found: Found[] = [];
  const alias = options.aliases === false ? undefined : ctx.shell.aliases.get(name);
  if (alias !== undefined) found.push({ kind: 'alias', value: alias });
  if (KEYWORDS.has(name)) found.push({ kind: 'keyword' });
  const spec = ctx.shell.registry.get(name);
  const files = searchPath(ctx, name, all);
  // A registry command bash builds in, or one with no file where $PATH leads, the shell runs itself.
  if (spec !== undefined && (BASH_BUILTINS.has(name) || files.length === 0)) found.push({ kind: 'builtin' });
  for (const path of files) found.push({ kind: 'file', path });
  return all ? found : found.slice(0, 1);
}

/** type's sentence for one finding: `ls is /usr/bin/ls`. */
export function describe(name: string, found: Found): string {
  switch (found.kind) {
    case 'alias':
      return `${name} is aliased to \`${found.value}'`;
    case 'keyword':
      return `${name} is a shell keyword`;
    case 'builtin':
      return `${name} is a shell builtin`;
    case 'file':
      return `${name} is ${found.path}`;
  }
}

/** command -v's word for one finding: the alias as it would be defined, the name, or the path. */
export function brief(name: string, found: Found): string {
  switch (found.kind) {
    case 'alias':
      return `alias ${name}=${shellQuote(found.value)}`;
    case 'keyword':
    case 'builtin':
      return name;
    case 'file':
      return found.path;
  }
}
