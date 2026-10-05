import { analyze, type Spec, type Ctx } from './context.ts';
export interface Candidate { value: string; display: string; kind: string; suffix: '' | ' ' | '/'; description?: string }
type Node = { type: 'file' | 'directory'; children?: Record<string, Node> };
export interface Env { fs: Node; cwd: string[]; home: string[]; registry: Map<string, Spec>; enums: Record<string, () => string[]> }
const SPECIAL = /[\s"'\\|&;<>()$`*?#~!]/g;
export function escapeWord(v: string, quote: null | '"' | "'"): string {
  if (quote === "'") return v.replace(/'/g, `'\\''`);
  if (quote === '"') return v.replace(/(["\\$`])/g, '\\$1');
  return v.replace(SPECIAL, (m, off) => (m === '~' && off !== 0 ? m : '\\' + m));
}
function lookup(fs: Node, segs: string[]): Node | null { let n: Node | undefined = fs; for (const s of segs) { n = n?.children?.[s]; if (!n) return null; } return n; }
function resolveDir(dirPart: string, env: Env): string[] {
  let base = dirPart.startsWith('/') ? [] : dirPart === '~' || dirPart.startsWith('~/') ? [...env.home] : [...env.cwd];
  const rest = dirPart.startsWith('~') ? dirPart.slice(1) : dirPart;
  for (const s of rest.split('/').filter(Boolean)) { if (s === '..') base.pop(); else if (s !== '.') base.push(s); }
  return base;
}
function pathCandidates(word: string, filter: 'any' | 'file' | 'dir', env: Env): Candidate[] {
  const slash = word.lastIndexOf('/');
  const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
  const base = slash >= 0 ? word.slice(slash + 1) : word;
  if (word === '~') return [{ value: '~/', display: '~/', kind: 'dir', suffix: '' }];
  const dir = lookup(env.fs, resolveDir(dirPart, env));
  if (!dir?.children) return [];
  const showHidden = base.startsWith('.');
  let names = Object.keys(dir.children).filter((n) => n.startsWith(base) && (showHidden || !n.startsWith('.')));
  if (names.length === 0) names = Object.keys(dir.children).filter((n) => n.toLowerCase().startsWith(base.toLowerCase()) && (showHidden || !n.startsWith('.')));
  return names.sort().flatMap((n) => {
    const isDir = dir.children![n].type === 'directory';
    if (filter === 'dir' && !isDir) return [];
    return [{ value: dirPart + n + (isDir ? '/' : ''), display: n + (isDir ? '/' : ''), kind: isDir ? 'dir' : 'file', suffix: isDir ? '' : ' ' } as Candidate];
  });
}
export function lcp(xs: string[]): string { if (!xs.length) return ''; let p = xs[0]; for (const x of xs) { let i = 0; while (i < p.length && i < x.length && p[i] === x[i]) i++; p = p.slice(0, i); } return p; }
export function complete(line: string, cursor: number, env: Env): { ctx: Ctx; candidates: Candidate[]; prefix: string } {
  const ctx = analyze(line, cursor, env.registry);
  const w = ctx.word.value; let c: Candidate[] = [];
  const p = ctx.position;
  if (p.kind === 'commandName') c = [...env.registry.keys()].filter((n) => n.startsWith(w)).sort().map((n) => ({ value: n, display: n, kind: 'command', suffix: ' ' }));
  else if (p.kind === 'subcommand') c = p.spec.subcommands!.filter((s) => s.name.startsWith(w)).map((s) => ({ value: s.name, display: s.name, kind: 'subcommand', suffix: ' ' }));
  else if (p.kind === 'option') c = (p.spec.options ?? []).flatMap((o) => [o.short && '-' + o.short, o.long && '--' + o.long].filter(Boolean) as string[]).filter((f) => f.startsWith(w)).map((f) => ({ value: f, display: f, kind: 'flag', suffix: ' ' }));
  else if (p.kind === 'redirectTarget') c = pathCandidates(w, 'any', env);
  else if (p.kind === 'argument' && p.completer) {
    const [k, arg] = p.completer.split(':');
    if (k === 'path') c = pathCandidates(w, arg as any, env);
    if (k === 'enum') { const vals = env.enums[arg](); c = vals.filter((v) => v.toLowerCase().startsWith(w.toLowerCase())).map((v) => ({ value: v, display: v, kind: 'enum', suffix: ' ' })); }
  }
  return { ctx, candidates: c, prefix: lcp(c.map((x) => x.value)) };
}
export function applyText(line: string, ctx: Ctx, value: string, suffix: string): { line: string; cursor: number } {
  const q = ctx.word.quote;
  const quoteOpen = q ?? '';
  // Re-emit the whole word: keep the user's opening quote style, close it on a terminal (non-dir) completion
  const closes = q && suffix === ' ' ? q : '';
  const inserted = quoteOpen + escapeWord(value, q) + closes + suffix;
  const out = line.slice(0, ctx.word.start) + inserted + line.slice(ctx.word.end);
  return { line: out, cursor: ctx.word.start + inserted.length };
}
