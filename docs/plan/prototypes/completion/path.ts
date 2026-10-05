import { cursorContext, smartMatch, lcp, quoteFor } from './core.ts';
type Node = { type: 'file' | 'directory'; children?: Record<string, Node> };
const d = (c: Record<string, Node>): Node => ({ type: 'directory', children: c });
const f: Node = { type: 'file' };
const root = d({ home: d({ user: d({ 'README.md': f, 'history.txt': f, documents: d({ 'linux.txt': f }), 'my notes': d({}), '.bashrc': f }), projects: d({ vesen: d({}) }) }), etc: d({ hosts: f, 'os-release': f }) });
const cwd = ['home', 'user'];
function walk(segs: string[]): Node | null { let n: Node = root; for (const s of segs) { const c = n.children?.[s]; if (!c) return null; n = c; } return n; }
function norm(base: string[], rel: string[]): string[] { const out = [...base]; for (const s of rel) { if (s === '' || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return out; }
// returns {replaceFromOffsetInRaw, candidates}
export function completePath(fragment: string, filter: 'any' | 'dir' | 'file') {
  const slash = fragment.lastIndexOf('/');
  const dirPart = slash >= 0 ? fragment.slice(0, slash + 1) : '';
  const base = slash >= 0 ? fragment.slice(slash + 1) : fragment;
  let start: string[];
  let rest = dirPart;
  if (dirPart.startsWith('~/') || fragment === '~') { start = ['home', 'user']; rest = dirPart.slice(2); }
  else if (dirPart.startsWith('/')) { start = []; rest = dirPart.slice(1); }
  else start = cwd;
  if (fragment === '~') return { base: '~', cands: [{ value: '~', suffix: '/' }] };
  const dir = walk(norm(start, rest.split('/')));
  if (!dir?.children) return { base, cands: [] };
  const showHidden = base.startsWith('.');
  const cands = Object.entries(dir.children)
    .filter(([n]) => showHidden || !n.startsWith('.'))
    .filter(([, nd]) => filter === 'any' || (filter === 'dir' ? nd.type === 'directory' : true))
    .filter(([n]) => smartMatch(n, base))
    .map(([n, nd]) => ({ value: n, suffix: nd.type === 'directory' ? '/' : ' ' }));
  if (base === '' || base === '.' || base === '..') { if (filter !== 'file' && (base === '.' || base === '..')) cands.unshift({ value: '..', suffix: '/' }); }
  return { base, cands };
}
for (const [frag, filt] of [['', 'any'], ['doc', 'any'], ['~/doc', 'dir'], ['../', 'dir'], ['../pro', 'dir'], ['/e', 'any'], ['/etc/', 'any'], ['.', 'any'], ['my', 'any'], ['documents/l', 'file'], ['R', 'any'], ['r', 'any']] as const) {
  const r = completePath(frag, filt);
  console.log(JSON.stringify(frag).padEnd(16), r.cands.map((c) => quoteFor(c.value, 'none') + c.suffix).join('  '), '| lcp:', lcp(r.cands.map((c) => c.value), !/[A-Z]/.test(r.base)));
}
