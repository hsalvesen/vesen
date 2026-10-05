// Prototype lexer for the vesen shell design. Word parts keep quoting info so
// expansion can decide what to glob / split.
export type WordPart =
  | { kind: 'lit'; text: string; quoted: boolean }   // quoted => no glob, no ~
  | { kind: 'var'; name: string; quoted: boolean }   // $NAME ${NAME} $? $#
export interface Word { parts: WordPart[]; start: number; end: number }
export type Op = '|' | '||' | '&&' | ';' | '>' | '>>' | '<' | '2>' | '2>>' | '&>' | '2>&1' | '&';
export type Token =
  | { t: 'word'; word: Word }
  | { t: 'op'; op: Op; start: number; end: number }
export class ShellSyntaxError extends Error { pos: number; incomplete: boolean; constructor(msg: string, pos: number, incomplete = false) { super(msg); this.pos = pos; this.incomplete = incomplete; } }

const OPS: Op[] = ['2>&1', '2>>', '&>', '||', '&&', '>>', '2>', '|', ';', '>', '<', '&'];
const VAR_START = /[A-Za-z_]/; const VAR_CH = /[A-Za-z0-9_]/;

export function lex(src: string): Token[] {
  const out: Token[] = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (c === '#') break; // comment to EOL
    // operator? (2> only when '2' starts a word)
    const op = OPS.find(o => src.startsWith(o, i));
    if (op) { out.push({ t: 'op', op, start: i, end: i + op.length }); i += op.length; continue; }
    // word
    const start = i; const parts: WordPart[] = [];
    let buf = ''; const flush = (quoted: boolean) => { if (buf) { parts.push({ kind: 'lit', text: buf, quoted }); buf = ''; } };
    while (i < src.length) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\n') break;
      if ('|;&<>'.includes(ch)) break;
      if (ch === '\\') { flush(false); if (i + 1 >= src.length) throw new ShellSyntaxError('trailing backslash', i, true); parts.push({ kind: 'lit', text: src[i + 1], quoted: true }); i += 2; continue; }
      if (ch === "'") { flush(false); const j = src.indexOf("'", i + 1); if (j < 0) throw new ShellSyntaxError("unexpected EOF while looking for matching `''", i, true); parts.push({ kind: 'lit', text: src.slice(i + 1, j), quoted: true }); i = j + 1; continue; }
      if (ch === '"') {
        flush(false); i++; let q = '';
        while (true) {
          if (i >= src.length) throw new ShellSyntaxError('unexpected EOF while looking for matching `"\'', start, true);
          const d = src[i];
          if (d === '"') { i++; break; }
          if (d === '\\' && '"\\$`'.includes(src[i + 1] ?? '')) { q += src[i + 1]; i += 2; continue; }
          if (d === '$') { const v = readVar(src, i); if (v) { if (q) { parts.push({ kind: 'lit', text: q, quoted: true }); q = ''; } parts.push({ kind: 'var', name: v.name, quoted: true }); i = v.end; continue; } }
          q += d; i++;
        }
        parts.push({ kind: 'lit', text: q, quoted: true }); continue;
      }
      if (ch === '$') { const v = readVar(src, i); if (v) { flush(false); parts.push({ kind: 'var', name: v.name, quoted: false }); i = v.end; continue; } }
      buf += ch; i++;
    }
    flush(false);
    // "2>" glued: a bare word "2" immediately followed by > is fd redirect
    out.push({ t: 'word', word: { parts, start, end: i } });
  }
  return out;
}
function readVar(src: string, i: number): { name: string; end: number } | null {
  const n = src[i + 1];
  if (n === '{') { const j = src.indexOf('}', i + 2); if (j < 0) throw new ShellSyntaxError('bad substitution', i, true); return { name: src.slice(i + 2, j), end: j + 1 }; }
  if (n === '?' || n === '#' || n === '$' || n === '0') return { name: n, end: i + 2 };
  if (n && VAR_START.test(n)) { let j = i + 1; while (j < src.length && VAR_CH.test(src[j])) j++; return { name: src.slice(i + 1, j), end: j }; }
  return null;
}
