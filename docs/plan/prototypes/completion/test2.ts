import { complete, applyText } from './engine.ts';
import type { Spec } from './context.ts';
const f = { type: 'file' as const }; const d = (children: any) => ({ type: 'directory' as const, children });
const fs = d({ home: d({ user: d({ 'README.md': f, 'history.txt': f, documents: d({ 'linux.txt': f, 'my notes.txt': f, 'my dir': d({ 'a.txt': f }) }), '.bashrc': f, '.ssh': d({ config: f }) }) }), etc: d({ hosts: f, passwd: f, 'os-release': f }) });
const reg = new Map<string, Spec>();
for (const s of [
  { name: 'cat', args: [{ name: 'file', completer: 'path:file', variadic: true }] },
  { name: 'cd', args: [{ name: 'dir', completer: 'path:dir' }] }, { name: 'cathode', subcommands: [{ name: 'ls' }, { name: 'set', args: [{ name: 'mode', completer: 'enum:cathode' }] }, { name: 'off' }] },
  { name: 'clear' }, { name: 'curl' }, { name: 'theme', subcommands: [{ name: 'ls' }, { name: 'set', args: [{ name: 't', completer: 'enum:theme' }] }] },
  { name: 'rm', options: [{ short: 'r', long: 'recursive' }, { short: 'f', long: 'force' }], args: [{ name: 'f', completer: 'path:any', variadic: true }] },
] as Spec[]) reg.set(s.name, s);
const env = { fs, cwd: ['home', 'user'], home: ['home', 'user'], registry: reg, enums: { theme: () => ['cassowary', 'cockatoo', 'crocodile', 'kangaroo', 'kookaburra', 'petroica', 'swamphen', 'treefrog', 'wallaby', 'wombat'], cathode: () => ['scanlines', 'phosphor', 'vintage'] } };
for (const line of ['c', 'ca', 'cat', 'cat d', 'cat documents/', 'cat documents/l', 'cat documents/my', 'cat documents/my\\ n', 'cat "documents/my n', 'cat documents/my\\ d', 'cd ', 'cd d', 'cd /e', 'cat /etc/', 'cat .', 'cat ~/.s', 'theme set k', 'theme set w', 'cathode s', 'rm --', 'cat Doc', 'cd ../../e']) {
  const r = complete(line, line.length, env);
  let applied = '';
  if (r.candidates.length === 1) applied = applyText(line, r.ctx, r.candidates[0].value, r.candidates[0].suffix).line;
  else if (r.prefix.length > r.ctx.word.value.length) applied = applyText(line, r.ctx, r.prefix, '').line + '   (extend)';
  else applied = '(list) ' + r.candidates.map((c) => c.display).join('  ');
  console.log(JSON.stringify(line).padEnd(26), '=>', JSON.stringify(applied));
}
