import { parse, type SimpleCommand, type Pipeline, type Script } from './parser.ts';
import { createPipe, emptyStdin, collector, EPIPE, type ReadStream, type WriteStream } from './streams.ts';
type Ctx = { argv: string[]; stdin: ReadStream; stdout: WriteStream; stderr: WriteStream; env: Map<string, string>; signal: AbortSignal };
type Cmd = (c: Ctx) => Promise<number> | number;
const files = new Map<string, string>([['/home/guest/a.txt', 'banana\napple\ncherry\napple\n']]);
const nullSink: WriteStream = { isTTY: false, columns: 80, write() {}, end() {} };
const cmds: Record<string, Cmd> = {
  echo: async c => { await c.stdout.write(c.argv.slice(1).join(' ') + '\n'); return 0; },
  true: () => 0, false: () => 1,
  yes: async c => { const y = (c.argv[1] ?? 'y') + '\n'; for (;;) { if (c.signal.aborted) return 130; await c.stdout.write(y); } },
  head: async c => { const n = Number(c.argv[c.argv.indexOf('-n') + 1] || 10); let i = 0; for await (const l of c.stdin.lines()) { await c.stdout.write(l + '\n'); if (++i >= n) break; } c.stdin.close(); return 0; },
  sort: async c => { const t = c.argv[1] ? files.get('/home/guest/' + c.argv[1]) ?? '' : await c.stdin.text(); await c.stdout.write(t.split('\n').filter(Boolean).sort().join('\n') + '\n'); return 0; },
  uniq: async c => { const ls = (await c.stdin.text()).split('\n').filter(Boolean); await c.stdout.write(ls.filter((l, i) => l !== ls[i - 1]).join('\n') + '\n'); return 0; },
  wc: async c => { const t = await c.stdin.text(); await c.stdout.write(String(t.split('\n').length - 1) + '\n'); return 0; },
  cat: async c => { if (c.argv.length === 1) { await c.stdout.write(await c.stdin.text()); return 0; } let rc = 0; for (const f of c.argv.slice(1)) { const t = files.get('/home/guest/' + f); if (t === undefined) { await c.stderr.write(`cat: ${f}: No such file or directory\n`); rc = 1; } else await c.stdout.write(t); } return rc; },
};
const words = (sc: SimpleCommand, env: Map<string, string>) => sc.words.map(w => w.parts.map(p => p.kind === 'var' ? env.get(p.name) ?? '' : p.text).join(''));
async function runSimple(sc: SimpleCommand, stdin: ReadStream, stdout: WriteStream, stderr: WriteStream, env: Map<string, string>, signal: AbortSignal): Promise<number> {
  const argv = words(sc, env);
  for (const r of sc.redirects) {
    const target = r.target ? r.target.parts.map((p: any) => p.text).join('') : '';
    if (r.op === '2>&1') stderr = stdout;
    else if (r.op === '2>' || r.op === '2>>') stderr = target === '/dev/null' ? nullSink : fileSink(target, r.op === '2>>');
    else if (r.op === '>' || r.op === '>>') stdout = target === '/dev/null' ? nullSink : fileSink(target, r.op === '>>');
    else if (r.op === '<') { const t = files.get('/home/guest/' + target); if (t === undefined) { await stderr.write(`vesen: ${target}: No such file or directory\n`); return 1; } const p = createPipe(); p.w.write(t); p.w.end(); stdin = p.r; }
  }
  const fn = cmds[argv[0]];
  if (!fn) { await stderr.write(`vesen: ${argv[0]}: command not found\n`); return 127; }
  try { return await fn({ argv, stdin, stdout, stderr, env, signal }); }
  catch (e) { if (e instanceof EPIPE) return 141; throw e; }
}
function fileSink(name: string, append: boolean): WriteStream { const key = '/home/guest/' + name; if (!append) files.set(key, ''); return { isTTY: false, columns: 80, write(s) { files.set(key, (files.get(key) ?? '') + s); }, end() {} }; }
async function runPipeline(pl: Pipeline, out: WriteStream, err: WriteStream, env: Map<string, string>, signal: AbortSignal): Promise<number> {
  const n = pl.commands.length; let stdin: ReadStream = emptyStdin; const procs: Promise<number>[] = [];
  for (let i = 0; i < n; i++) {
    const last = i === n - 1; const pipe = last ? null : createPipe();
    const myOut = last ? out : pipe!.w; const myIn = stdin;
    procs.push(runSimple(pl.commands[i], myIn, myOut, err, env, signal).finally(() => { myOut.end(); if (myIn !== emptyStdin) myIn.close(); }));
    if (pipe) stdin = pipe.r;
  }
  const codes = await Promise.all(procs); const rc = codes[n - 1];
  return pl.negated ? (rc === 0 ? 1 : 0) : rc;
}
export async function run(line: string, env: Map<string, string>) {
  const out = collector(); const err = collector(); const ac = new AbortController();
  const script: Script = parse(line);
  for (const item of script.items) {
    let rc = await runPipeline(item.first, out, err, env, ac.signal); env.set('?', String(rc));
    for (const { op, pipeline } of item.rest) { if ((op === '&&') === (rc === 0)) { rc = await runPipeline(pipeline, out, err, env, ac.signal); env.set('?', String(rc)); } }
  }
  return { out: out.out, err: err.out, status: env.get('?') };
}
