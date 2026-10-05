import { complete } from './engine.ts';
import { applyRaw } from './apply2.ts';
import type { Spec } from './context.ts';
const f = { type: 'file' as const }; const d = (children: any) => ({ type: 'directory' as const, children });
const fs = d({ home: d({ user: d({ documents: d({ 'my notes.txt': f, "it's.txt": f }), '.ssh': d({ config: f }) }) }) });
const reg = new Map<string, Spec>([['cat', { name: 'cat', args: [{ name: 'f', completer: 'path:file', variadic: true }] }]]);
const env = { fs, cwd: ['home', 'user'], home: ['home', 'user'], registry: reg, enums: {} };
for (const line of ['cat ~/.s', 'cat ~/.ssh/c', "cat 'documents/my", 'cat documents/it', 'cat "documents/it', 'cat Documents/my']) {
  const r = complete(line, line.length, env); const c = r.candidates[0];
  if (!c) { console.log(JSON.stringify(line).padEnd(24), '=>', '(no completion)'); continue; }
  const raw = line.slice(r.ctx.word.start);
  console.log(JSON.stringify(line).padEnd(24), '=>', JSON.stringify(applyRaw(line, r.ctx, raw, c.value, c.suffix).line));
}
// Tab reducer
type TabState = { kind: 'idle' } | { kind: 'listed'; key: string } | { kind: 'cycling'; key: string; index: number; original: string };
type Ev = { n: number; extendable: boolean; key: string };
function reduce(s: TabState, e: Ev): [TabState, string] {
  if (e.n === 0) return [{ kind: 'idle' }, 'bell'];
  if (e.n === 1) return [{ kind: 'idle' }, 'apply-unique'];
  if (s.kind === 'cycling' && s.key === e.key) return [{ ...s, index: (s.index + 1) % e.n }, `cycle->${(s.index + 1) % e.n}`];
  if (e.extendable) return [{ kind: 'idle' }, 'extend-prefix'];
  if (s.kind === 'listed' && s.key === e.key) return [{ kind: 'cycling', key: e.key, index: 0, original: '' }, 'cycle->0'];
  return [{ kind: 'listed', key: e.key }, 'list'];
}
let s: TabState = { kind: 'idle' }; const out: string[] = [];
for (const e of [{ n: 5, extendable: false, key: 'c' }, { n: 5, extendable: false, key: 'c' }, { n: 5, extendable: false, key: 'c' }, { n: 5, extendable: false, key: 'c' }]) { const [ns, eff] = reduce(s, e); s = ns; out.push(eff); }
console.log('Tab x4 on "c":', out.join(', '));
